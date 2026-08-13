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

  /**
   * Create a Business Unit. Mirrors 1.1 Create Business Unit.js
   *
   * `authMID` is the API call context (Client ID) — the same enterprise
   * parent used for auth/every SOAP call, unchanged from before.
   * `nestUnderMID` is the MID of the BU the new BU should actually be
   * created as a child of (ParentID) — this can now differ from authMID,
   * e.g. nesting new BUs under an intermediate BU like "!VIW Parent"
   * instead of directly under the enterprise top-level MID.
   */
  async createBusinessUnit({
    name,
    customerKey,
    email,
    fromName,
    authMID,
    nestUnderMID,
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
      `<ParentID>${nestUnderMID}</ParentID>` +
      `<Client><ID>${authMID}</ID></Client>` +
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

  /** Retrieve a single AccountUser by CustomerKey. Returns { userID, name } or null. */
  async retrieveUserByCustomerKey(customerKey) {
    const body =
      '<RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      "<RetrieveRequest>" +
      "<ObjectType>AccountUser</ObjectType>" +
      "<Properties>UserID</Properties>" +
      "<Properties>Name</Properties>" +
      '<Filter xsi:type="SimpleFilterPart">' +
      "<Property>CustomerKey</Property>" +
      "<SimpleOperator>equals</SimpleOperator>" +
      `<Value>${escapeXml(customerKey)}</Value>` +
      "</Filter>" +
      "</RetrieveRequest>" +
      "</RetrieveRequestMsg>";

    const raw = await this._soapRequest("Retrieve", body);
    const userID = firstMatch(raw, /<UserID>([\s\S]*?)<\/UserID>/);
    const name = firstMatch(raw, /<Name>([\s\S]*?)<\/Name>/);
    return userID ? { userID, name } : null;
  }

  /** Assign a Business Unit to an existing AccountUser. Mirrors 1.3 Step 3. */
  async assignUserToBusinessUnit({ userCustomerKey, targetMID, parentMID }) {
    // Retrieve the actual UserID (login username) for this CustomerKey — they
    // are different values for some admin users (e.g. CustomerKey is a UUID but
    // UserID is a human-readable username). Setting <UserID> to the wrong value
    // would silently rename the login username.
    const user = await this.retrieveUserByCustomerKey(userCustomerKey);
    if (!user) {
      return { ok: false, statusCode: "NOT_FOUND", statusMessage: `No user found with CustomerKey "${userCustomerKey}"`, newId: null, raw: "" };
    }

    const body =
      '<UpdateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="AccountUser">' +
      `<Client><ID>${parentMID}</ID></Client>` +
      `<CustomerKey>${escapeXml(userCustomerKey)}</CustomerKey>` +
      `<UserID>${escapeXml(user.userID)}</UserID>` +
      "<AssociatedBusinessUnits>" +
      `<BusinessUnit><ID>${targetMID}</ID></BusinessUnit>` +
      "</AssociatedBusinessUnits>" +
      "</Objects>" +
      "</UpdateRequest>";

    const raw = await this._soapRequest("Update", body);
    return parseCreateOrUpdateResult(raw);
  }

  /**
   * Insert a row into a Data Extension via SOAP DataExtensionObject Create
   * (replaces Platform.Function.InsertData used by the SSJS log DE).
   *
   * Uses SOAP rather than the REST customobjectdata/rowset endpoint: in
   * testing, some Installed Packages that have full SOAP DataExtensionObject
   * write access still get a 404 from the REST rowset endpoint (that REST
   * surface appears to be permissioned/enabled separately). SOAP Create is
   * the more broadly-supported write path for existing packages.
   */
  async logRow(deKey, row) {
    const properties = Object.entries(row)
      .map(([name, value]) => `<Property><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></Property>`)
      .join("");

    const body =
      '<CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="DataExtensionObject">' +
      `<CustomerKey>${escapeXml(deKey)}</CustomerKey>` +
      `<Properties>${properties}</Properties>` +
      "</Objects>" +
      "</CreateRequest>";

    const raw = await this._soapRequest("Create", body);
    return parseCreateOrUpdateResult(raw);
  }

  /**
   * Create an AccountUser (SFMC Marketing Cloud user). Mirrors
   * "2.1 Create Student Users.js" Step 3's Create call.
   *
   * MustChangePassword is sent as false here too, but SFMC's Create call
   * does not reliably honor it — this is exactly why the original
   * automation needed a *separate* Update call afterward
   * (see updateUserMustChangePasswordFalse below). Create still assigns
   * the BU, role(s), and initial password.
   *
   * `roleIDs` accepts one or more Role ObjectIDs — a user can hold
   * multiple roles simultaneously (e.g. Administrator + Marketing Cloud
   * VIW), each rendered as its own <Role> element inside <Roles>.
   */
  async createUser({ userId, password, name, email, authMID, targetMID, roleIDs }) {
    const roleList = Array.isArray(roleIDs) ? roleIDs : [roleIDs];
    const rolesXml = roleList
      .filter(Boolean)
      .map((id) => `<Role><ObjectID>${escapeXml(id)}</ObjectID></Role>`)
      .join("");

    const body =
      '<CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="AccountUser">' +
      `<Client><ID>${authMID}</ID></Client>` +
      `<UserID>${escapeXml(userId)}</UserID>` +
      `<Password>${escapeXml(password)}</Password>` +
      `<Name>${escapeXml(name)}</Name>` +
      `<Email>${escapeXml(email)}</Email>` +
      `<NotificationEmailAddress>${escapeXml(email)}</NotificationEmailAddress>` +
      "<ActiveFlag>true</ActiveFlag>" +
      "<MustChangePassword>false</MustChangePassword>" +
      `<DefaultBusinessUnit>${targetMID}</DefaultBusinessUnit>` +
      "<AssociatedBusinessUnits>" +
      `<BusinessUnit><ID>${targetMID}</ID></BusinessUnit>` +
      "</AssociatedBusinessUnits>" +
      `<Roles>${rolesXml}</Roles>` +
      "</Objects>" +
      "</CreateRequest>";

    const raw = await this._soapRequest("Create", body);
    return parseCreateOrUpdateResult(raw);
  }

  /**
   * Update an existing AccountUser so the password is not required to be
   * changed again ("password never expires" in Setup UI terms). This is
   * the second call in the required create-then-update sequence — Mirrors
   * "2.2 Update Student Users.js".
   */
  async updateUserMustChangePasswordFalse({ userId, authMID }) {
    const body =
      '<UpdateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">' +
      '<Objects xsi:type="AccountUser">' +
      `<Client><ID>${authMID}</ID></Client>` +
      `<UserID>${escapeXml(userId)}</UserID>` +
      "<MustChangePassword>false</MustChangePassword>" +
      "</Objects>" +
      "</UpdateRequest>";

    const raw = await this._soapRequest("Update", body);
    return parseCreateOrUpdateResult(raw);
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
