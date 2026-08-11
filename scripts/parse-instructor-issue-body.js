"use strict";

/**
 * Parses the "Create Instructor User" GitHub Issue Form body into
 * INSTRUCTOR_ORG, INSTRUCTOR_NAME, INSTRUCTOR_USERNAME, and
 * INSTRUCTOR_EMAIL, then writes them to GITHUB_ENV so the next step
 * can pick them up.
 *
 * Issue Form bodies look like:
 *
 *   ### Organization
 *
 *   MC Events 2 (MID 517022562)
 *
 *   ### Full Name
 *
 *   Jane Smith
 *
 *   ### Username
 *
 *   THA_JSmith
 *
 *   ### Email Address
 *
 *   jsmith@example.com
 *
 * (Field labels come from .github/ISSUE_TEMPLATE/create-instructor-user.yml —
 * if you rename a label there, update the heading text matched below too.)
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

  const org      = extractSection(body, "Organization");
  const name     = extractSection(body, "Full Name");
  const username = extractSection(body, "Username");
  const email    = extractSection(body, "Email Address");

  if (!org)      throw new Error('Could not find an "Organization" section in the issue body.');
  if (!name)     throw new Error('Could not find a "Full Name" section in the issue body.');
  if (!username) throw new Error('Could not find a "Username" section in the issue body.');
  if (!email)    throw new Error('Could not find an "Email Address" section in the issue body.');

  writeMultilineEnv("INSTRUCTOR_ORG",      org);
  writeMultilineEnv("INSTRUCTOR_NAME",     name);
  writeMultilineEnv("INSTRUCTOR_USERNAME", username);
  writeMultilineEnv("INSTRUCTOR_EMAIL",    email);

  console.log(`Parsed Org:      "${org}"`);
  console.log(`Parsed Name:     "${name}"`);
  console.log(`Parsed Username: "${username}"`);
  console.log(`Parsed Email:    "${email}"`);
}

main();
