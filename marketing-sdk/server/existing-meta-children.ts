import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { requireThat } from "./store.js";

/** Inventory the campaign edges, not merely the saved children. The execution contract currently
 * supports one ad set and one ad; additional children require their own reconciled
 * material and ownership. No filtering by saved IDs or status may hide them. */
export async function readMetaCampaignChildren(
  client: MetaMarketingClient, accountId: string,
  ids: { campaign: string; adset: string; ad: string; creative: string },
  guard: () => void | Promise<void> = () => {},
) {
  const account = accountId.replace(/^act_/, "");
  requireThat([account, ...Object.values(ids)].every(v => typeof v === "string" && /^\d+$/.test(v)),
    "existing_campaign_identity_invalid", 422);
  const adsets = await client.readAllPages(`${ids.campaign}/adsets`, {
    fields: "id,account_id,campaign_id,status,effective_status", limit: 200,
  }, guard);
  const ads = await client.readAllPages(`${ids.campaign}/ads`, {
    fields: "id,account_id,campaign_id,adset_id,creative,status,effective_status", limit: 200,
  }, guard);
  requireThat(adsets.data.length === 1 && ads.data.length === 1, "existing_campaign_children_mismatch");
  const adset = adsets.data[0], ad = ads.data[0];
  requireThat(adset?.id === ids.adset && ad?.id === ids.ad &&
    adset.account_id === account && ad.account_id === account &&
    adset.campaign_id === ids.campaign && ad.campaign_id === ids.campaign &&
    ad.adset_id === ids.adset && ad.creative?.id === ids.creative,
    "existing_campaign_children_mismatch");
  // Only explicit identity/state facts enter the receipt; cosmetic provider
  // additions do not change the reconciled inventory digest.
  return {
    adsets: [{ id: adset.id, accountId: account, campaignId: ids.campaign,
      status: adset.status, effectiveStatus: adset.effective_status }],
    ads: [{ id: ad.id, accountId: account, campaignId: ids.campaign, adsetId: ids.adset,
      creativeId: ids.creative, status: ad.status, effectiveStatus: ad.effective_status }],
  };
}

/** Adoption still requires configured and effective paused states. Activation
 * uses the same complete identity reader while its known children transition. */
export async function existingMetaChildren(client: MetaMarketingClient, accountId: string,
  ids: { campaign: string; adset: string; ad: string; creative: string },
  guard: () => void | Promise<void> = () => {}) {
  const result = await readMetaCampaignChildren(client, accountId, ids, guard);
  const adset = result.adsets[0]!, ad = result.ads[0]!;
  requireThat(adset.status === "PAUSED" && ad.status === "PAUSED" &&
    ["PAUSED", "CAMPAIGN_PAUSED"].includes(adset.effectiveStatus) &&
    ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(ad.effectiveStatus),
    "existing_campaign_children_not_paused");
  return result;
}
