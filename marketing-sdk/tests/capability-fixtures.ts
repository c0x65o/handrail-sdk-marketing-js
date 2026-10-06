import { CAPABILITY_VERSION, capabilityKey, type Campaign, type Grant, type ProviderSettings } from "../core/index.js";
/** Synthetic explicit approvals for intercepted test transports, never live grants. */
export function fixtureSettings(provider: "meta" | "linkedin", accountId: string, identityId: string): ProviderSettings {
  const base = { version: CAPABILITY_VERSION, accountId, nondiscriminationAccepted: true };
  return provider === "meta" ? { ...base, provider, apiVersion: "v26.0", format: "single_image", objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS",
    delivery: "ordinary", placements: ["facebook_feed"], identity: { pageId: identityId }, targeting: { languages: [], interestGroups: [], excludedCustomAudiences: [] } }
    : { ...base, provider, apiVersion: "202609", format: "STANDARD_UPDATE", objective: "WEBSITE_VISIT", optimization: "NONE",
      bid: { mode: "manual", costType: "CPC", amountMinor: 10 }, placements: ["linkedin_feed"], identity: { organizationId: identityId },
      targeting: { include: {}, exclude: {} }, politicalIntent: "NOT_POLITICAL", politicalConsent: true };
}
export function fixtureEligibility(c: Campaign, g: Grant) {
  g.capabilityEvidence = [{ key: capabilityKey(c.material, g), verifiedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", receipt: "intercepted-transport-fixture-only" }];
}
