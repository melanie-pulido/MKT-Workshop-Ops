"use strict";

/**
 * Thin SFMC client: REST OAuth (client_credentials) + raw SOAP calls,
 * mirroring what the original CloudPage SSJS scripts did via
 * Script.Util.WSProxy / HTTP.Post — just called from Node instead of SSJS.
 */

const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const xmlParser = new XMLParser({ ignoreAttributes: false });

class SfmcClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.subdomain    SFMC "tssd" subdomain for this org (from Setup > Installed Packages)
   * @param {string} cfg.clientId
   * @param {string} cfg.clientSecret
   * @param {string} [cfg.accountId]  Optional target MID for the token scope (parent business unit)
   */
  constructor(cfg) {
    this.subdomain = cfg.subdomain;
    this.clientId = cfg.clientId;
    this.clientSecret = cfg.clientSecret;
    this.accountId = cfg.accountId;
    this.authUrl = `https://${this.subdomain}.auth.marketingcloudapis.com/v2/token`;
    this.restBase = `https://${this.subdomain}.rest.marketingcloudapis.com`;
    this.soapUrl = `https://${this.subdomain}.soap.marketingcloudapis.com/Service.asmx`;
    this.accessToken = null;
  }

  async authenticate() {
    const payload = {
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (this.accountId) payload.account_id = this.accountId;

    const { data } = await axios.post(this.authUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  _authHeaderXml() {
    return (
      '<soapenv:Header><fueloauth xmlns="http://exacttarget.com">' +
      this.accessToken +
      "</fueloauth></soapenv:Header>"
    );
  }

  async _soapRequest(soapAction, bodyXml) {
    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      this._authHeaderXml() +
      "<soapenv:Body>" +
      bodyXml +
      "</soapenv:Body></soapenv:Envelope>";

    const response = await axios.post(this.soapUrl, envelope, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
      },
      validateStatus: () => true, // SFMC SOAP faults come back with 500; we want to inspect them ourselves
    });

    return response.data;
  }

  /** Create a Business Unit. Mirrors 1.1 Create Business Unit.js */
  async createBusinessUnit({
    name,
    customerKey,
    email,
    fromName,
    parentMID,
    businessName,
    address,
    city,
    state,
    zip,
    country,
  }) {
    const body =
      '<CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="BusinessUnit">' +
      `<Name>${escapeXml(name)}</Name>` +
      `<CustomerKey>${escapeXml(customerKey)}</CustomerKey>` +
      `<Email>${escapeXml(email)}</Email>` +
      `<FromName>${escapeXml(fromName)}</FromName>` +
      "<AccountType>BUSINESS_UNIT</AccountType>" +
      `<ParentID>${parentMID}</ParentID>` +
      `<Client><ID>${parentMID}</ID></Client>` +
      `<BusinessName>${escapeXml(businessName)}</BusinessName>` +
      `<Address>${escapeXml(address)}</Address>` +
      `<City>${escapeXml(city)}</City>` +
      `<State>${escapeXml(state)}</State>` +
      `<Zip>${escapeXml(zip)}</Zip>` +
      `<Country>${escapeXml(country)}</Country>` +
      "</Objects>" +
      "</CreateRequest>";

    const raw = await this._soapRequest("Create", body);
    return parseCreateOrUpdateResult(raw);
  }

  /** Update a Business Unit's unsubscribe behavior. Mirrors 1.2 Update Business Unit Settings.js */
  async updateBusinessUnitUnsubscribe({ customerKey, parentMID }) {
    const body =
      '<UpdateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="BusinessUnit">' +
      `<Client><ID>${parentMID}</ID></Client>` +
      `<CustomerKey>${escapeXml(customerKey)}</CustomerKey>` +
      "<MasterUnsubscribeBehavior>BUSINESS_UNIT_ONLY</MasterUnsubscribeBehavior>" +
      "</Objects>" +
      "</UpdateRequest>";

    const raw = await this._soapRequest("Update", body);
    return parseCreateOrUpdateResult(raw);
  }

  /** Retrieve all Business Units visible to this token, as a Name -> MID map. Mirrors 1.3 Step 2. */
  async retrieveBusinessUnitMap() {
    const body =
      '<RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      "<RetrieveRequest>" +
      "<ObjectType>BusinessUnit</ObjectType>" +
      "<Properties>ID</Properties>" +
      "<Properties>Name</Properties>" +
      "<QueryAllAccounts>true</QueryAllAccounts>" +
      "</RetrieveRequest>" +
      "</RetrieveRequestMsg>";

    const raw = await this._soapRequest("Retrieve", body);
    const map = {};
    const matches = raw.match(/<Results xsi:type="BusinessUnit">[\s\S]*?<\/Results>/g) || [];
    for (const block of matches) {
      const name = firstMatch(block, /<Name>([\s\S]*?)<\/Name>/);
      const id = firstMatch(block, /<ID>([\s\S]*?)<\/ID>/);
      if (name && id) map[name] = id;
    }
    return map;
  }

  /** Assign a Business Unit to an existing AccountUser. Mirrors 1.3 Step 3. */
  async assignUserToBusinessUnit({ userCustomerKey, targetMID, parentMID }) {
    const body =
      '<UpdateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="AccountUser">' +
      `<Client><ID>${parentMID}</ID></Client>` +
      `<CustomerKey>${escapeXml(userCustomerKey)}</CustomerKey>` +
      "<AssociatedBusinessUnits>" +
      `<BusinessUnit><ID>${targetMID}</ID></BusinessUnit>` +
      "</AssociatedBusinessUnits>" +
      "</Objects>" +
      "</UpdateRequest>";

    const raw = await this._soapRequest("Update", body);
    return parseCreateOrUpdateResult(raw);
  }

  /**
   * Insert a row into a Data Extension via REST (replaces
   * Platform.Function.InsertData used by the SSJS log DE).
   */
  async logRow(deKey, row) {
    const url = `${this.restBase}/data/v1/customobjectdata/key/${encodeURIComponent(deKey)}/rowset`;
    const payload = [
      {
        keys: {},
        values: row,
      },
    ];
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  /** Clear all rows from a Data Extension (replaces WSProxy ClearData). */
  async clearDataExtension(deKey) {
    const body =
      '<PerformRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      "<Action>ClearData</Action>" +
      '<Definitions><Definition xsi:type="DataExtension">' +
      `<CustomerKey>${escapeXml(deKey)}</CustomerKey>` +
      "</Definition></Definitions>" +
      "</PerformRequestMsg>";

    const raw = await this._soapRequest("Perform", body);
    return raw;
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function firstMatch(str, regex) {
  const m = str.match(regex);
  return m ? m[1] : null;
}

function parseCreateOrUpdateResult(rawXml) {
  const statusCode = firstMatch(rawXml, /<OverallStatus>([\s\S]*?)<\/OverallStatus>/) ||
    firstMatch(rawXml, /<StatusCode>([\s\S]*?)<\/StatusCode>/);
  const statusMessage =
    firstMatch(rawXml, /<StatusMessage>([\s\S]*?)<\/StatusMessage>/) || "";
  const newId = firstMatch(rawXml, /<NewID>([\s\S]*?)<\/NewID>/);
  const isFault = /<soap:Fault>|<Fault>/.test(rawXml);

  const ok = !isFault && (statusCode === "OK" || statusCode === "0");

  return {
    ok,
    statusCode: statusCode || (isFault ? "FAULT" : "UNKNOWN"),
    statusMessage: isFault ? extractFaultString(rawXml) : statusMessage,
    newId,
    raw: rawXml,
  };
}

function extractFaultString(rawXml) {
  return (
    firstMatch(rawXml, /<faultstring>([\s\S]*?)<\/faultstring>/) ||
    firstMatch(rawXml, /<Description>([\s\S]*?)<\/Description>/) ||
    "Unknown SOAP fault"
  );
}

module.exports = { SfmcClient };
