import { canonical, capabilityBlockers, capabilityStatus, providerBudgetBlockers, type Campaign, type Grant, type LinkedInSettings, type MetaSettings } from "../core/index.js";
import { requireThat } from "./store.js";

export function validateAccountCapability(c: Campaign, g: Grant, requireEvidence = false) {
  const blockers = capabilityBlockers(c.material, g);
  requireThat(!blockers.length, blockers[0] || "unsupported_capability", 422);
  if (requireEvidence) {
    const budgetBlockers = providerBudgetBlockers(c.material);
    requireThat(!budgetBlockers.length, budgetBlockers[0] || "budget_semantics_unverified", 422);
  }
  if (c.material.settings && requireEvidence)
    requireThat(capabilityStatus(c.material, g).accountVerified, "account_capability_unverified", 422);
}
export function linkedInTargeting(c: Campaign, s: LinkedInSettings) {
  const facets = (f: LinkedInSettings["targeting"]["include"]) => Object.entries(f).filter(([, v]) => v.length)
    .map(([k, v]) => ({ or: { [`urn:li:adTargetingFacet:${k}`]: v.map(x => x.id) } }));
  const exclude = Object.fromEntries(Object.entries(s.targeting.exclude).filter(([, v]) => v.length)
    .map(([k, v]) => [`urn:li:adTargetingFacet:${k}`, v.map(x => x.id)]));
  return { include: { and: [{ or: { "urn:li:adTargetingFacet:locations": c.material.audience.locations } }, ...facets(s.targeting.include)] },
    ...(Object.keys(exclude).length ? { exclude: { or: exclude } } : {}) };
}
/** Only explicit zero bits prove off; do not coerce null/false/blank or discard unknown keys. */
export function metaExpansionOff(value: unknown): boolean {
  const entries = Array.isArray(value) ? value : value && typeof value === "object"
    ? Object.entries(value).map(([key, value]) => ({ key, value })) : [];
  return entries.length === 2 && new Set(entries.map(x => x?.key)).size === 2 && entries.every(x =>
    x && typeof x === "object" && Object.keys(x).length === 2 && Object.hasOwn(x, "value") &&
    ["detailed_targeting", "lookalike"].includes(x.key) && (x.value === 0 || x.value === "0"));
}
export function metaTargeting(c: Campaign, s: MetaSettings) {
  const { audience: a } = c.material, t = s.targeting;
  return {
    geo_locations: { countries: a.locations }, age_min: a.ageMin, age_max: a.ageMax,
    publisher_platforms: s.placements.map(p => p === "facebook_feed" ? "facebook" : "instagram"),
    ...(s.placements.includes("facebook_feed") ? { facebook_positions: ["feed"] } : {}),
    ...(s.placements.includes("instagram_feed") ? { instagram_positions: ["stream"] } : {}),
    ...(t.languages.length ? { locales: t.languages.map(x => Number(x.id)) } : {}),
    ...(t.interestGroups.length ? { flexible_spec: t.interestGroups.map(group => ({ interests: group.map(x => ({ id: x.id, name: x.label })) })) } : {}),
    ...(t.excludedCustomAudiences.length ? { excluded_custom_audiences: t.excludedCustomAudiences.map(x => ({ id: x.id, name: x.label })) } : {}),
    targeting_automation: { advantage_audience: 0 },
    ...(s.delivery === "strict" ? { targeting_optimization: "none" } : {}),
  };
}
export function exactTargeting(actual: unknown, expected: unknown): boolean {
  // Preserve Boolean grouping, array membership/duplicates and unknown fields. Ordering is
  // intentionally strict: an unqualified provider normalization is not guessed here.
  return canonical(actual) === canonical(expected);
}
