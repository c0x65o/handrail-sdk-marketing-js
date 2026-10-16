import crypto from "node:crypto";
import {recordMarketingCredentials} from "./evidence-credentials.js";
import {safeMarketingEvidence} from "./evidence-projection.js";
export const META_AD_FIELDS = "id,name,status,effective_status,campaign_id,adset_id,creative,updated_time";
export const META_INSIGHT_FIELDS = "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,reach,impressions,frequency,cpm,clicks,inline_link_clicks,outbound_clicks,actions,cost_per_action_type";



const DEFAULT_VERSION = "v26.0";
const GRAPH_ROOT = "https://graph.facebook.com";
const TOKEN_RE = /(access_token|appsecret_proof)=[^&\s]+/gi;

export function redactProviderMessage(message, secrets = []) {
  let safe = String(message || "Meta request failed").replace(TOKEN_RE, "$1=[redacted]");
  for (const secret of secrets) {
    if (secret) safe = safe.replaceAll(String(secret), "[redacted]");
  }
  return safe;
}

export class MetaMarketingError extends Error {
  constructor(message, { code = "provider_error", status = 502, httpStatus = null, providerCode = null, providerSubcode = null, providerType = null, retryable = false, retryAfterMs = null } = {}) {
    super(redactProviderMessage(message));
    this.name = "MetaMarketingError";
    this.code = code;
    this.statusCode = status;
    this.httpStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    this.providerCode = Number.isSafeInteger(providerCode) && providerCode >= 0 ? providerCode : null;
    this.providerSubcode = Number.isSafeInteger(providerSubcode) && providerSubcode >= 0 ? providerSubcode : null;
    this.providerType = typeof providerType === "string" && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(providerType) ? providerType : null;
    this.retryable = retryable;
    this.retryAfterMs = Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : null;
  }
}

function classifyError(status, payload, method) {
  const providerCode = payload?.error?.code ?? null;
  const evidence = {httpStatus: status, providerCode, providerSubcode: payload?.error?.error_subcode, providerType: payload?.error?.type};
  // Reporting admission only: retain existing write rejection/uncertain-effect
  // semantics for 80004. Recognizing a read throttle never retries a write.
  if (status === 429 || providerCode === 4 || providerCode === 17 || providerCode === 32 || method === 'GET' && providerCode === 80004) return { code: "rate_limited", status: 429, retryable: true, ...evidence };
  if (status === 401 || status === 403 || providerCode === 10 || providerCode === 190 || providerCode === 200) return { code: "permission_error", status: 403, ...evidence };
  if (providerCode === 100) return { code: "provider_error", status: 422, retryable: false, ...evidence };
  if (status >= 500) return { code: "provider_unavailable", status: 503, retryable: true, ...evidence };
  return { code: "provider_error", status: 502, ...evidence };
}

// Optional bounded collection reads consume decoded bytes while streaming, before
// JSON parsing. Existing calls retain their response behavior and cost.
async function boundedJson(response,maxBytes,budget) {
  const limit=Math.min(maxBytes,budget.remaining);
  const tooLarge=()=>new MetaMarketingError("Meta response exceeded the read byte limit",{code:"provider_response_limit"});
  if(!response.body?.getReader)throw new MetaMarketingError("Meta response stream unavailable",{code:"provider_response_invalid"});
  const reader=response.body.getReader(),chunks=[];
  let bytes=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;budget.received+=value.byteLength;budget.remaining=Math.max(0,budget.remaining-value.byteLength);
      if(bytes>limit)throw tooLarge();
      chunks.push(Buffer.from(value));
    }
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch {throw new MetaMarketingError("Meta response was not JSON",{code:"provider_response_invalid"});}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function accountPath(accountId) {
  const id = typeof accountId === "string" ? accountId.replace(/^act_/, "") : "";
  if (!/^\d+$/.test(id)) throw new MetaMarketingError("A numeric Meta ad account ID is required", { code: "invalid_configuration", status: 400 });
  return `act_${id}`;
}

function requirePaused(input = {}) {
  if (input.status && input.status !== "PAUSED") throw new MetaMarketingError("Handrail only creates PAUSED Meta objects", { code: "unsafe_status", status: 400 });
  return { ...input, status: "PAUSED" };
}

export class MetaMarketingClient {
  /** @param {{accessToken: string, appSecret?: string | null, apiVersion?: string, fetchImpl?: typeof fetch, graphRoot?: string, timeoutMs?: number}} options */
  constructor({ accessToken, appSecret = null, apiVersion = DEFAULT_VERSION, fetchImpl = globalThis.fetch, graphRoot = GRAPH_ROOT, timeoutMs = 15000 } = {}) {
    if (!accessToken) throw new MetaMarketingError("Meta access token is not configured", { code: "disconnected", status: 409 });
    this.accessToken = accessToken;
    this.appSecret = appSecret;
    this.apiVersion = /^v\d+\.\d+$/.test(apiVersion) ? apiVersion : DEFAULT_VERSION;
    this.fetchImpl = fetchImpl;
    this.graphRoot = graphRoot.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  /** @param {string} path @param {{method?: string, params?: Record<string, any>, body?: any, form?: any, maxResponseBytes?: number | null, responseBudget?: {remaining: number, received: number} | null}} options */
  async request(path, { method = "GET", params = {}, body = null, form = null, maxResponseBytes = null, responseBudget = null } = {}) {
    if (maxResponseBytes !== null) {
      if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0)
        throw new MetaMarketingError("A positive response byte limit is required", {code:"invalid_configuration",status:400});
      responseBudget ??= {remaining:maxResponseBytes,received:0};
      if (!Number.isSafeInteger(responseBudget.remaining) || responseBudget.remaining < 0 || !Number.isSafeInteger(responseBudget.received) || responseBudget.received < 0)
        throw new MetaMarketingError("A valid response budget is required", {code:"invalid_configuration",status:400});
    }
    const url = new URL(`${this.graphRoot}/${this.apiVersion}/${String(path).replace(/^\//, "")}`);
    const values = { ...params };
    if (this.appSecret) values.appsecret_proof = crypto.createHmac("sha256", this.appSecret).update(this.accessToken).digest("hex");
    const secrets = [this.accessToken, this.appSecret, values.appsecret_proof].filter(Boolean);
    recordMarketingCredentials(this, ...secrets);
    Object.entries(values).forEach(([key, value]) => value != null && url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response,payload;
    try {
      response = await this.fetchImpl(url, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
      if(maxResponseBytes!==null) {
        try {payload=await boundedJson(response,maxResponseBytes,responseBudget);}
        catch(error) {
          // An HTTP rejection still feeds the shared cooldown/permission guard
          // when its body cannot be read safely. Never retain that raw body.
          if(!response.ok)payload={};else throw error;
        }
      }
    } catch (error) {
      if(maxResponseBytes!==null&&error instanceof MetaMarketingError)throw error;
      throw new MetaMarketingError(error?.name === "AbortError" ? "Meta request timed out" : "Meta is unavailable", { code: "provider_unavailable", status: 503, retryable: true });
    } finally { clearTimeout(timer); }
    if(maxResponseBytes===null)payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      const info = classifyError(response.status, payload, method);
      if (info.code === 'rate_limited' && method === 'GET') {
        const retryAfter = response.headers?.get?.('retry-after');
        if (retryAfter) info.retryAfterMs = /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      }
      info.providerType = safeMarketingEvidence(info.providerType, {lifecycle_credentials: secrets});
      const message = safeMarketingEvidence(redactProviderMessage(payload?.error?.error_user_msg || payload?.error?.message || "Meta request failed", secrets), {lifecycle_credentials: secrets});
      throw new MetaMarketingError(message, info);
    }
    return payload;
  }

  /** Country-only bounded search. Never follows paging.next or accepts a URL.
   * @param {string} query
   * @param {string | undefined} after */
  async searchCountries(query, after = undefined) {
    if (typeof query !== "string" || !query.trim() || query.length > 80 || /[\x00-\x1f\x7f]/.test(query) ||
      after !== undefined && (typeof after !== "string" || !/^[A-Za-z0-9_=-]{1,512}$/.test(after)))
      throw new MetaMarketingError("Invalid country search", { code: "invalid_country_search", status: 422 });
    const url = new URL(`${GRAPH_ROOT}/${DEFAULT_VERSION}/search`);
    url.search = new URLSearchParams({ type: "adgeolocation", location_types: '["country"]', q: query,
      limit: "50", locale: "en_US", ...(after ? { after } : {}) }).toString();
    if (this.appSecret) url.searchParams.set("appsecret_proof", crypto.createHmac("sha256", this.appSecret).update(this.accessToken).digest("hex"));
    recordMarketingCredentials(this, this.accessToken, this.appSecret, url.searchParams.get("appsecret_proof"));
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new MetaMarketingError("Country search timed out", { code: "country_search_timeout", status: 503 }));
    }, Math.min(this.timeoutMs, 10000)); });
    const read = async () => {
      const response = await this.fetchImpl(url, { method: "GET", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${this.accessToken}` } });
      if (!response.ok) { await response.body?.cancel(); throw new MetaMarketingError("Country search unavailable", classifyError(response.status, {})); }
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 65536) { await response.body?.cancel(); throw new MetaMarketingError("Country search too large", { code: "country_search_oversized" }); }
      const reader = response.body?.getReader();
      if (!reader) throw new MetaMarketingError("Country search unavailable");
      const chunks = []; let bytes = 0;
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65536) throw new MetaMarketingError("Country search too large", { code: "country_search_oversized" });
          chunks.push(Buffer.from(chunk.value)); }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    };
    try { return await Promise.race([read(), deadline]); }
    finally { clearTimeout(timer); }
  }

  async verifyConnection({ adAccountId, pageId, pixelId }) {
    const [account, permissionResult] = await Promise.all([
      this.request(accountPath(adAccountId), { params: { fields: "id,name,account_status,disable_reason,currency,timezone_name,business,amount_spent,balance,spend_cap,funding_source_details" } }),
      this.request("me/permissions"),
    ]);
    if (typeof account.id !== "string" || !/^act_\d+$/.test(account.id) || account.id !== accountPath(adAccountId))
      throw new MetaMarketingError("Account identity was not verified", { code: "verification_failed", status: 502 });
    const optionalAsset = async (id, fields) => {
      if (!id) return { configured: false, accessible: false, details: null, errorCode: null };
      try {
        return { configured: true, accessible: true, details: await this.request(id, { params: { fields } }), errorCode: null };
      } catch (error) {
        return { configured: true, accessible: false, details: null, errorCode: error?.code || "provider_error" };
      }
    };
    const [pageResult, pixelResult] = await Promise.all([
      optionalAsset(pageId, "id,name,instagram_business_account{id,username}"),
      optionalAsset(pixelId, "id,name,last_fired_time"),
    ]);
    const grantedPermissions = (permissionResult.data || [])
      .filter((permission) => String(permission.status || "").toLowerCase() === "granted")
      .map((permission) => String(permission.permission || ""))
      .filter(Boolean)
      .sort();
    const canReadAds = grantedPermissions.includes("ads_read") || grantedPermissions.includes("ads_management");
    const missingPermissions = canReadAds ? [] : ["ads_read"];
    return {
      account: {
        id: account.id || null,
        name: account.name || null,
        accountStatus: account.account_status ?? null,
        disableReason: account.disable_reason ?? null,
        currency: account.currency || null,
        timezoneName: account.timezone_name || null,
        business: account.business ? { id: account.business.id || null, name: account.business.name || null } : null,
        amountSpent: account.amount_spent ?? null,
        balance: account.balance ?? null,
        spendCap: account.spend_cap ?? null,
      },
      permissions: {
        granted: grantedPermissions,
        missing: missingPermissions,
        adsRead: canReadAds,
        adsManagement: grantedPermissions.includes("ads_management"),
        businessManagement: grantedPermissions.includes("business_management"),
      },
      assets: {
        page: {
          configured: pageResult.configured,
          accessible: pageResult.accessible,
          id: pageResult.details?.id || null,
          name: pageResult.details?.name || null,
          instagramAccount: pageResult.details?.instagram_business_account || null,
          errorCode: pageResult.errorCode,
        },
        pixel: {
          configured: pixelResult.configured,
          accessible: pixelResult.accessible,
          id: pixelResult.details?.id || null,
          name: pixelResult.details?.name || null,
          lastFiredTime: pixelResult.details?.last_fired_time || null,
          errorCode: pixelResult.errorCode,
        },
      },
      paymentReady: Boolean(account.funding_source_details),
      fundingSourceObserved: typeof account.funding_source_details?.id === "string" && account.funding_source_details.id.trim().length > 0,
      checkedAt: new Date().toISOString(),
    };
  }

  async readAllPages(path, params, guard = () => {}) {
    const data = [];
    const cursors = new Set();
    let after;
    for (let page = 0; page < 200; page += 1) {
      // Retain the trusted endpoint and query. Never send credentials to the
      // provider-returned paging.next URL, which is not an authority boundary.
      await guard();
      const result = await this.request(path, { params: { ...params, after } });
      await guard();
      if (!Array.isArray(result.data)) {
        throw new MetaMarketingError("Meta returned an invalid collection", { code: "provider_pagination_incomplete" });
      }
      data.push(...result.data);
      if (!result.paging?.next) return { data };
      after = result.paging?.cursors?.after;
      if (typeof after !== "string" || !after || cursors.has(after)) {
        throw new MetaMarketingError("Meta pagination did not advance; the collection is incomplete", { code: "provider_pagination_incomplete" });
      }
      cursors.add(after);
    }
    throw new MetaMarketingError("Meta collection exceeded the bounded page limit; narrow the reporting scope", { code: "provider_pagination_incomplete" });
  }

  listCampaigns(adAccountId) {
    return this.readAllPages(`${accountPath(adAccountId)}/campaigns`, { fields: "id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget,updated_time", limit: 100 });
  }

  /** @param {string} adAccountId @param {{since?: string, until?: string, datePreset?: string, level?: string, objectIds?: string[], breakdowns?: string, fields?: string}} options */
  getInsights(adAccountId, { since, until, datePreset = "last_30d", level = "account", objectIds = [], breakdowns = undefined, fields = undefined } = {}) {
    if (!["account", "campaign", "adset", "ad"].includes(level)) throw new MetaMarketingError("Unsupported Meta insight level", { code: "invalid_configuration", status: 400 });
    return this.readAllPages(`${accountPath(adAccountId)}/insights`, {
      fields: fields || "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,reach,impressions,frequency,cpm,clicks,inline_link_clicks,outbound_clicks,actions,cost_per_action_type",
      breakdowns,
      level,
      time_range: since && until ? { since, until } : undefined,
      date_preset: since && until ? undefined : datePreset,
      time_increment: 1,
      filtering: objectIds.length ? [{ field: `${level}.id`, operator: "IN", value: objectIds }] : undefined,
      limit: 500,
    });
  }

  listObjects(parentId, type) {
    if (type === "campaign") return this.listCampaigns(parentId);
    const contract = {
      adset: {
        edge: "adsets",
        fields: "id,name,status,effective_status,campaign_id,billing_event,optimization_goal,targeting_optimization_types,destination_type,promoted_object,targeting,attribution_spec,daily_budget,bid_strategy,updated_time",
      },
      creative: {
        edge: "adcreatives",
        fields: "id,name,status,object_story_spec,asset_feed_spec,image_hash,url_tags,thumbnail_url",
      },
      ad: {
        edge: "ads",
        fields: "id,name,status,effective_status,campaign_id,adset_id,creative,updated_time",
      },
    }[type];
    if (!contract) throw new MetaMarketingError("Unsupported Meta object list", { code: "invalid_object_type", status: 400 });
    return this.readAllPages(`${String(parentId).replace(/^\//, "")}/${contract.edge}`, { fields: contract.fields, limit: 200 });
  }

  searchTargeting(query, type = "adinterest") {
    const q = String(query || "").trim();
    if (!q || type !== "adinterest") throw new MetaMarketingError("A supported Meta targeting query is required", { code: "invalid_configuration", status: 400 });
    return this.request("search", { params: { type, q, limit: 100 } });
  }

  readAudienceAccount(adAccountId) {
    return this.request(accountPath(adAccountId), { params: { fields: "id,account_status,disable_reason,currency" } });
  }

  /** @param {string} adAccountId @param {{eligibilityMetadata?:boolean,assertCurrent?:()=>void|Promise<void>}} options */
  listCustomAudiences(adAccountId, { eligibilityMetadata = false, assertCurrent } = {}) {
    return this.readAllPages(`${accountPath(adAccountId)}/customaudiences`, {
      fields: "id,name,subtype,operation_status,delivery_status" + (eligibilityMetadata
        ? ",data_source{type,sub_type},customer_file_source,pixel_id,external_event_source{id}" : ""),
      limit: 100,
    }, assertCurrent);
  }

  listImages(adAccountId) {
    return this.readAllPages(`${accountPath(adAccountId)}/adimages`, {
      fields: "hash,name,original_width,original_height,status,updated_time",
      limit: 200,
    });
  }

  getObject(objectId, fields = "id,name,status,effective_status,updated_time") {
    return this.request(objectId, { params: { fields } });
  }

  getPreview(creativeId, adFormat) {
    return this.request(`${creativeId}/previews`, { params: { ad_format: adFormat } });
  }

  async updateDeliveryStatus(objectId, status) {
    if (!["ACTIVE", "PAUSED"].includes(status)) throw new MetaMarketingError("Meta delivery status must be ACTIVE or PAUSED", { code: "unsafe_status", status: 400 });
    try {
      await this.request(objectId, { method: "POST", params: { status } });
    } catch (error) {
      error.providerOutcome = error?.retryable ? "unknown" : "rejected";
      throw error;
    }
    let verified;
    try {
      verified = await this.getObject(objectId);
    } catch (cause) {
      const error = new MetaMarketingError("Meta accepted the delivery-status request, but its outcome could not be verified", {
        code: "provider_outcome_unknown", status: 502, retryable: false,
      });
      error.providerOutcome = "unknown";
      error.cause = cause;
      throw error;
    }
    if (String(verified?.id || "") !== String(objectId) || verified?.status !== status) {
      const error = new MetaMarketingError("Meta has not confirmed the requested object's configured delivery status", {
        code: "provider_outcome_unknown", status: 502, retryable: false,
      });
      error.providerOutcome = "unknown";
      throw error;
    }
    // Effective delivery can still be IN_PROCESS after configured activation.
    // Retain it as a separate observation instead of inventing a successful
    // configuration from the request when provider readback is missing.
    return { id: objectId, configuredStatus: verified.status, effectiveStatus: verified.effective_status || null, verified };
  }

  async updateDailyBudget(objectId, dailyBudgetCents) {
    const dailyBudget = Number(dailyBudgetCents);
    if (!Number.isSafeInteger(dailyBudget) || dailyBudget <= 0) throw new MetaMarketingError("Meta daily budget must be positive whole cents", { code: "invalid_configuration", status: 400 });
    try {
      await this.request(objectId, { method: "POST", params: { daily_budget: dailyBudget } });
    } catch (error) {
      error.providerOutcome = error?.retryable ? "unknown" : "rejected";
      throw error;
    }
    let verified;
    try {
      verified = await this.getObject(objectId, "id,name,daily_budget,status,effective_status,updated_time");
    } catch (cause) {
      const error = new MetaMarketingError("Meta accepted the budget request, but its outcome could not be verified", {
        code: "provider_outcome_unknown", status: 502, retryable: false,
      });
      error.providerOutcome = "unknown";
      error.cause = cause;
      throw error;
    }
    if (Number(verified.daily_budget) !== dailyBudget) {
      const error = new MetaMarketingError("Meta did not verify the requested daily budget", { code: "provider_outcome_unknown", status: 502 });
      error.providerOutcome = "unknown";
      throw error;
    }
    return { id: objectId, dailyBudgetCents: dailyBudget, configuredStatus: verified.status || null, effectiveStatus: verified.effective_status || null, verified };
  }

  async attachCreativeToAd(adId, creativeId) {
    if (!/^\d+$/.test(String(adId)) || !/^\d+$/.test(String(creativeId))) {
      throw new MetaMarketingError("Numeric Meta ad and creative IDs are required", { code: "invalid_configuration", status: 400 });
    }
    try {
      await this.request(adId, { method: "POST", params: { creative: { creative_id: creativeId } } });
    } catch (error) {
      error.providerOutcome = error?.retryable ? "unknown" : "rejected";
      throw error;
    }
    try {
      const verified = await this.getObject(adId, "id,name,status,effective_status,campaign_id,adset_id,creative,updated_time");
      const attachedId = typeof verified.creative === "string" ? verified.creative : verified.creative?.id;
      if (String(verified.id) === String(adId) && String(attachedId) === String(creativeId)) return verified;
    } catch (cause) {
      const error = new MetaMarketingError("Meta accepted the ad edit, but readback failed", { code: "provider_outcome_unknown" });
      error.providerOutcome = "unknown";
      error.cause = cause;
      throw error;
    }
    const error = new MetaMarketingError("Meta has not confirmed the ad's new creative", { code: "provider_outcome_unknown" });
    error.providerOutcome = "unknown";
    throw error;
  }

  /** @param {string} pixelId @param {{since?: string, until?: string, event?: string}} options */
  getPixelEventStats(pixelId, { since, until, event = "Lead" } = {}) {
    return this.request(`${pixelId}/stats`, { params: {
      aggregation: "event",
      start_time: since,
      end_time: until,
      event,
    } });
  }

  sendPixelEvent(pixelId, event, { testEventCode = null } = {}) {
    if (!event?.event_name || !event?.event_time || !event?.event_id || !event?.action_source) {
      throw new MetaMarketingError("A complete Meta server event is required", { code: "invalid_configuration", status: 400 });
    }
    return this.request(`${pixelId}/events`, { method: "POST", params: {
      data: [event],
      test_event_code: testEventCode || undefined,
    } });
  }

  uploadImage(adAccountId, { bytesBase64, filename }) {
    if (!bytesBase64) throw new MetaMarketingError("Image data is required", { code: "invalid_asset", status: 400 });
    const bytes = Buffer.from(bytesBase64, "base64");
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new MetaMarketingError("Image must be between 1 byte and 30 MB", { code: "invalid_asset", status: 400 });
    const form = new FormData();
    form.set("filename", new Blob([bytes]), filename || "handrail-creative.jpg");
    return this.request(`${accountPath(adAccountId)}/adimages`, { method: "POST", form });
  }

  uploadVideo(adAccountId, { fileUrl, title }) {
    if (!/^https:\/\//i.test(String(fileUrl || ""))) throw new MetaMarketingError("A provider-readable HTTPS video URL is required", { code: "invalid_asset", status: 400 });
    return this.request(`${accountPath(adAccountId)}/advideos`, { method: "POST", params: { file_url: fileUrl, title: title || "Handrail creative" } });
  }

  async createPausedObject(adAccountId, type, input) {
    const endpoints = { campaign: "campaigns", adset: "adsets", creative: "adcreatives", ad: "ads" };
    const endpoint = endpoints[type];
    if (!endpoint) throw new MetaMarketingError("Unsupported Meta object type", { code: "invalid_object_type", status: 400 });
    // New ad-set-budget campaigns must explicitly disable sharing (API v24+).
    // Do not default omitted/unknown input or offer an enabling option.
    if (type === "campaign" && input?.is_adset_budget_sharing_enabled !== false)
      throw new MetaMarketingError("Meta campaign budget sharing must be explicitly false", { code: "invalid_configuration", status: 400 });
    const safe = type === "creative" ? { ...input } : requirePaused(input);
    const created = await this.request(`${accountPath(adAccountId)}/${endpoint}`, { method: "POST", params: safe });
    if (!created?.id) throw new MetaMarketingError("Meta did not return an object ID", { code: "verification_failed", status: 502 });
    const fields = type === "creative"
      ? "id,name,object_story_spec,asset_feed_spec,image_hash,url_tags"
      : type === "adset"
        ? "id,name,status,effective_status,campaign_id,targeting,daily_budget,updated_time"
        : "id,name,status,effective_status";
    let verified;
    try {
      verified = await this.request(created.id, { params: { fields } });
    } catch (error) {
      error.providerOutcome = "unknown";
      error.providerObjectId = created.id;
      throw error;
    }
    if (type !== "creative" && !["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(verified.status) && !String(verified.effective_status || "").includes("PAUSED")) {
      throw new MetaMarketingError("Meta object was not verified as paused", { code: "verification_failed", status: 502 });
    }
    return { id: created.id, type, status: type === "creative" ? "CREATED" : "PAUSED", verified };
  }
}

export const metaMarketingSafety = Object.freeze({ activationSupported: true, autonomousActivation: false, deleteSupported: false, createdStatus: "PAUSED" });
