import type { MeasurementInput, MeasurementRow, MeasurementSnapshot, MeasurementValue } from "../core/measurement.js";
import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { LinkedInMarketingClient } from "../support/owner-marketing/linkedin-client.js";
import { digest, requireThat } from "./store.js";
import { measurementDays, measured, unknownMeasurement } from "./measurement.js";

/** Only server-side callers receive authenticated clients; credentials never enter evidence. */
export { MetaMarketingClient as MetaMeasurementClient, LinkedInMarketingClient as LinkedInMeasurementClient };
export type MeasurementClient =
  | { provider: "meta"; client: Pick<MetaMarketingClient, "getInsights" | "apiVersion"> }
  | { provider: "linkedin"; client: Pick<LinkedInMarketingClient, "getAnalytics" | "apiVersion"> };
export interface CollectionOptions extends Pick<MeasurementInput, "identity" | "window" | "delivery" | "outcomes" | "maturity"> {
  /** Host/NativeProvider supplies its freshly verified account and campaign binding. */
  verifiedScope: { accountId: string; currency: string; timezone: string; campaignIds: string[]; evidenceRefs: string[] };
  client: MeasurementClient;
  includePlacements?: boolean;
  /** One exact provider event, never a sum of overlapping action families. */
  metaConversionAction?: string;
  sourceKind?: "provider_api" | "synthetic";
  now?: () => string;
  retry?: { attempts: number; wait: (attempt: number) => Promise<void> };
}
export function measurementAccountId(provider: "meta" | "linkedin", value: string): string {
  const id = provider === "meta" ? value.replace(/^act_/, "") : value.replace(/^urn:li:sponsoredAccount:/, "");
  requireThat(/^\d+$/.test(id), "invalid_measurement_identity", 422);
  return id;
}
const numeric = (value: unknown, integer = false): MeasurementValue => {
  if (value === undefined || value === null || value === "") return unknownMeasurement("not_returned");
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(?:\.\d+)?$/.test(String(value)) ||
    !Number.isFinite(Number(value)) || (integer && !Number.isSafeInteger(Number(value)))) return unknownMeasurement("invalid_provider_value");
  return measured(Number(value));
};
/** Decimal parsing prevents binary floating point from changing currency rounding. */
export function providerMoneyMinor(value: unknown, factor: number): MeasurementValue {
  if (value === undefined || value === null || value === "") return unknownMeasurement("not_returned");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match || !Number.isSafeInteger(factor) || factor <= 0) return unknownMeasurement("invalid_provider_money");
  const decimals = match[2] || "", denominator = 10n ** BigInt(decimals.length);
  const numerator = BigInt(`${match[1]}${decimals}`) * BigInt(factor);
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? measured(Number(rounded)) : unknownMeasurement("provider_money_overflow");
}
function actionValue(value: unknown, action: string, integer = false): MeasurementValue {
  if (!Array.isArray(value)) return unknownMeasurement("not_returned");
  const matching = value.filter(v => v && typeof v === "object" && v.action_type === action);
  return matching.length === 1 ? numeric(matching[0].value, integer) : unknownMeasurement(matching.length ? "ambiguous_action_rows" : "action_not_returned");
}
function linkedDate(value: any): string {
  requireThat(value && [value.year, value.month, value.day].every(Number.isInteger), "measurement_row_scope_mismatch", 422);
  const day = `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  requireThat(Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day, "measurement_row_scope_mismatch", 422);
  return day;
}
const knownErrors = new Set(["permission_error", "disconnected", "rate_limited", "provider_unavailable", "provider_pagination_incomplete",
  "provider_reporting_incomplete", "provider_reporting_range_invalid", "measurement_row_scope_mismatch", "measurement_overlapping_rows"]);
function safeError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  return code && knownErrors.has(code) ? code : "provider_reporting_failed";
}
export async function collectProviderMeasurement(options: CollectionOptions): Promise<MeasurementInput> {
  const { identity, window, verifiedScope, client } = options, days = measurementDays(window);
  requireThat(client.provider === identity.provider && /^\d+$/.test(identity.accountId) && identity.campaignIds.every(c => /^\d+$/.test(c)), "invalid_measurement_identity", 422);
  requireThat(verifiedScope.accountId === identity.accountId && verifiedScope.currency === window.currency &&
    verifiedScope.timezone === window.timezone && verifiedScope.evidenceRefs.length > 0 &&
    identity.campaignIds.every(id => verifiedScope.campaignIds.includes(id)), "measurement_scope_unverified", 403);
  requireThat(identity.provider !== "linkedin" || window.timezone === "UTC", "linkedin_utc_required", 422);
  const now = options.now || (() => new Date().toISOString());
  const retry = options.retry || { attempts: 3, wait: (attempt: number) => new Promise<void>(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1))) };
  requireThat(Number.isSafeInteger(retry.attempts) && retry.attempts > 0, "invalid_reporting_retry", 422);
  const snapshots: MeasurementSnapshot[] = [];
  const since = days[0]!, until = days.at(-1)!;
  const normalize = (raw: any[], campaignIds: string[], placements: boolean): MeasurementRow[] => {
    const seen = new Set<string>();
    return raw.map(row => {
      const meta = identity.provider === "meta";
      const campaignId = meta ? String(row.campaign_id) : placements ? campaignIds[0]! : String(row.pivotValues?.[0] || "").replace(/^urn:li:sponsoredCampaign:/, "");
      const day = meta ? row.date_start : linkedDate(row.dateRange?.start), end = meta ? row.date_stop : linkedDate(row.dateRange?.end);
      requireThat(campaignIds.includes(campaignId) && days.includes(day) && end === day &&
        (meta ? String(row.account_id) === identity.accountId && !row.adset_id && !row.ad_id : Array.isArray(row.pivotValues) && row.pivotValues.length === 1),
      "measurement_row_scope_mismatch", 422);
      let placement: string | null = null;
      if (placements) {
        if (meta) {
          requireThat(typeof row.publisher_platform === "string" && /^[a-z_]+$/.test(row.publisher_platform) &&
            typeof row.platform_position === "string" && /^[a-z_]+$/.test(row.platform_position), "measurement_row_scope_mismatch", 422);
          placement = `${row.publisher_platform}/${row.platform_position}`;
        } else {
          requireThat(["LINKEDIN", "OFFSITE", "OFFSITE_IN_STREAM"].includes(row.pivotValues[0]), "measurement_row_scope_mismatch", 422);
          placement = row.pivotValues[0];
        }
      }
      const key = `${campaignId}/${day}/${placement}`;
      requireThat(!seen.has(key), "measurement_overlapping_rows", 422); seen.add(key);
      return { campaignId, day, placement,
        spendMinor: providerMoneyMinor(meta ? row.spend : row.costInLocalCurrency, window.minorUnitsPerMajor),
        impressions: numeric(row.impressions, true), clicks: numeric(row.clicks, true),
        outboundClicks: meta ? actionValue(row.outbound_clicks, "outbound_click", true) : numeric(row.landingPageClicks, true),
        landingViews: meta ? actionValue(row.actions, "landing_page_view", true) : unknownMeasurement("provider_metric_unsupported"),
        providerConversions: meta ? options.metaConversionAction ? actionValue(row.actions, options.metaConversionAction) : unknownMeasurement("conversion_mapping_unqualified") : numeric(row.externalWebsiteConversions),
        conversionDefinition: meta ? options.metaConversionAction || null : "externalWebsiteConversions",
        providerCpm: meta ? numeric(row.cpm) : unknownMeasurement("provider_metric_not_returned"),
        providerOutboundCtrPercent: meta ? actionValue(row.outbound_clicks_ctr, "outbound_click") : unknownMeasurement("provider_metric_not_returned") };
    });
  };
  const collect = async (campaignIds: string[], placements: boolean): Promise<{ rows: MeasurementRow[]; error: string | null }> => {
    const request = { kind: placements ? "placements" as const : "campaign_totals" as const, campaignIds, since, until };
    for (let attempt = 1; ; attempt++) {
      let rows: MeasurementRow[] = [], errorCode: string | null = null, retryable = false;
      try {
        const raw = client.provider === "meta"
          ? (await client.client.getInsights(identity.accountId, { since, until, level: "campaign", objectIds: campaignIds,
            fields: "account_id,campaign_id,date_start,date_stop,spend,impressions,clicks,cpm,outbound_clicks,outbound_clicks_ctr,actions",
            ...(placements ? { breakdowns: "publisher_platform,platform_position" } : {}) })).data
          : (await client.client.getAnalytics(identity.accountId, { since, until, pivot: placements ? "PLACEMENT_NAME" : "CAMPAIGN",
            campaignUrns: campaignIds.map(id => `urn:li:sponsoredCampaign:${id}`) })).elements;
        requireThat(Array.isArray(raw), "provider_reporting_incomplete");
        rows = normalize(raw, campaignIds, placements);
      } catch (error) { errorCode = safeError(error); retryable = (error as { retryable?: boolean })?.retryable === true && ["rate_limited", "provider_unavailable"].includes(errorCode); }
      const snapshot = { request, collectedAt: now(), attempt, rows, error: errorCode };
      snapshots.push({ ...snapshot, digest: digest(snapshot) });
      if (!errorCode || !retryable || attempt >= retry.attempts) return { rows, error: errorCode };
      await retry.wait(attempt);
    }
  };
  const totals = await collect(identity.campaignIds, false);
  const totalSnapshots = [...snapshots];
  const placementRows: MeasurementRow[] = []; let placementError: string | null = options.includePlacements ? null : "not_requested";
  if (options.includePlacements && !totals.error) {
    // One LinkedIn campaign per placement query preserves the campaign binding when pivotValues contains the placement alone.
    const groups = identity.provider === "linkedin" ? identity.campaignIds.map(id => [id]) : [identity.campaignIds];
    for (const ids of groups) { const result = await collect(ids, true); placementRows.push(...result.rows); if (result.error) placementError = result.error; }
  } else if (totals.error) placementError = "campaign_reporting_unavailable";
  return {
    identity: structuredClone(identity), window: structuredClone(window), rows: totals.rows, snapshots,
    source: { kind: options.sourceKind || "provider_api", collector: `sdk_${identity.provider}_daily_v1`, apiVersion: client.client.apiVersion,
      collectedAt: now(), receiptIds: totalSnapshots.map(s => `collection_${s.digest}`), snapshotDigests: totalSnapshots.map(s => s.digest),
      paginationComplete: !totals.error, missingReason: totals.error, dataThrough: null },
    placements: { rows: placementRows, complete: placementError === null, reason: placementError, snapshotDigests: snapshots.slice(totalSnapshots.length).map(s => s.digest) },
    delivery: structuredClone(options.delivery), outcomes: structuredClone(options.outcomes), maturity: structuredClone(options.maturity),
  };
}
