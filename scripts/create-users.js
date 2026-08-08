"use strict";

/**
 * Recreates the 2-step CloudPage automation ("2.1 Create Student Users" ->
 * "2.2 Update Student Users") as a single GitHub Actions job.
 *
 * The two-call sequence (Create, then a separate Update) is required
 * because SFMC's AccountUser Create call does not reliably honor
 * MustChangePassword=false on creation -- it has to be set again via a
 * follow-up Update call per user. See sfmc-client.js createUser() and
 * updateUserMustChangePasswordFalse().
 *
 * Inputs come from workflow_dispatch (see .github/workflows/create-users.yml)
 * mapped to env vars by the workflow. Org-level config (password, role,
 * email, parent MID) comes from repo Secrets/Variables; the per-run BU MID
 * and user list come from the workflow form.
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

/**
 * Parses the multi-line "username,Full Name" (or tab-separated) textarea
 * input into { userId, name } objects. One user per line. Blank lines and
 * a header row (if someone pastes "username,name") are skipped.
 */
function parseUserList(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,/).map((p) => p.trim());
      return { userId: parts[0] || "", name: parts[1] || "" };
    })
    .filter((u) => u.userId && u.userId.toLowerCase() !== "username");
}

async function main() {
  // --- Secrets (never printed) ---
  const subdomain = requireEnv("SFMC_SUBDOMAIN");
  const clientId = requireEnv("SFMC_CLIENT_ID");
  const clientSecret = requireEnv("SFMC_CLIENT_SECRET");
  const defaultPassword = requireEnv("DEFAULT_USER_PASSWORD");

  // --- Org-level config (repo Variables, fixed) ---
  const authMID = requireEnv("SFMC_PARENT_MID");
  const roleID = requireEnv("DEFAULT_USER_ROLE_ID");
  const userEmail = requireEnv("DEFAULT_USER_EMAIL");
  const logDeKey = process.env.LOG_DE_KEY || "Automation_Log_CreateVIWStudent";

  // --- Per-request inputs (from the workflow_dispatch form) ---
  const targetMID = requireEnv("TARGET_BU_MID").trim();
  const userListRaw = requireEnv("USER_LIST");
  const users = parseUserList(userListRaw);

  if (users.length === 0) {
    throw new Error("No users parsed from the user list input. Expected one 'username,Full Name' pair per line.");
  }

  summaryLine(`## Create Users in BU ${targetMID}`);
  summaryLine("");
  summaryLine(`Users to create: ${users.length}`);
  summaryLine("");

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  const log = async (username, status, message) => {
    try {
      await client.logRow(logDeKey, {
        Username: username,
        Status: status,
        Message: message,
        LogDate: new Date().toISOString(),
      });
    } catch (err) {
      summaryLine(`> ⚠️ Logging to ${logDeKey} failed: ${err.message}`);
    }
  };

  summaryLine("| Username | Name | Create | Set password never-expire |");
  summaryLine("|---|---|---|---|");

  let anyFailed = false;

  for (const user of users) {
    let createMark = "";
    let updateMark = "";

    try {
      const createResult = await client.createUser({
        userId: user.userId,
        password: defaultPassword,
        name: user.name || user.userId,
        email: userEmail,
        authMID,
        targetMID,
        roleID,
      });

      if (!createResult.ok) {
        createMark = `❌ ${createResult.statusMessage}`;
        updateMark = "skipped";
        anyFailed = true;
        await log(user.userId, "Failed: Create", createResult.statusMessage);
        summaryLine(`| ${user.userId} | ${user.name} | ${createMark} | ${updateMark} |`);
        continue;
      }

      createMark = "✅ OK";
      await log(user.userId, "Created", "AccountUser created");

      // --- Second call: required so the user isn't forced to change the
      // password again on next login (see file header for why this can't
      // be combined into the Create call above). ---
      const updateResult = await client.updateUserMustChangePasswordFalse({
        userId: user.userId,
        authMID,
      });

      if (!updateResult.ok) {
        updateMark = `❌ ${updateResult.statusMessage}`;
        anyFailed = true;
        await log(user.userId, "Failed: Update", updateResult.statusMessage);
      } else {
        updateMark = "✅ OK";
        await log(user.userId, "Complete", "Password never-expire set");
      }
    } catch (err) {
      anyFailed = true;
      createMark = createMark || `❌ ${err.message}`;
      updateMark = updateMark || "❌ exception";
      await log(user.userId, "Failed: Exception", err.message);
    }

    summaryLine(`| ${user.userId} | ${user.name} | ${createMark} | ${updateMark} |`);
  }

  summaryLine("");
  if (anyFailed) {
    summaryLine("### ⚠️ Completed with errors — see table above.");
    process.exitCode = 1;
    return;
  }

  summaryLine("### ✅ User creation automation complete.");
}

main().catch((err) => {
  summaryLine(`### ❌ Script exception: ${err.message}`);
  console.error(err);
  process.exitCode = 1;
});
