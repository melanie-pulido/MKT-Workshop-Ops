"use strict";

/**
 * Assigns an existing instructor user to a class Business Unit.
 * Does not remove any existing permissions — only adds the new BU.
 * If the user is already assigned, SFMC returns a success (idempotent).
 */

const fs = require("fs");
const { SfmcClient } = require("./sfmc-client");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const REPORT_PATH = "/tmp/add-instructor-report.md";

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

  // --- Org-level config ---
  const authMID  = requireEnv("SFMC_PARENT_MID");

  // --- Per-request inputs (from GITHUB_ENV, written by parse step) ---
  const username   = requireEnv("INSTRUCTOR_USERNAME").trim();
  const classBuName = requireEnv("CLASS_BU_NAME").trim();

  summaryLine(`## Add Instructor to Class`);
  summaryLine("");
  summaryLine(`Instructor: ${username}`);
  summaryLine(`Class BU:   ${classBuName}`);
  summaryLine("");

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  // Resolve BU name -> MID
  const buMap = await client.retrieveBusinessUnitMap();
  const targetMID = buMap[classBuName];

  if (!targetMID) {
    summaryLine(`❌ **FAILED:** Could not find a Business Unit named "${classBuName}".`);
    summaryLine("");
    summaryLine("Available Business Units:");
    Object.keys(buMap).sort().forEach(name => summaryLine(`- ${name}`));
    process.exitCode = 1;
    return;
  }

  summaryLine(`Resolved "${classBuName}" → MID ${targetMID}`);
  summaryLine("");
  summaryLine("### Assigning instructor to Business Unit…");

  const result = await client.assignUserToBusinessUnit({
    userCustomerKey: username,
    targetMID,
    parentMID: authMID,
  });

  if (!result.ok) {
    summaryLine(`❌ **FAILED:** ${result.statusMessage}`);
    process.exitCode = 1;
    return;
  }

  summaryLine(`✅ **${username}** has been added to **${classBuName}**.`);
  summaryLine("");
  summaryLine("### ✅ Complete.");
}

main().catch((err) => {
  summaryLine(`### ❌ Script exception: ${err.message}`);
  console.error(err);
  process.exitCode = 1;
});
