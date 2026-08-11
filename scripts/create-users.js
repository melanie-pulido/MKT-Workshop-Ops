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
 * email, parent MID) comes from repo Secrets/Variables; the per-run BU name
 * and user list come from the workflow form. The BU name is resolved to a
 * MID at runtime via retrieveBusinessUnitMap() -- the same lookup the
 * Create Business Unit workflow already uses to resolve a newly created
 * BU's MID by name (see scripts/run.js Step 3).
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

// GITHUB_STEP_SUMMARY is scoped per-step — a later step can't read the
// file this step wrote because the env var points to a new empty file.
// We also write to a fixed temp path that persists across steps so the
// "Post results" step can cat it into the issue comment.
const REPORT_PATH = "/tmp/create-users-report.md";

function summaryLine(line) {
  console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, line + "\n");
  }
  fs.appendFileSync(REPORT_PATH, line + "\n");
}

/**
 * Parses the multi-line "Full Name,username" (or tab-separated) textarea
 * input into { userId, name } objects. Column order is Name first,
 * Username second, matching how the source Google Sheet is laid out.
 *
 * Handles three paste shapes so both a direct Google Sheets copy-paste
 * and a plain CSV download-then-paste work without reformatting:
 *
 * 1. Plain "Name,Username" or "Name<TAB>Username" per line (CSV-style).
 * 2. A raw Google Sheets copy-paste, which wraps the data in an HTML
 *    comment like:
 *      <google-sheets-html-origin><style>...</style>
 *      Name | Username
 *      -- | --
 *      NTO Student 0001 | MKT001_0001
 *    That comment/style noise and the markdown table's own header +
 *    "-- | --" separator row are stripped before parsing rows.
 * 3. A plain markdown pipe table pasted without the Sheets wrapper
 *    (same "Name | Username" / "-- | --" shape, just no HTML comment).
 *
 * Blank lines and a literal header row ("name,username"/"name | username")
 * are skipped either way.
 */
function parseUserList(raw) {
  // Strip Google Sheets' HTML wrapper (the <google-sheets-html-origin>
  // comment and inline <style> block it injects) if present -- it isn't
  // valid HTML on its own, so this is done with a targeted string strip
  // rather than an HTML parser.
  let cleaned = raw.replace(/<google-sheets-html-origin>[\s\S]*?<\/style>/i, "");

  // Drop a markdown table's "-- | --" (or "---|---", any dash count)
  // separator row -- it carries no user data.
  cleaned = cleaned
    .split(/\r?\n/)
    .filter((line) => !/^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+$/.test(line))
    .join("\n");

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Markdown table rows use " | " between cells; plain CSV/TSV rows
      // use a bare comma or tab. Try pipe first since a name could
      // legitimately contain a comma but a pipe is unambiguous.
      const parts = (line.includes("|") ? line.split("|") : line.split(/\t|,/)).map((p) => p.trim());
      return { name: parts[0] || "", userId: parts[1] || "" };
    })
    .filter((u) => u.userId && u.name.toLowerCase() !== "name" && u.userId.toLowerCase() !== "username");
}

async function main() {
  // --- Secrets (never printed) ---
  const subdomain = requireEnv("SFMC_SUBDOMAIN");
  const clientId = requireEnv("SFMC_CLIENT_ID");
  const clientSecret = requireEnv("SFMC_CLIENT_SECRET");
  const defaultPassword = requireEnv("DEFAULT_USER_PASSWORD");

  // --- Org-level config (repo Variables, fixed) ---
  const authMID = requireEnv("SFMC_PARENT_MID");
  // Comma-separated list of Role ObjectIDs — every created user gets all
  // of these roles at once (e.g. Administrator + Marketing Cloud VIW).
  const roleIDs = requireEnv("DEFAULT_USER_ROLE_ID")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const userEmail = requireEnv("DEFAULT_USER_EMAIL");
  const logDeKey = process.env.LOG_DE_KEY || "Automation_Log_CreateVIWStudent";

  // --- Per-request inputs (from the workflow_dispatch form) ---
  const targetBuName = requireEnv("TARGET_BU_NAME").trim();
  const userListRaw = requireEnv("USER_LIST");
  const users = parseUserList(userListRaw);

  if (users.length === 0) {
    throw new Error("No users parsed from the user list input. Expected one 'username,Full Name' pair per line.");
  }

  summaryLine(`## Create Users in BU "${targetBuName}"`);
  summaryLine("");
  summaryLine(`Users to create: ${users.length}`);
  summaryLine("");

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  // Resolve the BU name to a MID before touching any users -- fail fast
  // and clearly if the name is wrong/misspelled, rather than partway
  // through creating users.
  const buMap = await client.retrieveBusinessUnitMap();
  const targetMID = buMap[targetBuName];

  if (!targetMID) {
    summaryLine(`❌ **FAILED:** Could not find a Business Unit named "${targetBuName}".`);
    process.exitCode = 1;
    return;
  }

  summaryLine(`Resolved "${targetBuName}" -> MID ${targetMID}`);
  summaryLine("");

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
        roleIDs,
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
