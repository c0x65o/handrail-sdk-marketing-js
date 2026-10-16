import { canonical, type Audience, type Material, type PublicGrant } from "./index.js";

export const CAPABILITY_VERSION = "2026-10-06.1" as const;
export interface ResolvedOption { id: string; label: string }
export type ProfessionalFacet = "titles" | "jobFunctions" | "seniorities" | "employers" | "industries" | "staffCountRanges" | "interfaceLocales";
export type ProfessionalFacets = Partial<Record<ProfessionalFacet, ResolvedOption[]>>;
export interface ApplicantGoal {
  event: "ApplicantRequestMOU";
  meaning: "completed_mou_request";
}
interface SettingsBase {
  version: typeof CAPABILITY_VERSION;
  accountId: string;
  /** null preserves an unknown historical acknowledgement; actions still require true. */
  nondiscriminationAccepted: boolean | null;
}
/** Explicit single-image placements. This catalogue describes request/readback
 * representation; every exact account/material still needs eligibility evidence. */
export const META_PLACEMENTS = [
  { id: "facebook_feed", label: "Facebook Feed", platform: "facebook", position: "feed" },
  { id: "instagram_feed", label: "Instagram Feed", platform: "instagram", position: "stream" },
  { id: "facebook_reels", label: "Facebook Reels", platform: "facebook", position: "facebook_reels" },
  { id: "instagram_reels", label: "Instagram Reels", platform: "instagram", position: "reels" },
] as const;
export type MetaPlacement = typeof META_PLACEMENTS[number]["id"];
export function usesInstagram(placements: readonly string[]): boolean {
  return placements.some(id => META_PLACEMENTS.some(p => p.id === id && p.platform === "instagram"));
}
export interface MetaSettings extends SettingsBase {
  provider: "meta";
  apiVersion: "v26.0";
  format: "single_image";
  objective: "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS" | "OUTCOME_LEADS";
  optimization: "LINK_CLICKS" | "IMPRESSIONS" | "REACH" | "OFFSITE_CONVERSIONS";
  delivery: "ordinary" | "strict" | "employment" | "advantage_plus_interests" | "advantage_plus_broad";
  /** Explicit opt-in to Meta's evolving defaults; never an empty manual list. */
  placementMode?: "provider_defaults";
  placements: MetaPlacement[];
  identity: { pageId: string; instagramUserId?: string };
  targeting: {
    languages: ResolvedOption[];
    /** OR inside each group; AND between groups. */
    interestGroups: ResolvedOption[][];
    excludedCustomAudiences: ResolvedOption[];
    locationTypes?: ("home" | "recent" | "travel_in" | "frequently_in")[];
    /** WhatsApp Status age inclusion. Absence is retained, never coerced to false. */
    userAgeUnknown?: boolean;
    expansion?: { detailedTargeting: 0 | 1; lookalike: 0 | 1 };
  };
  specialAdCategory?: "EMPLOYMENT";
  specialAdCategoryCountry?: "US";
  conversion?: ({ pixelId: string; customConversionId: string; event: "ApplicantRequestMOU" }
    | { pixelId: string; event: "Lead" }) & { smartPseEnabled?: boolean };
  /** Awareness page promotion; absence preserves an unspecified provider flag. */
  pagePromotion?: { smartPseEnabled: boolean };
  attribution?: { eventType: "CLICK_THROUGH" | "VIEW_THROUGH"; windowDays: 1 | 7 | 28 }[];
  creative?: {
    description?: string;
    urlTags?: string;
    /** Exact provider feature names and explicit enrollment, never inferred defaults. */
    features?: Record<string, "OPT_IN" | "OPT_OUT">;
  };
}
export interface LinkedInSettings extends SettingsBase {
  provider: "linkedin";
  apiVersion: "202609";
  format: "STANDARD_UPDATE";
  objective: "WEBSITE_VISIT" | "WEBSITE_CONVERSION" | "BRAND_AWARENESS" | "ENGAGEMENT";
  optimization: "NONE" | "MAX_CLICK" | "ENHANCED_CONVERSION" | "MAX_CONVERSION" | "MAX_REACH";
  bid: { mode: "manual"; costType: "CPC"; amountMinor: number } | { mode: "auto"; costType: "CPM" };
  placements: ["linkedin_feed"];
  identity: { organizationId: string };
  targeting: { include: ProfessionalFacets; exclude: ProfessionalFacets };
  /** Required for all locations, so an unresolved EU country cannot bypass consent. */
  politicalIntent: "NOT_POLITICAL";
  politicalConsent: boolean;
  conversion?: { id: string; type: "LEAD" | "PURCHASE" | "OTHER"; event: "Lead" | "Purchase" | "ApplicantRequestMOU" };
}
export type ProviderSettings = MetaSettings | LinkedInSettings;
export type MetaMaterial = Material & { settings: MetaSettings; audience: Audience & { provider: "meta"; keywords?: never; jobTitles?: never } };
export type LinkedInMaterial = Material & { settings: LinkedInSettings; audience: Audience & { provider: "linkedin"; ageMin?: never; ageMax?: never; keywords?: never; jobTitles?: never } };
export type ProviderMaterial = MetaMaterial | LinkedInMaterial;
/** Trusted host evidence, never supplied through a browser/agent command. */
export interface AccountCapabilityEvidence {
  key: string;
  verifiedAt: string;
  expiresAt: string;
  receipt: string;
}
export interface TargetingOption extends ResolvedOption {
  kind: "locations" | "languages" | "interests" | "customAudiences" | ProfessionalFacet;
}
export const LINKEDIN_COMBINATIONS = [
  ["WEBSITE_VISIT", "NONE", "manual", "CPC"],
  ["WEBSITE_VISIT", "MAX_CLICK", "auto", "CPM"],
  ["WEBSITE_CONVERSION", "ENHANCED_CONVERSION", "manual", "CPC"],
  ["WEBSITE_CONVERSION", "MAX_CONVERSION", "auto", "CPM"],
  ["BRAND_AWARENESS", "MAX_REACH", "auto", "CPM"],
  ["ENGAGEMENT", "MAX_CLICK", "auto", "CPM"],
  ["WEBSITE_CONVERSION", "NONE", "manual", "CPC"],
] as const;
export const META_COMBINATIONS = [
  ["ordinary", "OUTCOME_TRAFFIC", "LINK_CLICKS"],
  ["strict", "OUTCOME_TRAFFIC", "IMPRESSIONS"],
  ["strict", "OUTCOME_TRAFFIC", "REACH"],
  ["strict", "OUTCOME_AWARENESS", "REACH"],
  ["employment", "OUTCOME_LEADS", "OFFSITE_CONVERSIONS"],
  ["advantage_plus_interests", "OUTCOME_LEADS", "OFFSITE_CONVERSIONS"],
  ["advantage_plus_broad", "OUTCOME_LEADS", "OFFSITE_CONVERSIONS"],
] as const;
export const CAPABILITY_MATRIX = {
  version: CAPABILITY_VERSION,
  meta: { apiVersion: "v26.0", format: "single_image", combinations: META_COMBINATIONS,
    placements: META_PLACEMENTS.map(p => p.id), placementModes: ["manual", "provider_defaults"], strictCountries: ["US"], employmentCountries: ["US"],
    gate: "Exact account eligibility receipt and complete provider readback; application contract is not a Meta delivery guarantee" },
  linkedin: { apiVersion: "202609", format: "STANDARD_UPDATE", combinations: LINKEDIN_COMBINATIONS,
    placements: ["linkedin_feed"], gate: "Exact account eligibility receipt, resolved taxonomy, conversion binding and complete readback" },
  google: { apiVersion: "v25", contract: "unchanged legacy exact Search; new Google options are outside this tranche" },
  deferred: ["document", "ad_video", "gated_document", "lead_gen_form", "additional_placements", "non_US_Meta_strict_or_employment"],
} as const;

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: unknown, allowed: string[]) => record(v) && Object.keys(v).every(k => allowed.includes(k));
const nonempty = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const numeric = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);
const options = (v: unknown, pattern: RegExp) => Array.isArray(v) && v.length <= 30 &&
  new Set(v.map(x => x?.id)).size === v.length && v.every(x => only(x, ["id", "label"]) && typeof x.id === "string" && pattern.test(x.id) && nonempty(x.label));
const facetPatterns: Record<ProfessionalFacet, RegExp> = {
  titles: /^urn:li:title:\d+$/, jobFunctions: /^urn:li:function:\d+$/, seniorities: /^urn:li:seniority:\d+$/,
  interfaceLocales: /^urn:li:locale:[a-z]{2}_[A-Z]{2}$/,
  employers: /^urn:li:organization:\d+$/, industries: /^urn:li:industry:\d+$/,
  staffCountRanges: /^urn:li:staffCountRange:\((1,1|2,10|11,50|51,200|201,500|501,1000|1001,5000|5001,10000|10001,2147483647)\)$/,
};
/** Shared browser/headless/agent validation. Does not infer or repair user intent. */
export function capabilityStructureBlockers(m: Pick<Material, "settings" | "purpose" | "applicantGoal" | "audience"> & Partial<Pick<Material, "timezone" | "startAt" | "endAt" | "budget" | "advertisingBudget">>, g?: PublicGrant): string[] {
  const s = m.settings;
  if (!s) return m.purpose === "recruitment" ? ["recruitment_provider_unsupported"] : [];
  if (!record(s) || !record(m.audience)) return ["invalid_provider_settings"];
  const errors: string[] = [];
  const check = (ok: unknown, code: string) => { if (!ok) errors.push(code); };
  const base = ["version", "accountId", "provider", "apiVersion", "format", "objective", "optimization", "placements", "identity", "targeting", "nondiscriminationAccepted", "conversion"];
  check(s.version === CAPABILITY_VERSION && nonempty(s.accountId), "unsupported_capability_version_or_account");
  check(s.provider === m.audience.provider, "provider_settings_mismatch");
  check(m.purpose === "acquisition" || m.purpose === "recruitment", "explicit_purpose_required");
  check(typeof s.nondiscriminationAccepted === "boolean" || s.provider === "meta" && s.nondiscriminationAccepted === null, "invalid_nondiscrimination_evidence");
  if (g) check(s.provider === g.provider && s.accountId === g.accountId, "account_context_mismatch");
  if (m.purpose === "recruitment") check(only(m.applicantGoal, ["event", "meaning"]) && m.applicantGoal?.event === "ApplicantRequestMOU" && m.applicantGoal.meaning === "completed_mou_request", "applicant_goal_required");
  else check(m.applicantGoal === undefined, "purpose_outcome_mismatch");
  if (!record(s.identity) || !record(s.targeting) || !Array.isArray(s.placements)) return [...errors, "invalid_provider_settings"];
  if (s.provider === "meta") {
    check(only(s, [...base, "delivery", "placementMode", "specialAdCategory", "specialAdCategoryCountry", "attribution", "creative", "pagePromotion"]), "unexpected_settings_fields");
    check(s.apiVersion === "v26.0" && s.format === "single_image", "unsupported_format_or_api");
    check(META_COMBINATIONS.some(row => row[0] === s.delivery && row[1] === s.objective && row[2] === s.optimization), "unsupported_objective_optimization");
    check(s.placementMode === undefined || s.placementMode === "provider_defaults", "unsupported_placement_mode");
    check(s.placementMode === "provider_defaults" ? s.placements.length === 0 :
      s.placements.length > 0 && s.placements.length <= META_PLACEMENTS.length && new Set(s.placements).size === s.placements.length && s.placements.every(id => META_PLACEMENTS.some(p => p.id === id)), "unsupported_placement");
    check(only(s.identity, ["pageId", "instagramUserId"]) && numeric(s.identity?.pageId) && (!g || s.identity.pageId === g.pageId), "meta_page_required");
    check(s.placementMode === "provider_defaults" ? s.identity.instagramUserId === undefined || numeric(s.identity.instagramUserId) :
      usesInstagram(s.placements) ? numeric(s.identity?.instagramUserId) : s.identity?.instagramUserId === undefined, "instagram_identity_mismatch");
    if (g && s.identity?.instagramUserId) check(s.identity.instagramUserId === g.instagramUserId, "instagram_identity_mismatch");
    const t = s.targeting;
    check(only(t, ["languages", "interestGroups", "excludedCustomAudiences", "locationTypes", "expansion", "userAgeUnknown"]) && options(t?.languages, /^\d+$/) && options(t?.excludedCustomAudiences, /^\d+$/) && Array.isArray(t?.interestGroups) && t.interestGroups.length <= 5 && t.interestGroups.every(a => options(a, /^\d+$/) && a.length > 0), "invalid_resolved_targeting");
    if (errors.includes("invalid_resolved_targeting")) return errors;
    check(t.locationTypes === undefined || Array.isArray(t.locationTypes) && t.locationTypes.length > 0 &&
      new Set(t.locationTypes).size === t.locationTypes.length && t.locationTypes.every(x => ["home", "recent", "travel_in", "frequently_in"].includes(x)), "invalid_location_types");
    check(t.userAgeUnknown === undefined || typeof t.userAgeUnknown === "boolean", "invalid_unknown_age_setting");
    check(m.audience.expansion === (["advantage_plus_interests", "advantage_plus_broad"].includes(s.delivery)), "targeting_expansion_mismatch");
    if (["advantage_plus_interests", "advantage_plus_broad"].includes(s.delivery)) {
      check(Array.isArray(s.attribution) && s.attribution.length > 0, "explicit_attribution_required");
      check((s.delivery === "advantage_plus_broad" ? t.interestGroups.length === 0 : t.interestGroups.length > 0) && only(t.expansion, ["detailedTargeting", "lookalike"]) &&
        [t.expansion?.detailedTargeting, t.expansion?.lookalike].every(x => x === 0 || x === 1), "explicit_expansion_required");
    } else check(t.expansion === undefined, "unexpected_expansion_settings");
    check(s.attribution === undefined || Array.isArray(s.attribution) && (s.attribution.length > 0 || s.conversion === undefined) &&
      new Set(s.attribution.map(x => x.eventType)).size === s.attribution.length && s.attribution.every(x =>
        only(x, ["eventType", "windowDays"]) && ["CLICK_THROUGH", "VIEW_THROUGH"].includes(x.eventType) && [1, 7, 28].includes(x.windowDays)), "invalid_attribution_spec");
    const creative = s.creative;
    check(creative === undefined || only(creative, ["description", "urlTags", "features"]) &&
      (creative.description === undefined || typeof creative.description === "string" && creative.description.length <= 3000) &&
      (creative.urlTags === undefined || typeof creative.urlTags === "string" && creative.urlTags.length <= 8000) &&
      (creative.features === undefined || record(creative.features) && Object.keys(creative.features).length <= 200 &&
        Object.entries(creative.features).every(([key, value]) => /^[a-z][a-z0-9_]{0,99}$/.test(key) && ["OPT_IN", "OPT_OUT"].includes(value))), "invalid_creative_settings");
    if (s.delivery === "strict") {
      check(t?.interestGroups?.length > 0, "strict_interests_required");
      check(m.audience.locations?.length === 1 && m.audience.locations[0] === "US", "meta_country_contract_unverified");
    }
    if (s.delivery === "ordinary") check(t?.interestGroups?.length === 0 && t?.excludedCustomAudiences?.length === 0, "ordinary_traffic_not_strict");
    check(s.pagePromotion === undefined || s.objective === "OUTCOME_AWARENESS" && only(s.pagePromotion, ["smartPseEnabled"]) && typeof s.pagePromotion.smartPseEnabled === "boolean", "invalid_meta_page_promotion");
    check(s.conversion?.smartPseEnabled === undefined || typeof s.conversion.smartPseEnabled === "boolean", "invalid_meta_smart_pse_setting");
    if (s.delivery === "employment") {
      check(m.purpose === "recruitment" && s.specialAdCategory === "EMPLOYMENT" && s.specialAdCategoryCountry === "US", "employment_category_country_required");
      check(m.audience.locations?.length === 1 && m.audience.locations[0] === "US" && m.audience.ageMin === 18 && m.audience.ageMax === 65 && t?.languages?.length === 0 && t?.interestGroups?.length === 0 && t?.excludedCustomAudiences?.length === 0, "employment_narrowing_unsupported");
      check(only(s.conversion, ["pixelId", "customConversionId", "event", "smartPseEnabled"]) && numeric(s.conversion?.pixelId) && numeric(s.conversion && "customConversionId" in s.conversion ? s.conversion.customConversionId : undefined) && s.conversion?.event === "ApplicantRequestMOU", "applicant_conversion_required");
    } else {
      check(m.purpose === "acquisition" && s.specialAdCategory === undefined && s.specialAdCategoryCountry === undefined, "purpose_conversion_mismatch");
      check(["advantage_plus_interests", "advantage_plus_broad"].includes(s.delivery) ? only(s.conversion, ["pixelId", "event", "smartPseEnabled"]) &&
        numeric(s.conversion?.pixelId) && s.conversion?.event === "Lead" : s.conversion === undefined, "purpose_conversion_mismatch");
    }
  } else if (s.provider === "linkedin") {
    check(m.timezone === "UTC" && (!g || g.timezone === "UTC"), "linkedin_utc_required");
    // Provider runSchedule uses exact UTC instants, including existing partial days.
    // Completed-day reporting has its own midnight boundary validation.
    check([m.startAt, ...(m.endAt === null ? [] : [m.endAt])].every(v => typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === (v.includes(".") ? v : v.replace("Z", ".000Z"))), "linkedin_schedule_requires_utc_instants");
    check(only(s, [...base, "bid", "politicalIntent", "politicalConsent"]), "unexpected_settings_fields");
    check(s.apiVersion === "202609" && s.format === "STANDARD_UPDATE", "unsupported_format_or_api");
    check(LINKEDIN_COMBINATIONS.some(row => row[0] === s.objective && row[1] === s.optimization && row[2] === s.bid?.mode && row[3] === s.bid?.costType), "unsupported_objective_optimization_bid");
    check(s.bid?.mode === "manual" ? only(s.bid, ["mode", "costType", "amountMinor"]) && Number.isSafeInteger(s.bid.amountMinor) && s.bid.amountMinor > 0 && s.bid.amountMinor <= 1e9 : only(s.bid, ["mode", "costType"]), "explicit_bid_required");
    check(Array.isArray(s.placements) && s.placements.length === 1 && s.placements[0] === "linkedin_feed", "unsupported_placement");
    check(only(s.identity, ["organizationId"]) && numeric(s.identity?.organizationId) && (!g || s.identity.organizationId === g.organizationId), "linkedin_organization_required");
    check(s.politicalIntent === "NOT_POLITICAL" && s.politicalConsent === true, "political_consent_required");
    const t = s.targeting;
    check(only(t, ["include", "exclude"]) && [t?.include, t?.exclude].every(f => only(f, Object.keys(facetPatterns)) && Object.entries(f).every(([k, v]) => options(v, facetPatterns[k as ProfessionalFacet]))), "invalid_professional_facets");
    const inc = t?.include || {}, exc = t?.exclude || {};
    check(!(inc.titles?.length && (inc.jobFunctions?.length || inc.seniorities?.length)), "titles_function_seniority_conflict");
    check(!(inc.employers?.length && (inc.industries?.length || inc.staffCountRanges?.length)), "employer_industry_size_conflict");
    check(!(inc.staffCountRanges?.length && exc.staffCountRanges?.length), "staff_count_include_exclude_conflict");
    check(!m.audience.jobTitles?.length, "use_resolved_professional_facets");
    if (s.objective === "WEBSITE_CONVERSION") {
      check(only(s.conversion, ["id", "type", "event"]) && /^urn:lla:llaPartnerConversion:\d+$/.test(s.conversion?.id || "") &&
        (m.purpose === "recruitment" ? s.conversion?.type === "OTHER" && s.conversion.event === "ApplicantRequestMOU" : (s.conversion?.type === "LEAD" && s.conversion.event === "Lead" || s.conversion?.type === "PURCHASE" && s.conversion.event === "Purchase")), "exact_conversion_binding_required");
    } else check(s.conversion === undefined && m.purpose === "acquisition", "purpose_conversion_mismatch");
  } else check(false, "unsupported_provider_settings");
  if (g && !errors.length) {
    for (const [kind, option] of selectedOptions(m.audience, s)) check(g.targetingOptions?.some(x => x.kind === kind && x.id === option.id && (kind === "locations" ? nonempty(x.label) : x.label === option.label)), "unresolved_targeting_option");
  }
  return [...new Set(errors)];
}
export function selectedOptions(a: Audience, s: ProviderSettings): [string, ResolvedOption][] {
  return s.provider === "meta" ? [
    ...s.targeting.languages.map(x => ["languages", x] as [string, ResolvedOption]),
    ...s.targeting.interestGroups.flat().map(x => ["interests", x] as [string, ResolvedOption]),
    ...s.targeting.excludedCustomAudiences.map(x => ["customAudiences", x] as [string, ResolvedOption]),
  ] : [
    ...a.locations.map(id => ["locations", { id, label: "" }] as [string, ResolvedOption]),
    ...[s.targeting.include, s.targeting.exclude].flatMap(f => Object.entries(f).flatMap(([k, v]) => v.map(x => [k, x] as [string, ResolvedOption]))),
  ];
}
/** Canonical key binds account revision, identity, targeting and outcome semantics. */
export function capabilityKey(m: Material, g: PublicGrant): string {
  return canonical({ version: CAPABILITY_VERSION, provider: g.provider, account: g.accountId, grantRevision: g.revision,
    grantId: g.id, projectId: g.projectId, currency: g.currency, timezone: g.timezone, material: m });
}
/** Exact material eligibility remains separate from budget exposure accounting. */
export function capabilityStatus(m: Material, g: PublicGrant, now = Date.now()) {
  const blockers = capabilityBlockers(m, g);
  const grantCurrent = !g.revokedAt && Date.parse(g.expiresAt ?? "") > now;
  const evidence = g.capabilityEvidence?.find(e => e.key === capabilityKey(m, g) && nonempty(e.receipt) &&
    Number.isFinite(Date.parse(e.verifiedAt)) && Date.parse(e.verifiedAt) <= now && Date.parse(e.expiresAt) > now);
  return { version: CAPABILITY_VERSION, key: capabilityKey(m, g), sdkSupported: !!m.settings && !blockers.length,
    accountVerified: grantCurrent && !!m.settings && !blockers.length && !!evidence, deliveryObserved: false as const, blockers };
}

/** Conservative reservation basis for provider daily budgets. This is
 * exposure accounting, not a claim that provider pacing is an intraday hard cap. */
export function dailyExposureMinor(m: Pick<Material, "settings" | "advertisingBudget"> & Partial<Pick<Material, "budget">>): number | null {
  const daily = m.advertisingBudget?.daily?.minor;
  if (daily === undefined) return null;
  // Meta's published daily flexibility is 75%; sharing is disabled in the plan
  // and must read back false before activation. Round exposure upward, never
  // rewrite the provider's nominal daily budget or assume weekly headroom.
  const multiplier = m.settings?.provider === "meta" ? 1.75 : m.settings?.provider === "linkedin" ? 1.5 : 1;
  return Math.min(m.budget?.minor ?? Infinity, Math.ceil(daily * multiplier));
}

/** Operational readiness includes acknowledgement; representing a paused imported
 * campaign with unknown history is not acceptance of that acknowledgement. */
export function capabilityBlockers(...args: Parameters<typeof capabilityStructureBlockers>): string[] {
  const errors=capabilityStructureBlockers(...args);
  if(args[0].settings&&args[0].settings.nondiscriminationAccepted!==true)errors.push("nondiscrimination_notice_required");
  const exposure=dailyExposureMinor(args[0]),ceiling=args[0].advertisingBudget?.campaignDailyCeiling;
  if(ceiling&&(exposure===null||exposure>ceiling.minor))errors.push("campaign_daily_exposure_exceeded");
  return errors;
}
