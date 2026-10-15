import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { requireThat } from "./store.js";

/** Inventory the campaign edges, not merely the saved children. Adoption currently
 * supports one ad set and one ad; additional children require their own reconciled
 * material and ownership. No filtering by saved IDs or status may hide them. */
export async function existingMetaChildren(
  client: MetaMarketingClient, accountId: string,
  ids: { campaign: string; adset: string; ad: string; creative: string },
) {
  const account = accountId.replace(/^act_/, "");
  requireThat([account, ...Object.values(ids)].every(v => typeof v === "string" && /^\d+$/.test(v)),
    "existing_campaign_identity_invalid", 422);
  const adsets = await client.readAllPages(`${ids.campaign}/adsets`, {
    fields: "id,account_id,campaign_id,status,effective_status", limit: 200,
  });
  const ads = await client.readAllPages(`${ids.campaign}/ads`, {
    fields: "id,account_id,campaign_id,adset_id,creative,status,effective_status", limit: 200,
  });
  requireThat(adsets.data.length === 1 && ads.data.length === 1, "existing_campaign_children_mismatch");
  const adset = adsets.data[0], ad = ads.data[0];
  requireThat(adset?.id === ids.adset && ad?.id === ids.ad &&
    adset.account_id === account && ad.account_id === account &&
    adset.campaign_id === ids.campaign && ad.campaign_id === ids.campaign &&
    ad.adset_id === ids.adset && ad.creative?.id === ids.creative,
    "existing_campaign_children_mismatch");
  requireThat(adset.status === "PAUSED" && ad.status === "PAUSED" &&
    ["PAUSED", "CAMPAIGN_PAUSED"].includes(adset.effective_status) &&
    ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(ad.effective_status),
    "existing_campaign_children_not_paused");
  // Only explicit identity/state facts enter the receipt; cosmetic provider
  // additions do not change the reconciled inventory digest.
  return {
    adsets: [{ id: adset.id, accountId: account, campaignId: ids.campaign,
      status: adset.status, effectiveStatus: adset.effective_status }],
    ads: [{ id: ad.id, accountId: account, campaignId: ids.campaign, adsetId: ids.adset,
      creativeId: ids.creative, status: ad.status, effectiveStatus: ad.effective_status }],
  };
}
