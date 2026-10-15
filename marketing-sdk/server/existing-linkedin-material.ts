import { CAPABILITY_VERSION, type Grant, type LinkedInSettings, type Material, type TargetingOption } from "../core/index.js";
import { exactLinkedInTargeting, linkedInTargeting } from "./capabilities.js";
import { requireThat, digest } from "./store.js";
import { material as validateMaterial } from "./validation.js";

/** Trusted native source, bound to retained history by the host. These are
 * original records and policy acknowledgements, never a new spending approval. */
export interface ExistingLinkedInMaterialSource {
  name: string; headline: string; body: string; destination: string; destinationDigest: string;
  assetId: string; purpose: Material["purpose"]; applicantGoal?: Material["applicantGoal"];
  campaignDailyCeiling: number;
  policy: { nondiscriminationAccepted: boolean; politicalConsent: boolean; receiptRefs: string[] };
  conversion?: LinkedInSettings["conversion"];
  /** Last retained provider observation, not a desired/new campaign proposal. */
  retainedProviderTerms: {
    campaignGroup: string; associatedEntity: string; objectiveType: string; format: string; type: string; costType: string;
    unitCost: {amount: string; currencyCode: string}; dailyBudget: {amount: string; currencyCode: string};
    runSchedule: {start: number; end: number | null}; targetingCriteria: unknown; locale: unknown;
    audienceExpansionEnabled: boolean; offsiteDeliveryEnabled: boolean; politicalIntent: string;
  };
}

/** Account/campaign-scoped child inventory. Pagination must finish before a
 * single-creative campaign can be adopted; a saved identity is not an inventory. */
export async function existingLinkedInChildren(client: any, accountId: string, campaignId: string, creativeId: string) {
  let pageToken: string | null = null;
  const tokens = new Set<string>(), rows: {id: string; campaign: string; intendedStatus: string}[] = [];
  do {
    const page: {elements?: any[]; metadata?: {nextPageToken?: unknown}} = await client.listCreatives(accountId,{campaignUrn:`urn:li:sponsoredCampaign:${campaignId}`,pageSize:100,pageToken});
    requireThat(Array.isArray(page?.elements),"existing_campaign_children_incomplete");
    for (const row of page.elements!) {
      const id=String(row.id).replace(/^urn:li:sponsoredCreative:/,"");
      requireThat(id===creativeId&&row.campaign===`urn:li:sponsoredCampaign:${campaignId}`&&
        ["PAUSED","DRAFT"].includes(row.intendedStatus)&&!rows.some(r=>r.id===id),"existing_campaign_children_mismatch");
      rows.push({id,campaign:row.campaign,intendedStatus:row.intendedStatus});
    }
    const next: unknown=page.metadata?.nextPageToken;
    requireThat(next==null||typeof next==="string"&&next.length>0&&!tokens.has(next),"existing_campaign_children_incomplete");
    pageToken=typeof next === "string" ? next : null;
    if(pageToken)tokens.add(pageToken);
  } while(pageToken);
  requireThat(rows.length===1,"existing_campaign_children_mismatch");
  return rows;
}

/** Map an actual provider campaign into the shared material contract. Unsupported
 * Boolean targeting, absent facts and fractional minor units fail explicitly.
 * This is capture, not verification: callers must inspect the complete hierarchy
 * and original media before execution ownership can transfer. */
export function existingLinkedInMaterial(source: ExistingLinkedInMaterialSource, grant: Grant, campaign: any) {
  requireThat(grant.provider === "linkedin" && grant.timezone === "UTC" && grant.organizationId,
    "existing_material_account_invalid");
  requireThat(source.policy.nondiscriminationAccepted === true && source.policy.politicalConsent === true &&
    source.policy.receiptRefs.length > 0 && source.policy.receiptRefs.every(v => typeof v === "string" && v.length > 0),
    "existing_material_policy_unverified");
  requireThat(campaign.account === `urn:li:sponsoredAccount:${grant.accountId}` &&
    campaign.associatedEntity === `urn:li:organization:${grant.organizationId}`, "existing_material_account_mismatch");
  requireThat(campaign.format === "STANDARD_UPDATE" && campaign.type === "SPONSORED_UPDATES" &&
    campaign.audienceExpansionEnabled === false && campaign.offsiteDeliveryEnabled === false &&
    campaign.connectedTelevisionOnly === false && campaign.politicalIntent === "NOT_POLITICAL",
    "existing_material_placement_or_policy_unsupported");
  const money = (value: any) => {
    requireThat(value?.currencyCode === grant.currency && typeof value.amount === "string" && /^\d+(?:\.\d{1,2})?$/.test(value.amount),
      "existing_material_money_invalid");
    const [whole, fraction = ""] = value.amount.split(".");
    const minor = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
    requireThat(Number.isSafeInteger(minor) && minor >= 0 && minor <= 1e9, "existing_material_money_invalid");
    return {currency: grant.currency, minor};
  };
  const daily = money(campaign.dailyBudget), lifetime = campaign.totalBudget == null ? null : money(campaign.totalBudget);
  const bid = money(campaign.unitCost);
  const retained=source.retainedProviderTerms;
  requireThat(retained&&digest(money(retained.dailyBudget))===digest(daily)&&digest(money(retained.unitCost))===digest(bid)&&
    retained.runSchedule?.start===campaign.runSchedule?.start&&(retained.runSchedule?.end??null)===(campaign.runSchedule?.end??null)&&
    ["campaignGroup","associatedEntity","objectiveType","format","type","costType","locale","audienceExpansionEnabled","offsiteDeliveryEnabled","politicalIntent"]
      .every(key=>Object.hasOwn(retained,key)&&digest({value:(retained as any)[key]})===digest({value:campaign[key]}))&&
    exactLinkedInTargeting(retained.targetingCriteria,campaign.targetingCriteria),"existing_material_retained_terms_changed");
  requireThat(daily.minor > 0 && (!lifetime || lifetime.minor > 0), "existing_material_money_invalid");
  const settings: LinkedInSettings = { version: CAPABILITY_VERSION, provider: "linkedin", apiVersion: "202609",
    accountId: grant.accountId, format: "STANDARD_UPDATE", objective: campaign.objectiveType, optimization: campaign.optimizationTargetType,
    bid: campaign.costType === "CPC" ? {mode: "manual", costType: "CPC", amountMinor: bid.minor} : {mode: "auto", costType: "CPM"},
    placements: ["linkedin_feed"], identity: {organizationId: grant.organizationId!}, targeting: {include: {}, exclude: {}},
    nondiscriminationAccepted: true, politicalIntent: "NOT_POLITICAL", politicalConsent: true,
    ...(source.conversion ? {conversion: structuredClone(source.conversion)} : {}) };
  requireThat(campaign.costType === "CPC" || campaign.costType === "CPM" && bid.minor === 0, "existing_material_bid_unsupported");
  const options: TargetingOption[] = [], locations: string[] = [];
  const facets = ["titles", "jobFunctions", "seniorities", "employers", "industries", "staffCountRanges", "interfaceLocales"] as const;
  const add = (key: string, values: unknown, exclude: boolean) => {
    const kind = key.replace(/^urn:li:adTargetingFacet:/, "");
    requireThat(key === `urn:li:adTargetingFacet:${kind}` && (kind === "locations" && !exclude || facets.includes(kind as any)) &&
      Array.isArray(values) && values.length > 0 && values.every(v => typeof v === "string"), "existing_material_targeting_unsupported");
    const ids = values as string[];
    requireThat(new Set(ids).size === ids.length, "existing_material_targeting_unsupported");
    if (kind === "locations") { requireThat(!locations.length, "existing_material_targeting_unsupported"); locations.push(...ids); }
    else {
      const target = exclude ? settings.targeting.exclude : settings.targeting.include;
      requireThat(!Object.hasOwn(target, kind), "existing_material_targeting_unsupported");
      // Identifiers are explicit display fallbacks, not invented taxonomy labels.
      Object.assign(target, {[kind]: ids.map(id => ({id, label: id}))});
    }
    for (const id of ids) if (!options.some(x => x.kind === kind && x.id === id)) options.push({kind: kind as TargetingOption["kind"], id, label: id});
  };
  requireThat(Array.isArray(campaign.targetingCriteria?.include?.and), "existing_material_targeting_unsupported");
  for (const clause of campaign.targetingCriteria.include.and) {
    requireThat(clause?.or && Object.keys(clause.or).length === 1, "existing_material_targeting_unsupported");
    for (const [key, values] of Object.entries(clause.or)) add(key, values, false);
  }
  if (campaign.targetingCriteria.exclude) {
    requireThat(campaign.targetingCriteria.exclude.or && typeof campaign.targetingCriteria.exclude.or === "object", "existing_material_targeting_unsupported");
    for (const [key, values] of Object.entries(campaign.targetingCriteria.exclude.or)) add(key, values, true);
  }
  const instant = (value: unknown) => {
    requireThat(typeof value === "number" && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()), "existing_material_schedule_unknown");
    return new Date(value as number).toISOString();
  };
  const result: Material = {name: source.name, headline: source.headline, body: source.body,
    destination: source.destination, destinationDigest: source.destinationDigest, assetIds: [source.assetId], purpose: source.purpose,
    ...(source.applicantGoal ? {applicantGoal: structuredClone(source.applicantGoal)} : {}), settings,
    audience: {provider: "linkedin", locations, expansion: false}, budget: lifetime,
    advertisingBudget: {daily, ...(lifetime ? {lifetime} : {}), campaignDailyCeiling: {currency: grant.currency, minor: source.campaignDailyCeiling}},
    startAt: instant(campaign.runSchedule?.start), endAt: campaign.runSchedule?.end == null ? null : instant(campaign.runSchedule.end), timezone: "UTC"};
  requireThat(exactLinkedInTargeting(campaign.targetingCriteria, linkedInTargeting({material: result} as any, settings)), "existing_material_targeting_unsupported");
  validateMaterial(result, "linkedin");
  return {material: result, targetingOptions: options};
}
