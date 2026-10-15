import type { Campaign, Grant } from "../core/index.js";
import type { MeasurementInput } from "../core/measurement.js";
import type { ExecutionAdoptionReceipt } from "./execution-adoption.js";
import { readHistoricalCampaignSnapshot } from "./adoption.js";
import { measurementAccountId } from "./measurement-collectors.js";
import { readLatestMeasurementEvidence } from "./measurement.js";
import { requireThat, type Store } from "./store.js";

/** Bind a fresh native observation to verified execution ownership. This is a
 * relationship recorded at collection time, not proof that today's material
 * version served during a historical reporting window. No authority is issued. */
export async function bindAdoptedMeasurementIdentity(store: Store, input: MeasurementInput): Promise<MeasurementInput> {
  const frozen = structuredClone(input), identity = frozen.identity, project = identity.projectId;
  return store.transaction(async () => {
    const row = await store.db.prepare("SELECT body FROM records WHERE project_id=? AND kind=? AND id=?")
      .get(project, "campaignExecutionOwner", identity.nativeCampaignId);
    if (!row) return frozen;
    const owner = JSON.parse(String(row.body)) as { receiptId: string; executor: string };
    requireThat(owner.executor === "sdk", "measurement_execution_owner_invalid");
    const receipt = await store.get<ExecutionAdoptionReceipt>(project, "executionAdoption", owner.receiptId);
    const campaign = await store.get<Campaign>(project, "campaign", receipt.sdkCampaignId);
    const grant = await store.get<Grant>(project, "grant", campaign.grantId);
    const history = await readHistoricalCampaignSnapshot(store, project, receipt.historyImportId);
    requireThat(receipt.id === owner.receiptId && receipt.projectId === project && receipt.nativeCampaignId === identity.nativeCampaignId &&
      receipt.executionOwner === "sdk" && campaign.projectId === project && campaign.id === receipt.sdkCampaignId &&
      campaign.adoptionOrigin?.receiptId === receipt.id && campaign.adoptionOrigin.nativeCampaignId === identity.nativeCampaignId &&
      campaign.adoptionOrigin.historyImportId === receipt.historyImportId && campaign.adoptionOrigin.sourceRevision === receipt.sourceRevision &&
      grant.projectId === project && grant.id === receipt.grantId && campaign.grantId === receipt.grantId,
    "measurement_adoption_binding_mismatch");
    requireThat(grant.provider === identity.provider &&
      measurementAccountId(identity.provider, grant.accountId) === measurementAccountId(identity.provider, identity.accountId) &&
      history.snapshot.nativeCampaignId === identity.nativeCampaignId && history.snapshot.provider === identity.provider &&
      history.snapshot.accountId === measurementAccountId(identity.provider, identity.accountId) && identity.campaignIds.length === 1 &&
      identity.campaignIds[0] === receipt.providerReceipt.ids.campaign && campaign.receipt?.ids.campaign === receipt.providerReceipt.ids.campaign &&
      (identity.sdkCampaignId === null || identity.sdkCampaignId === campaign.id) &&
      (identity.purpose === "unknown" || identity.purpose === campaign.material.purpose), "measurement_adoption_identity_mismatch");
    // Retrospective material attribution needs interval evidence. Neither a
    // current revision nor an imported historical observation establishes it.
    requireThat(identity.materialVersion === null, "measurement_adoption_material_interval_unverified");
    requireThat(Number.isFinite(Date.parse(receipt.adoptedAt)) && Number.isFinite(Date.parse(frozen.source.collectedAt)), "measurement_adoption_time_invalid");
    if (Date.parse(frozen.source.collectedAt) < Date.parse(receipt.adoptedAt)) return frozen;
    const preceding = identity.sdkCampaignId === null ? await readLatestMeasurementEvidence(store, frozen) : null;
    identity.sdkCampaignId = campaign.id;
    // The enriched identity starts its own revision chain; retain an explicit
    // link to the old identity's head without rewriting its facts or digest.
    frozen.source.receiptIds = [...new Set([...frozen.source.receiptIds, receipt.id, receipt.historyImportId, ...(preceding ? [preceding.id] : [])])];
    return frozen;
  });
}
