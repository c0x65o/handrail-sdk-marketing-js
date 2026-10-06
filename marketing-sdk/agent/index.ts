import { CAPABILITY_VERSION } from "../core/index.js";
import type { Command, Commands, MarketingClient } from "../core/index.js";

const string = { type: "string", minLength: 1, maxLength: 200 };
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
  schemaObject({ ...settingsBase, provider: { const: "meta" }, apiVersion: { const: "v26.0" }, format: { const: "single_image" },
    objective: { enum: ["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_LEADS"] }, optimization: { enum: ["LINK_CLICKS", "IMPRESSIONS", "REACH", "OFFSITE_CONVERSIONS"] },
    delivery: { enum: ["ordinary", "strict", "employment"] }, placements: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ["facebook_feed", "instagram_feed"] } },
    identity: schemaObject({ pageId: string, instagramUserId: string }, ["pageId"]), targeting: schemaObject({ languages: options,
      interestGroups: { type: "array", maxItems: 5, items: options }, excludedCustomAudiences: options }),
    specialAdCategory: { const: "EMPLOYMENT" }, specialAdCategoryCountry: { const: "US" },
    conversion: schemaObject({ pixelId: string, customConversionId: string, event: { const: "ApplicantRequestMOU" } }),
  }, [...Object.keys(settingsBase), "provider", "apiVersion", "format", "objective", "optimization", "delivery", "placements", "identity", "targeting"]),
  schemaObject({ ...settingsBase, provider: { const: "linkedin" }, apiVersion: { const: "202609" }, format: { const: "STANDARD_UPDATE" },
    objective: { enum: ["WEBSITE_VISIT", "WEBSITE_CONVERSION", "BRAND_AWARENESS", "ENGAGEMENT"] }, optimization: { enum: ["NONE", "MAX_CLICK", "MAX_CONVERSION", "ENHANCED_CONVERSION", "MAX_REACH"] },
    bid: { oneOf: [schemaObject({ mode: { const: "manual" }, costType: { const: "CPC" }, amountMinor: { type: "integer", minimum: 1, maximum: 1e9 } }),
      schemaObject({ mode: { const: "auto" }, costType: { const: "CPM" } })] }, placements: { type: "array", minItems: 1, maxItems: 1, items: { const: "linkedin_feed" } },
    identity: schemaObject({ organizationId: string }), targeting: schemaObject({ include: facets, exclude: facets }),
    politicalIntent: { const: "NOT_POLITICAL" }, politicalConsent: { const: true },
    conversion: schemaObject({ id: string, type: { enum: ["LEAD", "PURCHASE", "OTHER"] }, event: { enum: ["Lead", "Purchase", "ApplicantRequestMOU"] } }),
  }, [...Object.keys(settingsBase), "provider", "apiVersion", "format", "objective", "optimization", "bid", "placements", "identity", "targeting", "politicalIntent", "politicalConsent"]),
] };
const material = schemaObject(
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
        expansion: { const: false },
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
const tools = {
  workspace: {},
  setup: { grantId: string, requestKey: string },
  resumeSetup: {
    setupId: string,
    expectedRevision: { type: "integer", minimum: 1 },
  },
  prepare: { campaignId: string, requestKey: string },
  packet: { campaignId: string },
  execute: { packetId: string, digest: string, requestKey: string },
  reconcile: { operationId: string },
  reconcileGeneration: { jobId: string },
  results: { campaignId: string, from: string, until: string },
  captureDestination: {
    url: { type: "string", format: "uri", maxLength: 2000 },
  },
  saveCampaign: {
    requestKey: string,
    grantId: string,
    material,
    id: string,
    expectedRevision: { type: "integer", minimum: 1 },
  },
  generate: {
    campaignId: string,
    grantId: string,
    prompt: { type: "string", minLength: 1, maxLength: 6000 },
    rightsReceipt: string,
    parentAssetIds: { type: "array", items: string, maxItems: 5 },
    requestKey: string,
  },
  storyboard: {
    campaignId: string,
    text: { type: "string", minLength: 1, maxLength: 6000 },
  },
  pause: { campaignId: string, requestKey: string },
  syncMetrics: { campaignId: string, from: string, until: string },
  conversations: { campaignId: string },
} as const;
export const marketingToolSchemas = Object.entries(tools).map(
  ([name, properties]) => ({
    name: `marketing_${name}`,
    description: `Project-scoped Marketing ${name}; host authentication and current grants apply. Human decisions are not agent tools.`,
    inputSchema: {
      type: "object",
      properties,
      required:
        name === "saveCampaign"
          ? ["grantId", "material"]
          : Object.keys(properties),
      additionalProperties: false,
    },
  }),
);
/** Bind a server-issued AGENT session, never the human's cookie/bearer token. */
export function agentTools(client: MarketingClient) {
  return async (name: string, input: unknown) => {
    const command = name.replace(/^marketing_/, "");
    if (!Object.hasOwn(tools, command))
      throw new Error("agent_tool_not_allowed");
    return client.call(command as Command, input as Commands[Command]["input"]);
  };
}
