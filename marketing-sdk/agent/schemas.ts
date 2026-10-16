import { CAPABILITY_VERSION, META_PLACEMENTS } from "../core/index.js";

export const string = { type: "string", minLength: 1, maxLength: 200 };
const schemaObject = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const strings = { type: "array", items: string, maxItems: 30 };
const money = schemaObject({ currency: { enum: ["USD", "EUR", "GBP", "CAD", "AUD"] }, minor: { type: "integer", minimum: 1, maximum: 1e9 } });
const option = schemaObject({ id: string, label: string });
const options = { type: "array", items: option, maxItems: 30 };
const facets = schemaObject(Object.fromEntries(["titles", "jobFunctions", "seniorities", "employers", "industries", "staffCountRanges"].map(k => [k, options])), []);
const settingsBase = { version: { const: CAPABILITY_VERSION }, accountId: string, nondiscriminationAccepted: { const: true } };
const providerSettings = { oneOf: [
  Object.assign(schemaObject({ ...settingsBase, provider: { const: "meta" }, apiVersion: { const: "v26.0" }, format: { const: "single_image" },
    objective: { enum: ["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_LEADS"] }, optimization: { enum: ["LINK_CLICKS", "IMPRESSIONS", "REACH", "OFFSITE_CONVERSIONS"] },
    delivery: { enum: ["ordinary", "strict", "employment"] }, placementMode: { const: "provider_defaults" }, placements: { type: "array", minItems: 0, maxItems: META_PLACEMENTS.length, uniqueItems: true, items: { enum: META_PLACEMENTS.map(p => p.id) } },
    identity: schemaObject({ pageId: string, instagramUserId: string }, ["pageId"]), targeting: schemaObject({ languages: options,
      interestGroups: { type: "array", maxItems: 5, items: options }, excludedCustomAudiences: options, userAgeUnknown: {type:"boolean"} }, ["languages","interestGroups","excludedCustomAudiences"]),
    pagePromotion: schemaObject({smartPseEnabled:{type:"boolean"}}),
    specialAdCategory: { const: "EMPLOYMENT" }, specialAdCategoryCountry: { const: "US" },
    conversion: schemaObject({ pixelId: string, customConversionId: string, event: { const: "ApplicantRequestMOU" } }),
  }, [...Object.keys(settingsBase), "provider", "apiVersion", "format", "objective", "optimization", "delivery", "placements", "identity", "targeting"]), {allOf:[{
    if:{required:["placementMode"]}, then:{properties:{placements:{maxItems:0}}},
    else:{properties:{placements:{minItems:1}}},
  },{if:{required:["pagePromotion"]},then:{properties:{objective:{const:"OUTCOME_AWARENESS"}}}}]}),
  schemaObject({ ...settingsBase, provider: { const: "linkedin" }, apiVersion: { const: "202609" }, format: { const: "STANDARD_UPDATE" },
    objective: { enum: ["WEBSITE_VISIT", "WEBSITE_CONVERSION", "BRAND_AWARENESS", "ENGAGEMENT"] }, optimization: { enum: ["NONE", "MAX_CLICK", "MAX_CONVERSION", "ENHANCED_CONVERSION", "MAX_REACH"] },
    bid: { oneOf: [schemaObject({ mode: { const: "manual" }, costType: { const: "CPC" }, amountMinor: { type: "integer", minimum: 1, maximum: 1e9 } }),
      schemaObject({ mode: { const: "auto" }, costType: { const: "CPM" } })] }, placements: { type: "array", minItems: 1, maxItems: 1, items: { const: "linkedin_feed" } },
    identity: schemaObject({ organizationId: string }), targeting: schemaObject({ include: facets, exclude: facets }),
    politicalIntent: { const: "NOT_POLITICAL" }, politicalConsent: { const: true },
    conversion: schemaObject({ id: string, type: { enum: ["LEAD", "PURCHASE", "OTHER"] }, event: { enum: ["Lead", "Purchase", "ApplicantRequestMOU"] } }),
  }, [...Object.keys(settingsBase), "provider", "apiVersion", "format", "objective", "optimization", "bid", "placements", "identity", "targeting", "politicalIntent", "politicalConsent"]),
] };
export const material = schemaObject(
  {
    name: string,
    settings: providerSettings,
    purpose: { enum: ["acquisition", "recruitment"] },
    applicantGoal: schemaObject({ event: { const: "ApplicantRequestMOU" }, meaning: { const: "completed_mou_request" } }),
    advertisingBudget: schemaObject({ lifetime: money, daily: money, campaignDailyCeiling: money, campaignLifetimeCeiling: money }, ["lifetime"]),
    headline: string,
    body: { type: "string", minLength: 1, maxLength: 3000 },
    destination: { type: "string", format: "uri", maxLength: 2000 },
    destinationDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    assetIds: strings,
    audience: schemaObject(
      {
        provider: { enum: ["meta", "google", "linkedin"] },
        locations: strings,
        ageMin: { type: "integer", minimum: 18, maximum: 65 },
        ageMax: { type: "integer", minimum: 18, maximum: 65 },
        keywords: strings,
        jobTitles: strings,
        expansion: { type: "boolean" },
      },
      ["provider", "locations", "expansion"],
    ),
    budget: schemaObject({
      currency: { enum: ["USD", "EUR", "GBP", "CAD", "AUD"] },
      minor: { type: "integer", minimum: 1, maximum: 1000000000 },
    }),
    startAt: string,
    endAt: string,
    timezone: string,
    searchHeadlines: strings,
    searchDescriptions: strings,
  },
  [
    "name",
    "headline",
    "body",
    "destination",
    "destinationDigest",
    "assetIds",
    "audience",
    "budget",
    "startAt",
    "endAt",
    "timezone",
  ],
);
