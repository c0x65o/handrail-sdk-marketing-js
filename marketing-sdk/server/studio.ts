import { assertTextPlanningCapability, type NativeTextPlanning } from './text-planning.js';
import type { DraftGenerationPort } from "./studio-generation.js";
import type { DraftGenerationJob, GenerationGrant } from "../core/index.js";
import { providerPlan } from "./providers.js";
import sharp from 'sharp';
import { emptyBrief, STUDIO_STEPS, capabilityBlockers, capabilityStatus, providerBudgetBlockers, CAPABILITY_VERSION, type StudioCommands, type StudioDraft, type CampaignDraft, type Campaign, type StudioState, type StudioAsset, type StudioView, type LibraryItem, type StudioReport, type StudioCheck, type Grant, type Material, type PlanningRequest, type PlanningAuthority, type Operation } from '../core/index.js';
import { Store, type Principal, digest, byteDigest, id, requireThat } from './store.js';
import { keys, text, draftMaterial, material } from './validation.js';
import { inspectMedia } from './generation.js';
import { type SessionAuthority, type SessionInspection, sessionBinding, assertSessionInspection, inspectLiveSessions, createStoreSessionAuthority } from './session-authority.js';
import { type PlanningPort, type PlanningOutcome, validateBrief, validateOption, validatePlanningOutput, PLANNING_VERSION, unknownUsage, CAMPAIGN_OPTIONS_SCHEMA, PLANNING_PROMPT } from './planning.js';

export const studioCommandFields: Record<keyof StudioCommands,string[]> = {
  textPlanningConnections:[], reviewTextPlan:['draftId','expectedRevision','connectionId','maxOutputTokens','requestKey'], approveTextPlan:['reviewId','reviewDigest','requestKey'], cancelTextPlan:['reviewId','reviewDigest'],
  studioImportStatus:['requestKey'],
  reviewStudioDeletion:['draftId','expectedRevision'],
  generateDraftMedia:['draftId','expectedRevision','requestKey','grantId','prompt','rightsReceipt','quoteReceipt'],
  reconcileDraftMedia:['jobId'],
  promoteStudio:['draftId','expectedRevision','grantId','expectedGrantRevision','requestKey'],
  studio:['draftId'], saveBrief:['id','expectedRevision','requestKey','brief'],
  saveStudioMaterial:['draftId','expectedRevision','requestKey','material','step'],
  saveCampaignOption:['draftId','expectedRevision','requestKey','optionId','value'],
  selectCampaignOption:['draftId','expectedRevision','requestKey','optionId','optionRevision','variant'],
  selectStudioMedia:['draftId','expectedRevision','requestKey','assetIds'],
  listCampaigns:['query','kind','lifecycle','cursor','limit'], copyToDraft:['id','kind','expectedRevision','requestKey'],
  setCampaignLifecycle:['id','kind','expectedRevision','requestKey','lifecycle'],
  checkStudio:['draftId','expectedRevision','grantId'], requestPlan:['draftId','expectedRevision','authorityId','requestKey'],
  planningRequest:['requestId'], reconcilePlanning:['requestId'], applyPlanningOption:['draftId','expectedRevision','requestKey','requestId','optionIndex'],
};
export interface StudioOptions { withPromotion?: <T>(p:Principal,project:string,draftId:string,local:(retain:(campaign:Campaign)=>Promise<void>)=>Promise<T>)=>Promise<T>; textPlanning?: NativeTextPlanning; withTracking?: <T>(p:Principal,project:string,view:import('../core/index.js').TrackingView,local:()=>Promise<T>)=>Promise<T>; tracking?: (p:Principal,project:string,owner:import('../core/index.js').TrackingOwner)=>Promise<import('../core/index.js').TrackingView>; sessions?: SessionAuthority; planning?: PlanningPort; generation?: DraftGenerationPort }
type Change = { draftId:string; expectedRevision:number; requestKey:string };
export class CampaignStudio {
  readonly sessions: SessionAuthority;
  constructor(readonly store: Store, readonly options: StudioOptions = {}, readonly mode: 'fixture'|'live'='live', readonly now=()=>Date.now()) {
    this.sessions=options.sessions??createStoreSessionAuthority(store);
    if(options.textPlanning)assertTextPlanningCapability(options.textPlanning,store,this.sessions);
  }
  private async guarded<T>(p:Principal, project:string, write:boolean, action:()=>Promise<T>, expected?:SessionInspection):Promise<T> {
    const binding=sessionBinding(p), inspection=await this.sessions.inspectSession(binding,project);
    assertSessionInspection(inspection,binding,project);
    requireThat(!expected || digest(expected)===digest(inspection),'session_authority_changed',401);
    requireThat(!write || ['admin','editor'].includes(inspection.role),'forbidden',403);
    return this.sessions.withLiveSessions([inspection],()=>this.store.transaction(async()=>{
      await this.store.authorize(p,project,write?['admin','editor']:undefined);
      const result=await action();
      // A host lock serializes revocation writers, but time can still expire
      // during local awaits. Recheck before this SQL transaction commits.
      requireThat(digest(await this.inspection(p,project))===digest(inspection),'session_authority_changed',401);
      return result;
    }));
  }
  private async inspection(p:Principal,project:string) {
    const binding=sessionBinding(p), value=await this.sessions.inspectSession(binding,project);
    assertSessionInspection(value,binding,project);return value;
  }
  async call<K extends keyof StudioCommands>(p:Principal,project:string,command:K,input:StudioCommands[K]['input']):Promise<StudioCommands[K]['output']> {
    keys(input,studioCommandFields[command]);
    const fn=this[command] as (p:Principal,project:string,input:StudioCommands[K]['input'])=>Promise<StudioCommands[K]['output']>;
    return fn.call(this,p,project,input);
  }
  private state(d:CampaignDraft):StudioState {
    return d.studio??{brief:{...emptyBrief(),name:d.material.name,destination:d.material.destination||null,outcome:d.material.purpose??'acquisition'},briefDigest:'',creativeSetId:id(),options:[],selection:null,assetIds:[],lifecycle:'active',step:'brief',updatedAt:new Date(this.now()).toISOString(),source:null};
  }
  private async draft(project:string,draftId:string,revision?:number,active=false):Promise<StudioDraft> {
    const d=await this.store.get<CampaignDraft>(project,'campaignDraft',draftId);
    requireThat(revision===undefined || d.revision===revision,'revision_conflict');
    const studio=this.state(d); if(!studio.briefDigest) studio.briefDigest=digest(studio.brief);
    requireThat(!active||studio.lifecycle==='active','restore_draft_before_edit'); return {...d,studio};
  }
  private async retain(d:StudioDraft,expected?:number) {
    d.studio.updatedAt=new Date(this.now()).toISOString();
    await this.store.put(d.projectId,'campaignDraft',d.id,d,expected);
    await this.store.put(d.projectId,'studioRevision',`${d.id}:${d.revision}`,d);
    await this.store.append(d.projectId,d.id,'studio.changed',{revision:d.revision,lifecycle:d.studio.lifecycle}); return d;
  }
  private async once<T>(p:Principal,project:string,command:string,input:{requestKey:string},work:()=>Promise<T>):Promise<T> {
    text(input.requestKey,160); const key=`studio:${digest([p.userId,input.requestKey])}`, hash=digest({command,input});
    const old=await this.store.db.prepare('SELECT * FROM requests WHERE project_id=? AND request_key=?').get(project,key);
    if(old) {requireThat(old.digest===hash,'request_key_payload_conflict'); return (await this.store.get<{result:T}>(project,'studioWrite',String(old.record_id))).result;}
    const result=await work(), record=id(); await this.store.put(project,'studioWrite',record,{id:record,result});
    await this.store.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(project,key,hash,'studioWrite',record); return result;
  }
  private async change(p:Principal,project:string,command:string,input:Change,edit:(d:StudioDraft)=>Promise<void>) {
    return this.guarded(p,project,true,()=>this.once(p,project,command,input,async()=>{
      const d=await this.draft(project,input.draftId,input.expectedRevision,true); await edit(d); d.revision++; return this.retain(d,input.expectedRevision);
    }));
  }
  async studio(p:Principal,project:string,i:StudioCommands['studio']['input']):Promise<StudioView> {
    const inspection=await this.inspection(p,project);
    const grants=await this.guarded(p,project,false,async()=>{await this.draft(project,i.draftId);return this.store.list<GenerationGrant>(project,'generationGrant');},inspection);
    // Host quotes may await custody/billing. Never hold SQL or revocation locks here.
    const generationQuotes=await Promise.all(grants.map(async g=>{try{const quote=await this.options.generation?.quote(g);return {grantId:g.id,kind:g.kind,model:g.model,quote:quote??null};}catch{return {grantId:g.id,kind:g.kind,model:g.model,quote:null};}}));
    const textReviews=this.options.textPlanning?await this.options.textPlanning.reviews(p,project,i.draftId):[];
    return this.guarded(p,project,false,async()=>{
      const current=await this.store.list<GenerationGrant>(project,'generationGrant');
      return {draft:await this.draft(project,i.draftId),assets:await this.store.list<StudioAsset>(project,'studioAsset'),
        jobs:(await this.store.list<DraftGenerationJob>(project,'draftJob')).filter(j=>j.owner.draftId===i.draftId),generationAvailable:!!this.options.generation,
        plans:(await this.store.list<PlanningRequest>(project,'planningRequest')).filter(r=>r.draftId===i.draftId),
        reports:(await this.store.list<StudioReport>(project,'studioReport')).filter(r=>r.draftId===i.draftId),
        generationQuotes:generationQuotes.filter((q,n)=>current.some(g=>g.id===q.grantId&&!g.revokedAt&&Date.parse(g.expiresAt)>this.now()&&digest(g)===digest(grants[n]))),
        textReviews,
        planning:{state:this.options.textPlanning?'interactive':this.mode==='fixture'&&this.options.planning?'fixture':'unavailable',reason:this.options.textPlanning?'Choose a text-purpose connection and review one exact bounded request. Manual editing remains available.':this.mode==='fixture'&&this.options.planning?'Synthetic text authority required for each exact input; no paid calls':'Manual editing available. Real text custody/billing and persistent execution are not qualified.'}};
    },inspection);
  }

  async saveBrief(p:Principal,project:string,i:StudioCommands['saveBrief']['input']) {
    validateBrief(i.brief); requireThat(i.id ? Number.isSafeInteger(i.expectedRevision)&&i.expectedRevision!>0 : i.expectedRevision===undefined,'invalid_draft_revision',422);
    return this.guarded(p,project,true,()=>this.once(p,project,'saveBrief',i,async()=>{
      const old=i.id?await this.draft(project,i.id,i.expectedRevision,true):null;
      const d:StudioDraft=old??{id:id(),projectId:project,revision:0,state:'draft',connection:'unconnected',grantId:null,receipt:null,material:{name:i.brief.name},studio:this.state({material:{name:i.brief.name}} as CampaignDraft)};
      if(d.studio.briefDigest!==digest(i.brief)) {d.studio.selection=null; d.material={...d.material,destinationDigest:''};}
      d.studio.brief=structuredClone(i.brief);d.studio.briefDigest=digest(i.brief);d.studio.step='options';
      d.material={...d.material,name:i.brief.name,destination:i.brief.destination??'',purpose:i.brief.outcome}; d.revision++;
      return this.retain(d,old?i.expectedRevision:undefined);
    }));
  }
  async saveStudioMaterial(p:Principal,project:string,i:StudioCommands['saveStudioMaterial']['input']) {
    draftMaterial(i.material);requireThat(STUDIO_STEPS.includes(i.step),'invalid_studio_step',422);
    return this.change(p,project,'saveStudioMaterial',i,async d=>{
      requireThat(digest(i.material.assetIds??[])===digest(d.studio.assetIds),'use_media_selection');
      requireThat(!i.material.purpose||i.material.purpose===d.studio.brief.outcome,'change_desired_outcome_in_brief');
      const selected=d.studio.options.find(o=>o.id===d.studio.selection?.optionId);
      requireThat(!selected||!i.material.audience||i.material.audience.provider===selected.value.provider,'select_option_for_changed_provider');
      d.material=structuredClone(i.material);d.studio.step=i.step;
    });
  }
  async saveCampaignOption(p:Principal,project:string,i:StudioCommands['saveCampaignOption']['input']) {
    validateOption(i.value);return this.change(p,project,'saveCampaignOption',i,async d=>{
      const old=d.studio.options.find(o=>o.id===i.optionId);requireThat(!i.optionId||old,'option_not_found');
      requireThat(old||d.studio.options.length<12,'option_limit');
      const option={id:old?.id??id(),revision:(old?.revision??0)+1,briefDigest:d.studio.briefDigest,value:structuredClone(i.value),provenance:old?.provenance.kind==='planning'?{...old.provenance,edited:true as const}:{kind:'manual' as const}};
      d.studio.options=[...d.studio.options.filter(o=>o.id!==option.id),option];d.studio.step='options'; if(d.studio.selection?.optionId===option.id)d.studio.selection=null;
    });
  }
  async selectCampaignOption(p:Principal,project:string,i:StudioCommands['selectCampaignOption']['input']) {
    return this.change(p,project,'selectCampaignOption',i,async d=>{
      const o=d.studio.options.find(o=>o.id===i.optionId);requireThat(o&&o.revision===i.optionRevision&&o.briefDigest===d.studio.briefDigest,'option_stale');
      requireThat(Number.isInteger(i.variant)&&o.value.variants[i.variant],'invalid_variant');const v=o.value.variants[i.variant]!;
      d.studio.selection={optionId:o.id,revision:o.revision,variant:i.variant};d.studio.step='media';
      d.material={...d.material,headline:v.headline,body:v.body,destination:o.value.destination??d.studio.brief.destination??'',destinationDigest:'',
        audience:{provider:o.value.provider,locations:[],expansion:false},assetIds:[]};
      delete d.material.settings;delete d.material.searchHeadlines;delete d.material.searchDescriptions;
      if(o.value.provider==='google'){d.material.searchHeadlines=o.value.variants.map(v=>v.headline);d.material.searchDescriptions=o.value.variants.map(v=>v.body);}
      d.studio.assetIds=[];
    });
  }
  private async asset(project:string,assetId:string,observed?:Map<string,Buffer>) {
    const a=await this.store.get<StudioAsset>(project,'studioAsset',assetId);requireThat(a.projectId===project&&a.rights.declaration,'media_rights_required');
    const b=await this.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get(project,a.digest);
    requireThat(b&&byteDigest(b.bytes as Uint8Array)===a.digest,'asset_bytes_missing_or_changed');observed?.set(a.digest,Buffer.from(b.bytes as Uint8Array));return a;
  }
  async selectStudioMedia(p:Principal,project:string,i:StudioCommands['selectStudioMedia']['input']) {
    requireThat(Array.isArray(i.assetIds)&&i.assetIds.length<=3&&new Set(i.assetIds).size===i.assetIds.length,'invalid_media_selection');
    return this.change(p,project,'selectStudioMedia',i,async d=>{for(const a of i.assetIds)await this.asset(project,a); d.studio.assetIds=[...i.assetIds];d.material.assetIds=[...i.assetIds];d.studio.step='checks';});
  }
  /** Bounded actual binary input; MIME, dimensions and digest are never client assertions. */
  async importRaster(p:Principal,project:string,i:Change&{rights:string},bytes:Uint8Array):Promise<StudioAsset> {
    keys(i,['draftId','expectedRevision','requestKey','rights']);text(i.rights,2000);requireThat(bytes.byteLength>0&&bytes.byteLength<=10*1024*1024,'raster_size_limit',413);
    // Authorize before decoding. Repeat under the short commit guard afterwards.
    const inspection=await this.inspection(p,project);
    await this.guarded(p,project,true,()=>this.draft(project,i.draftId),inspection);
    const info=await inspectMedia(bytes,'image'),originalDigest=byteDigest(bytes),input=Buffer.from(bytes);
    const metadata=await sharp(input,{limitInputPixels:40_000_000,failOn:'warning'}).timeout({seconds:10}).metadata();requireThat((metadata.pages??1)===1,'animated_import_unavailable',422);
    if(info.mime==='image/png')requireThat(input.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex')),'trailing_raster_data',422);
    if(info.mime==='image/jpeg')requireThat(input.subarray(-2).equals(Buffer.from([255,217])),'trailing_raster_data',422);
    const clean=await sharp(input,{limitInputPixels:40_000_000,failOn:'warning'}).timeout({seconds:10}).rotate().png().toBuffer();
    const verified=await inspectMedia(clean,'image','image/png');
    const intent={...i,originalDigest};
    return this.guarded(p,project,true,()=>this.once(p,project,'importRaster',intent,async()=>{
      const d=await this.draft(project,i.draftId,i.expectedRevision,true);
      const asset:StudioAsset={id:id(),projectId:project,version:2,owner:{kind:'draft',draftId:d.id},creativeSetId:d.studio.creativeSetId,kind:'image',source:'imported',digest:byteDigest(clean),originalDigest,mime:verified.mime,width:verified.width,height:verified.height,seconds:null,bytes:clean.length,rights:{declaration:i.rights,actorId:p.userId,at:new Date(this.now()).toISOString(),verified:false},sourceAssetId:null,jobId:null};
      for(const b of [input,clean])await this.store.db.prepare(this.store.db.dialect==='mariadb'?'INSERT IGNORE INTO blobs(project_id,digest,bytes) VALUES(?,?,?)':'INSERT INTO blobs(project_id,digest,bytes) VALUES(?,?,?) ON CONFLICT(project_id,digest) DO NOTHING').run(project,byteDigest(b),b);
      await this.store.put(project,'studioAsset',asset.id,asset);await this.store.append(project,d.id,'studio.mediaImported',{assetId:asset.id,digest:asset.digest});return asset;
    }),inspection);
  }
  async media(p:Principal,project:string,assetId:string) {
    return this.guarded(p,project,false,async()=>{const asset=await this.asset(project,assetId);const row=await this.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get(project,asset.digest);return {asset,bytes:Buffer.from(row!.bytes as Uint8Array)};});
  }
  async campaignMedia(p:Principal,project:string,assetId:string) {
    return this.guarded(p,project,false,async()=>{
      const asset=await this.store.get<import('../core/index.js').Asset>(project,'asset',assetId);
      requireThat(asset.projectId===project,'asset_project_mismatch',403);
      await this.store.get<Campaign>(project,'campaign',asset.campaignId);
      const row=await this.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get(project,asset.digest);
      requireThat(row,'asset_missing',404);const bytes=Buffer.from(row.bytes as Uint8Array);
      requireThat(byteDigest(bytes)===asset.digest,'asset_integrity_failure');return {asset,bytes};
    });
  }
  private item(d:CampaignDraft|Campaign):LibraryItem {
    const draft='connection' in d, state=draft?d.studio:undefined;
    return {id:d.id,kind:draft?'draft':'campaign',name:d.material.name,revision:d.revision,lifecycle:state?.lifecycle??'active',updatedAt:state?.updatedAt??'',nextStep:state?.lifecycle==='trash'?'Restore draft':state?.lifecycle==='archived'?'Recover':draft?(state?.step??'brief'):'Review launch and provider state',providerState:draft?null:d.state};
  }
  async listCampaigns(p:Principal,project:string,i:StudioCommands['listCampaigns']['input']) {
    requireThat(i.kind===undefined||['draft','campaign'].includes(i.kind),'invalid_kind');requireThat(i.lifecycle===undefined||['active','archived','trash'].includes(i.lifecycle),'invalid_lifecycle');
    const limit=i.limit??25;requireThat(Number.isInteger(limit)&&limit>0&&limit<=50,'invalid_limit');requireThat(!i.query||i.query.length<=200,'query_too_long');
    return this.guarded(p,project,false,async()=>{
      const records=[...await this.store.list<CampaignDraft>(project,'campaignDraft'),...await this.store.list<Campaign>(project,'campaign')];
      const items:LibraryItem[]=[];
      for(const d of records){const item=this.item(d);if(item.kind==='campaign'){const states=await this.store.list<{id:string;lifecycle:LibraryItem['lifecycle'];updatedAt:string}>(project,'campaignLifecycle');const state=states.find(s=>s.id===d.id);if(state){item.lifecycle=state.lifecycle;item.updatedAt=state.updatedAt;}}
        if((!i.kind||item.kind===i.kind)&&item.lifecycle===(i.lifecycle??'active')&&(!i.query||JSON.stringify([d.material,'studio'in d?d.studio?.brief:null]).toLowerCase().includes(i.query.toLowerCase())))items.push(item);}
      items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
      const start=i.cursor?items.findIndex(x=>`${x.updatedAt}|${x.id}`===i.cursor)+1:0;requireThat(!i.cursor||start>0,'library_cursor_stale');const page=items.slice(start,start+limit),last=page.at(-1);
      return {items:page,nextCursor:start+limit<items.length&&last?`${last.updatedAt}|${last.id}`:null};
    });
  }
  async copyToDraft(p:Principal,project:string,i:StudioCommands['copyToDraft']['input']) {
    requireThat(['draft','campaign'].includes(i.kind),'invalid_kind');return this.guarded(p,project,true,()=>this.once(p,project,'copyToDraft',i,async()=>{
      const source=await this.store.get<CampaignDraft|Campaign>(project,i.kind==='draft'?'campaignDraft':'campaign',i.id);requireThat(source.revision===i.expectedRevision,'revision_conflict');
      const studio=structuredClone('connection'in source?this.state(source):this.state({material:source.material} as CampaignDraft));studio.creativeSetId=id();studio.lifecycle='active';studio.source={id:source.id,revision:source.revision};
      const d:StudioDraft={id:id(),projectId:project,revision:1,state:'draft',connection:'unconnected',grantId:null,receipt:null,material:structuredClone(source.material),studio};
      delete d.material.settings;d.material.destinationDigest='';
      d.material.name=`${source.material.name.slice(0,90)} copy`;studio.brief.name=d.material.name;studio.briefDigest=digest(studio.brief);studio.options=studio.options.map(o=>({...o,briefDigest:studio.briefDigest}));
      // Campaign assets retain the original metadata and immutable bytes; draft aliases never reparent them.
      if(!('connection'in source)){d.studio.assetIds=[];for(const assetId of source.material.assetIds){const old=await this.store.get<import('../core/index.js').Asset>(project,'asset',assetId);requireThat(old.campaignId===source.id&&old.kind!=='storyboard'&&old.width&&old.height&&old.rightsReceipt,'asset_not_reusable');const row=await this.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get(project,old.digest);requireThat(row&&byteDigest(row.bytes as Uint8Array)===old.digest,'asset_bytes_missing_or_changed');const a:StudioAsset={id:id(),projectId:project,version:2,owner:{kind:'draft',draftId:d.id},creativeSetId:studio.creativeSetId,kind:old.kind,source:old.source==='uploaded'?'imported':old.source,digest:old.digest,originalDigest:old.digest,mime:old.mime,width:old.width,height:old.height,seconds:old.seconds,bytes:(row.bytes as Uint8Array).length,rights:{declaration:old.rightsReceipt,actorId:p.userId,at:new Date(this.now()).toISOString(),verified:false},sourceAssetId:old.id,jobId:old.jobId};await this.store.put(project,'studioAsset',a.id,a);d.studio.assetIds.push(a.id);}}
      for(const a of d.studio.assetIds)await this.asset(project,a);d.material.assetIds=[...d.studio.assetIds];return this.retain(d);
    }));
  }
  async setCampaignLifecycle(p:Principal,project:string,i:StudioCommands['setCampaignLifecycle']['input']) {
    requireThat(['draft','campaign'].includes(i.kind)&&['active','archived','trash'].includes(i.lifecycle),'invalid_lifecycle');requireThat(i.kind==='draft'||i.lifecycle!=='trash','campaign_trash_unavailable');
    return this.guarded(p,project,true,()=>this.once(p,project,'setCampaignLifecycle',i,async()=>{
      if(i.kind==='draft'){const d=await this.draft(project,i.id,i.expectedRevision);d.studio.lifecycle=i.lifecycle;d.revision++;return this.item(await this.retain(d,i.expectedRevision));}
      const c=await this.store.get<Campaign>(project,'campaign',i.id);requireThat(c.revision===i.expectedRevision,'revision_conflict');
      if(i.lifecycle!=='active')requireThat(!['enabled','unknown'].includes(c.state)&&!(await this.store.list<Operation>(project,'operation')).some(o=>o.campaignId===c.id&&['queued','running','unknown'].includes(o.state)),'pause_and_reconcile_before_archive');
      c.revision++;await this.store.put(project,'campaign',c.id,c,i.expectedRevision);await this.store.put(project,'campaignVersion',`${c.id}:${c.revision}`,c);
      await this.store.put(project,'campaignLifecycle',c.id,{id:c.id,lifecycle:i.lifecycle,updatedAt:new Date(this.now()).toISOString()});return {...this.item(c),lifecycle:i.lifecycle};
    }));
  }
  async checkStudio(p:Principal,project:string,i:StudioCommands['checkStudio']['input']):Promise<StudioReport> {
    const session=await this.inspection(p,project);
    const tracking=await this.options.tracking?.(p,project,{kind:'draft',id:i.draftId})??null;
    // Custom status-only adapters cannot mint an authoritative handoff.
    requireThat(tracking?.readiness !== 'passed' || this.options.withTracking, 'tracking_commit_guard_required');
    const commit=async()=>{
      await inspectLiveSessions(this.sessions,[session]);
      const d=await this.draft(project,i.draftId,i.expectedRevision), checks:StudioCheck[]=[];
      const add=(step:StudioCheck['step'],code:string,state:StudioCheck['state'],message:string,kind:StudioCheck['kind']='technical')=>checks.push({step,code,state,message,kind});
      const assets=[];for(const a of d.studio.assetIds){try{assets.push(await this.asset(project,a));}catch{add('media','media_changed','blocked','Retained bytes are missing or changed. Select valid media.');}}
      let g:Grant|null=null;if(i.grantId)g=await this.store.get<Grant>(project,'grant',i.grantId);
      let dest:StudioReport['inputs']['destinationEvidence']=null;if(d.material.destinationDigest){try{dest=await this.store.get<NonNullable<StudioReport['inputs']['destinationEvidence']>>(project,'destination',d.material.destinationDigest);}catch{/* missing evidence */}}
      add('brief','brief',d.studio.brief.offer&&d.studio.brief.audience?'pass':'blocked',d.studio.brief.offer&&d.studio.brief.audience?'Offer and intended audience are saved.':'Offer and intended audience are required for a meaningful plan.');
      const selection=d.studio.selection, option=d.studio.options.find(o=>o.id===selection?.optionId);
      add('options','selection',option&&option.briefDigest===d.studio.briefDigest&&option.revision===selection?.revision?'pass':'blocked',option&&option.briefDigest===d.studio.briefDigest&&option.revision===selection?.revision?'Copy option selected for this brief.':'Explicitly select a copy option for the current brief.');
      add('options','claims','unknown','Review all claims against your supplied facts; suggestions are not claim approval.','editorial');
      add('checks','account',g&&!g.revokedAt&&Date.parse(g.expiresAt)>this.now()?'pass':'blocked','Choose a current account and identity in Connections.');
      add('checks','destination',dest&&(dest as {url:string}).url===d.material.destination?'pass':'blocked','Capture matching destination evidence explicitly; checking never fetches a URL.');
      if(g){try{material(d.material as Material,g.provider);const blockers=[...capabilityBlockers(d.material as Material,g),...providerBudgetBlockers(d.material as Material)];for(const code of blockers)add('checks',code,'blocked',code.replaceAll('_',' '));if(!blockers.length)add('checks','material','pass','Local field and provider capability constraints pass.');}catch(e){add('checks','material','blocked',(e as Error).message.replaceAll('_',' '));}
        add('checks','account_eligibility',capabilityStatus(d.material as Material,g).accountVerified?'pass':'unknown','Current exact account eligibility evidence is separate from local format validity.','provider');
        if(g.currency!==d.material.budget?.currency||g.timezone!==d.material.timezone)add('checks','account_budget_schedule','blocked','Review account currency and timezone.');
      }
      const provider=d.material.audience?.provider;
      add('media','format',provider==='google'?assets.length===0?'pass':'blocked':assets.length===1&&assets[0]?.kind==='image'?'pass':'blocked',provider==='google'?'Google Search is text only.':'Current Meta/LinkedIn adapters require one retained image. Video and storyboards cannot launch.');
      add('checks','provider_approval','unknown','Provider approval has not been requested. This preview is an approximation.','provider');
      requireThat(!tracking || tracking.ownerRevision===d.revision,'tracking_material_or_binding_changed');
      add('tracking','tracking',tracking?.readiness==='passed'?'pass':'unknown',tracking?.reason??'Missing integration / Not tested. A configured pixel or conversion ID is not a test event.');
      if(tracking?.binding?.providerMapping)add('tracking','provider_event_delivery','unknown','Provider event delivery and pixel firing are unavailable; configure and qualify a provider-specific transport separately.','provider');
      const {secretRef:_secret,...account}=g??{secretRef:''};
      const inputs:StudioReport['inputs']={material:d.material,briefDigest:d.studio.briefDigest,selection,assets,account:g?account as import('../core/index.js').PublicGrant:null,destinationEvidence:dest,capabilities:CAPABILITY_VERSION,evaluatedAt:new Date(this.now()).toISOString(),tracking};
      const inputDigest=digest({revision:d.revision,...inputs});
      const tested=tracking?.tests.filter(t=>t.bindingRevision===tracking.binding?.revision).at(-1);
      const accepted=tracking?.diagnostics.filter(r=>r.testId===tested?.id && r.eligibleAtReceipt).at(-1);
      const stage=(state:'verified'|'unknown',source:string,reason:string|null)=>({state,source,observedAt:accepted!.receivedAt,expiresAt:tested!.expiresAt,reason});
      const receipt:import('../core/index.js').TrackingReceipt|null=tracking?.readiness==='passed'&&tracking.binding&&tested&&accepted?{
        testSessionId:tested.id,bindingRevision:String(tracking.binding.revision),sourceId:tracking.binding.source.id,eventRef:accepted.eventRef,occurredAt:accepted.occurredAt,receivedAt:accepted.receivedAt,qaExcluded:true,consentBasis:accepted.consentBasis,
        stages:{websiteObserved:stage('verified','authenticated site completion',null),localReceived:stage('verified','authenticated first-party collector',null),providerAccepted:stage('unknown','provider','Provider delivery is unavailable; qualify a provider-specific transport.'),matched:stage('unknown','provider','No matching diagnostics are available.'),attributed:stage(accepted.attribution.campaignId?'verified':'unknown',accepted.attribution.rule,accepted.attribution.campaignId?null:'No eligible campaign click observed.')}
      }:null;
      const report:StudioReport={id:inputDigest,draftId:d.id,revision:d.revision,inputDigest,createdAt:inputs.evaluatedAt,inputs,checks,providerApproval:'not_requested',tracking:{projectId:project,draftId:d.id,revision:d.revision,materialDigest:digest(d.material),destination:d.material.destination??null,destinationDigest:d.material.destinationDigest??null,outcome:d.studio.brief.outcome,status:tracking?.readiness??'missing_integration',testStatus:tracking??undefined,receipt}};
      await this.store.put(project,'studioReport',report.id,report);
      await inspectLiveSessions(this.sessions,[session]);return report;
    };
    return tracking && this.options.withTracking ? this.options.withTracking(p,project,tracking,commit) : this.guarded(p,project,false,commit,session);
  }
  async studioImportStatus(p:Principal,project:string,i:StudioCommands['studioImportStatus']['input']) {
    text(i.requestKey,160);return this.guarded(p,project,false,async()=>{const row=await this.store.db.prepare('SELECT record_id FROM requests WHERE project_id=? AND request_key=?').get(project,`studio:${digest([p.userId,i.requestKey])}`);if(!row)return {asset:null};const receipt=await this.store.get<{result:StudioAsset}>(project,'studioWrite',String(row.record_id));requireThat(receipt.result.version===2&&receipt.result.source==='imported','request_not_import');return {asset:await this.asset(project,receipt.result.id)};});
  }
  async reviewStudioDeletion(p:Principal,project:string,i:StudioCommands['reviewStudioDeletion']['input']):Promise<StudioCommands['reviewStudioDeletion']['output']> {
    return this.guarded(p,project,false,async()=>{const d=await this.draft(project,i.draftId,i.expectedRevision);return {draftId:d.id,revision:d.revision,eligible:false,reason:'No separately authorized exact host retention policy is configured. Assets, audit, holds, backups and derived references must be resolved before permanent deletion can be offered.',retained:{assets:d.studio.assetIds.length,revisions:(await this.store.list<StudioDraft>(project,'studioRevision')).filter(x=>x.id===d.id).length,planningRequests:(await this.store.list<PlanningRequest>(project,'planningRequest')).filter(x=>x.draftId===d.id).length,mediaJobs:(await this.store.list<DraftGenerationJob>(project,'draftJob')).filter(x=>x.owner.draftId===d.id).length},confirmationPolicy:'Unavailable. A future exact impact receipt requires current human admin deletion permission, affected IDs/revisions/digests, hold/reference/unknown-operation checks, expiry and explicit confirmation with cancellation as default. This SDK does not issue a deletion decision or purge.',recovery:'restore',providerDeletion:'unavailable'};});
  }
  async promoteStudio(p:Principal,project:string,i:StudioCommands['promoteStudio']['input']) {
    // Read a committed original result before resolving changed draft/source
    // state. Replays still require the caller's current editor authority.
    const replay = await this.guarded(p,project,true,async()=>{
      text(i.requestKey,160);
      const row=await this.store.db.prepare('SELECT * FROM requests WHERE project_id=? AND request_key=?').get(project,`studio:${digest([p.userId,i.requestKey])}`);
      if(!row)return null;
      requireThat(row.digest===digest({command:'promoteStudio',input:i}),'request_key_payload_conflict');
      return this.store.get<{result:Campaign}>(project,'studioWrite',String(row.record_id));
    });
    if(replay)return replay.result;
    const session=await this.inspection(p,project);
    requireThat(['admin','editor'].includes(session.role),'forbidden',403);
    const original=await this.draft(project,i.draftId,i.expectedRevision,true);
    const observed=new Map<string,Buffer>(), media:StudioAsset[]=[];
    for(const assetId of original.studio.assetIds)media.push(await this.asset(project,assetId,observed));
    const commit=(retain:(campaign:Campaign)=>Promise<void>)=>this.once(p,project,'promoteStudio',i,async()=>{
      const d=await this.draft(project,i.draftId,i.expectedRevision,true),g=await this.store.get<Grant>(project,'grant',i.grantId);
      requireThat(digest(await this.inspection(p,project))===digest(session),'session_authority_changed',401);
      requireThat(digest(d)===digest(original),'revision_conflict');
      for(const [hash,bytes] of observed)requireThat(await this.store.db.prepare('SELECT 1 AS present FROM blobs WHERE project_id=? AND digest=? AND bytes=?').get(project,hash,bytes),'asset_bytes_missing_or_changed');
      requireThat(g.revision===i.expectedGrantRevision&&!g.revokedAt&&Date.parse(g.expiresAt)>this.now(),'grant_changed');
      const chosen=d.studio.options.find(o=>o.id===d.studio.selection?.optionId);
      requireThat(chosen&&chosen.revision===d.studio.selection?.revision&&chosen.briefDigest===d.studio.briefDigest,'option_stale');
      const m=structuredClone(d.material) as Material; material(m,g.provider);
      const blockers=capabilityBlockers(m,g);requireThat(!blockers.length,blockers[0]??'unsupported_capability');
      requireThat(m.budget.currency===g.currency&&m.timezone===g.timezone,'account_currency_or_timezone_mismatch');
      const dest=await this.store.get<{url:string;source:string}>(project,'destination',m.destinationDigest);
      requireThat(dest.url===m.destination&&(this.mode==='fixture'||dest.source==='public_https'),'destination_snapshot_mismatch');
      const binding=digest([d.id,d.revision,g.provider,g.accountId]);
      const previous=(await this.store.list<{id:string;campaignId:string}>(project,'studioPromotion')).find(x=>x.id===binding);
      if(previous)return this.store.get<Campaign>(project,'campaign',previous.campaignId);
      const c:Campaign={id:id(),projectId:project,revision:1,grantId:g.id,creativeSetId:id(),material:m,state:'draft',receipt:null,
        draftOrigin:{draftId:d.id,revision:d.revision,actorId:p.userId,materialDigest:digest(d.material),accountId:g.accountId}};
      const assets:import('../core/index.js').Asset[]=[];
      for(const assetId of d.studio.assetIds){const a=await this.store.get<StudioAsset>(project,'studioAsset',assetId);requireThat(digest(a)===digest(media.find(v=>v.id===assetId)),'asset_bytes_missing_or_changed');requireThat(a.kind==='image'&&(this.mode==='fixture'||a.source!=='fixture'),'launch_media_unavailable');
        assets.push({id:id(),projectId:project,campaignId:c.id,version:1,kind:a.kind,digest:a.digest,mime:a.mime,width:a.width,height:a.height,seconds:a.seconds,jobId:a.jobId,source:a.source==='imported'?'uploaded':a.source,rightsReceipt:a.rights.declaration,parentAssetIds:[a.id]});}
      c.material.assetIds=assets.map(a=>a.id);providerPlan(c,g,assets);
      for(const a of assets)await this.store.put(project,'asset',a.id,a);
      await this.store.put(project,'campaign',c.id,c);await this.store.put(project,'campaignVersion',`${c.id}:1`,c);
      await retain(c);
      await this.store.put(project,'studioPromotion',binding,{id:binding,campaignId:c.id,draft:d,assets:assets.map(a=>({id:a.id,source:a.parentAssetIds[0],digest:a.digest}))});
      await this.store.append(project,c.id,'studio.promoted',{draftId:d.id,revision:d.revision});return c;
    });
    return this.options.withPromotion
      ? this.options.withPromotion(p,project,i.draftId,commit)
      : this.guarded(p,project,true,()=>commit(async()=>{}));
  }
  private async mediaAuthority(p:Principal,project:string,j:DraftGenerationJob) {
    requireThat(this.options.generation?.version===2,'draft_generation_configuration_unavailable');
    const {inspection:expected}=await this.store.get<{inspection:SessionInspection}>(project,'draftJobSession',j.id);
    requireThat(digest(expected)===digest(await this.inspection(p,project)),'session_authority_changed',401);
    const g=await this.store.get<GenerationGrant>(project,'generationGrant',j.grantId);
    requireThat(g.projectId===project&&!g.revokedAt&&Date.parse(g.expiresAt)>this.now()&&digest(sessionBinding(p))===j.sessionDigest&&g.billingCapabilityRef&&g.ceiling.currency===j.quote.currency,'generation_grant_unavailable');
    requireThat(digest({...g,usedJobs:0})===j.grantDigest,'generation_grant_changed');
    this.options.generation.validate(g);
    const q=j.quote;
    requireThat(Date.parse(q.expiresAt)>this.now()&&q.receipt&&Number.isSafeInteger(q.maxUnitMinor)&&q.maxUnitMinor>0&&q.maxUnitMinor<=g.ceiling.minor,'generation_quote_changed');return g;
  }
  private async quotedMedia(p:Principal,project:string,j:DraftGenerationJob) {
    const g=await this.guarded(p,project,true,()=>this.mediaAuthority(p,project,j));
    const q=await this.options.generation!.quote(g);
    requireThat(digest(q)===digest(j.quote),'generation_quote_changed');
    return this.guarded(p,project,true,()=>this.mediaAuthority(p,project,j));
  }
  async generateDraftMedia(p:Principal,project:string,i:StudioCommands['generateDraftMedia']['input']) {
    text(i.prompt,6000);text(i.rightsReceipt,200);text(i.quoteReceipt,200);text(i.requestKey,160);
    const inspection=await this.inspection(p,project);
    const snapshot=await this.guarded(p,project,true,async()=>{
      const old=await this.store.db.prepare('SELECT * FROM requests WHERE project_id=? AND request_key=?').get(project,`studio:${digest([p.userId,i.requestKey])}`);
      if(old){requireThat(old.digest===digest({command:'generateDraftMedia',input:i}),'request_key_payload_conflict');return {result:(await this.store.get<{result:DraftGenerationJob}>(project,'studioWrite',String(old.record_id))).result};}
      const d=await this.draft(project,i.draftId,i.expectedRevision,true);
      requireThat(this.options.generation,'draft_generation_configuration_unavailable');
      requireThat(this.mode==='fixture'||this.options.generation.evidence==='generated','fixture_not_live_generation');
      requireThat(d.studio.selection&&d.material.audience?.provider!=='google','choose_supported_media_format_first');
      const g=await this.store.get<GenerationGrant>(project,'generationGrant',i.grantId);this.options.generation.validate(g);return {grant:g};
    },inspection);
    if(snapshot.result)return snapshot.result;
    const q=await this.options.generation!.quote(snapshot.grant!);
    return this.guarded(p,project,true,()=>this.once(p,project,'generateDraftMedia',i,async()=>{
      const d=await this.draft(project,i.draftId,i.expectedRevision,true),g=await this.store.get<GenerationGrant>(project,'generationGrant',i.grantId);
      requireThat(digest({...g,usedJobs:0})===digest({...snapshot.grant,usedJobs:0}),'generation_grant_changed');
      requireThat(q.receipt===i.quoteReceipt,'generation_quote_changed');
      const j:DraftGenerationJob={id:id(),projectId:project,version:2,owner:{kind:'draft',draftId:d.id},creativeSetId:d.studio.creativeSetId,draftRevision:d.revision,sessionDigest:digest(sessionBinding(p)),grantDigest:digest({...g,usedJobs:0}),quote:q,grantId:g.id,kind:g.kind,prompt:i.prompt,promptDigest:digest(i.prompt),rightsReceipt:i.rightsReceipt,parentAssetIds:[],state:'queued',providerRequestId:null,assetId:null,reason:null,createdAt:new Date(this.now()).toISOString()};
      await this.store.put(project,'draftJobSession',j.id,{inspection});
      await this.mediaAuthority(p,project,j);requireThat(g.usedJobs<g.maxJobs,'generation_attempt_limit');
      requireThat(!(await this.store.list<DraftGenerationJob>(project,'draftJob')).some(x=>x.owner.draftId===d.id&&['queued','running','processing','unknown'].includes(x.state)),'generation_pending_reconcile_before_resubmit');
      const reservations=await this.store.list<{grantId:string;minor:number}>(project,'generationCostReservation');
      requireThat(reservations.filter(r=>r.grantId===g.id).reduce((n,r)=>n+r.minor,0)+q.maxUnitMinor<=g.ceiling.minor,'generation_budget_exceeded');
      await this.store.put(project,'generationCostReservation',j.id,{jobId:j.id,grantId:g.id,minor:q.maxUnitMinor,currency:q.currency,quoteReceipt:q.receipt});
      await this.store.put(project,'generationGrant',g.id,{...g,usedJobs:g.usedJobs+1});
      await this.store.put(project,'draftJob',j.id,j);await this.store.put(project,'draftJobActor',j.id,p);return j;
    }),inspection);
  }
  async dispatchDraftMedia(project:string,jobId:string) {
    await this.store.db.assertExecutionOwner();const p=await this.store.get<Principal>(project,'draftJobActor',jobId);
    const candidate=await this.guarded(p,project,true,()=>this.store.get<DraftGenerationJob>(project,'draftJob',jobId));
    if(candidate.state!=='queued')return candidate;
    await this.quotedMedia(p,project,candidate);
    const job=await this.guarded(p,project,true,async()=>{await this.store.db.assertExecutionOwner();const j=await this.store.get<DraftGenerationJob>(project,'draftJob',jobId);if(j.state!=='queued')return null;await this.mediaAuthority(p,project,j);await this.draft(project,j.owner.draftId,j.draftRevision,true);j.state='running';await this.store.put(project,'draftJob',j.id,j);return j;});
    if(!job)return this.store.get<DraftGenerationJob>(project,'draftJob',jobId);
    const fence=async()=>{await this.quotedMedia(p,project,job);await this.guarded(p,project,true,async()=>{await this.store.db.assertExecutionOwner();await this.mediaAuthority(p,project,job);await this.draft(project,job.owner.draftId,job.draftRevision,true);});};
    try{
      const out=await this.options.generation!.submit(job,await this.quotedMedia(p,project,job),async requestId=>{
        text(requestId,500);await this.store.transaction(async()=>{const current=await this.store.get<DraftGenerationJob>(project,'draftJob',job.id);requireThat(!current.providerRequestId||current.providerRequestId===requestId,'generation_response_changed');current.providerRequestId=requestId;await this.store.put(project,'draftJob',job.id,current);});
      },fence);
      return await this.retainDraftMedia(p,project,job,out);
    }catch{return this.store.transaction(async()=>{const j=await this.store.get<DraftGenerationJob>(project,'draftJob',jobId);if(['retained','failed'].includes(j.state))return j;j.state='unknown';j.reason='Outcome unknown; check outcome without resubmission.';await this.store.put(project,'draftJob',j.id,j);return j;});}
  }
  private async retainDraftMedia(p:Principal,project:string,job:DraftGenerationJob,out:import('./ports.js').GenerationOutput) {
    // Decode outside local locks, then fence current session, lease and exact draft.
    await this.quotedMedia(p,project,job);
    const media=out.state==='retained' ? await inspectMedia(out.bytes!,job.kind,out.mime) : null;
    return this.guarded(p,project,true,async()=>{
      await this.store.db.assertExecutionOwner();const grant=await this.mediaAuthority(p,project,job);
      const j=await this.store.get<DraftGenerationJob>(project,'draftJob',job.id);if(['retained','failed'].includes(j.state))return j;
      await this.draft(project,j.owner.draftId,j.draftRevision,true);
      requireThat(!out.requestId||!j.providerRequestId||out.requestId===j.providerRequestId,'generation_response_changed');
      if(out.state==='retained'){
        requireThat(out.bytes&&j.providerRequestId&&media,'generation_response_identity_required');
        requireThat(j.kind!=='video'||(media.seconds!==undefined&&media.seconds<=grant.maxSeconds+0.5),'video_duration_exceeds_grant');
        const a:StudioAsset={id:id(),projectId:project,version:2,owner:j.owner,creativeSetId:j.creativeSetId,kind:j.kind,source:this.options.generation!.evidence,digest:byteDigest(out.bytes),originalDigest:byteDigest(out.bytes),mime:media.mime,width:media.width,height:media.height,seconds:media.seconds??null,bytes:out.bytes.length,rights:{declaration:j.rightsReceipt,actorId:p.userId,at:new Date(this.now()).toISOString(),verified:false},sourceAssetId:null,jobId:j.id};
        await this.store.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(project,a.digest,out.bytes);await this.store.put(project,'studioAsset',a.id,a);j.assetId=a.id;
      }
      j.state=out.state;j.providerRequestId=out.requestId??j.providerRequestId;j.reason=out.state==='unknown'?'Original outcome unavailable; no resubmission':null;await this.store.put(project,'draftJob',j.id,j);return j;
    });
  }
  async reconcileDraftMedia(p:Principal,project:string,i:StudioCommands['reconcileDraftMedia']['input']) {
    const j=await this.guarded(p,project,true,async()=>{const j=await this.store.get<DraftGenerationJob>(project,'draftJob',i.jobId);await this.mediaAuthority(p,project,j);return j;});
    if(!['processing','unknown','running'].includes(j.state))return j;
    const out=await this.options.generation!.reconcile(j,await this.quotedMedia(p,project,j));return this.retainDraftMedia(p,project,j,out);
  }
  async textPlanningConnections(p:Principal,project:string,_i:StudioCommands['textPlanningConnections']['input']) {
    if(this.options.textPlanning)return this.options.textPlanning.connections(p,project);
    await this.inspection(p,project);return {connections:[],reason:'Text planning needs current host text permission, private credential custody, model facts and billing. Ask your project administrator; manual Studio is available.'};
  }
  async reviewTextPlan(p:Principal,project:string,i:StudioCommands['reviewTextPlan']['input']) { requireThat(this.options.textPlanning,'text_planning_configuration_required');return this.options.textPlanning.review(p,project,i); }
  async approveTextPlan(p:Principal,project:string,i:StudioCommands['approveTextPlan']['input']) { requireThat(this.options.textPlanning,'text_planning_configuration_required');return this.options.textPlanning.approve(p,project,i); }
  async cancelTextPlan(p:Principal,project:string,i:StudioCommands['cancelTextPlan']['input']) { requireThat(this.options.textPlanning,'text_planning_configuration_required');return this.options.textPlanning.cancel(p,project,i); }
  private async authority(p:Principal,project:string,r:PlanningRequest) {
    requireThat(this.mode==='fixture'&&this.options.planning?.evidence==='fixture','planning_configuration_unavailable');
    const a=await this.store.get<PlanningAuthority>(project,'planningAuthority',r.authorityId);
    const {inspection:expected}=await this.store.get<{inspection:SessionInspection}>(project,'planningSession',r.id);
    requireThat(digest(expected)===digest(await this.inspection(p,project)),'session_authority_changed',401);
    requireThat(a.evidence==='fixture'&&a.projectId===project&&a.actorId===p.userId&&a.sessionDigest===digest(sessionBinding(p))&&a.purpose==='campaign_planning'&&a.inputDigest===r.inputDigest&&a.model===r.model&&a.provider===r.provider&&a.maxAttempts===1&&!a.revokedAt&&Date.parse(a.expiresAt)>this.now()&&a.custodyRef&&a.billingCapabilityRef&&a.quoteRef&&/^\d+(\.\d+)?$/.test(a.maxCost.value)&&Number(a.maxCost.value)>0&&a.maxCost.unit&&a.maxCost.currency&&Number.isSafeInteger(a.maxInputTokens)&&a.maxInputTokens>0&&Number.isSafeInteger(a.maxOutputTokens)&&a.maxOutputTokens>0&&a.maxOutputTokens<=32768,'planning_authority_unavailable',403);
    requireThat(!r.authorityDigest||digest(a)===r.authorityDigest,'planning_authority_changed',403);return a;
  }
  async requestPlan(p:Principal,project:string,i:StudioCommands['requestPlan']['input']) {
    return this.guarded(p,project,true,()=>this.once(p,project,'requestPlan',i,async()=>{
      const d=await this.draft(project,i.draftId,i.expectedRevision,true);
      requireThat(!(await this.store.list<PlanningRequest>(project,'planningRequest')).some(r=>r.draftId===d.id&&['queued','running','unknown'].includes(r.state)),'planning_pending_check_outcome');
      const a=await this.store.get<PlanningAuthority>(project,'planningAuthority',i.authorityId);
      const r:PlanningRequest={id:id(),projectId:project,draftId:d.id,draftRevision:d.revision,briefDigest:d.studio.briefDigest,inputDigest:planningInputDigest(d.studio.brief),brief:d.studio.brief,model:a.model,provider:a.provider,promptVersion:PLANNING_VERSION,schemaVersion:PLANNING_VERSION,authorityId:a.id,authorityDigest:'',state:'queued',providerResponseId:null,options:[],reason:null,usage:unknownUsage(),outputDigest:null,createdAt:new Date(this.now()).toISOString()};
      await this.store.put(project,'planningSession',r.id,{inspection:await this.inspection(p,project)});
      await this.authority(p,project,r);r.authorityDigest=digest(a);
      requireThat(!(await this.store.list<PlanningRequest>(project,'planningRequest')).some(x=>x.authorityId===a.id),'planning_attempt_limit');
      requireThat(Buffer.byteLength(JSON.stringify({prompt:PLANNING_PROMPT,schema:CAMPAIGN_OPTIONS_SCHEMA,brief:r.brief}))+1000<=a.maxInputTokens,'planning_input_limit');
      await this.store.put(project,'planningReservation',r.id,{requestId:r.id,authorityId:a.id,authorityDigest:r.authorityDigest,maximum:a.maxCost,quoteRef:a.quoteRef,state:'reserved',usage:unknownUsage()});
      await this.store.put(project,'planningRequest',r.id,r);await this.store.put(project,'planningActor',r.id,p);return r;
    }));
  }
  async planningRequest(p:Principal,project:string,i:StudioCommands['planningRequest']['input']) {return this.guarded(p,project,false,()=>this.store.get<PlanningRequest>(project,'planningRequest',i.requestId));}
  /** Existing host executor calls once. Durable running state is an uncertain fence after crash. */
  async dispatchPlanning(project:string,requestId:string,signal?:AbortSignal) {
    const candidate=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);
    if(candidate.textReceipt){requireThat(this.options.textPlanning,'text_planning_configuration_required');return this.options.textPlanning.dispatch(project,requestId,signal);}
    await this.store.db.assertExecutionOwner();const p=await this.store.get<Principal>(project,'planningActor',requestId);
    const claimed=await this.guarded(p,project,true,async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);if(r.state!=='queued')return null;await this.authority(p,project,r);await this.draft(project,r.draftId,r.draftRevision,true);r.state='running';await this.store.put(project,'planningRequest',r.id,r);return r;});
    if(!claimed)return this.planningRequest(p,project,{requestId});
    const fence=()=>this.guarded(p,project,true,async()=>{await this.store.db.assertExecutionOwner();await this.authority(p,project,claimed);await this.draft(project,claimed.draftId,claimed.draftRevision,true);});
    try{const a=await this.authority(p,project,claimed);const output=await this.options.planning!.submit(claimed,a,async responseId=>{text(responseId,500);await this.store.transaction(async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);requireThat(!r.providerResponseId||r.providerResponseId===responseId,'provider_identity_changed');r.providerResponseId=responseId;await this.store.put(project,'planningRequest',r.id,r);});},fence);return await this.finishPlanning(p,project,requestId,output);}catch{return this.store.transaction(async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);if(['succeeded','failed'].includes(r.state))return r;r.state='unknown';r.reason='Outcome unknown. Check outcome; do not resubmit.';await this.store.put(project,'planningRequest',r.id,r);return r;});}
  }
  private async finishPlanning(p:Principal,project:string,requestId:string,out:PlanningOutcome) {
    // Preserve costly evidence even when authority expired. It is never usable until revalidated.
    await this.store.transaction(async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);await this.store.put(project,'planningEvidence',`${requestId}:${digest(out)}`,out);if(['succeeded','failed'].includes(r.state))return;r.usage=out.usage;r.outputDigest=out.rawOutputDigest??digest(out.output??null);const reservation=await this.store.get<Record<string,unknown>>(project,'planningReservation',requestId);await this.store.put(project,'planningReservation',requestId,{...reservation,state:'observed_not_released',usage:out.usage,providerResponseId:r.providerResponseId});await this.store.put(project,'planningRequest',r.id,r);});
    return this.guarded(p,project,true,async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);await this.authority(p,project,r);if(['succeeded','failed'].includes(r.state))return r;requireThat(r.providerResponseId&&r.providerResponseId===out.providerResponseId,'provider_response_identity_required');
      try{await this.store.db.assertExecutionOwner();await this.draft(project,r.draftId,r.draftRevision,true);requireThat(out.state==='completed',`planning_${out.state}`);const a=await this.authority(p,project,r);requireThat(out.usage.outputTokens===null||out.usage.outputTokens<=a.maxOutputTokens,'planning_output_limit');requireThat(out.usage.inputTokens===null||out.usage.inputTokens<=a.maxInputTokens,'planning_input_limit');if(out.usage.cost){requireThat(out.usage.cost.unit===a.maxCost.unit&&out.usage.cost.currency===a.maxCost.currency&&decimalAtMost(out.usage.cost.value,a.maxCost.value),'planning_cost_limit_or_unit_mismatch');}r.options=validatePlanningOutput(out.output);r.state='succeeded';r.reason=null;}catch(e){r.state='failed';r.options=[];r.reason=`${(e as Error).message}. Edit manually or explicitly authorize a new attempt.`;}await this.store.put(project,'planningRequest',r.id,r);return r;});
  }
  async reconcilePlanning(p:Principal,project:string,i:StudioCommands['reconcilePlanning']['input']) {
    const candidate=await this.planningRequest(p,project,i);
    if(candidate.textReceipt){requireThat(this.options.textPlanning,'text_planning_configuration_required');return this.options.textPlanning.reconcile(p,project,i.requestId);}
    const r=await this.guarded(p,project,true,async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',i.requestId);await this.authority(p,project,r);return r;});
    if(!['running','unknown'].includes(r.state))return r;
    if(!this.options.planning?.reconcile)return this.guarded(p,project,true,async()=>{const current=await this.store.get<PlanningRequest>(project,'planningRequest',r.id);await this.authority(p,project,current);if(['running','unknown'].includes(current.state)){current.state='unknown';current.reason='Original response readback unavailable. No retry or reservation release was performed.';await this.store.put(project,'planningRequest',current.id,current);}return current;});
    const out=await this.options.planning.reconcile(r,await this.authority(p,project,r));return this.finishPlanning(p,project,r.id,out);
  }
  async applyPlanningOption(p:Principal,project:string,i:StudioCommands['applyPlanningOption']['input']) {
    const candidate=await this.planningRequest(p,project,{requestId:i.requestId});
    if(candidate.textReceipt){
      requireThat(this.options.textPlanning,'text_planning_configuration_required');
      return this.options.textPlanning.withSelectable(p,project,candidate,()=>this.once(p,project,'applyPlanningOption',i,async()=>{
        const d=await this.draft(project,i.draftId,i.expectedRevision,true);
        requireThat(candidate.draftId===d.id&&candidate.briefDigest===d.studio.briefDigest&&candidate.draftRevision===d.revision,'planning_inputs_changed');
        const value=candidate.options[i.optionIndex];requireThat(Number.isInteger(i.optionIndex)&&value,'option_not_found');requireThat(d.studio.options.length<12,'option_limit');
        d.studio.options.push({id:id(),revision:1,briefDigest:d.studio.briefDigest,value,provenance:{kind:'planning',requestId:candidate.id,optionIndex:i.optionIndex}});d.studio.step='options';d.revision++;return this.retain(d,i.expectedRevision);
      }));
    }
    return this.change(p,project,'applyPlanningOption',i,async d=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',i.requestId);await this.authority(p,project,r);
      requireThat(r.draftId===d.id&&r.briefDigest===d.studio.briefDigest&&r.draftRevision===d.revision&&r.state==='succeeded','planning_inputs_changed');
      const value=r.options[i.optionIndex];requireThat(Number.isInteger(i.optionIndex)&&value,'option_not_found');requireThat(d.studio.options.length<12,'option_limit');
      d.studio.options.push({id:id(),revision:1,briefDigest:d.studio.briefDigest,value,provenance:{kind:'planning',requestId:r.id,optionIndex:i.optionIndex}});d.studio.step='options';
    });
  }
}
export const planningInputDigest=(brief:import('../core/index.js').BusinessBrief)=>digest({brief,prompt:PLANNING_PROMPT,schema:CAMPAIGN_OPTIONS_SCHEMA,version:PLANNING_VERSION});

function decimalAtMost(value:string,ceiling:string) {
  if(!/^\d+(\.\d+)?$/.test(value)||!/^\d+(\.\d+)?$/.test(ceiling)||value.length>100||ceiling.length>100)return false;
  const [vi,vf='']=value.split('.'),[ci,cf='']=ceiling.split('.'),scale=Math.max(vf.length,cf.length);
  return BigInt(vi!+vf.padEnd(scale,'0'))<=BigInt(ci!+cf.padEnd(scale,'0'));
}
