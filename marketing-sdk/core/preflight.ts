/** Prerequisites for a separately authorized preparation or activation attempt.
 * This is never advertisement acceptance, approval, delivery or spend authority. */
export interface CampaignCheck {
  id: string;
  campaignId: string;
  action: "prepare" | "activate";
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
    input: { campaignId: string; action?: "prepare" | "activate"; expectedRevision: number; expectedGrantRevision: number; requestKey: string };
    output: CampaignCheck;
  };
  campaignCheck: {
    input: { campaignId: string; requestKey?: string };
    output: CampaignCheck | null;
  };
}
