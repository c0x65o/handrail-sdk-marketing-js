import type {Grant} from '../core/index.js';
import {readHistoricalCampaignSnapshot} from './adoption.js';
import type {ExistingMetaHierarchyInspection,ExistingMetaReconciledCreativeInspection,ExistingLinkedInHierarchyInspection,ProviderPort} from './ports.js';
import {Store,DomainError,digest,requireThat,type Principal} from './store.js';
import {sessionBinding,inspectLiveSessions,type SessionAuthority} from './session-authority.js';
import {text} from './validation.js';

export interface HistoricalEffectInput {historyImportId:string;operationId:string;requestKey:string}
interface HistoricalEffectFacts {
  projectId:string;nativeCampaignId:string;historyImportId:string;operationId:string;sourceRevision:string;
  originalStatus:'partial';originalRequestCoverage:'unknown';
  evidenceRecordIds:string[];affectedProviderIds:string[];grant:Grant;
}
export type HistoricalEffectCandidate = HistoricalEffectFacts & (
  {basis:'mapped_objects_after_material_readback_failure'|'mapped_objects_after_pause_readback_failure';
   providerIds:{campaign:string;adset:string;ad:string;creative:string}} |
  {basis:'mapped_meta_creative_after_creation_reconciliation';providerIds:{campaign:string;adset:string;ad:string;creative:string;reconciledCreative:string}} |
  {basis:'mapped_creative_after_creation_reconciliation';providerIds:{group:string;campaign:string;creative:string}}
);
export interface HistoricalEffectSource {
  authorize(principal:Principal,project:string,campaign:string):Promise<void>;
  /** Trusted host proof of a deterministic material/paused-readback failure after its
   * affected objects were durably mapped. Unknown transport outcomes do not fit. */
  capture(principal:Principal,project:string,historyImportId:string,operationId:string):Promise<HistoricalEffectCandidate>;
  assertCurrent(principal:Principal,candidate:HistoricalEffectCandidate):Promise<void>;
  withCurrentSource<T>(principal:Principal,candidate:HistoricalEffectCandidate,commit:()=>Promise<T>):Promise<T>;
}
export interface HistoricalEffectResolution {
  id:string;projectId:string;nativeCampaignId:string;historyImportId:string;sourceDigest:string;operationId:string;sourceRevision:string;
  basis:HistoricalEffectCandidate['basis'];originalStatus:'partial';originalRequestCoverage:'unknown';
  evidenceRecordIds:string[];affectedProviderIds:string[];providerIds:HistoricalEffectCandidate['providerIds'];
  providerEvidence:ExistingMetaHierarchyInspection|ExistingMetaReconciledCreativeInspection|ExistingLinkedInHierarchyInspection;resolution:'known_effects_preserved_paused';
  missingReasons:['historical_request_receipts_unavailable'];recordedBy:string;recordedAt:string;
  originalOperationRewritten:false;executionTransferred:false;spendingAuthorityGranted:false;
}
async function optional<T>(store:Store,project:string,kind:string,id:string):Promise<T|null>{
  try{return await store.get<T>(project,kind,id);}catch(e){if(e instanceof DomainError&&e.code==='not_found')return null;throw e;}
}
export async function readHistoricalEffectResolution(store:Store,project:string,historyImportId:string,operationId:string){
  const current=await optional<{id:string}>(store,project,'historicalEffectCurrent',digest([historyImportId,operationId]));
  if(!current)return null;
  const saved=await store.get<HistoricalEffectResolution>(project,'historicalEffectResolution',current.id);
  const {id,...body}=saved,history=await readHistoricalCampaignSnapshot(store,project,historyImportId);
  requireThat(id===current.id&&id===`effect_${digest(body)}`&&saved.projectId===project&&saved.historyImportId===historyImportId&&
    saved.operationId===operationId&&saved.sourceDigest===history.receipt.sourceDigest&&saved.nativeCampaignId===history.snapshot.nativeCampaignId&&
    history.receipt.unsettledOperationIds.includes(operationId),'historical_effect_receipt_invalid');
  return saved;
}
/** Append evidence of known stopped effects without rewriting original failed
 * operations or filling gaps in historical request receipts. No provider writes. */
export class HistoricalEffectResolutions {
  constructor(readonly store:Store,readonly source:HistoricalEffectSource,readonly sessions:SessionAuthority,
    readonly providers:Partial<Record<'meta'|'linkedin',ProviderPort>>){}
  async access(p:Principal,project:string,importId:string){
    await this.store.authorize(p,project);const h=await readHistoricalCampaignSnapshot(this.store,project,importId);
    await this.source.authorize(p,project,h.snapshot.nativeCampaignId);return h;
  }
  async read(p:Principal,project:string,importId:string,operationId:string){
    const session=await this.sessions.inspectSession(sessionBinding(p),project);
    return this.sessions.withLiveSessions([session],async()=>{await this.access(p,project,importId);return readHistoricalEffectResolution(this.store,project,importId,operationId);});
  }
  async readRequest(p:Principal,project:string,requestKey:string){
    text(requestKey,200);await this.store.authorize(p,project);
    const session=await this.sessions.inspectSession(sessionBinding(p),project);
    return this.sessions.withLiveSessions([session],async()=>{
      const saved=await optional<{historyImportId:string;operationId:string}>(this.store,project,'historicalEffectRequest',digest([p.userId,requestKey]));
      if(!saved)return null;await this.access(p,project,saved.historyImportId);
      return readHistoricalEffectResolution(this.store,project,saved.historyImportId,saved.operationId);
    });
  }
  async resolve(p:Principal,project:string,input:HistoricalEffectInput){
    requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===3&&
      ['historyImportId','operationId','requestKey'].every(k=>k in input),'historical_effect_request_invalid',422);
    text(input.historyImportId,200);text(input.operationId,300);text(input.requestKey,200);
    const frozen=structuredClone(input),inputDigest=digest(frozen),key=digest([p.userId,frozen.requestKey]);
    const session=await this.sessions.inspectSession(sessionBinding(p),project);
    const replay=async()=>{
      await this.access(p,project,frozen.historyImportId);
      const request=await optional<{inputDigest:string}>(this.store,project,'historicalEffectRequest',key);
      if(!request)return null;
      requireThat(request.inputDigest===inputDigest,'historical_effect_request_conflict');
      return readHistoricalEffectResolution(this.store,project,frozen.historyImportId,frozen.operationId);
    };
    const prior=await this.sessions.withLiveSessions([session],replay);if(prior)return prior;
    await this.store.authorize(p,project,['admin','editor']);
    const history=await this.access(p,project,frozen.historyImportId);
    const candidate=structuredClone(await this.source.capture(p,project,frozen.historyImportId,frozen.operationId)),hash=digest(candidate);
    requireThat(candidate.projectId===project&&candidate.historyImportId===frozen.historyImportId&&candidate.operationId===frozen.operationId&&
      candidate.nativeCampaignId===history.snapshot.nativeCampaignId&&
      history.snapshot.provider===(candidate.basis==='mapped_creative_after_creation_reconciliation'?'linkedin':'meta')&&candidate.grant.provider===history.snapshot.provider&&
      candidate.grant.projectId===project&&typeof history.snapshot.accountId==='string'&&candidate.grant.accountId===(history.snapshot.provider==='meta'?`act_${history.snapshot.accountId.replace(/^act_/,'')}`:history.snapshot.accountId)&&
      history.snapshot.providerCampaignIds.length===1&&history.snapshot.providerCampaignIds[0]===candidate.providerIds.campaign&&
      history.receipt.unsettledOperationIds.includes(frozen.operationId),'historical_effect_scope_invalid');
    requireThat(['mapped_objects_after_material_readback_failure','mapped_objects_after_pause_readback_failure','mapped_creative_after_creation_reconciliation','mapped_meta_creative_after_creation_reconciliation'].includes(candidate.basis)&&candidate.originalStatus==='partial'&&candidate.originalRequestCoverage==='unknown'&&
      typeof candidate.sourceRevision==='string'&&candidate.sourceRevision.length>0&&Array.isArray(candidate.evidenceRecordIds)&&
      candidate.evidenceRecordIds.length>0&&new Set(candidate.evidenceRecordIds).size===candidate.evidenceRecordIds.length&&
      candidate.evidenceRecordIds.every(id=>history.receipt.recordRefs.some(r=>r.digest===id&&['operation','provider_object'].includes(r.kind)))&&
      history.receipt.recordRefs.some(r=>r.sourceId===frozen.operationId&&r.kind==='operation'&&candidate.evidenceRecordIds.includes(r.digest))&&
      Array.isArray(candidate.affectedProviderIds)&&candidate.affectedProviderIds.length>0&&new Set(candidate.affectedProviderIds).size===candidate.affectedProviderIds.length&&
      (candidate.basis==='mapped_creative_after_creation_reconciliation'
        ? candidate.affectedProviderIds.includes(candidate.providerIds.creative)&&candidate.affectedProviderIds.every(id=>
            history.snapshot.records.some(r=>r.kind==='provider_object'&&r.payload.provider==='linkedin'&&
              ['image','creative'].includes(String(r.payload.object_type))&&r.payload.provider_object_id===id&&
              r.payload.parent_provider_object_id===candidate.providerIds.campaign&&
              candidate.evidenceRecordIds.includes(digest({project,nativeCampaignId:history.snapshot.nativeCampaignId,system:history.snapshot.source.system,record:r}))))
        : candidate.basis==='mapped_meta_creative_after_creation_reconciliation'
          ? candidate.affectedProviderIds.includes(candidate.providerIds.reconciledCreative)&&candidate.affectedProviderIds.every(id=>
              history.snapshot.records.some(r=>r.kind==='provider_object'&&r.payload.provider==='meta'&&
                (r.payload.object_type==='image'||(r.payload.object_type==='creative'&&id===candidate.providerIds.reconciledCreative))&&
                r.payload.provider_object_id===id&&candidate.evidenceRecordIds.includes(digest({project,nativeCampaignId:history.snapshot.nativeCampaignId,system:history.snapshot.source.system,record:r}))))
        : candidate.affectedProviderIds.some(id=>[candidate.providerIds.campaign,candidate.providerIds.adset,candidate.providerIds.ad].includes(id))&&
          candidate.affectedProviderIds.every(id=>[candidate.providerIds.campaign,candidate.providerIds.adset,candidate.providerIds.ad].includes(id)||
            (candidate.basis==='mapped_objects_after_pause_readback_failure'&&history.snapshot.records.some(r=>
              r.kind==='provider_object'&&r.payload.provider==='meta'&&['image','creative'].includes(String(r.payload.object_type))&&r.payload.provider_object_id===id&&
              candidate.evidenceRecordIds.includes(digest({project,nativeCampaignId:history.snapshot.nativeCampaignId,system:history.snapshot.source.system,record:r})))))),
      'historical_effect_evidence_missing');
    const guard=async()=>{await inspectLiveSessions(this.sessions,[session]);await this.access(p,project,frozen.historyImportId);
      requireThat(digest(candidate)===hash,'historical_effect_source_changed');await this.source.assertCurrent(p,candidate);};
    let evidence:ExistingMetaHierarchyInspection|ExistingLinkedInHierarchyInspection;
    if(candidate.basis==='mapped_creative_after_creation_reconciliation'){
      const provider=this.providers.linkedin;requireThat(provider?.inspectExistingLinkedInHierarchy,'historical_effect_inspection_unavailable');
      await guard();evidence=await provider.inspectExistingLinkedInHierarchy(candidate.grant,candidate.providerIds,guard);await guard();
      const s=evidence.snapshot,ids=candidate.providerIds;
      requireThat(evidence.provider==='linkedin'&&evidence.source==='provider_api'&&evidence.inventoryComplete===true&&evidence.allPaused===true&&
        evidence.sharedGroupModified===false&&evidence.digest===digest(s)&&s.account.id===candidate.grant.accountId&&
        s.account.currency===candidate.grant.currency&&s.account.timezone===candidate.grant.timezone&&
        s.group.id===ids.group&&s.group.accountId===s.account.id&&typeof s.group.status==='string'&&s.group.status.length>0&&
        s.campaign.id===ids.campaign&&s.campaign.accountId===s.account.id&&s.campaign.groupId===ids.group&&
        s.campaign.organizationId===candidate.grant.organizationId&&['PAUSED','DRAFT'].includes(s.campaign.status)&&
        s.creatives.length===1&&s.creatives[0]!.id===ids.creative&&s.creatives[0]!.campaign===`urn:li:sponsoredCampaign:${ids.campaign}`&&
        ['PAUSED','DRAFT'].includes(s.creatives[0]!.intendedStatus)&&Number.isFinite(Date.parse(evidence.observedAt)),
        'historical_effect_provider_evidence_invalid');
    }else{
    const provider=this.providers.meta;requireThat(provider?.inspectExistingMetaHierarchy,'historical_effect_inspection_unavailable');
    await guard();
    if(candidate.basis==='mapped_meta_creative_after_creation_reconciliation'){
      requireThat(provider.inspectExistingMetaReconciledCreative,'historical_effect_inspection_unavailable');
      const inspected=await provider.inspectExistingMetaReconciledCreative(candidate.grant,candidate.providerIds,guard);
      requireThat(inspected.snapshot.reconciledCreative?.id===candidate.providerIds.reconciledCreative&&
        inspected.snapshot.reconciledCreative.accountId===candidate.grant.accountId.slice(4),'historical_effect_provider_evidence_invalid');
      evidence=inspected;
    }else evidence=await provider.inspectExistingMetaHierarchy(candidate.grant,candidate.providerIds,guard);
    await guard();
    const s=evidence.snapshot,ids=candidate.providerIds;
    requireThat(evidence.provider==='meta'&&evidence.source==='provider_api'&&evidence.inventoryComplete===true&&evidence.allPaused===true&&
      evidence.digest===digest(s)&&s.account.id===candidate.grant.accountId&&s.account.currency===candidate.grant.currency&&s.account.timezone===candidate.grant.timezone&&
      s.campaign.id===ids.campaign&&s.campaign.accountId===candidate.grant.accountId.slice(4)&&s.campaign.status==='PAUSED'&&s.campaign.effectiveStatus==='PAUSED'&&
      s.adsets.length===1&&s.ads.length===1&&s.adsets[0]!.id===ids.adset&&s.ads[0]!.id===ids.ad&&s.ads[0]!.creativeId===ids.creative&&
      s.adsets[0]!.campaignId===ids.campaign&&s.ads[0]!.campaignId===ids.campaign&&s.ads[0]!.adsetId===ids.adset&&
      s.adsets[0]!.accountId===s.campaign.accountId&&s.ads[0]!.accountId===s.campaign.accountId&&
      s.adsets[0]!.status==='PAUSED'&&s.ads[0]!.status==='PAUSED'&&['PAUSED','CAMPAIGN_PAUSED'].includes(s.adsets[0]!.effectiveStatus)&&
      ['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED'].includes(s.ads[0]!.effectiveStatus)&&Number.isFinite(Date.parse(evidence.observedAt)),
      'historical_effect_provider_evidence_invalid');
    }
    return this.source.withCurrentSource(p,candidate,()=>this.sessions.withLiveSessions([session],()=>this.store.transaction(async()=>{
      await guard();await this.store.authorize(p,project,['admin','editor']);const raced=await replay();if(raced)return raced;
      requireThat(!await optional(this.store,project,'campaignExecutionOwner',candidate.nativeCampaignId),'historical_effect_already_adopted');
      let resolution=await readHistoricalEffectResolution(this.store,project,frozen.historyImportId,frozen.operationId);
      if(resolution)requireThat(resolution.sourceRevision===candidate.sourceRevision,'historical_effect_source_changed');
      else{
        const {grant,...facts}=candidate;
        const body={...facts,sourceDigest:history.receipt.sourceDigest,providerEvidence:evidence,resolution:'known_effects_preserved_paused' as const,
          missingReasons:['historical_request_receipts_unavailable'] as ['historical_request_receipts_unavailable'],recordedBy:p.userId,recordedAt:new Date().toISOString(),
          originalOperationRewritten:false as const,executionTransferred:false as const,spendingAuthorityGranted:false as const};
        resolution={id:`effect_${digest(body)}`,...body};
        await this.store.put(project,'historicalEffectResolution',resolution.id,resolution);
        await this.store.put(project,'historicalEffectCurrent',digest([frozen.historyImportId,frozen.operationId]),{id:resolution.id});
        await this.store.append(project,candidate.nativeCampaignId,'campaign.historical_effect_reconciled',{resolutionId:resolution.id,operationId:frozen.operationId,spendingAuthorityGranted:false});
      }
      await this.store.put(project,'historicalEffectRequest',key,{historyImportId:frozen.historyImportId,operationId:frozen.operationId,inputDigest});
      await guard();return resolution;
    })));
  }
}
