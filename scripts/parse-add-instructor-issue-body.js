"use strict";

const fs = require("fs");

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined) throw new Error(`Missing required environment variable: ${name}`);
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

  const org        = extractSection(body, "Environment");
  const username   = extractSection(body, "Instructor Username");
  const classBuName = extractSection(body, "Class Business Unit Name");

  if (!org)         throw new Error('Could not find an "Environment" section in the issue body.');
  if (!username)    throw new Error('Could not find an "Instructor Username" section in the issue body.');
  if (!classBuName) throw new Error('Could not find a "Class Business Unit Name" section in the issue body.');

  writeMultilineEnv("ORG",              org);
  writeMultilineEnv("INSTRUCTOR_USERNAME", username);
  writeMultilineEnv("CLASS_BU_NAME",    classBuName);

  console.log(`Parsed Env:      "${org}"`);
  console.log(`Parsed Username: "${username}"`);
  console.log(`Parsed BU Name:  "${classBuName}"`);
}

main();
