"use strict";

/**
 * Parses the "Create Users" GitHub Issue Form body into TARGET_BU_NAME and
 * USER_LIST, then writes them to GITHUB_ENV so the next step in the same
 * job (npm run create-users) can pick them up exactly like it does today
 * for workflow_dispatch inputs.
 *
 * Why this exists: GitHub's workflow_dispatch "Run workflow" web form only
 * renders `type: string` inputs as a single-line box, so pasting multiple
 * spreadsheet rows into it collapses every row onto one line (tabs are
 * kept, but the newlines between rows are lost). Issue Forms render
 * `type: textarea` as a real multi-line <textarea>, which preserves the
 * newlines — this script (plus the accompanying issue-triggered workflow)
 * is the fix for that, without changing create-users.js at all.
 *
 * Issue Form bodies look like:
 *
 *   ### Business Unit Name
 *
 *   NTO Student BU 0001
 *
 *   ### User List
 *
 *   MKT001_0001	NTO Student 0001
 *   MKT001_0002	NTO Student 0002
 *
 * (Field labels come from .github/ISSUE_TEMPLATE/create-users.yml — if you
 * rename a label there, update the heading text matched below too.)
 */

const fs = require("fs");

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/**
 * Extracts the text under a "### <label>" heading up to the next "###"
 * heading (or end of body). Returns "" if the heading isn't found.
 */
function extractSection(body, label) {
  const headingRe = new RegExp(`^###\\s+${escapeRegex(label)}\\s*$`, "m");
  const match = headingRe.exec(body);
  if (!match) return "";

  const afterHeading = body.slice(match.index + match[0].length);
  const nextHeadingMatch = /^###\s+/m.exec(afterHeading);
  const sectionRaw = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading;

  // Issue Forms render an empty field's value as literal "_No response_".
  const trimmed = sectionRaw.trim();
  return trimmed === "_No response_" ? "" : trimmed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeMultilineEnv(name, value) {
  const delimiter = `EOF_${name}_${Math.abs(hashCode(value)).toString(36)}`;
  const envPath = requireEnv("GITHUB_ENV");
  fs.appendFileSync(envPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

// Simple deterministic hash so the delimiter is stable but very unlikely
// to collide with real content (Date.now()/Math.random() intentionally
// avoided — not needed here, and keeps this script side-effect-free/pure
// given the same input).
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function main() {
  const body = requireEnv("ISSUE_BODY");

  const targetBuName = extractSection(body, "Business Unit Name");
  const userList = extractSection(body, "User List");

  if (!targetBuName) {
    throw new Error('Could not find a "Business Unit Name" section in the issue body.');
  }
  if (!userList) {
    throw new Error('Could not find a "User List" section in the issue body.');
  }

  writeMultilineEnv("TARGET_BU_NAME", targetBuName);
  writeMultilineEnv("USER_LIST", userList);

  console.log(`Parsed Business Unit Name: "${targetBuName}"`);
  console.log(`Parsed User List (${userList.split(/\r?\n/).filter(Boolean).length} non-blank lines).`);
}

main();
