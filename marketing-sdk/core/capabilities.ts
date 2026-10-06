import { canonical, type Audience, type Material, type PublicGrant } from "./index.js";

export const CAPABILITY_VERSION = "2026-10-06.1" as const;
export interface ResolvedOption { id: string; label: string }
export type ProfessionalFacet = "titles" | "jobFunctions" | "seniorities" | "employers" | "industries" | "staffCountRanges";
export type ProfessionalFacets = Partial<Record<ProfessionalFacet, ResolvedOption[]>>;
export interface ApplicantGoal {
  event: "ApplicantRequestMOU";
  meaning: "completed_mou_request";
}
interface SettingsBase {
  version: typeof CAPABILITY_VERSION;
  accountId: string;
  nondiscriminationAccepted: boolean;
}
export interface MetaSettings extends SettingsBase {
  provider: "meta";
  apiVersion: "v26.0";
  format: "single_image";
  objective: "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS" | "OUTCOME_LEADS";
  optimization: "LINK_CLICKS" | "IMPRESSIONS" | "REACH" | "OFFSITE_CONVERSIONS";
  delivery: "ordinary" | "strict" | "employment";
  placements: ("facebook_feed" | "instagram_feed")[];
  identity: { pageId: string; instagramUserId?: string };
  targeting: {
    languages: ResolvedOption[];
    /** OR inside each group; AND between groups. */
    interestGroups: ResolvedOption[][];
    excludedCustomAudiences: ResolvedOption[];
  };
  specialAdCategory?: "EMPLOYMENT";
  specialAdCategoryCountry?: "US";
  conversion?: { pixelId: string; customConversionId: string; event: "ApplicantRequestMOU" };
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
] as const;
export const META_COMBINATIONS = [
  ["ordinary", "OUTCOME_TRAFFIC", "LINK_CLICKS"],
  ["strict", "OUTCOME_TRAFFIC", "IMPRESSIONS"],
  ["strict", "OUTCOME_TRAFFIC", "REACH"],
  ["strict", "OUTCOME_AWARENESS", "REACH"],
  ["employment", "OUTCOME_LEADS", "OFFSITE_CONVERSIONS"],
] as const;
export const CAPABILITY_MATRIX = {
  version: CAPABILITY_VERSION,
  meta: { apiVersion: "v26.0", format: "single_image", combinations: META_COMBINATIONS,
    placements: ["facebook_feed", "instagram_feed"], strictCountries: ["US"], employmentCountries: ["US"],
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
  employers: /^urn:li:organization:\d+$/, industries: /^urn:li:industry:\d+$/,
  staffCountRanges: /^urn:li:staffCountRange:\((1,1|2,10|11,50|51,200|201,500|501,1000|1001,5000|5001,10000|10001,2147483647)\)$/,
};
/** Shared browser/headless/agent validation. Does not infer or repair user intent. */
export function capabilityBlockers(m: Pick<Material, "settings" | "purpose" | "applicantGoal" | "audience"> & Partial<Pick<Material, "timezone" | "startAt" | "endAt">>, g?: PublicGrant): string[] {
  const s = m.settings;
  if (!s) return m.purpose === "recruitment" ? ["recruitment_provider_unsupported"] : [];
  if (!record(s) || !record(m.audience)) return ["invalid_provider_settings"];
  const errors: string[] = [];
  const check = (ok: unknown, code: string) => { if (!ok) errors.push(code); };
  const base = ["version", "accountId", "provider", "apiVersion", "format", "objective", "optimization", "placements", "identity", "targeting", "nondiscriminationAccepted", "conversion"];
  check(s.version === CAPABILITY_VERSION && nonempty(s.accountId), "unsupported_capability_version_or_account");
  check(s.provider === m.audience.provider, "provider_settings_mismatch");
  check(m.purpose === "acquisition" || m.purpose === "recruitment", "explicit_purpose_required");
  check(s.nondiscriminationAccepted === true, "nondiscrimination_notice_required");
  if (g) check(s.provider === g.provider && s.accountId === g.accountId, "account_context_mismatch");
  if (m.purpose === "recruitment") check(only(m.applicantGoal, ["event", "meaning"]) && m.applicantGoal?.event === "ApplicantRequestMOU" && m.applicantGoal.meaning === "completed_mou_request", "applicant_goal_required");
  else check(m.applicantGoal === undefined, "purpose_outcome_mismatch");
  if (!record(s.identity) || !record(s.targeting) || !Array.isArray(s.placements)) return [...errors, "invalid_provider_settings"];
  if (s.provider === "meta") {
    check(only(s, [...base, "delivery", "specialAdCategory", "specialAdCategoryCountry"]), "unexpected_settings_fields");
    check(s.apiVersion === "v26.0" && s.format === "single_image", "unsupported_format_or_api");
    check(META_COMBINATIONS.some(row => row[0] === s.delivery && row[1] === s.objective && row[2] === s.optimization), "unsupported_objective_optimization");
    check(Array.isArray(s.placements) && s.placements.length > 0 && s.placements.length <= 2 && new Set(s.placements).size === s.placements.length && s.placements.every(p => ["facebook_feed", "instagram_feed"].includes(p)), "unsupported_placement");
    check(only(s.identity, ["pageId", "instagramUserId"]) && numeric(s.identity?.pageId) && (!g || s.identity.pageId === g.pageId), "meta_page_required");
    check(s.placements?.includes("instagram_feed") ? numeric(s.identity?.instagramUserId) : s.identity?.instagramUserId === undefined, "instagram_identity_mismatch");
    if (g && s.identity?.instagramUserId) check(s.identity.instagramUserId === g.instagramUserId, "instagram_identity_mismatch");
    const t = s.targeting;
    check(only(t, ["languages", "interestGroups", "excludedCustomAudiences"]) && options(t?.languages, /^\d+$/) && options(t?.excludedCustomAudiences, /^\d+$/) && Array.isArray(t?.interestGroups) && t.interestGroups.length <= 5 && t.interestGroups.every(a => options(a, /^\d+$/) && a.length > 0), "invalid_resolved_targeting");
    if (errors.includes("invalid_resolved_targeting")) return errors;
    if (s.delivery === "strict") {
      check(t?.interestGroups?.length > 0, "strict_interests_required");
      check(m.audience.locations?.length === 1 && m.audience.locations[0] === "US", "meta_country_contract_unverified");
    }
    if (s.delivery === "ordinary") check(t?.interestGroups?.length === 0 && t?.excludedCustomAudiences?.length === 0, "ordinary_traffic_not_strict");
    if (s.delivery === "employment") {
      check(m.purpose === "recruitment" && s.specialAdCategory === "EMPLOYMENT" && s.specialAdCategoryCountry === "US", "employment_category_country_required");
      check(m.audience.locations?.length === 1 && m.audience.locations[0] === "US" && m.audience.ageMin === 18 && m.audience.ageMax === 65 && t?.languages?.length === 0 && t?.interestGroups?.length === 0 && t?.excludedCustomAudiences?.length === 0, "employment_narrowing_unsupported");
      check(only(s.conversion, ["pixelId", "customConversionId", "event"]) && numeric(s.conversion?.pixelId) && numeric(s.conversion?.customConversionId) && s.conversion?.event === "ApplicantRequestMOU", "applicant_conversion_required");
    } else check(m.purpose === "acquisition" && s.specialAdCategory === undefined && s.specialAdCategoryCountry === undefined && s.conversion === undefined, "purpose_conversion_mismatch");
  } else if (s.provider === "linkedin") {
    check(m.timezone === "UTC" && (!g || g.timezone === "UTC"), "linkedin_utc_required");
    check([m.startAt, m.endAt].every(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(v)), "linkedin_schedule_requires_utc_midnights");
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
/** Budget field existence does not qualify Meta daily exposure or cap compatibility. */
export function providerBudgetBlockers(m: Pick<Material, "settings" | "advertisingBudget">): string[] {
  return m.settings?.provider === "meta" && m.advertisingBudget?.daily ? ["meta_daily_budget_semantics_unverified"] : [];
}
export function capabilityStatus(m: Material, g: PublicGrant, now = Date.now()) {
  const blockers = [...capabilityBlockers(m, g), ...providerBudgetBlockers(m)];
  const grantCurrent = !g.revokedAt && Date.parse(g.expiresAt) > now;
  const evidence = g.capabilityEvidence?.find(e => e.key === capabilityKey(m, g) && nonempty(e.receipt) &&
    Number.isFinite(Date.parse(e.verifiedAt)) && Date.parse(e.verifiedAt) <= now && Date.parse(e.expiresAt) > now);
  return { version: CAPABILITY_VERSION, key: capabilityKey(m, g), sdkSupported: !!m.settings && !blockers.length,
    accountVerified: grantCurrent && !!m.settings && !blockers.length && !!evidence, deliveryObserved: false as const, blockers };
}

/** Conservative reservation basis for the newly offered LinkedIn plans. This is
 * exposure accounting, not a claim that provider pacing is an intraday hard cap. */
export function dailyExposureMinor(m: Pick<Material, "settings" | "budget" | "advertisingBudget">): number | null {
  const daily = m.advertisingBudget?.daily?.minor;
  return m.settings?.provider === "meta" && daily !== undefined ? null : daily === undefined ? null : m.settings?.provider === "linkedin"
    ? Math.min(m.budget.minor, Math.ceil(daily * 1.5)) : daily;
}
