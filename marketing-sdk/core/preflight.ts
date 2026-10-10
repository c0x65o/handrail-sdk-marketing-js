/** Prerequisites for a separately authorized attempt to prepare paused objects.
 * This is never advertisement acceptance, approval, delivery or spend authority. */
export interface CampaignCheck {
  id: string;
  campaignId: string;
  campaignRevision: number;
  grantRevision: number;
  evidence: "fixture" | "provider";
  state: "checking" | "ready" | "blocked" | "incomplete" | "stale";
  checkedAt: string | null;
  expiresAt: string | null;
  reasons: string[];
  facts: string[];
}
export interface CampaignCheckCommands {
  checkCampaign: {
    input: { campaignId: string; expectedRevision: number; expectedGrantRevision: number; requestKey: string };
    output: CampaignCheck;
  };
  campaignCheck: {
    input: { campaignId: string; requestKey?: string };
    output: CampaignCheck | null;
  };
}
