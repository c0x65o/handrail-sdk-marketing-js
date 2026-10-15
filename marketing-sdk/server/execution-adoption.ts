import type { Asset, Campaign, Grant, Material, Receipt } from "../core/index.js";
import type { HistoricalRecord } from "../core/adoption.js";
import { readHistoricalCampaignSnapshot } from "./adoption.js";
import { readHistoricalPurposeResolution } from "./historical-purpose.js";
import type {MetaMaterialReconciliation} from './meta-material-observations.js';
import {META_OBSERVATION_KEYS,reconcileMetaObservations} from './meta-material-observations.js';
import type { ProviderPort, ExistingMetaImageInspection } from "./ports.js";
import type { SessionAuthority } from "./session-authority.js";
import { sessionBinding, assertSessionInspection, inspectLiveSessions } from "./session-authority.js";
import { Store, DomainError, digest, byteDigest, requireThat, type Principal } from "./store.js";
import { material, text } from "./validation.js";
import { measurementAccountId } from "./measurement-collectors.js";
import { inspectMedia } from "./generation.js";

/** Trusted host evidence, never accepted as a browser/agent command payload. */
export interface ExecutionAdoptionCandidate {
  projectId: string;
  nativeCampaignId: string;
  historyImportId: string;
  sourceRevision: string;
  purposeResolutionId?:string;
  grantId: string;
  material: Material;
  materialReconciliation?:MetaMaterialReconciliation;
  providerIds: Record<string, string>;
  media: { assetId: string; uploadedDigest: string|null; providerImageId: string; historyRecordId: string;
    /** Original source retained when historical upload bytes/checksum are unknown.
     * The host binds these facts to history; the SDK separately reads the image. */
    retainedSource?: {digest:string; historyRecordId:string; providerFilename:string; missingReason:string};
    original?: {assetId:string; digest:string; historyRecordId:string} }[];
  retirement: { state: "all_legacy_writes_disabled"; receiptRefs: string[] };
  unsettledOperationIds: string[];
  settlements: { operationId: string; receiptRefs: string[] }[];
}
export interface ExecutionAdoptionReceipt {
  id: string; projectId: string; nativeCampaignId: string; sdkCampaignId: string;
  historyImportId: string; sourceRevision: string; candidateDigest: string;
  grantId: string; grantRevision: number; providerReceipt: Receipt;
  retirementReceiptRefs: string[]; settlementReceiptRefs: string[];
  mediaRecordIds: string[]; mediaAssetsDigest: string; adoptedAt: string; adoptedBy: string;
  purposeResolutionId?:string;
  materialReconciliation?:MetaMaterialReconciliation;
  mediaProvenance?: {assetId:string; sourceDigest:string; uploadedDigest:string|null;
    originalUploadBytesVerified:boolean; missingReason:string|null; providerImage:ExistingMetaImageInspection|null;
    providerFilenameComparison?:{retained:string;current:string;matches:boolean}}[];
  executionOwner: "sdk"; state: "paused"; spendingAuthorityGranted: false;
}
export interface ExecutionAdoptionMedia {
  asset: Asset;
  /** Original upload bytes, or retained original source bytes when the candidate
   * explicitly declares unknown upload provenance. Never a guessed upload. */
  bytes: Uint8Array;
  /** Original pre-transcoding asset, retained separately with its original ID/version. */
  original?: {asset:Asset; bytes:Uint8Array};
}
export interface ExecutionAdoptionSource {
  authorize(principal: Principal, projectId: string, nativeCampaignId: string): Promise<void>;
  capture(principal: Principal, projectId: string, nativeCampaignId: string): Promise<ExecutionAdoptionCandidate>;
  /** Read original metadata and upload bytes from the authorized native store.
   * No SDK campaign/asset prerequisite and no new provider upload. */
  readMedia(principal: Principal, candidate: ExecutionAdoptionCandidate): Promise<ExecutionAdoptionMedia[]>;
  /** Verify native identity, complete old-executor retirement, writer/effect
   * settlement, original asset metadata/rights, upload provenance and source revision against current records. */
  assertCurrent(principal: Principal, candidate: ExecutionAdoptionCandidate): Promise<void>;
  /** Hold source/identity guards through SDK commit. Retirement must be monotonic:
   * no old publisher, reactivation or pause writer may start after this proof.
   * This port performs no provider mutation and cannot create spending authority. */
  withRetiredExecution<T>(principal: Principal, candidate: ExecutionAdoptionCandidate, commit: () => Promise<T>): Promise<T>;
}
async function optional<T>(store: Store, project: string, kind: string, key: string): Promise<T | null> {
  try { return await store.get<T>(project, kind, key); }
  catch (error) { if (error instanceof DomainError && error.code === "not_found") return null; throw error; }
}
const refs = (value: string[]) => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(v => typeof v === "string" && v.length > 0);

/** Adopts already-existing, stopped provider objects. No prepare/create, event
 * replay, grant issuance, approval decision, scheduler or advertising reservation. */
export class CampaignExecutionAdoptions {
  constructor(readonly store: Store, readonly source: ExecutionAdoptionSource,
    readonly sessions: SessionAuthority, readonly providers: Pick<Record<Grant["provider"], ProviderPort>, "meta" | "linkedin">,
    readonly mode: "live" | "fixture" = "live") {}

  async readRequest(principal: Principal, project: string, requestKey: string) {
    text(requestKey, 200);
    await this.store.authorize(principal, project);
    const request = await optional<{ receiptId: string }>(this.store, project, "executionAdoptionRequest", digest([principal.userId, requestKey]));
    return request ? this.read(principal, project, request.receiptId) : null;
  }
  async read(principal: Principal, project: string, receiptId: string) {
    const binding = sessionBinding(principal), session = await this.sessions.inspectSession(binding, project);
    assertSessionInspection(session, binding, project);
    return this.sessions.withLiveSessions([session], () => this.store.transaction(async () => {
      await this.store.authorize(principal, project);
      const receipt = await this.store.get<ExecutionAdoptionReceipt>(project, "executionAdoption", receiptId);
      await this.source.authorize(principal, project, receipt.nativeCampaignId);
      return receipt;
    }));
  }
  async adopt(principal: Principal, project: string, nativeCampaignId: string, requestKey: string): Promise<ExecutionAdoptionReceipt> {
    text(nativeCampaignId); text(requestKey, 200);
    const binding = sessionBinding(principal), session = await this.sessions.inspectSession(binding, project);
    assertSessionInspection(session, binding, project);
    await this.store.authorize(principal, project, ["admin", "editor"]);
    await this.source.authorize(principal, project, nativeCampaignId);
    const prior = await this.readRequest(principal, project, requestKey);
    if (prior) {
      requireThat(prior.nativeCampaignId === nativeCampaignId, "adoption_request_conflict");
      return prior;
    }
    const candidate = structuredClone(await this.source.capture(principal, project, nativeCampaignId));
    requireThat(candidate.projectId === project && candidate.nativeCampaignId === nativeCampaignId, "adoption_scope_mismatch");
    text(candidate.sourceRevision); text(candidate.historyImportId); text(candidate.grantId);
    requireThat(candidate.retirement?.state === "all_legacy_writes_disabled" && refs(candidate.retirement.receiptRefs), "legacy_execution_not_retired");
    requireThat(Array.isArray(candidate.unsettledOperationIds) && candidate.unsettledOperationIds.length === 0, "adoption_effects_unsettled");
    const grant = await this.store.get<Grant>(project, "grant", candidate.grantId);
    requireThat(grant.id === candidate.grantId && grant.projectId === project && ["meta", "linkedin"].includes(grant.provider) && !grant.revokedAt &&
      Date.parse(grant.expiresAt) > Date.now() && grant.permissions.includes("report") && grant.permissions.includes("pause"), "adoption_current_grant_required");
    const providerName = grant.provider as "meta" | "linkedin", provider = this.providers[providerName];
    requireThat(provider.inspectExistingCampaign, "existing_campaign_inspection_unavailable");
    requireThat(this.mode === "fixture" || provider.evidence === "provider", "fixture_provider_not_live");
    material(candidate.material, providerName);
    const { receipt: history, snapshot } = await readHistoricalCampaignSnapshot(this.store, project, candidate.historyImportId);
    requireThat(history.projectId === project && history.nativeCampaignId === nativeCampaignId && snapshot.nativeCampaignId === nativeCampaignId &&
      snapshot.provider === providerName && snapshot.accountId !== null &&
      measurementAccountId(providerName, snapshot.accountId) === measurementAccountId(providerName, grant.accountId) &&
      snapshot.providerCampaignIds.length === 1 && snapshot.providerCampaignIds[0] === candidate.providerIds.campaign,
      "adoption_history_identity_mismatch");
    const assertPurpose=async()=>{
      if(snapshot.purpose!=='unknown')requireThat(!candidate.purposeResolutionId&&snapshot.purpose===candidate.material.purpose,'adoption_purpose_unverified');
      else {
        requireThat(candidate.purposeResolutionId,'adoption_purpose_unverified');
        const assessed=await readHistoricalPurposeResolution(this.store,project,history.id,candidate.purposeResolutionId);
        requireThat(assessed?.current&&assessed.resolution.purpose===candidate.material.purpose,'adoption_purpose_unverified');
      }
    };
    await assertPurpose();
    if(candidate.materialReconciliation){
      const r=candidate.materialReconciliation,{id,...body}=r;
      requireThat(providerName==='meta'&&id===`material_${digest(body)}`&&r.method==='current_provider_state_with_retained_observations'&&
        r.materialDigest===digest(candidate.material)&&r.observedTermsDigest===digest(r.observedTerms)&&r.originalMaterialFullyKnown===false&&
        r.materialApproved===false&&r.spendingAuthorityGranted===false&&Number.isFinite(Date.parse(r.observedAt))&&
        r.historyRecordIds.length>0&&r.historyRecordIds.every(id=>history.recordRefs.some(ref=>ref.digest===id&&['material','targeting','provider_object'].includes(ref.kind)))&&
        r.comparisons.length===META_OBSERVATION_KEYS.length&&new Set(r.comparisons.map(x=>x.key)).size===META_OBSERVATION_KEYS.length&&
        r.comparisons.every(x=>META_OBSERVATION_KEYS.includes(x.key)&&(!x.retained||r.historyRecordIds.includes(x.retained.historyRecordId))),
        'adoption_material_reconciliation_invalid');
      const recomputed=reconcileMetaObservations(r.comparisons.flatMap(x=>x.retained?[x.retained]:[]),r.observedTerms,r.observedTerms,candidate.material);
      const {id:ignored,...recomputedBody}=recomputed;
      requireThat(digest({...recomputedBody,observedAt:r.observedAt})===digest(body),'adoption_material_reconciliation_invalid');
    }
    const unsettled = new Set(history.unsettledOperationIds);
    requireThat(Array.isArray(candidate.settlements) && candidate.settlements.length === unsettled.size &&
      new Set(candidate.settlements.map(x => x.operationId)).size === unsettled.size &&
      candidate.settlements.every(x => unsettled.has(x.operationId) && refs(x.receiptRefs)), "adoption_settlement_evidence_required");
    const campaign: Campaign = { id: nativeCampaignId, projectId: project, revision: 1, grantId: grant.id,
      creativeSetId: `adopted:${nativeCampaignId}`, material: candidate.material, state: "paused", receipt: null };
    const originalMedia = await this.source.readMedia(principal, candidate);
    const assets = originalMedia.map(item => structuredClone(item.asset));
    requireThat(assets.length === 1 && candidate.media.length === 1, "adoption_media_binding_required");
    const media = candidate.media[0]!, asset = assets[0]!;
    requireThat(candidate.material.assetIds.length === 1 && candidate.material.assetIds[0] === asset.id &&
      asset.projectId === project && asset.campaignId === campaign.id && media.assetId === asset.id &&
      media.providerImageId === candidate.providerIds.image, "adoption_media_binding_mismatch");
    const unknownUpload = media.uploadedDigest === null;
    requireThat(unknownUpload ? providerName === "meta" && Boolean(media.retainedSource) && !media.original :
      !media.retainedSource && media.uploadedDigest === asset.digest, "adoption_media_binding_mismatch");
    const record = await this.store.get<HistoricalRecord>(project, "historicalRecord", media.historyRecordId);
    requireThat(history.recordRefs.some(r => r.digest === media.historyRecordId && ["material", "provider_object", "operation"].includes(r.kind)) &&
      digest({ project, nativeCampaignId, system: snapshot.source.system, record }) === media.historyRecordId,
      "adoption_media_history_missing");
    // Verify exactly the bytes we retain. A source checksum or lossy filename
    // checksum is never promoted to proof of original provider-upload bytes.
    const bytes = Buffer.from(originalMedia[0]!.bytes);
    requireThat(byteDigest(bytes) === asset.digest && (unknownUpload || asset.digest === media.uploadedDigest), "adoption_media_bytes_changed");
    if (unknownUpload) {
      const source=media.retainedSource!;
      text(source.missingReason);text(source.providerFilename);
      requireThat(source.digest===asset.digest && !originalMedia[0]!.original, "adoption_media_binding_mismatch");
      const sourceRecord=await this.store.get<HistoricalRecord>(project,"historicalRecord",source.historyRecordId);
      requireThat(history.recordRefs.some(r=>r.digest===source.historyRecordId&&r.kind==="material") &&
        digest({project,nativeCampaignId,system:snapshot.source.system,record:sourceRecord})===source.historyRecordId,"adoption_original_media_history_missing");
    }
    requireThat(asset.kind === "image" && (this.mode === "fixture" || asset.source !== "fixture"), "adoption_media_binding_mismatch");
    requireThat(Number.isSafeInteger(asset.version) && asset.version > 0 && ["fixture", "generated", "uploaded"].includes(asset.source), "adoption_media_metadata_invalid");
    text(asset.rightsReceipt);
    const decoded = await inspectMedia(bytes, asset.kind, asset.mime);
    requireThat(decoded.width === asset.width && decoded.height === asset.height, "adoption_media_dimensions_changed");
    const original = originalMedia[0]!.original;
    requireThat(Boolean(original) === Boolean(media.original), "adoption_original_media_binding_required");
    if (original && media.original) {
      const a=original.asset, binding=media.original;
      requireThat(a.id===binding.assetId && a.id!==asset.id && a.digest===binding.digest && byteDigest(original.bytes)===a.digest &&
        a.projectId===project && a.campaignId===campaign.id && a.kind==="image" &&
        Number.isSafeInteger(a.version)&&a.version>0&&["generated","uploaded"].includes(a.source) &&
        digest(asset.parentAssetIds)===digest([a.id]), "adoption_original_media_mismatch");
      text(a.rightsReceipt);
      const originalRecord=await this.store.get<HistoricalRecord>(project,"historicalRecord",binding.historyRecordId);
      requireThat(history.recordRefs.some(r=>r.digest===binding.historyRecordId&&r.kind==="material") &&
        digest({project,nativeCampaignId,system:snapshot.source.system,record:originalRecord})===binding.historyRecordId,"adoption_original_media_history_missing");
      const decoded=await inspectMedia(original.bytes,a.kind,a.mime);
      requireThat(decoded.width===a.width&&decoded.height===a.height,"adoption_original_media_dimensions_changed");
    } else requireThat(asset.parentAssetIds.length===0,"adoption_original_media_binding_required");
    const retainedMedia=[...(original?[original]:[]),{asset,bytes}].map(x=>({asset:structuredClone(x.asset),bytes:Buffer.from(x.bytes)}));
    const originalDigest=original?digest({asset:original.asset,bytesDigest:byteDigest(original.bytes)}):null;
    const candidateDigest = digest(candidate), grantDigest = digest(grant), assetsDigest = digest(retainedMedia.map(x=>x.asset));
    const guard = async () => {
      await inspectLiveSessions(this.sessions, [session]);
      await this.store.authorize(principal, project, ["admin", "editor"]);
      await this.source.assertCurrent(principal, candidate);
      await assertPurpose();
      const currentMedia = await this.source.readMedia(principal, candidate);
      requireThat(currentMedia.length === originalMedia.length && currentMedia.every((item, index) =>
        byteDigest(item.bytes) === assets[index]!.digest), "adoption_media_bytes_changed");
      requireThat(digest(candidate) === candidateDigest && digest(await this.store.get(project, "grant", grant.id)) === grantDigest &&
        digest(currentMedia.map(item => item.asset)) === digest(assets) &&
        (currentMedia[0]?.original ? digest({asset:currentMedia[0].original.asset,bytesDigest:byteDigest(currentMedia[0].original.bytes)}) : null) === originalDigest,
        "adoption_source_changed");
      requireThat(Date.parse(grant.expiresAt) > Date.now(), "adoption_current_grant_required");
    };
    await guard();
    const inspection = await provider.inspectExistingCampaign(campaign, grant, assets, candidate.providerIds, guard);
    await guard();
    requireThat(inspection.candidateReceipt.intent === "paused" && inspection.candidateReceipt.evidence === provider.evidence &&
      inspection.candidateReceipt.ids.readbackDigest && inspection.candidateReceipt.payloadDigest === digest(provider.plan(campaign, grant, assets)) &&
      Object.entries(candidate.providerIds).every(([key,value]) => inspection.candidateReceipt.ids[key] === value), "adoption_provider_receipt_mismatch");
    let providerImage:ExistingMetaImageInspection|null=null;
    let providerFilenameComparison:{retained:string;current:string;matches:boolean}|undefined;
    if (unknownUpload) {
      requireThat(provider.inspectExistingMetaImage,"adoption_provider_image_inspection_required");
      providerImage=await provider.inspectExistingMetaImage(grant,media.providerImageId,guard);
      await guard();
      const image=providerImage.image;
      const comparisons={readbackVerified:providerImage.providerImageReadbackVerified===true,
        originalBytesUnknown:providerImage.originalUploadBytesVerified===false,
        noTransferOrSpending:providerImage.executionTransferred===false&&providerImage.spendingAuthorityGranted===false,
        snapshotDigestMatches:providerImage.providerSnapshotDigest===digest(image),
        collectionTimeValid:Number.isFinite(Date.parse(providerImage.observedAt)),
        accountMatches:measurementAccountId("meta",image.accountId)===measurementAccountId("meta",grant.accountId),
        imageMatches:image.hash===media.providerImageId,filenameRecorded:typeof image.name==="string"&&image.name.length>0,filenameMatches:image.name===media.retainedSource!.providerFilename,
        dimensionsMatch:image.width===asset.width&&image.height===asset.height,active:image.status==="ACTIVE"};
      // Provider filename is retained metadata, not image identity or binary
      // provenance. Keep discrepancies; account/hash/source/readback still bind.
      const {filenameMatches,...identityAndEvidence}=comparisons;
      providerFilenameComparison={retained:media.retainedSource!.providerFilename,current:image.name,matches:filenameMatches};
      if(!Object.values(identityAndEvidence).every(Boolean))throw Object.assign(new DomainError("adoption_provider_image_mismatch"),
        {providerImageDiagnostic:{comparisons,expectedDimensions:{width:asset.width,height:asset.height},
          observedDimensions:{width:image.width,height:image.height},providerSnapshotDigest:providerImage.providerSnapshotDigest,
          observedAt:providerImage.observedAt}});
    }
    const receipt: ExecutionAdoptionReceipt = { id: `adoption_${digest([project, nativeCampaignId, candidateDigest])}`, projectId: project,
      nativeCampaignId, sdkCampaignId: campaign.id, historyImportId: history.id, sourceRevision: candidate.sourceRevision, candidateDigest,
      grantId: grant.id, grantRevision: grant.revision, providerReceipt: inspection.candidateReceipt,
      ...(candidate.purposeResolutionId?{purposeResolutionId:candidate.purposeResolutionId}:{}),
      ...(candidate.materialReconciliation?{materialReconciliation:structuredClone(candidate.materialReconciliation)}:{}),
      retirementReceiptRefs: candidate.retirement.receiptRefs, settlementReceiptRefs: candidate.settlements.flatMap(x => x.receiptRefs),
      mediaRecordIds: candidate.media.flatMap(x => [x.historyRecordId,...(x.original?[x.original.historyRecordId]:[]),...(x.retainedSource?[x.retainedSource.historyRecordId]:[])]),
      mediaProvenance:[{assetId:asset.id,sourceDigest:original?.asset.digest??asset.digest,uploadedDigest:media.uploadedDigest,
        originalUploadBytesVerified:!unknownUpload,missingReason:media.retainedSource?.missingReason??null,providerImage,
        ...(providerFilenameComparison?{providerFilenameComparison}:{})}],
      mediaAssetsDigest: assetsDigest, adoptedAt: new Date().toISOString(), adoptedBy: principal.userId,
      executionOwner: "sdk", state: "paused", spendingAuthorityGranted: false };
    return this.sessions.withLiveSessions([session], () => this.source.withRetiredExecution(principal, candidate, () => this.store.transaction(async () => {
      await guard();
      const retainedHistory = await readHistoricalCampaignSnapshot(this.store, project, history.id);
      requireThat(digest(retainedHistory) === digest({ receipt: history, snapshot }), "adoption_history_changed");
      const concurrent = await optional<{ receiptId: string }>(this.store, project, "executionAdoptionRequest", digest([principal.userId, requestKey]));
      if (concurrent) {
        const saved = await this.store.get<ExecutionAdoptionReceipt>(project, "executionAdoption", concurrent.receiptId);
        requireThat(saved.nativeCampaignId === nativeCampaignId && saved.candidateDigest === candidateDigest, "adoption_request_conflict");
        return saved;
      }
      const existing = await optional<{ receiptId: string }>(this.store, project, "campaignExecutionOwner", nativeCampaignId);
      if (existing) {
        const saved = await this.store.get<ExecutionAdoptionReceipt>(project, "executionAdoption", existing.receiptId);
        requireThat(saved.candidateDigest === candidateDigest, "campaign_already_adopted");
        await this.store.put(project, "executionAdoptionRequest", digest([principal.userId, requestKey]), { receiptId: saved.id });
        return saved;
      }
      requireThat(!await optional(this.store, project, "campaign", campaign.id), "adoption_campaign_already_exists");
      const ownedTypes = providerName === "meta" ? ["campaign", "adset", "ad"] : ["campaign", "creative"];
      // SDK-created campaigns predate adoption owner indexes. Their identities
      // are still owned, including IDs retained by an uncertain operation.
      const stored = await this.store.db.prepare("SELECT project_id,body FROM records WHERE kind=?").all("campaign");
      for (const row of stored) {
        const other = JSON.parse(String(row.body)) as Campaign;
        const otherGrant = await this.store.get<Grant>(String(row.project_id), "grant", other.grantId);
        if (otherGrant.provider !== providerName || measurementAccountId(providerName, otherGrant.accountId) !== measurementAccountId(providerName, grant.accountId)) continue;
        const pending = await this.store.list<{ campaignId: string; receipt: Receipt | null }>(String(row.project_id), "operation");
        const receipts = [other.receipt, ...pending.filter(o => o.campaignId === other.id).map(o => o.receipt)];
        requireThat(!receipts.some(r => r && ownedTypes.some(type => r.ids[type] === candidate.providerIds[type])), "provider_object_already_owned");
      }
      for (const type of ownedTypes) {
        const objectId = candidate.providerIds[type]; text(objectId);
        const key = digest([providerName, measurementAccountId(providerName, grant.accountId), type, objectId]);
        requireThat(!(await this.store.db.prepare("SELECT project_id FROM records WHERE kind=? AND id=?").all("providerExecutionOwner", key)).length,
          "provider_object_already_owned");
        await this.store.put(project, "providerExecutionOwner", key, { receiptId: receipt.id, sdkCampaignId: campaign.id, type, objectId });
      }
      // Original media and execution ownership commit together. An existing ID
      // or digest may be reused only when its retained contents match exactly.
      for(const retained of retainedMedia) {
        const existingAsset = await optional<Asset>(this.store, project, "asset", retained.asset.id);
        requireThat(!existingAsset || digest(existingAsset) === digest(retained.asset), "adoption_asset_conflict");
        await this.store.db.prepare("INSERT OR IGNORE INTO blobs VALUES(?,?,?)").run(project, retained.asset.digest, retained.bytes);
        requireThat(await this.store.db.prepare("SELECT 1 AS present FROM blobs WHERE project_id=? AND digest=? AND bytes=?")
          .get(project, retained.asset.digest, retained.bytes), "adoption_media_bytes_changed");
        if (!existingAsset) await this.store.put(project, "asset", retained.asset.id, retained.asset);
      }
      const adopted: Campaign = { ...campaign, receipt: inspection.candidateReceipt, preparedMaterial: structuredClone(campaign.material),
        adoptionOrigin: { nativeCampaignId, historyImportId: history.id, sourceRevision: candidate.sourceRevision, receiptId: receipt.id } };
      await this.store.put(project, "campaign", campaign.id, adopted);
      await this.store.put(project, "campaignVersion", `${campaign.id}:1`, adopted);
      await this.store.put(project, "audience", `${campaign.id}:1`, campaign.material.audience);
      await this.store.put(project, "executionAdoption", receipt.id, receipt);
      await this.store.put(project, "campaignExecutionOwner", nativeCampaignId, { receiptId: receipt.id, executor: "sdk" });
      await this.store.put(project, "executionAdoptionRequest", digest([principal.userId, requestKey]), { receiptId: receipt.id });
      await this.store.append(project, campaign.id, "campaign.execution_adopted", { receiptId: receipt.id, historyImportId: history.id });
      await guard();
      return receipt;
    })));
  }
}
