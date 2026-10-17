import type {Asset,Campaign,Grant,Operation,StudioAsset,StudioDraft} from '../core/index.js';
import {Store,digest,byteDigest,id,requireThat,type Principal,DomainError} from './store.js';
import {keys,text} from './validation.js';
import {inspectMedia} from './generation.js';
import {sessionBinding,assertSessionInspection,type SessionAuthority} from './session-authority.js';
import type {ExecutionAuthority} from './execution-authority.js';

/** Both promotion and existing-campaign retention preserve the exact Studio
 * source, rights declaration and generation job. Neither issues new rights. */
export function campaignAssetFromStudio(project:string,campaignId:string,a:StudioAsset,mode:'live'|'fixture'):Asset {
  requireThat(a.projectId===project&&a.rights.declaration,'media_rights_required');
  requireThat(a.kind==='image'&&(mode==='fixture'||a.source!=='fixture'),'launch_media_unavailable');
  return {id:id(),projectId:project,campaignId,version:1,kind:a.kind,digest:a.digest,mime:a.mime,
    width:a.width,height:a.height,seconds:a.seconds,jobId:a.jobId,
    source:a.source==='imported'?'uploaded':a.source,rightsReceipt:a.rights.declaration,parentAssetIds:[a.id]};
}
export interface CampaignStudioMediaInput {
  campaignId:string;expectedRevision:number;draftId:string;expectedDraftRevision:number;assetIds:string[];requestKey:string;
}
export interface CampaignStudioMediaReceipt {
  id:string;projectId:string;actorId:string;input:CampaignStudioMediaInput;inputDigest:string;
  campaignRevision:number;campaignMaterialDigest:string;draft:StudioDraft;
  sources:StudioAsset[];assets:Asset[];createdAt:string;
}
/** Host-only local media retention. It does not select/save material, renew a
 * grant, create an ad, publish or spend. The existing material-save workflow
 * admits selection separately. Exact receipts recover lost acknowledgements. */
export class CampaignStudioMedia {
  constructor(readonly store:Store,readonly sessions:SessionAuthority,readonly authority:ExecutionAuthority|undefined,
    readonly mode:'live'|'fixture',readonly now=()=>Date.now()){}
  private validate(i:CampaignStudioMediaInput){
    keys(i,['campaignId','expectedRevision','draftId','expectedDraftRevision','assetIds','requestKey']);
    for(const s of [i.campaignId,i.draftId,i.requestKey])text(s,160);
    requireThat(Number.isSafeInteger(i.expectedRevision)&&i.expectedRevision>0&&Number.isSafeInteger(i.expectedDraftRevision)&&i.expectedDraftRevision>0,'revision_required');
    requireThat(Array.isArray(i.assetIds)&&i.assetIds.length>0&&i.assetIds.length<=3&&new Set(i.assetIds).size===i.assetIds.length,'invalid_media_selection');
    for(const s of i.assetIds)text(s,160);
  }
  private async receipt(p:Principal,project:string,i:CampaignStudioMediaInput){
    const key=digest([p.userId,i.requestKey]);
    let r:CampaignStudioMediaReceipt;
    try{r=await this.store.get(project,'campaignStudioMedia',key);}catch(e){if(e instanceof DomainError&&e.code==='not_found')return null;throw e;}
    requireThat(r.actorId===p.userId&&r.projectId===project&&r.inputDigest===digest(i),'request_key_payload_conflict');return r;
  }
  private async guard<T>(p:Principal,project:string,local:()=>Promise<T>){
    const binding=sessionBinding(p),session=await this.sessions.inspectSession(binding,project);
    assertSessionInspection(session,binding,project);requireThat(['admin','editor'].includes(session.role),'forbidden',403);
    return this.sessions.withLiveSessions([session],()=>this.store.transaction(async()=>{
      await this.store.authorize(p,project,['admin','editor']);const result=await local();
      const current=await this.sessions.inspectSession(binding,project);assertSessionInspection(current,binding,project);
      requireThat(digest(current)===digest(session),'session_authority_changed',401);return result;
    }));
  }
  async readRequest(p:Principal,project:string,i:CampaignStudioMediaInput){
    this.validate(i);return this.guard(p,project,()=>this.receipt(p,project,i));
  }
  async retain(p:Principal,project:string,i:CampaignStudioMediaInput):Promise<CampaignStudioMediaReceipt>{
    this.validate(i);requireThat(this.authority,'material_revision_authority_required',403);
    const original=await this.guard(p,project,async()=>{
      const saved=await this.receipt(p,project,i);if(saved)return {saved};
      const campaign=await this.store.get<Campaign>(project,'campaign',i.campaignId);
      await this.authority!.assertCurrent(p,campaign,'revise_material');
      const draft=await this.store.get<StudioDraft>(project,'campaignDraft',i.draftId);
      requireThat(campaign.revision===i.expectedRevision&&draft.revision===i.expectedDraftRevision,'revision_conflict');
      requireThat(draft.projectId===project&&draft.studio?.lifecycle==='active','restore_draft_before_edit');
      requireThat(i.assetIds.every(a=>draft.studio.assetIds.includes(a)),'studio_media_selection_changed');
      return {campaign,draft,sources:await Promise.all(i.assetIds.map(a=>this.store.get<StudioAsset>(project,'studioAsset',a)))};
    });
    if(original.saved)return original.saved;
    const {campaign,draft,sources}=original;
    // Native decoding and byte reads stay outside host revocation guards.
    const observed=new Map<string,Buffer>();
    for(const a of sources){
      campaignAssetFromStudio(project,campaign.id,a,this.mode);
      const row=await this.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get(project,a.digest);
      requireThat(row&&byteDigest(row.bytes as Uint8Array)===a.digest,'asset_bytes_missing_or_changed');
      const bytes=Buffer.from(row.bytes as Uint8Array),info=await inspectMedia(bytes,'image');
      requireThat(info.mime===a.mime&&info.width===a.width&&info.height===a.height,'asset_metadata_changed');observed.set(a.digest,bytes);
    }
    return this.authority!.withCurrent(p,campaign,'revise_material',()=>this.guard(p,project,async()=>{
      const saved=await this.receipt(p,project,i);if(saved)return saved;
      const current=await this.store.get<Campaign>(project,'campaign',campaign.id);
      requireThat(digest(current)===digest(campaign)&&digest(await this.store.get(project,'campaignDraft',draft.id))===digest(draft),'revision_conflict');
      requireThat(current.state==='draft'||current.state==='paused','pause_and_reconcile_before_edit');
      requireThat(!(await this.store.list<Operation>(project,'operation')).some(o=>o.campaignId===campaign.id&&['queued','running','unknown'].includes(o.state)),'reconcile_before_edit');
      const grant=await this.store.get<Grant>(project,'grant',campaign.grantId);
      requireThat(campaign.projectId===project&&grant.projectId===project&&(!grant.campaignId||grant.campaignId===campaign.id)&&!grant.revokedAt,'material_revision_grant_scope',403);
      await this.authority!.assertCurrent(p,current,'revise_material');
      for(const a of sources)requireThat(digest(await this.store.get(project,'studioAsset',a.id))===digest(a),'asset_bytes_missing_or_changed');
      for(const [hash,bytes]of observed)requireThat(await this.store.db.prepare('SELECT 1 AS present FROM blobs WHERE project_id=? AND digest=? AND bytes=?').get(project,hash,bytes),'asset_bytes_missing_or_changed');
      const assets=sources.map(a=>campaignAssetFromStudio(project,campaign.id,a,this.mode));
      const r:CampaignStudioMediaReceipt={id:digest([p.userId,i.requestKey]),projectId:project,actorId:p.userId,input:structuredClone(i),inputDigest:digest(i),
        campaignRevision:campaign.revision,campaignMaterialDigest:digest(campaign.material),draft,sources,assets,createdAt:new Date(this.now()).toISOString()};
      for(const a of assets)await this.store.put(project,'asset',a.id,a);
      await this.store.put(project,'campaignStudioMedia',r.id,r);
      await this.store.append(project,campaign.id,'campaign.studio_media_retained',{receiptId:r.id,draftId:draft.id,draftRevision:draft.revision,assetIds:assets.map(a=>a.id)});
      await this.authority!.assertCurrent(p,current,'revise_material');return r;
    }));
  }
}
