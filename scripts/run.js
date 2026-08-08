"use strict";

/**
 * Recreates the 3-step CloudPage automation (Create BU -> Update BU settings
 * -> Assign admin users) as a single GitHub Actions job.
 *
 * Inputs come from workflow_dispatch (see .github/workflows/create-business-unit.yml)
 * mapped to env vars by the workflow. Org-level config (parent MID, company
 * info, default admins) comes from repo Variables; secrets come from repo Secrets.
 */

const fs = require("fs");
const { SfmcClient } = require("./sfmc-client");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function summaryLine(line) {
  console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, line + "\n");
  }
}

async function main() {
  // --- Secrets (never printed) ---
  const subdomain = requireEnv("SFMC_SUBDOMAIN");
  const clientId = requireEnv("SFMC_CLIENT_ID");
  const clientSecret = requireEnv("SFMC_CLIENT_SECRET");

  // --- Org-level config (repo Variables, fixed) ---
  // authMID is the enterprise parent used for API auth/Client context on every
  // SOAP call (unchanged behavior). nestUnderMID is the MID of the BU that
  // newly created BUs should be nested under (ParentID) — a hardcoded repo
  // Variable, same pattern as authMID itself, rather than resolved by name at
  // runtime: MID is the durable identifier in SFMC (renaming the BU doesn't
  // change it), and hardcoding it avoids an extra Retrieve call and a runtime
  // failure mode if the BU's name ever changes or is mistyped.
  const authMID = requireEnv("SFMC_PARENT_MID");
  const nestUnderMID = requireEnv("NEST_UNDER_BU_MID");
  const buEmail = requireEnv("BU_EMAIL");
  const fromName = requireEnv("BU_FROM_NAME");
  const companyName = requireEnv("COMPANY_NAME");
  const streetAddr = requireEnv("COMPANY_ADDRESS");
  const city = requireEnv("COMPANY_CITY");
  const state = requireEnv("COMPANY_STATE");
  const zip = requireEnv("COMPANY_ZIP");
  const country = requireEnv("COMPANY_COUNTRY");
  const logDeKey = process.env.LOG_DE_KEY || "Automation_Log_CreateBU";

  // --- Per-request inputs (from the workflow_dispatch form) ---
  const buName = requireEnv("BU_NAME").trim();

  // Admin users are always the backend-configured default list (repo Variable
  // DEFAULT_ADMIN_USER_KEYS) — there is no per-run override input anymore.
  const adminUserKeys = requireEnv("DEFAULT_ADMIN_USER_KEYS")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (adminUserKeys.length === 0) {
    throw new Error("No admin user keys provided (input and default list were both empty).");
  }

  const customerKey = buName; // Matches original scripts: BU Name doubles as CustomerKey/ExternalKey

  summaryLine(`## Create Business Unit: ${buName}`);
  summaryLine("");
  summaryLine(`Admins to assign: ${adminUserKeys.join(", ")}`);
  summaryLine("");

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  const log = async (status) => {
    try {
      await client.logRow(logDeKey, {
        BU_Name: buName,
        Status: status,
        LogDate: new Date().toISOString(),
      });
    } catch (err) {
      summaryLine(`> ⚠️ Logging to ${logDeKey} failed: ${err.message}`);
    }
  };

  // === Step 1: Create Business Unit (mirrors 1.1) ===
  summaryLine("### Step 1 of 4: Create Business Unit");
  await log("New Business Unit Initiated (Step 1 of 4)");
  summaryLine(`Nesting new BU under MID: ${nestUnderMID}.`);

  const createResult = await client.createBusinessUnit({
    name: buName,
    customerKey,
    email: buEmail,
    fromName,
    authMID,
    nestUnderMID,
    businessName: companyName,
    address: streetAddr,
    city,
    state,
    zip,
    country,
  });

  if (!createResult.ok) {
    await log(`Failed: ${createResult.statusMessage}`);
    summaryLine(`❌ **FAILED:** ${createResult.statusMessage}`);
    process.exitCode = 1;
    return;
  }

  summaryLine(`✅ Created. New MID: ${createResult.newId || "(not returned)"}`);
  await log("New Business Unit Created (Step 2 of 4)");

  // === Step 2: Update Business Unit unsubscribe settings (mirrors 1.2) ===
  summaryLine("");
  summaryLine("### Step 2 of 4: Update Business Unit settings");

  const updateResult = await client.updateBusinessUnitUnsubscribe({ customerKey, parentMID: authMID });

  if (!updateResult.ok) {
    await log(`Failed Step 3: ${updateResult.statusMessage}`);
    summaryLine(`❌ **FAILED:** ${updateResult.statusMessage}`);
    process.exitCode = 1;
    return;
  }

  summaryLine("✅ Updated to BU-only unsubscribes.");
  await log("Business Unit Settings Updated (Step 3 of 4)");

  // === Step 3: Look up the new BU's MID, then assign admin users (mirrors 1.3) ===
  summaryLine("");
  summaryLine("### Step 3 of 4: Assign admin users");

  const buMap = await client.retrieveBusinessUnitMap();
  const targetMID = buMap[buName];

  if (!targetMID) {
    await log("Failed Step 4: BU Not Found in Account");
    summaryLine(`❌ **FAILED:** Could not find MID for "${buName}" after creation.`);
    process.exitCode = 1;
    return;
  }

  summaryLine(`Resolved MID: ${targetMID}`);
  summaryLine("");
  summaryLine("| Admin User Key | Result |");
  summaryLine("|---|---|");

  let anyFailed = false;
  for (const userKey of adminUserKeys) {
    try {
      const assignResult = await client.assignUserToBusinessUnit({
        userCustomerKey: userKey,
        targetMID,
        parentMID: authMID,
      });
      const mark = assignResult.ok ? "✅ OK" : `❌ ${assignResult.statusMessage}`;
      if (!assignResult.ok) anyFailed = true;
      summaryLine(`| ${userKey} | ${mark} |`);
    } catch (err) {
      anyFailed = true;
      summaryLine(`| ${userKey} | ❌ ${err.message} |`);
    }
  }

  summaryLine("");
  if (anyFailed) {
    await log("Failed Step 4: One or more admin user assignments failed");
    summaryLine("### ⚠️ Completed with errors — see admin assignment table above.");
    process.exitCode = 1;
    return;
  }

  await log("Business Unit Permissions Updated (Step 4 of 4)");
  await log("New Business Unit Automation Complete");
  summaryLine("### ✅ Business Unit automation complete.");
}

main().catch((err) => {
  summaryLine(`### ❌ Script exception: ${err.message}`);
  console.error(err);
  process.exitCode = 1;
});
