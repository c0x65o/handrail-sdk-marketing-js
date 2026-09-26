import type { Command, Commands, MarketingClient } from "../core/index.js";

const string = { type: "string", minLength: 1, maxLength: 200 };
const schemaObject = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const strings = { type: "array", items: string, maxItems: 30 };
const material = schemaObject(
  {
    name: string,
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
