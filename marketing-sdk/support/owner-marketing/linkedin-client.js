import crypto from "node:crypto";
import {recordMarketingCredentials} from "./evidence-credentials.js";

const API_ROOT = "https://api.linkedin.com/rest";
const OAUTH_ROOT = "https://www.linkedin.com/oauth/v2";
const DEFAULT_VERSION = "202608";
const DEFAULT_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const TYPEAHEAD_TARGETING_FACETS = new Set([
  "degrees",
  "employers",
  "employersAll",
  "employersPast",
  "fieldsOfStudy",
  "firstDegreeConnectionCompanies",
  "followedCompanies",
  "groups",
  "industries",
  "interests",
  "locations",
  "profileLocations",
  "schools",
  "skills",
  "titles",
  "titlesAll",
  "titlesPast",
]);
const PROVIDER_CAMPAIGN_OBJECTIVES = Object.freeze({
  WEBSITE_CONVERSIONS: "WEBSITE_CONVERSION",
  WEBSITE_VISITS: "WEBSITE_VISIT",
  VIDEO_VIEWS: "VIDEO_VIEW",
});
const PROVIDER_CAMPAIGN_FORMATS = Object.freeze({
  DOCUMENT: "SPONSORED_UPDATE_NATIVE_DOCUMENT",
  SINGLE_IMAGE: "STANDARD_UPDATE",
});
const PROVIDER_CONTENT_CALL_TO_ACTION_LABELS = new Set([
  "APPLY",
  "DOWNLOAD",
  "VIEW_QUOTE",
  "LEARN_MORE",
  "SIGN_UP",
  "SUBSCRIBE",
  "REGISTER",
  "JOIN",
  "ATTEND",
  "REQUEST_DEMO",
  "SEE_MORE",
  "BUY_NOW",
  "SHOP_NOW",
]);

function redactLinkedInMessage(message, secrets = []) {
  let safe = String(message || "LinkedIn request failed");
  for (const secret of secrets) {
    if (secret) safe = safe.replaceAll(String(secret), "[redacted]");
  }
  return safe.replace(/((?:access_token|client_secret|refresh_token)=)([^&\s]+)/gi, "$1[redacted]");
}

function errorDetails(status, payload = {}) {
  const providerCode = payload?.code ?? payload?.errorCode ?? payload?.status ?? null;
  if (status === 429) return { code: "rate_limited", status: 429, retryable: true, providerCode };
  if (status === 400 && ["invalid_grant", "invalid_request"].includes(payload?.error)) return { code: "permission_error", status: 403, providerCode };
  if (status === 401 || status === 403) return { code: "permission_error", status: 403, providerCode };
  if (status >= 500) return { code: "provider_unavailable", status: 503, retryable: true, providerCode };
  return { code: "provider_error", status: status >= 400 && status < 500 ? 422 : 502, retryable: false, providerCode };
}

function providerValidationDetails(payload = {}, secrets = []) {
  const raw = [];
  const collect = (value) => {
    if (raw.length >= 12 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (typeof value !== "object") return;
    if (value.code || value.type || value.errorCode || value.description || value.message || value.errorMessage) raw.push(value);
    for (const key of ["inputErrors", "conditionalInputErrors", "pathErrors", "details", "errors"]) collect(value[key]);
  };
  collect(payload?.errorDetails);
  collect(payload?.details);
  return raw.slice(0, 12).map((detail) => {
    const field = detail?.field
      || detail?.fieldPath
      || detail?.input?.inputPath?.fieldPath
      || detail?.input?.fieldPath
      || detail?.input?.parameterName
      || null;
    const type = detail?.type || detail?.code || detail?.errorCode || null;
    const message = detail?.message || detail?.errorMessage || detail?.description || null;
    return [field, type, message]
      .map((value) => redactLinkedInMessage(value, secrets).trim())
      .filter(Boolean)
      .join(" · ")
      .slice(0, 800);
  }).filter(Boolean);
}

function accountId(value) {
  const id = String(value || "").trim().replace(/^urn:li:sponsoredAccount:/, "");
  if (!/^\d+$/.test(id)) throw new LinkedInMarketingError("A numeric LinkedIn ad account ID is required", { code: "invalid_configuration", status: 400 });
  return id;
}

function scopes(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort();
}

async function responsePayload(response) {
  if (typeof response?.text === "function") {
    const raw = await response.text();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return { message: raw }; }
  }
  return response?.json?.().catch(() => ({})) || {};
}

function restliId(response, payload = {}) {
  const value = response?.headers?.get?.("x-restli-id") || payload?.id || payload?.value?.id || (typeof payload?.value === "string" ? payload.value : null);
  return value == null ? null : String(value);
}

function moneyFromCents(cents, currencyCode = "USD") {
  const amount = Number(cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LinkedInMarketingError("LinkedIn budget must be positive whole cents", { code: "invalid_configuration", status: 400 });
  return { amount: (amount / 100).toFixed(2), currencyCode: String(currencyCode || "USD").toUpperCase() };
}

function urnId(value, kind) {
  const raw = String(value || "").trim();
  const prefix = `urn:li:${kind}:`;
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (!id) throw new LinkedInMarketingError(`A LinkedIn ${kind} identifier is required`, { code: "invalid_configuration", status: 400 });
  return { id, urn: `${prefix}${id}` };
}

function partnerConversionUrn(value) {
  const raw = String(value || "").trim();
  const prefix = "urn:lla:llaPartnerConversion:";
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (!/^\d+$/.test(id)) throw new LinkedInMarketingError("A numeric LinkedIn conversion ID is required", { code: "invalid_configuration", status: 400 });
  return { id, urn: `${prefix}${id}` };
}

function contentCallToActionLabel(value) {
  const normalized = String(value || "LEARN_MORE")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return PROVIDER_CONTENT_CALL_TO_ACTION_LABELS.has(normalized) ? normalized : "LEARN_MORE";
}

function restliQueryValue(value, key = null) {
  const raw = String(value);
  const encoded = encodeURIComponent(raw);
  const preserveRestliSyntax = key === "fields" || raw.startsWith("(") || raw.startsWith("List(");
  if (!preserveRestliSyntax) return encoded;
  const delimiters = encoded
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%2C/gi, ",");
  return raw.startsWith("(") ? delimiters.replace(/%3A/gi, ":") : delimiters;
}

// LinkedIn limits object names by UTF-8 bytes, not JavaScript characters.
export function linkedInObjectName(value, fallback = "Handrail campaign") {
  let result = "";
  for (const character of String(value || fallback).trim()) {
    if (Buffer.byteLength(result + character, "utf8") > 200) break;
    result += character;
  }
  return result.trimEnd();
}

export class LinkedInMarketingError extends Error {
  constructor(message, { code = "provider_error", status = 502, providerStatus = null, providerCode = null, providerDetails = [], retryable = false, secrets = [] } = {}) {
    super(redactLinkedInMessage(message, secrets));
    this.name = "LinkedInMarketingError";
    this.code = code;
    this.statusCode = status;
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
    this.providerDetails = Array.isArray(providerDetails) ? providerDetails.slice(0, 12) : [];
    this.retryable = retryable;
  }
}

export class LinkedInMarketingClient {
  // Host authority must be rechecked after token/media awaits, at each write.
  beforeWrite = async () => {};
  onAssetInitialized = async (_id) => {};
  /** @param {{accessToken?: string | null, refreshToken?: string | null, clientId?: string, clientSecret?: string, apiVersion?: string, fetchImpl?: typeof fetch, apiRoot?: string, oauthRoot?: string, timeoutMs?: number, now?: () => number, tokenRefreshSkewMs?: number, assetPollAttempts?: number, assetPollIntervalMs?: number}} options */
  constructor({ accessToken = null, refreshToken = null, clientId, clientSecret, apiVersion = DEFAULT_VERSION, fetchImpl = globalThis.fetch, apiRoot = API_ROOT, oauthRoot = OAUTH_ROOT, timeoutMs = 15000, now = () => Date.now(), tokenRefreshSkewMs = DEFAULT_TOKEN_REFRESH_SKEW_MS, assetPollAttempts = 20, assetPollIntervalMs = 250 } = {}) {
    if (!accessToken && !refreshToken) throw new LinkedInMarketingError("LinkedIn refresh token is not configured", { code: "disconnected", status: 409 });
    if (!clientId || !clientSecret) throw new LinkedInMarketingError("LinkedIn OAuth client credentials are not configured", { code: "invalid_configuration", status: 409 });
    this.accessToken = refreshToken ? null : accessToken;
    this.accessTokenExpiresAtMs = refreshToken ? 0 : Number.POSITIVE_INFINITY;
    this.accessTokenScopes = null;
    this.refreshToken = refreshToken;
    this.tokenRefreshPromise = null;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.apiVersion = /^\d{6}$/.test(String(apiVersion)) ? String(apiVersion) : DEFAULT_VERSION;
    this.fetchImpl = fetchImpl;
    this.apiRoot = apiRoot.replace(/\/$/, "");
    this.oauthRoot = oauthRoot.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.tokenRefreshSkewMs = Math.max(0, Number(tokenRefreshSkewMs) || 0);
    this.assetPollAttempts = Math.max(1, Number(assetPollAttempts) || 1);
    this.assetPollIntervalMs = Math.max(0, Number(assetPollIntervalMs) || 0);
  }

  async fetchWithMeta(url, init, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new LinkedInMarketingError(error?.name === "AbortError" ? `${label} timed out` : "LinkedIn is unavailable", { code: "provider_unavailable", status: 503, retryable: true });
    } finally { clearTimeout(timer); }
    const payload = await responsePayload(response);
    if (!response.ok) {
      const details = errorDetails(response.status, payload);
      const secrets = [this.accessToken, this.refreshToken, this.clientId, this.clientSecret];
      const providerDetails = providerValidationDetails(payload, secrets);
      const summary = payload?.message || payload?.error_description || `${label} failed`;
      const message = providerDetails.length ? `${summary}: ${providerDetails.join("; ")}` : summary;
      const error = new LinkedInMarketingError(message, { ...details, providerStatus: response.status, providerDetails, secrets });
      // An explicit validation/authorization rejection cannot have created the object.
      // Timeouts, throttling and server errors retain uncertain-outcome recovery.
      if ([400,401,403,404,409,422].includes(response.status)) error.providerOutcome = "rejected";
      throw error;
    }
    return { payload, response, id: restliId(response, payload) };
  }

  async fetch(url, init, label) {
    return (await this.fetchWithMeta(url, init, label)).payload;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      if (this.accessToken) return this.accessToken;
      throw new LinkedInMarketingError("LinkedIn refresh token is not configured", { code: "disconnected", status: 409 });
    }
    if (this.accessToken && this.accessTokenExpiresAtMs - this.tokenRefreshSkewMs > this.now()) return this.accessToken;
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;
    this.tokenRefreshPromise = (async () => {
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken, client_id: this.clientId, client_secret: this.clientSecret });
      const payload = await this.fetch(`${this.oauthRoot}/accessToken`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      }, "LinkedIn access token refresh");
      recordMarketingCredentials(this, payload?.access_token, payload?.refresh_token);
      const token = String(payload?.access_token || "").trim();
      const expiresInSeconds = Number(payload?.expires_in);
      if (!token || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new LinkedInMarketingError("LinkedIn did not return a valid access token and expiration", { code: "provider_error", status: 502 });
      }
      recordMarketingCredentials(this, token);
      this.accessToken = token;
      this.accessTokenExpiresAtMs = this.now() + expiresInSeconds * 1000;
      this.accessTokenScopes = payload.scope == null ? null : scopes(payload.scope);
      if (payload?.refresh_token) this.refreshToken = String(payload.refresh_token);
      return token;
    })();
    try { return await this.tokenRefreshPromise; } finally { this.tokenRefreshPromise = null; }
  }

  async accessTokenForRequest() {
    const token = await this.refreshAccessToken();
    recordMarketingCredentials(this, token, this.refreshToken);
    return token;
  }

  async replaceRejectedAccessToken(accessToken) {
    // Another request may already have replaced the rejected token.
    if (this.accessToken === accessToken) {
      this.accessToken = null;
      this.accessTokenExpiresAtMs = 0;
      this.accessTokenScopes = null;
    }
    const token = await this.refreshAccessToken();
    recordMarketingCredentials(this, token, this.refreshToken);
    return token;
  }

  async requestWithMeta(path, { method = "GET", query = {}, body = null, headers = {} } = {}) {
    const accessToken = await this.accessTokenForRequest();
    const url = new URL(`${this.apiRoot}/${String(path).replace(/^\//, "")}`);
    const queryEntries = Object.entries(query || {}).filter(([, value]) => value != null && value !== "");
    if (queryEntries.length) url.search = queryEntries.map(([key, value]) => `${encodeURIComponent(key)}=${restliQueryValue(value, key)}`).join("&");
    const init = {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "linkedin-version": this.apiVersion,
        "x-restli-protocol-version": "2.0.0",
        ...(body == null ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
    };
    try {
      if (method !== "GET") await this.beforeWrite();
      return await this.fetchWithMeta(url, init, "LinkedIn Marketing API request");
    } catch (error) {
      if (error.providerStatus !== 401 || !this.refreshToken) throw error;
      const refreshedToken = await this.replaceRejectedAccessToken(accessToken);
      if (method !== "GET") await this.beforeWrite();
      return this.fetchWithMeta(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${refreshedToken}` },
      }, "LinkedIn Marketing API request");
    }
  }

  async request(path, options = {}) {
    return (await this.requestWithMeta(path, options)).payload;
  }

  getCampaignGroup(adAccountId, campaignGroupId) {
    return this.request(`adAccounts/${accountId(adAccountId)}/adCampaignGroups/${urnId(campaignGroupId, "sponsoredCampaignGroup").id}`);
  }

  listCampaignGroups(adAccountId, { pageSize = 100, pageToken = null } = {}) {
    return this.request(`adAccounts/${accountId(adAccountId)}/adCampaignGroups`, { query: { q: "search", pageSize: Math.min(1000, Math.max(1, Number(pageSize) || 100)), pageToken } });
  }

  getAdAccount(adAccountId) {
    return this.request(`adAccounts/${accountId(adAccountId)}`);
  }

  async createCampaignGroup(adAccountId, input = {}) {
    const id = accountId(adAccountId);
    const payload = {
      account: `urn:li:sponsoredAccount:${id}`,
      name: linkedInObjectName(input.name, "Handrail campaign group"),
      status: "DRAFT",
      ...(input.startAt || input.endAt ? { runSchedule: { ...(input.startAt ? { start: Number(input.startAt) } : {}), ...(input.endAt ? { end: Number(input.endAt) } : {}) } } : {}),
      ...(input.totalBudgetCents ? { totalBudget: moneyFromCents(input.totalBudgetCents, input.currencyCode) } : {}),
    };
    const created = await this.requestWithMeta(`adAccounts/${id}/adCampaignGroups`, { method: "POST", body: payload });
    if (!created.id) throw new LinkedInMarketingError("LinkedIn did not return a campaign group identifier", { code: "verification_failed", status: 502 });
    return { id: created.id, urn: `urn:li:sponsoredCampaignGroup:${created.id}`, status: "DRAFT", payload: created.payload };
  }

  async updateCampaignGroup(adAccountId, campaignGroupId, fields = {}) {
    const id = accountId(adAccountId);
    const group = urnId(campaignGroupId, "sponsoredCampaignGroup");
    let writeAccepted = false;
    try {
      await this.request(`adAccounts/${id}/adCampaignGroups/${group.id}`, { method: "POST", headers: { "x-restli-method": "PARTIAL_UPDATE" }, body: { patch: { $set: fields } } });
      writeAccepted = true;
      return await this.getCampaignGroup(id, group.id);
    } catch (error) {
      if (!writeAccepted) {
        error.providerOutcome = error.retryable ? "unknown" : "rejected";
        throw error;
      }
      const verification = new LinkedInMarketingError("LinkedIn accepted the campaign-group update, but Handrail could not verify the resulting provider state", {
        code: "provider_outcome_unknown",
        status: 503,
        retryable: true,
      });
      verification.providerOutcome = "unknown";
      verification.cause = error;
      throw verification;
    }
  }

  updateCampaignGroupStatus(adAccountId, campaignGroupId, status) {
    if (!["ACTIVE", "PAUSED"].includes(status)) throw new LinkedInMarketingError("LinkedIn campaign group status must be ACTIVE or PAUSED", { code: "unsafe_status", status: 400 });
    return this.updateCampaignGroup(adAccountId, campaignGroupId, { status });
  }

  updateCampaignGroupBudget(adAccountId, campaignGroupId, totalBudgetCents, currencyCode = "USD") {
    return this.updateCampaignGroup(adAccountId, campaignGroupId, { totalBudget: moneyFromCents(totalBudgetCents, currencyCode) });
  }

  getCampaign(adAccountId, campaignId) {
    return this.request(`adAccounts/${accountId(adAccountId)}/adCampaigns/${urnId(campaignId, "sponsoredCampaign").id}`);
  }

  listCampaigns(adAccountId, { pageSize = 100, pageToken = null } = {}) {
    return this.request(`adAccounts/${accountId(adAccountId)}/adCampaigns`, { query: { q: "search", pageSize: Math.min(1000, Math.max(1, Number(pageSize) || 100)), pageToken } });
  }

  async createCampaign(adAccountId, input = {}) {
    const id = accountId(adAccountId);
    const group = urnId(input.campaignGroup, "sponsoredCampaignGroup");
    if (!input.targetingCriteria?.include) throw new LinkedInMarketingError("LinkedIn targeting criteria are required", { code: "invalid_configuration", status: 400 });
    const objectiveType = String(input.objectiveType || "WEBSITE_VISITS");
    const format = input.format ? String(input.format) : null;
    const payload = {
      account: `urn:li:sponsoredAccount:${id}`,
      campaignGroup: group.urn,
      associatedEntity: urnId(input.organizationId, "organization").urn,
      audienceExpansionEnabled: input.audienceExpansionEnabled === true,
      connectedTelevisionOnly: false,
      costType: String(input.costType || "CPC"),
      creativeSelection: String(input.creativeSelection || "OPTIMIZED"),
      dailyBudget: moneyFromCents(input.dailyBudgetCents, input.currencyCode),
      locale: { country: String(input.localeCountry || "US").toUpperCase(), language: String(input.localeLanguage || "en").toLowerCase() },
      name: linkedInObjectName(input.name, "Handrail LinkedIn campaign"),
      objectiveType: PROVIDER_CAMPAIGN_OBJECTIVES[objectiveType] || objectiveType,
      ...(input.optimizationTargetType ? { optimizationTargetType: String(input.optimizationTargetType) } : {}),
      offsiteDeliveryEnabled: input.offsiteDeliveryEnabled === true,
      politicalIntent: String(input.politicalIntent || "NOT_POLITICAL"),
      runSchedule: { start: Number(input.startAt || Date.now()), ...(input.endAt ? { end: Number(input.endAt) } : {}) },
      targetingCriteria: input.targetingCriteria,
      type: String(input.type || "SPONSORED_UPDATES"),
      unitCost: { amount: String(input.unitCostAmount || "0"), currencyCode: String(input.currencyCode || "USD").toUpperCase() },
      status: "DRAFT",
      ...(format ? { format: PROVIDER_CAMPAIGN_FORMATS[format] || format } : {}),
    };
    const created = await this.requestWithMeta(`adAccounts/${id}/adCampaigns`, { method: "POST", body: payload });
    if (!created.id) throw new LinkedInMarketingError("LinkedIn did not return a campaign identifier", { code: "verification_failed", status: 502 });
    return { id: created.id, urn: `urn:li:sponsoredCampaign:${created.id}`, status: "DRAFT", payload: created.payload };
  }

  async updateCampaign(adAccountId, campaignId, fields = {}) {
    const id = accountId(adAccountId);
    const campaign = urnId(campaignId, "sponsoredCampaign");
    let writeAccepted = false;
    try {
      await this.request(`adAccounts/${id}/adCampaigns/${campaign.id}`, { method: "POST", headers: { "x-restli-method": "PARTIAL_UPDATE" }, body: { patch: { $set: fields } } });
      writeAccepted = true;
      return await this.getCampaign(id, campaign.id);
    } catch (error) {
      if (!writeAccepted) {
        error.providerOutcome = error.retryable ? "unknown" : "rejected";
        throw error;
      }
      const verification = new LinkedInMarketingError("LinkedIn accepted the campaign update, but Handrail could not verify the resulting provider state", {
        code: "provider_outcome_unknown",
        status: 503,
        retryable: true,
      });
      verification.providerOutcome = "unknown";
      verification.cause = error;
      throw verification;
    }
  }

  updateCampaignStatus(adAccountId, campaignId, status) {
    if (!["ACTIVE", "PAUSED"].includes(status)) throw new LinkedInMarketingError("LinkedIn campaign status must be ACTIVE or PAUSED", { code: "unsafe_status", status: 400 });
    return this.updateCampaign(adAccountId, campaignId, { status });
  }

  updateCampaignBudget(adAccountId, campaignId, dailyBudgetCents, currencyCode = "USD") {
    return this.updateCampaign(adAccountId, campaignId, { dailyBudget: moneyFromCents(dailyBudgetCents, currencyCode) });
  }

  listConversions(adAccountId, { start = 0, count = 100 } = {}) {
    return this.request("conversions", { query: { q: "account", account: `urn:li:sponsoredAccount:${accountId(adAccountId)}`, start, count } });
  }

  getConversion(conversionId, adAccountId) {
    return this.request(`conversions/${partnerConversionUrn(conversionId).id}`, { query: { account: `urn:li:sponsoredAccount:${accountId(adAccountId)}` } });
  }

  listInsightTags(adAccountId) {
    return this.request("insightTags", { query: { q: "account", account: `urn:li:sponsoredAccount:${accountId(adAccountId)}` } });
  }

  listInsightTagDomains(adAccountId) {
    return this.request("insightTagDomains", { query: { q: "account", account: `urn:li:sponsoredAccount:${accountId(adAccountId)}` } });
  }

  async createInsightTagLeadConversion(adAccountId, name) {
    // Omitting urlMatchRuleExpression creates an event-specific Insight Tag rule.
    // conversionMethod=CONVERSIONS_API would instead require the separate product.
    const created = await this.requestWithMeta("conversions", { method: "POST", body: {
      account: `urn:li:sponsoredAccount:${accountId(adAccountId)}`,
      name, type: "LEAD", enabled: true, valueType: "NO_VALUE",
      attributionType: "LAST_TOUCH_BY_CONVERSION",
      postClickAttributionWindowSize: 30, viewThroughAttributionWindowSize: 7,
    } });
    const id = created.id || created.payload?.id;
    if (!id) throw new LinkedInMarketingError("LinkedIn did not return a conversion identifier; reconcile conversion inventory before retrying", { code: "verification_failed", status: 502 });
    return this.getConversion(id, adAccountId);
  }

  async listCampaignConversions(campaignId) {
    const campaign = urnId(campaignId, "sponsoredCampaign"), elements = [];
    for (let start = 0; start < 20000; start += 100) {
      const page = await this.request("campaignConversions", { query: { q: "campaigns", campaigns: `List(${campaign.urn})`, start, count: 100 } });
      if (!Array.isArray(page?.elements)) throw new LinkedInMarketingError("Conversion inventory is incomplete", { code: "verification_failed", status: 502 });
      elements.push(...page.elements);
      if (page.elements.length < 100) return elements;
    }
    throw new LinkedInMarketingError("Conversion inventory exceeded bounded pagination", { code: "verification_failed", status: 502 });
  }

  getCampaignConversion(campaignId, conversionId) {
    const campaign = urnId(campaignId, "sponsoredCampaign");
    const conversion = partnerConversionUrn(conversionId);
    return this.request(`campaignConversions/(campaign:${encodeURIComponent(campaign.urn)},conversion:${encodeURIComponent(conversion.urn)})`);
  }

  async associateCampaignConversion(campaignId, conversionId) {
    const campaign = urnId(campaignId, "sponsoredCampaign");
    const conversion = partnerConversionUrn(conversionId);
    const compoundKey = `(campaign:${encodeURIComponent(campaign.urn)},conversion:${encodeURIComponent(conversion.urn)})`;
    await this.request(`campaignConversions/${compoundKey}`, {
      method: "PUT",
      body: { campaign: campaign.urn, conversion: conversion.urn },
    });
    return { campaign: campaign.urn, conversion: conversion.urn };
  }

  async sendConversionEvent({ conversionId, eventId, email, conversionHappenedAt = Date.now() } = {}) {
    const conversion = partnerConversionUrn(conversionId);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new LinkedInMarketingError("A valid email is required for LinkedIn conversion matching", { code: "invalid_configuration", status: 400 });
    const safeEventId = String(eventId || "").trim().slice(0, 255);
    if (!safeEventId) throw new LinkedInMarketingError("A stable LinkedIn conversion event ID is required", { code: "invalid_configuration", status: 400 });
    const happenedAt = new Date(conversionHappenedAt).getTime();
    if (!Number.isFinite(happenedAt) || happenedAt <= 0) throw new LinkedInMarketingError("A valid LinkedIn conversion timestamp is required", { code: "invalid_configuration", status: 400 });
    const payload = {
      conversion: conversion.urn,
      conversionHappenedAt: happenedAt,
      user: {
        userIds: [{
          idType: "SHA256_EMAIL",
          idValue: crypto.createHash("sha256").update(normalizedEmail).digest("hex"),
        }],
      },
      eventId: safeEventId,
    };
    await this.request("conversionEvents", { method: "POST", body: payload });
    return { conversion: conversion.urn, eventId: safeEventId };
  }

  async getCreative(adAccountId, creativeId) {
    const creative = await this.request(`adAccounts/${accountId(adAccountId)}/creatives/${encodeURIComponent(urnId(creativeId, "sponsoredCreative").urn)}`);
    return this.expandCreativePost(creative);
  }

  async expandCreativePost(creative) {
    const reference = creative?.content?.reference;
    if (creative?.inlineContent?.post || !/^urn:li:(share|ugcPost):[0-9]+$/.test(reference || "")) return creative;
    const post = await this.request(`posts/${encodeURIComponent(reference)}`, { query: { viewContext: "AUTHOR" } });
    return { ...creative, inlineContent: { ...creative.inlineContent, post } };
  }

  listCreatives(adAccountId, { campaignUrn = null, pageSize = 100, pageToken = null } = {}) {
    return this.request(`adAccounts/${accountId(adAccountId)}/creatives`, { query: { q: "criteria", campaigns: campaignUrn ? `List(${campaignUrn})` : null, sortOrder: "ASCENDING", pageSize, pageToken } });
  }

  async findCreativeByCampaignAndName(adAccountId, campaignId, name) {
    const campaign = urnId(campaignId, "sponsoredCampaign");
    const result = await this.listCreatives(adAccountId, { campaignUrn: campaign.urn, pageSize: 1000 });
    const wanted = String(name || "").trim();
    return (result?.elements || []).find((item) => item.campaign === campaign.urn && String(item.name || "").trim() === wanted) || null;
  }

  async waitForAssetAvailable(kind, assetUrn) {
    if (!["image", "document"].includes(kind)) throw new LinkedInMarketingError("LinkedIn asset kind must be image or document", { code: "invalid_asset", status: 400 });
    for (let attempt = 0; attempt < this.assetPollAttempts; attempt += 1) {
      const asset = await this.request(`${kind === "image" ? "images" : "documents"}/${encodeURIComponent(String(assetUrn))}`);
      if (asset?.status === "AVAILABLE") return asset;
      if (asset?.status === "PROCESSING_FAILED") throw new LinkedInMarketingError(`LinkedIn ${kind} processing failed`, { code: "invalid_asset", status: 422 });
      if (attempt + 1 < this.assetPollAttempts && this.assetPollIntervalMs) await new Promise((resolve) => setTimeout(resolve, this.assetPollIntervalMs));
    }
    throw new LinkedInMarketingError(`LinkedIn ${kind} is still processing`, { code: "provider_unavailable", status: 503, retryable: true });
  }

  async createDirectSponsoredCreative(adAccountId, input = {}) {
    const id = accountId(adAccountId);
    const campaign = urnId(input.campaignId, "sponsoredCampaign");
    const organization = urnId(input.organizationId, "organization");
    if (input.documentReference) await this.waitForAssetAvailable("document", input.documentReference);
    else if (input.mediaUrn) await this.waitForAssetAvailable("image", input.mediaUrn);
    const post = {
      adContext: { dscAdAccount: `urn:li:sponsoredAccount:${id}`, dscStatus: "ACTIVE" },
      author: organization.urn,
      commentary: String(input.commentary || "").trim().slice(0, 3000),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "NONE", thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: true,
      ...(input.landingPageUrl ? { contentCallToActionLabel: contentCallToActionLabel(input.callToActionLabel), contentLandingPage: String(input.landingPageUrl) } : {}),
      ...(input.mediaUrn || input.documentReference ? { content: { media: { id: String(input.documentReference || input.mediaUrn), title: String(input.mediaTitle || input.name || "Handrail creative").slice(0, 200) } } } : {}),
    };
    const creative = {
      name: linkedInObjectName(input.name, "Handrail creative"),
      inlineContent: { post },
      campaign: campaign.urn,
      intendedStatus: "DRAFT",
      ...(input.documentReference ? { content: { documentAd: { ...(input.gatedLeadgenPreviewPageCount ? { gatedLeadgenPreviewPageCount: Number(input.gatedLeadgenPreviewPageCount) } : {}) } } } : {}),
    };
    const created = await this.requestWithMeta(`adAccounts/${id}/creatives`, { method: "POST", query: { action: "createInline" }, body: { creative } });
    let creativeId = created.id;
    if (!creativeId) {
      // Some createInline responses omit the identity. Read the campaign before
      // returning; never repeat the creation to obtain an ID.
      const inventory = await this.listCreatives(id, { campaignUrn: campaign.urn, pageSize: 1000 });
      const matches = (inventory?.elements || []).filter(item => item.campaign === campaign.urn && item.name === creative.name);
      if (matches.length === 1) creativeId = matches[0].id;
    }
    if (!creativeId) throw new LinkedInMarketingError("LinkedIn did not return a unique creative identifier; reconcile the campaign inventory before retrying", { code: "verification_failed", status: 502 });
    const identity = urnId(creativeId, "sponsoredCreative");
    return { id: identity.id, urn: identity.urn, status: "DRAFT", payload: created.payload };
  }

  async updateCreativeStatus(adAccountId, creativeId, intendedStatus) {
    if (!["ACTIVE", "PAUSED"].includes(intendedStatus)) throw new LinkedInMarketingError("LinkedIn creative status must be ACTIVE or PAUSED", { code: "unsafe_status", status: 400 });
    const id = accountId(adAccountId);
    const creative = urnId(creativeId, "sponsoredCreative");
    let writeAccepted = false;
    try {
      await this.request(`adAccounts/${id}/creatives/${encodeURIComponent(creative.urn)}`, { method: "POST", headers: { "x-restli-method": "PARTIAL_UPDATE" }, body: { patch: { $set: { intendedStatus } } } });
      writeAccepted = true;
      return await this.getCreative(id, creative.id);
    } catch (error) {
      if (!writeAccepted) {
        error.providerOutcome = error.retryable ? "unknown" : "rejected";
        throw error;
      }
      const verification = new LinkedInMarketingError("LinkedIn accepted the creative update, but Handrail could not verify the resulting provider state", {
        code: "provider_outcome_unknown",
        status: 503,
        retryable: true,
      });
      verification.providerOutcome = "unknown";
      verification.cause = error;
      throw verification;
    }
  }

  listTargetingFacets() {
    return this.request("adTargetingFacets");
  }

  findTargetingEntities({ facet, query = null, localeLanguage = "en", localeCountry = "US" } = {}) {
    const facetUrn = String(facet || "").startsWith("urn:li:adTargetingFacet:") ? String(facet) : `urn:li:adTargetingFacet:${String(facet || "").trim()}`;
    const facetName = facetUrn.split(":").at(-1);
    if (!facetName) throw new LinkedInMarketingError("A LinkedIn targeting facet is required", { code: "invalid_configuration", status: 400 });
    const finder = query && TYPEAHEAD_TARGETING_FACETS.has(facetName) ? "typeahead" : "adTargetingFacet";
    return this.request("adTargetingEntities", { query: {
      q: finder,
      queryVersion: "QUERY_USES_URNS",
      facet: facetUrn,
      query: finder === "typeahead" ? query : null,
      locale: `(language:${String(localeLanguage).toLowerCase()},country:${String(localeCountry).toUpperCase()})`,
    } });
  }

  async uploadAsset({ kind, organizationId, bytes, mediaType = null, filename = null } = {}) {
    if (!["image", "document"].includes(kind)) throw new LinkedInMarketingError("LinkedIn asset kind must be image or document", { code: "invalid_asset", status: 400 });
    const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const maxBytes = kind === "image" ? 20 * 1024 * 1024 : 100 * 1024 * 1024;
    if (!content.length || content.length > maxBytes) throw new LinkedInMarketingError(`LinkedIn ${kind} is empty or too large`, { code: "invalid_asset", status: 400 });
    const organization = urnId(organizationId, "organization");
    const initialized = await this.request(`${kind === "image" ? "images" : "documents"}`, {
      method: "POST",
      query: { action: "initializeUpload" },
      body: { initializeUploadRequest: { owner: organization.urn } },
    });
    const uploadUrl = initialized?.value?.uploadUrl;
    const assetUrn = initialized?.value?.[kind];
    if (!uploadUrl || !assetUrn) throw new LinkedInMarketingError(`LinkedIn did not initialize the ${kind} upload`, { code: "verification_failed", status: 502 });
    await this.onAssetInitialized(assetUrn);
    const accessToken = await this.accessTokenForRequest();
    let uploaded;
    await this.beforeWrite();
    try {
      uploaded = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": mediaType || (kind === "image" ? "image/jpeg" : "application/pdf"),
        },
        body: content,
      });
    } catch {
      const error = new LinkedInMarketingError("LinkedIn asset upload is unavailable", { code: "provider_unavailable", status: 503, retryable: true });
      error.providerOutcome = "unknown";
      error.providerObjectId = assetUrn;
      throw error;
    }
    if (!uploaded?.ok) {
      const payload = await responsePayload(uploaded);
      const details = errorDetails(uploaded?.status || 502, payload);
      throw new LinkedInMarketingError(payload?.message || `LinkedIn ${kind} upload failed`, { ...details, secrets: [this.accessToken, this.refreshToken] });
    }
    try {
      await this.waitForAssetAvailable(kind, assetUrn);
    } catch (error) {
      error.providerOutcome = "unknown";
      error.providerObjectId = assetUrn;
      throw error;
    }
    return { kind, urn: assetUrn, filename: filename ? String(filename).slice(0, 255) : null, mediaType, byteSize: content.length };
  }

  uploadImage(input = {}) {
    return this.uploadAsset({ ...input, kind: "image" });
  }

  uploadDocument(input = {}) {
    return this.uploadAsset({ ...input, kind: "document" });
  }

  /** @param {string} adAccountId @param {{pivot?: string, since?: string, until?: string, campaignUrns?: string[], fields?: string[]}} options */
  async getAnalytics(adAccountId, { pivot = "CAMPAIGN", since, until, campaignUrns = [], fields = ["dateRange", "impressions", "clicks", "landingPageClicks", "externalWebsiteConversions", "costInLocalCurrency", "pivotValues"] } = {}) {
    const start = new Date(since).getTime();
    const end = new Date(until).getTime();
    const utcDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
    if (!utcDate(since) || !utcDate(until) || start > end || end + 86_400_000 > Date.now()) {
      throw new LinkedInMarketingError("A valid inclusive reporting date range is required", { code: "provider_reporting_range_invalid", status: 400 });
    }
    // LinkedIn adAnalytics has no pagination and caps responses at 15,000 rows.
    // Bound campaign/day queries below that ceiling instead of trusting truncation.
    const uniqueCampaigns = [...new Set(campaignUrns)];
    const batches = [];
    for (let offset = 0; offset < uniqueCampaigns.length; offset += 100) batches.push(uniqueCampaigns.slice(offset, offset + 100));
    if (!batches.length) batches.push([]);
    if (Math.ceil((end - start + 86_400_000) / (30 * 86_400_000)) * batches.length > 200) {
      throw new LinkedInMarketingError("Reporting range exceeds the bounded sync workload", { code: "provider_reporting_range_invalid", status: 400 });
    }
    const date = value => { const parsed = new Date(value); return `(year:${parsed.getUTCFullYear()},month:${parsed.getUTCMonth() + 1},day:${parsed.getUTCDate()})`; };
    const elements = [];
    for (let day = start; day <= end; day += 30 * 86_400_000) {
      for (const campaigns of batches) {
        const result = await this.request("adAnalytics", { query: {
          q: "analytics", pivot, timeGranularity: "DAILY",
          dateRange: `(start:${date(day)},end:${date(Math.min(end, day + 29 * 86_400_000))})`,
          accounts: `List(urn:li:sponsoredAccount:${accountId(adAccountId)})`,
          campaigns: campaigns.length ? `List(${campaigns.join(",")})` : null,
          fields: fields.join(","),
        } });
        if (!Array.isArray(result.elements) || result.elements.length >= 15_000) {
          throw new LinkedInMarketingError("Reporting response may be truncated; no complete snapshot was saved", { code: "provider_reporting_incomplete" });
        }
        elements.push(...result.elements);
      }
    }
    return { elements };
  }

  async introspectToken({ retryInactive = true } = {}) {
    const accessToken = await this.accessTokenForRequest();
    const form = new URLSearchParams({ token: accessToken, client_id: this.clientId, client_secret: this.clientSecret });
    let token;
    try {
      token = await this.fetch(`${this.oauthRoot}/introspectToken`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      }, "LinkedIn token introspection");
    } catch (error) {
      if (error.providerStatus !== 401 || !retryInactive || !this.refreshToken) throw error;
      await this.replaceRejectedAccessToken(accessToken);
      return this.introspectToken({ retryInactive: false });
    }
    if (token.active !== false || !retryInactive || !this.refreshToken) return token;
    await this.replaceRejectedAccessToken(accessToken);
    return this.introspectToken({ retryInactive: false });
  }

  async verifyConnection({ adAccountId, organizationId = null } = {}) {
    const id = accountId(adAccountId);
    const token = await this.introspectToken();
    const inspectedAccessToken = this.accessToken;
    // LinkedIn can report a freshly refreshed token as revoked while accepting
    // that same token at the Marketing API. Require a real account read before
    // deciding access works; scope grants still need OAuth evidence.
    const account = await this.getAdAccount(id);
    // adAccounts has no account timezone. Reporting and daily budgets use UTC
    // by provider policy; unrelated extra response fields are not provenance.
    const observedId = typeof account.id === "string" && /^\d+$/.test(account.id) ? account.id
      : Number.isSafeInteger(account.id) && account.id > 0 ? String(account.id) : null;
    if (observedId !== id)
      throw new LinkedInMarketingError("Account identity was not verified", { code: "verification_failed", status: 502 });
    const introspectionApplies = token.active === true && inspectedAccessToken === this.accessToken;
    const granted = this.accessTokenScopes ?? scopes(introspectionApplies ? token.scope || token.scopes : null);
    const adsRead = granted.includes("rw_ads");
    const servingStatuses = Array.isArray(account.servingStatuses) ? account.servingStatuses.map(String) : [];
    const referencedOrganizationId = /^urn:li:organization:(\d+)$/.exec(String(account.reference || ""))?.[1] || null;
    const resolvedOrganizationId = organizationId ? String(organizationId).replace(/^urn:li:organization:/, "") : referencedOrganizationId;
    const expectedOrganization = resolvedOrganizationId ? `urn:li:organization:${resolvedOrganizationId}` : null;
    const organizationMatches = expectedOrganization ? account.reference === expectedOrganization : null;
    return {
      account: {
        id: observedId,
        name: account.name || null,
        accountStatus: null,
        status: account.status || null,
        currency: account.currency || null,
        timezoneName: "UTC",
        timezoneSource: "provider_reporting_and_budget_policy",
        reference: account.reference || null,
        test: account.test === true,
        servingStatuses,
      },
      permissions: {
        granted,
        missing: adsRead ? [] : ["rw_ads"],
        adsRead,
        adsManagement: granted.includes("rw_ads"),
        adsReporting: granted.includes("r_ads_reporting"),
        organizationSocialWrite: granted.includes("w_organization_social"),
        organizationSocialRead: granted.includes("r_organization_social"),
      },
      assets: {
        organization: {
          configured: Boolean(resolvedOrganizationId),
          id: resolvedOrganizationId,
          source: organizationId ? "configuration" : referencedOrganizationId ? "ad_account_reference" : null,
          matchesAccountReference: organizationMatches,
        },
        account: {
          status: account.status || null,
          test: account.test === true,
          servingStatuses,
        },
        token: {
          active: true,
          expiresAt: Number.isFinite(this.accessTokenExpiresAtMs) && this.accessTokenExpiresAtMs > 0
            ? Math.floor(this.accessTokenExpiresAtMs / 1000)
            : introspectionApplies ? token.expires_at || null : null,
          verificationSource: "ad_account_read",
          introspectionActive: token.active === true,
        },
      },
      paymentReady: servingStatuses.includes("RUNNABLE"),
      checkedAt: new Date().toISOString(),
    };
  }
}

export const linkedInMarketingSafety = Object.freeze({
  connectionVerificationSupported: true,
  campaignWritesSupported: true,
  preparationCreatesDraftOnly: true,
  activationRequiresOwner: true,
  reportingSupported: true,
  targetingDiscoverySupported: true,
  directSponsoredContentSupported: true,
  documentAdsSupportedWhenApproved: true,
  autonomousActivation: false,
  personalAccountAutomationSupported: false,
});
