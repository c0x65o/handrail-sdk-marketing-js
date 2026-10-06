import { capabilityBlockers, dailyExposureMinor } from "../core/index.js";
import type { AdvertisingBudget, Audience, DraftMaterial, Material } from "../core/index.js";
import { requireThat } from "./store.js";

export function text(value: unknown, max = 200): string {
  requireThat(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "invalid_text",
    422,
  );
  return value;
}
export function instant(value: unknown): string {
  text(value, 40);
  requireThat(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value as string) &&
      Number.isFinite(Date.parse(value as string)),
    "invalid_instant",
    422,
  );
  return value as string;
}
export function keys(
  value: unknown,
  allowed: string[],
): asserts value is Record<string, unknown> {
  requireThat(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => allowed.includes(k)),
    "unexpected_fields",
    422,
  );
}
/** Validate local document shape and bounds, without requiring provider readiness. */
export function draftMaterial(value: DraftMaterial) {
  keys(value, ["name", "headline", "body", "destination", "destinationDigest",
    "searchHeadlines", "searchDescriptions", "assetIds", "audience", "budget",
    "startAt", "endAt", "timezone", "advertisingBudget", "purpose", "settings", "applicantGoal"]);
  if (value.purpose !== undefined) requireThat(["acquisition", "recruitment"].includes(value.purpose), "invalid_purpose", 422);
  if (value.advertisingBudget) advertisingBudget(value.advertisingBudget);
  for (const field of [value.settings, value.applicantGoal]) if (field !== undefined) requireThat(field && typeof field === "object" && !Array.isArray(field) && JSON.stringify(field).length <= 20000, "invalid_draft_settings", 422);
  text(value.name, 100);
  const optionalText = (v: unknown, max: number) => requireThat(
    typeof v === "string" && v.length <= max, "invalid_draft_text", 422);
  for (const [key, max] of Object.entries({ headline: 150, body: 3000, destination: 2000,
    destinationDigest: 64, startAt: 40, endAt: 40, timezone: 100 })) {
    if (Object.hasOwn(value, key)) optionalText(value[key as keyof DraftMaterial], max);
  }
  const strings = (v: unknown, count: number, max: number) => {
    requireThat(Array.isArray(v) && v.length <= count, "invalid_draft_list", 422);
    v.forEach(x => optionalText(x, max));
  };
  for (const key of ["assetIds", "searchHeadlines", "searchDescriptions"] as const)
    if (Object.hasOwn(value, key)) strings(value[key], key === "assetIds" ? 3 : 15, 200);
  if (Object.hasOwn(value, "budget")) {
    keys(value.budget, ["currency", "minor"]);
    if (Object.hasOwn(value.budget, "currency")) optionalText(value.budget.currency, 3);
    if (Object.hasOwn(value.budget, "minor")) requireThat(Number.isSafeInteger(value.budget.minor) &&
      value.budget.minor! >= 0 && value.budget.minor! <= 1e9, "invalid_draft_budget", 422);
  }
  if (Object.hasOwn(value, "audience")) {
    keys(value.audience, ["provider", "locations", "ageMin", "ageMax", "keywords", "jobTitles", "expansion"]);
    const a = value.audience;
    if (Object.hasOwn(a, "provider")) requireThat(["meta", "google", "linkedin"].includes(a.provider!), "invalid_provider", 422);
    for (const key of ["locations", "keywords", "jobTitles"] as const)
      if (Object.hasOwn(a, key)) strings(a[key], 30, 200);
    for (const key of ["ageMin", "ageMax"] as const)
      if (Object.hasOwn(a, key)) requireThat(Number.isInteger(a[key]) && a[key]! >= 18 && a[key]! <= 65, "invalid_age", 422);
    if (Object.hasOwn(a, "expansion")) requireThat(a.expansion === false, "unsupported_targeting", 422);
  }
}
export function audience(value: Audience, provider: string) {
  keys(value, [
    "provider",
    "locations",
    "ageMin",
    "ageMax",
    "keywords",
    "jobTitles",
    "expansion",
  ]);
  requireThat(
    value.provider === provider && value.expansion === false,
    "unsupported_targeting",
    422,
  );
  requireThat(
    Array.isArray(value.locations) &&
      value.locations.length > 0 &&
      value.locations.length <= 20,
    "invalid_locations",
    422,
  );
  const pattern =
    provider === "meta"
      ? /^[A-Z]{2}$/
      : provider === "google"
        ? /^geoTargetConstants\/\d+$/
        : /^urn:li:geo:\d+$/;
  requireThat(
    value.locations.every((x) => typeof x === "string" && pattern.test(x)),
    "provider_location_id_required",
    422,
  );
  if (provider === "meta") {
    requireThat(
      !value.keywords && !value.jobTitles,
      "unsupported_targeting",
      422,
    );
    for (const age of [value.ageMin, value.ageMax])
      requireThat(
        Number.isInteger(age) && age! >= 18 && age! <= 65,
        "invalid_age",
        422,
      );
    requireThat(value.ageMin! <= value.ageMax!, "invalid_age", 422);
  } else {
    requireThat(
      value.ageMin === undefined && value.ageMax === undefined,
      "unsupported_age_targeting",
      422,
    );
    if (provider === "google") {
      requireThat(
        !value.jobTitles &&
          Array.isArray(value.keywords) &&
          value.keywords.length > 0 &&
          value.keywords.length <= 30,
        "search_keywords_required",
        422,
      );
      value.keywords.forEach((x) => text(x, 80));
    } else {
      requireThat(
        !value.keywords &&
          (!value.jobTitles ||
            (value.jobTitles.length <= 20 &&
              value.jobTitles.every((x) => /^urn:li:title:\d+$/.test(x)))),
        "unsupported_targeting",
        422,
      );
    }
  }
}
export function material(value: Material, provider: string) {
  keys(value, [
    "name",
    "headline",
    "body",
    "searchHeadlines",
    "searchDescriptions",
    "destination",
    "destinationDigest",
    "assetIds",
    "audience",
    "budget",
    "advertisingBudget",
    "purpose",
    "settings",
    "applicantGoal",
    "startAt",
    "endAt",
    "timezone",
  ]);
  text(value.name, 100);
  text(value.headline, provider === "google" ? 30 : 150);
  text(value.body, provider === "google" ? 90 : 3000);
  if (provider === "google") {
    requireThat(
      Array.isArray(value.searchHeadlines) &&
        value.searchHeadlines.length >= 3 &&
        value.searchHeadlines.length <= 15 &&
        new Set(value.searchHeadlines).size === value.searchHeadlines.length,
      "search_headlines_required",
      422,
    );
    requireThat(
      Array.isArray(value.searchDescriptions) &&
        value.searchDescriptions.length >= 2 &&
        value.searchDescriptions.length <= 4,
      "search_descriptions_required",
      422,
    );
    value.searchHeadlines.forEach((v) => text(v, 30));
    value.searchDescriptions.forEach((v) => text(v, 90));
  } else
    requireThat(
      !value.searchHeadlines && !value.searchDescriptions,
      "unsupported_copy_fields",
      422,
    );
  const url = new URL(text(value.destination, 2000));
  requireThat(
    url.protocol === "https:" && !url.username && !url.password,
    "https_destination_required",
    422,
  );
  requireThat(
    /^[a-f0-9]{64}$/.test(value.destinationDigest),
    "destination_snapshot_required",
    422,
  );
  requireThat(
    Array.isArray(value.assetIds) &&
      value.assetIds.length <= 3 &&
      new Set(value.assetIds).size === value.assetIds.length,
    "invalid_assets",
    422,
  );
  value.assetIds.forEach((x) => text(x));
  keys(value.budget, ["currency", "minor"]);
  requireThat(
    ["USD", "EUR", "GBP", "CAD", "AUD"].includes(value.budget.currency) &&
      Number.isSafeInteger(value.budget.minor) &&
      value.budget.minor > 0 &&
      value.budget.minor <= 1e9,
    "unsupported_money",
    422,
  );
  requireThat(value.purpose === undefined || ["acquisition", "recruitment"].includes(value.purpose), "invalid_purpose", 422);
  const blockers = capabilityBlockers(value);
  requireThat(!blockers.length, blockers[0] || "unsupported_capability", 422);
  requireThat(value.settings || value.applicantGoal === undefined, "applicant_goal_requires_settings", 422);
  if (value.advertisingBudget) {
    advertisingBudget(value.advertisingBudget);
    requireThat(!value.advertisingBudget.campaignDailyCeiling || (dailyExposureMinor(value) !== null && dailyExposureMinor(value)! <= value.advertisingBudget.campaignDailyCeiling.minor), "campaign_daily_exposure_exceeded", 422);
    requireThat(value.advertisingBudget.lifetime.currency === value.budget.currency &&
      value.advertisingBudget.lifetime.minor === value.budget.minor, "legacy_lifetime_budget_mismatch", 422);
  }
  instant(value.startAt);
  instant(value.endAt);
  requireThat(
    Date.parse(value.endAt) > Date.parse(value.startAt),
    "invalid_delivery_window",
    422,
  );
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
  } catch {
    requireThat(false, "invalid_timezone", 422);
  }
  audience(value.audience, provider);
}

export function advertisingBudget(value: AdvertisingBudget) {
  keys(value, ["lifetime", "daily", "campaignDailyCeiling", "campaignLifetimeCeiling"]);
  requireThat(value.lifetime, "lifetime_budget_required", 422);
  for (const amount of Object.values(value)) {
    keys(amount, ["currency", "minor"]);
    requireThat(["USD", "EUR", "GBP", "CAD", "AUD"].includes(String(amount.currency)) &&
      amount.currency === value.lifetime.currency && Number.isSafeInteger(amount.minor) &&
      Number(amount.minor) > 0 && Number(amount.minor) <= 1e9, "unsupported_money", 422);
  }
  requireThat(!value.campaignDailyCeiling || (value.daily && value.daily.minor <= value.campaignDailyCeiling.minor), "campaign_daily_ceiling_exceeded", 422);
  requireThat(!value.campaignLifetimeCeiling || value.lifetime.minor <= value.campaignLifetimeCeiling.minor, "campaign_lifetime_ceiling_exceeded", 422);
}
