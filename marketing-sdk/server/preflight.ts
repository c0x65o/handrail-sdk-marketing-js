import type { Campaign, CampaignCheck, Grant, Asset } from "../core/index.js";
import { Store, digest, byteDigest, requireThat } from "./store.js";
import type { SessionInspection } from "./session-authority.js";

export const NATIVE_PREREQUISITE_CONTRACT = "meta-v26.0-ordinary-traffic-prerequisites-3";
export interface PrerequisiteRecord {
  id: string; projectId: string; campaignId: string; generation: number;
  action: "prepare"; contract: string; actorId: string;
  view: CampaignCheck;
  binding: string | null;
  authority: string | null;
  credentialExpiresAt?: number;
  sessions: SessionInspection[];
  createdAt: string;
  scope?: Record<string, unknown>;
  checkedFacts?: Record<string, unknown>;
  receiptReferences?: string[];
}
/** Server-only digest; includes bytes read from SQL, never trusts asset metadata alone.
 * No decoding or external work: safe to reuse inside a short final commit guard. */
export async function prerequisiteBinding(store: Store, c: Campaign, g: Grant, plan: unknown) {
  const assets = [];
  for (const assetId of c.material.assetIds) {
    const a = await store.get<Asset>(c.projectId, "asset", assetId);
    requireThat(a.projectId === c.projectId && a.campaignId === c.id, "asset_ownership_mismatch");
    const b = await store.db.prepare("SELECT bytes FROM blobs WHERE project_id=? AND digest=?").get(c.projectId, a.digest);
    requireThat(b && byteDigest(b.bytes as Uint8Array) === a.digest, "asset_bytes_missing_or_changed");
    assets.push(a);
  }
  const destination = await store.get(c.projectId, "destination", c.material.destinationDigest);
  const tracking = (await store.list<any>(c.projectId, "trackingBinding")).find(b => b.owner.kind === "campaign" && b.owner.id === c.id) ?? null;
  const sealed = await store.get(c.projectId, "vault", g.secretRef);
  return digest({ contract: NATIVE_PREREQUISITE_CONTRACT, action: "prepare", projectId: c.projectId,
    campaignId: c.id, revision: c.revision, material: c.material, grant: g, plan, assets, destination, tracking, sealed });
}
export async function currentPrerequisite(store: Store, c: Campaign, g: Grant, plan: unknown, now = Date.now()) {
  const campaign = await store.get<Campaign>(c.projectId, "campaign", c.id);
  const grant = await store.get<Grant>(c.projectId, "grant", g.id);
  requireThat(c.grantId === g.id && campaign.grantId === g.id && campaign.revision === c.revision &&
    digest(campaign.material) === digest(c.material) && digest(grant) === digest(g), "campaign_prerequisites_stale", 422);
  const pointer = await store.get<{ id: string }>(c.projectId, "campaignCheckCurrent", c.id).catch(() => null);
  requireThat(pointer, "campaign_prerequisites_not_checked", 422);
  const r = await store.get<PrerequisiteRecord>(c.projectId, "campaignCheck", pointer.id);
  requireThat(r.projectId === c.projectId && r.campaignId === c.id && r.action === "prepare" &&
    r.contract === NATIVE_PREREQUISITE_CONTRACT && r.view.state === "ready" && r.view.id === r.id &&
    r.view.campaignId === c.id && r.view.campaignRevision === c.revision && r.view.grantRevision === g.revision &&
    Date.parse(r.view.expiresAt ?? "") > now && Date.parse(r.view.expiresAt ?? "") <= Date.parse(r.createdAt) + 120000 &&
    Date.parse(r.createdAt) <= Date.parse(r.view.checkedAt ?? "") && Date.parse(r.view.checkedAt ?? "") <= now &&
    r.binding === await prerequisiteBinding(store, c, g, plan), "campaign_prerequisites_stale", 422);
  return r;
}
