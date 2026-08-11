"use strict";

/**
 * Parses the "Create Business Unit" GitHub Issue Form body into BU_NAME,
 * then writes it to GITHUB_ENV so the next step (npm run create-bu) can
 * pick it up exactly like the workflow_dispatch input does today.
 *
 * Issue Form bodies look like:
 *
 *   ### Business Unit Name
 *
 *   NTO Student BU 0001
 *
 * (Field label comes from .github/ISSUE_TEMPLATE/create-business-unit.yml —
 * if you rename the label there, update the heading text matched below too.)
 */

const fs = require("fs");

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function extractSection(body, label) {
  const headingRe = new RegExp(`^###\\s+${escapeRegex(label)}\\s*$`, "m");
  const match = headingRe.exec(body);
  if (!match) return "";

  const afterHeading = body.slice(match.index + match[0].length);
  const nextHeadingMatch = /^###\s+/m.exec(afterHeading);
  const sectionRaw = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading;

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

  const org    = extractSection(body, "Environment");
  const buName = extractSection(body, "Business Unit Name");

  if (!org)    throw new Error('Could not find an "Environment" section in the issue body.');
  if (!buName) throw new Error('Could not find a "Business Unit Name" section in the issue body.');

  writeMultilineEnv("ORG",     org);
  writeMultilineEnv("BU_NAME", buName);

  console.log(`Parsed Org:                "${org}"`);
  console.log(`Parsed Business Unit Name: "${buName}"`);
}

main();
