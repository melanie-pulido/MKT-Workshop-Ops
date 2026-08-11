"use strict";

/**
 * One-off script: deletes a Business Unit by name via SOAP Delete.
 * Triggered manually via workflow_dispatch; not part of the regular automation.
 */

const { SfmcClient } = require("./sfmc-client");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const subdomain = requireEnv("SFMC_SUBDOMAIN");
  const clientId = requireEnv("SFMC_CLIENT_ID");
  const clientSecret = requireEnv("SFMC_CLIENT_SECRET");
  const authMID = requireEnv("SFMC_PARENT_MID");
  const buName = requireEnv("BU_NAME").trim();

  const client = new SfmcClient({ subdomain, clientId, clientSecret, accountId: authMID });
  await client.authenticate();

  // Resolve name -> CustomerKey (same as name in this org) and MID
  const buMap = await client.retrieveBusinessUnitMap();
  const targetMID = buMap[buName];
  if (!targetMID) {
    console.error(`❌ No BU found with name "${buName}". Available BUs:`);
    Object.entries(buMap).forEach(([name, mid]) => console.error(`  ${name} (${mid})`));
    process.exitCode = 1;
    return;
  }

  console.log(`Resolved "${buName}" -> MID ${targetMID}`);

  // SFMC SOAP Delete on BusinessUnit
  const raw = await client._soapRequest(
    "Delete",
    `<DeleteRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">` +
    `<Objects xsi:type="BusinessUnit">` +
    `<ID>${targetMID}</ID>` +
    `</Objects>` +
    `</DeleteRequest>`
  );

  const ok = /OverallStatus>OK</.test(raw) || /StatusCode>OK</.test(raw);
  const msg = (raw.match(/<StatusMessage>([\s\S]*?)<\/StatusMessage>/) || [])[1] || "";
  const fault = (raw.match(/<faultstring>([\s\S]*?)<\/faultstring>/) || [])[1] || "";

  if (ok) {
    console.log(`✅ Deleted "${buName}" (MID ${targetMID})`);
  } else {
    console.error(`❌ Failed to delete "${buName}": ${fault || msg}`);
    console.error(raw);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ Exception: ${err.message}`);
  process.exitCode = 1;
});
