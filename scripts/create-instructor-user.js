"use strict";

/**
 * Creates a single SFMC instructor user in the THA Internal Business Unit.
 *
 * Unlike the student Create Users flow, each instructor has their own name,
 * username, and email supplied per-request via the Issue Form. Password and
 * role are hardcoded as repo Secret/Variable. The target BU (THA Internal)
 * is also hardcoded — resolved by name at runtime, same as the student flow.
 *
 * The same two-call sequence (Create, then Update MustChangePassword=false)
 * is used here for the same reason: SFMC's AccountUser Create does not
 * reliably honor MustChangePassword=false at creation time.
 */

const fs = require("fs");
const { SfmcClient } = require("./sfmc-client");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const REPORT_PATH = "/tmp/create-instructor-report.md";

function summaryLine(line) {
  console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) fs.appendFileSync(summaryPath, line + "\n");
  fs.appendFileSync(REPORT_PATH, line + "\n");
}

async function main() {
  // --- Secrets ---
  const subdomain    = requireEnv("SFMC_SUBDOMAIN");
  const clientId     = requireEnv("SFMC_CLIENT_ID");
  const clientSecret = requireEnv("SFMC_CLIENT_SECRET");
  const password     = requireEnv("INSTRUCTOR_USER_PASSWORD");

  // --- Org-level config (repo Variables) ---
  const authMID    = requireEnv("SFMC_PARENT_MID");
  const roleIDs    = requireEnv("INSTRUCTOR_USER_ROLE_ID")
    .split(",").map(r => r.trim()).filter(Boolean);
  const targetBuName = requireEnv("INSTRUCTOR_BU_NAME").trim();
  const logDeKey   = process.env.LOG_DE_KEY_CREATE_USERS || "Automation_Log_CreateVIWStudent";

  // --- Per-request inputs (from GITHUB_ENV, written by parse step) ---
  const name     = requireEnv("INSTRUCTOR_NAME").trim();
  const userId   = requireEnv("INSTRUCTOR_USERNAME").trim();
  const email    = requireEnv("INSTRUCTOR_EMAIL").trim();

  summaryLine(`## Create Instructor User: ${name}`);
  summaryLine("");
  summaryLine(`Username: ${userId}`);
  summaryLine(`Email:    ${email}`);
  summaryLine(`BU:       ${targetBuName}`);
  summaryLine("");

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  // Resolve BU name -> MID
  const buMap = await client.retrieveBusinessUnitMap();
  const targetMID = buMap[targetBuName];

  if (!targetMID) {
    summaryLine(`❌ **FAILED:** Could not find a Business Unit named "${targetBuName}".`);
    process.exitCode = 1;
    return;
  }

  summaryLine(`Resolved "${targetBuName}" -> MID ${targetMID}`);
  summaryLine("");

  const log = async (status, message) => {
    try {
      await client.logRow(logDeKey, {
        Username: userId,
        Status: status,
        Message: message,
        LogDate: new Date().toISOString(),
      });
    } catch (err) {
      summaryLine(`> ⚠️ Logging to ${logDeKey} failed: ${err.message}`);
    }
  };

  // === Step 1: Create the user ===
  summaryLine("### Step 1 of 2: Create user");

  const createResult = await client.createUser({
    userId,
    password,
    name,
    email,
    authMID,
    targetMID,
    roleIDs,
  });

  if (!createResult.ok) {
    summaryLine(`❌ **FAILED:** ${createResult.statusMessage}`);
    await log("Failed: Create", createResult.statusMessage);
    process.exitCode = 1;
    return;
  }

  summaryLine("✅ User created.");
  await log("Created", "Instructor AccountUser created");

  // === Step 2: Set MustChangePassword=false ===
  summaryLine("");
  summaryLine("### Step 2 of 2: Set password never-expire");

  const updateResult = await client.updateUserMustChangePasswordFalse({ userId, authMID });

  if (!updateResult.ok) {
    summaryLine(`❌ **FAILED:** ${updateResult.statusMessage}`);
    await log("Failed: Update", updateResult.statusMessage);
    process.exitCode = 1;
    return;
  }

  summaryLine("✅ Password never-expire set.");
  await log("Complete", "Instructor user creation complete");

  summaryLine("");
  summaryLine("### ✅ Instructor user creation complete.");
}

main().catch((err) => {
  summaryLine(`### ❌ Script exception: ${err.message}`);
  console.error(err);
  process.exitCode = 1;
});
