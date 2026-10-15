import type { HistoricalCampaignSnapshot } from '../core/adoption.js';
import { readHistoricalCampaignSnapshot } from './adoption.js';
import { Store, DomainError, digest, requireThat, type Principal } from './store.js';
import { text } from './validation.js';
import { sessionBinding, inspectLiveSessions, type SessionAuthority } from './session-authority.js';

export interface HistoricalPurposeInput {
  historyImportId:string; purpose:'acquisition'|'recruitment'; rationale:string;
  evidenceRecordIds:string[]; previousResolutionId:string|null; requestKey:string;
}
export interface HistoricalPurposeResolution extends Omit<HistoricalPurposeInput,'requestKey'> {
  id:string; projectId:string; nativeCampaignId:string; sourceDigest:string;
  basis:'recorded_assessment'; originalPurpose:HistoricalCampaignSnapshot['purpose'];
  recordedBy:string; recordedAt:string; executionTransferred:false; spendingAuthorityGranted:false;
}
async function optional<T>(store:Store,project:string,kind:string,id:string):Promise<T|null>{
  try{return await store.get<T>(project,kind,id);}catch(e){if(e instanceof DomainError&&e.code==='not_found')return null;throw e;}
}
/** Trusted read. Callers authorize current access separately. An assessment never
 * changes the original snapshot or its unknown/conflicting purpose. */
export async function readHistoricalPurposeResolution(store:Store,project:string,historyImportId:string,id?:string){
  const current=await optional<{id:string}>(store,project,'historicalPurposeCurrent',historyImportId);
  const selected=id??current?.id;if(!selected)return null;
  const saved=await store.get<HistoricalPurposeResolution>(project,'historicalPurposeResolution',selected);
  const {id:receiptId,...body}=saved;
  const history=await readHistoricalCampaignSnapshot(store,project,historyImportId);
  requireThat(receiptId===selected&&receiptId===`purpose_${digest(body)}`&&saved.projectId===project&&
    saved.historyImportId===historyImportId&&saved.sourceDigest===history.receipt.sourceDigest&&
    saved.nativeCampaignId===history.snapshot.nativeCampaignId,'historical_purpose_receipt_invalid');
  return {resolution:saved,current:current?.id===selected};
}

/** Explicit human/agent assessment over retained evidence, not keyword inference,
 * provider approval, original intent fabrication or a new execution grant. */
export class HistoricalPurposeResolutions {
  constructor(readonly store:Store,readonly sessions:SessionAuthority,
    readonly authorize:(principal:Principal,project:string,campaign:string)=>Promise<void>){}
  async access(principal:Principal,project:string,historyImportId:string){
    await this.store.authorize(principal,project);
    const history=await readHistoricalCampaignSnapshot(this.store,project,historyImportId);
    await this.authorize(principal,project,history.snapshot.nativeCampaignId);return history;
  }
  async read(principal:Principal,project:string,historyImportId:string,id?:string){
    const session=await this.sessions.inspectSession(sessionBinding(principal),project);
    return this.sessions.withLiveSessions([session],async()=>{
      await this.access(principal,project,historyImportId);
      return readHistoricalPurposeResolution(this.store,project,historyImportId,id);
    });
  }
  async readRequest(principal:Principal,project:string,requestKey:string){
    text(requestKey,200);await this.store.authorize(principal,project);
    const session=await this.sessions.inspectSession(sessionBinding(principal),project);
    return this.sessions.withLiveSessions([session],async()=>{
      const request=await optional<{id:string;historyImportId:string}>(this.store,project,'historicalPurposeRequest',digest([principal.userId,requestKey]));
      if(!request)return null;
      await this.access(principal,project,request.historyImportId);
      return readHistoricalPurposeResolution(this.store,project,request.historyImportId,request.id);
    });
  }
  async resolve(principal:Principal,project:string,input:HistoricalPurposeInput){
    requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===6&&['historyImportId','purpose','rationale','evidenceRecordIds','previousResolutionId','requestKey'].every(k=>k in input),'historical_purpose_request_invalid',422);
    text(input.historyImportId,200);text(input.requestKey,200);text(input.rationale,4000);
    requireThat(['acquisition','recruitment'].includes(input.purpose)&&Array.isArray(input.evidenceRecordIds)&&
      input.evidenceRecordIds.length>0&&input.evidenceRecordIds.length<=100&&new Set(input.evidenceRecordIds).size===input.evidenceRecordIds.length&&
      input.evidenceRecordIds.every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))&&
      (input.previousResolutionId===null||typeof input.previousResolutionId==='string'&&input.previousResolutionId.length>0),'historical_purpose_request_invalid',422);
    const frozen=structuredClone({...input,evidenceRecordIds:[...input.evidenceRecordIds].sort()}),inputDigest=digest(frozen);
    const session=await this.sessions.inspectSession(sessionBinding(principal),project);
    return this.sessions.withLiveSessions([session],()=>this.store.transaction(async()=>{
      await this.store.authorize(principal,project,['admin','editor']);
      const history=await this.access(principal,project,frozen.historyImportId);
      const key=digest([principal.userId,frozen.requestKey]);
      const replay=await optional<{id:string;historyImportId:string;inputDigest:string}>(this.store,project,'historicalPurposeRequest',key);
      if(replay){requireThat(replay.inputDigest===inputDigest,'historical_purpose_request_conflict');return (await readHistoricalPurposeResolution(this.store,project,replay.historyImportId,replay.id))!.resolution;}
      requireThat(history.snapshot.purpose==='unknown','historical_purpose_already_explicit');
      requireThat(frozen.evidenceRecordIds.every(id=>history.receipt.recordRefs.some(r=>r.digest===id&&['campaign','material','targeting','attribution','authority'].includes(r.kind))),'historical_purpose_evidence_missing');
      requireThat(!await optional(this.store,project,'campaignExecutionOwner',history.snapshot.nativeCampaignId),'historical_purpose_already_adopted');
      const current=await optional<{id:string}>(this.store,project,'historicalPurposeCurrent',frozen.historyImportId);
      requireThat((current?.id??null)===frozen.previousResolutionId,'historical_purpose_revision_conflict');
      const {requestKey,...assessment}=frozen;
      const body={...assessment,projectId:project,nativeCampaignId:history.snapshot.nativeCampaignId,sourceDigest:history.receipt.sourceDigest,
        basis:'recorded_assessment' as const,originalPurpose:history.snapshot.purpose,recordedBy:principal.userId,recordedAt:new Date().toISOString(),
        executionTransferred:false as const,spendingAuthorityGranted:false as const};
      const resolution:HistoricalPurposeResolution={id:`purpose_${digest(body)}`,...body};
      await this.store.put(project,'historicalPurposeResolution',resolution.id,resolution);
      await this.store.put(project,'historicalPurposeCurrent',frozen.historyImportId,{id:resolution.id});
      await this.store.put(project,'historicalPurposeRequest',key,{id:resolution.id,historyImportId:frozen.historyImportId,inputDigest});
      await this.store.append(project,history.snapshot.nativeCampaignId,'campaign.historical_purpose_assessed',{resolutionId:resolution.id,historyImportId:frozen.historyImportId,purpose:frozen.purpose,spendingAuthorityGranted:false});
      await this.access(principal,project,frozen.historyImportId);await inspectLiveSessions(this.sessions,[session]);
      return (await readHistoricalPurposeResolution(this.store,project,frozen.historyImportId,resolution.id))!.resolution;
    }));
  }
}
