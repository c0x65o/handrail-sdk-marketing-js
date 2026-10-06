import crypto from "node:crypto";

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
  constructor(message, { code = "provider_error", status = 502, providerCode = null, retryable = false } = {}) {
    super(redactProviderMessage(message));
    this.name = "MetaMarketingError";
    this.code = code;
    this.statusCode = status;
    this.providerCode = providerCode;
    this.retryable = retryable;
  }
}

function classifyError(status, payload) {
  const providerCode = payload?.error?.code ?? null;
  if (status === 429 || providerCode === 4 || providerCode === 17 || providerCode === 32) return { code: "rate_limited", status: 429, retryable: true, providerCode };
  if (status === 401 || status === 403 || providerCode === 10 || providerCode === 190 || providerCode === 200) return { code: "permission_error", status: 403, providerCode };
  if (providerCode === 100) return { code: "provider_error", status: 422, retryable: false, providerCode };
  if (status >= 500) return { code: "provider_unavailable", status: 503, retryable: true, providerCode };
  return { code: "provider_error", status: 502, providerCode };
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

  async request(path, { method = "GET", params = {}, body = null, form = null } = {}) {
    const url = new URL(`${this.graphRoot}/${this.apiVersion}/${String(path).replace(/^\//, "")}`);
    const values = { ...params };
    if (this.appSecret) values.appsecret_proof = crypto.createHmac("sha256", this.appSecret).update(this.accessToken).digest("hex");
    Object.entries(values).forEach(([key, value]) => value != null && url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
    } catch (error) {
      throw new MetaMarketingError(error?.name === "AbortError" ? "Meta request timed out" : "Meta is unavailable", { code: "provider_unavailable", status: 503, retryable: true });
    } finally { clearTimeout(timer); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      const info = classifyError(response.status, payload);
      const message = redactProviderMessage(payload?.error?.error_user_msg || payload?.error?.message || "Meta request failed", [this.accessToken, this.appSecret]);
      throw new MetaMarketingError(message, info);
    }
    return payload;
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
      checkedAt: new Date().toISOString(),
    };
  }

  async readAllPages(path, params) {
    const data = [];
    const cursors = new Set();
    let after;
    for (let page = 0; page < 200; page += 1) {
      // Retain the trusted endpoint and query. Never send credentials to the
      // provider-returned paging.next URL, which is not an authority boundary.
      const result = await this.request(path, { params: { ...params, after } });
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

  getInsights(adAccountId, { since, until, datePreset = "last_30d", level = "account", objectIds = [] } = {}) {
    if (!["account", "campaign", "adset", "ad"].includes(level)) throw new MetaMarketingError("Unsupported Meta insight level", { code: "invalid_configuration", status: 400 });
    return this.readAllPages(`${accountPath(adAccountId)}/insights`, {
      fields: "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,reach,impressions,frequency,cpm,clicks,inline_link_clicks,outbound_clicks,actions,cost_per_action_type",
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
        fields: "id,name,status,effective_status,campaign_id,billing_event,optimization_goal,destination_type,promoted_object,targeting,attribution_spec,daily_budget,bid_strategy,updated_time",
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

  listCustomAudiences(adAccountId) {
    return this.readAllPages(`${accountPath(adAccountId)}/customaudiences`, {
      fields: "id,name,subtype,operation_status,delivery_status",
      limit: 100,
    });
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
