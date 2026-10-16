import {string,material} from "./schemas.js";
import type { Command, Commands, MarketingClient } from "../core/index.js";
import {marketingStudioToolSchemas} from './studio.js';
export {marketingStudioToolSchemas, type MarketingStudioAgentCommand} from './studio.js';

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
export const marketingToolSchemas = [...Object.entries(tools).map(
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
), ...marketingStudioToolSchemas.map(({command,description,inputSchema})=>({name:`marketing_${command}`,description,inputSchema}))];
const agentCommands=new Map<string,Command>([
  ...Object.keys(tools).map(command=>[`marketing_${command}`,command] as [string,Command]),
  ...marketingStudioToolSchemas.map(({command})=>[`marketing_${command}`,command] as [string,Command]),
]);
/** Bind a server-issued AGENT session or a qualified host invocation, never a human cookie. */
export function agentTools(client: MarketingClient) {
  return async (name: string, input: unknown) => {
    const command = agentCommands.get(name);
    if (!command)
      throw new Error("agent_tool_not_allowed");
    return client.call(command, input as Commands[Command]["input"]);
  };
}
