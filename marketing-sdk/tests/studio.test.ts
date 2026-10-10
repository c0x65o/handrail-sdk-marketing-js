import { fork } from "node:child_process";
import { once } from "node:events";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { CampaignStudio, ResponsesPlanningAdapter, planningInputDigest, digest, sessionBinding, type PlanningPort } from '../server/index.js';
import { emptyBrief, type PlanningAuthority, type CampaignOption } from '../core/index.js';
import { testStore } from './datastore.js';
import { externalSessionFixture } from './external-session-fixture.js';
const approach:CampaignOption={title:'Local launch',audienceHypothesis:'People nearby',offer:'A guided tour',rationale:'Manual first',unknowns:['Availability'],provider:'meta',format:'single_image',destination:'https://example.test',variants:[{headline:'See the studio',body:'Book a guided tour.',cta:'Learn more'}]};
async function fixture(port?:PlanningPort){
  mkdirSync(resolve(process.env.MARKETING_STUDIO_SQL_ARTIFACTS??'artifacts/studio-3baf00fd/sql'),{recursive:true});const dir=mkdtempSync(resolve(process.env.MARKETING_STUDIO_SQL_ARTIFACTS??'artifacts/studio-3baf00fd/sql','case-'));const store=await testStore(join(dir,'db'));await store.db.acquireExecutor();
  for(const project of ['p','other'])await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project,'Studio '+project);
  const host=await externalSessionFixture(store),session=await host.login(),p=await host.principal(session.token);
  const studio=new CampaignStudio(store,{sessions:host.authority,planning:port},'fixture');
  const brief={...emptyBrief(),name:'Autumn tour',offer:'Guided studio tour',audience:'Local customers',facts:['Tours take 30 minutes'],destination:'https://example.test'};
  const d=await studio.saveBrief(p,'p',{requestKey:'brief',brief});return {store,host,session,p,studio,d,brief,path:join(dir,"db")};
}
test('manual Studio on real SQL: immutable retries, copy, archive, trash, recovery, revisions and retained references',async()=>{
 const f=await fixture();try{
  const retry=await f.studio.saveBrief(f.p,'p',{requestKey:'brief',brief:f.brief});assert.deepEqual(retry,f.d);
  const a=await f.studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'option',value:approach});
  const b=await f.studio.selectCampaignOption(f.p,'p',{draftId:a.id,expectedRevision:2,requestKey:'select',optionId:a.studio.options[0]!.id,optionRevision:1,variant:0});
  assert.equal(b.material.headline,approach.variants[0]!.headline);
  await assert.rejects(f.studio.saveStudioMaterial(f.p,'p',{draftId:b.id,expectedRevision:3,requestKey:'changed-outcome',step:'checks',material:{...b.material,purpose:'recruitment'}}),/change_desired_outcome_in_brief/);
  await assert.rejects(f.studio.saveStudioMaterial(f.p,'p',{draftId:b.id,expectedRevision:3,requestKey:'changed-provider',step:'checks',material:{...b.material,audience:{provider:'linkedin',locations:[],expansion:false}}}),/select_option_for_changed_provider/);
  const bytes=await sharp({create:{width:300,height:200,channels:3,background:'#117766'}}).png().toBuffer();
  const input={draftId:b.id,expectedRevision:3,requestKey:'import',rights:'I own this fixture artwork'};
  const asset=await f.studio.importRaster(f.p,'p',input,bytes);assert.equal(asset.kind,'image');assert.equal(asset.width,300);assert.equal(asset.rights.verified,false);
  assert.deepEqual(await f.studio.importRaster(f.p,'p',input,bytes),asset);
  const selected=await f.studio.selectStudioMedia(f.p,'p',{draftId:b.id,expectedRevision:3,requestKey:'media',assetIds:[asset.id]});
  const copy=await f.studio.copyToDraft(f.p,'p',{id:selected.id,kind:'draft',expectedRevision:4,requestKey:'copy'});
  assert.deepEqual(copy.studio.assetIds,[asset.id]);assert.notEqual(copy.studio.creativeSetId,selected.studio.creativeSetId);
  const before=(await f.studio.media(f.p,'p',asset.id)).bytes;
  await f.studio.setCampaignLifecycle(f.p,'p',{id:selected.id,kind:'draft',expectedRevision:4,requestKey:'archive',lifecycle:'archived'});
  await assert.rejects(f.studio.saveBrief(f.p,'p',{id:selected.id,expectedRevision:5,requestKey:'edit-archived',brief:f.brief}),/restore_draft/);
  await f.studio.setCampaignLifecycle(f.p,'p',{id:selected.id,kind:'draft',expectedRevision:5,requestKey:'trash',lifecycle:'trash'});
  assert.equal((await f.studio.listCampaigns(f.p,'p',{lifecycle:'trash'})).items.length,1);
  await f.studio.setCampaignLifecycle(f.p,'p',{id:selected.id,kind:'draft',expectedRevision:6,requestKey:'restore',lifecycle:'active'});
  assert.deepEqual((await f.studio.media(f.p,'p',asset.id)).bytes,before);
  assert.equal((await f.store.list('p','studioRevision')).length,8);
  await assert.rejects(f.studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'stale',value:approach}),/revision_conflict/);
  await assert.rejects(f.studio.saveBrief(f.p,'p',{requestKey:'brief',brief:{...f.brief,offer:'changed'}}),/request_key_payload_conflict/);
  const report=await f.studio.checkStudio(f.p,'p',{draftId:copy.id,expectedRevision:1});assert.equal(report.tracking.status,'missing_integration');assert.equal(report.providerApproval,'not_requested');
  assert.equal((await f.store.list('p','operation')).length,0);assert.equal((await f.store.list('p','job')).length,0);
  assert.equal(Number((await f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n),0);
 }finally{await f.store.close();}
});
test('changed brief invalidates selection; current roles, sessions and project are enforced on retries',async()=>{
 const f=await fixture();try{
  const d=await f.studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'o',value:approach});
  const edited=await f.studio.saveBrief(f.p,'p',{id:d.id,expectedRevision:2,requestKey:'b',brief:{...f.brief,offer:'New offer'}});
  await assert.rejects(f.studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:edited.revision,requestKey:'s',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0}),/option_stale/);
  await f.host.principal(f.session.token,'other');await assert.rejects(f.studio.studio(f.p,'other',{draftId:d.id}),/not_found/);
  await f.host.changeRole('analyst');await f.host.principal(f.session.token);
  await assert.rejects(f.studio.copyToDraft(f.p,'p',{id:d.id,kind:'draft',expectedRevision:edited.revision,requestKey:'copy'}),/forbidden/);
  await f.host.revoke(f.session.sessionRef);await assert.rejects(f.studio.studio(f.p,'p',{draftId:d.id}),/authentication|required|session/);
 }finally{await f.store.close();}
});
test('binary import rejects forged metadata, SVG, trailing payloads, animation and changed bytes',async()=>{
 const f=await fixture();try{
  const input={draftId:f.d.id,expectedRevision:1,requestKey:'a',rights:'Owned'};
  await assert.rejects(f.studio.importRaster(f.p,'p',input,Buffer.from('<svg/>')),/invalid_image/);
  const bytes=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
  await assert.rejects(f.studio.importRaster(f.p,'p',{...input,width:1} as typeof input,bytes),/unexpected_fields/);
  await assert.rejects(f.studio.importRaster(f.p,'p',input,Buffer.concat([bytes,Buffer.from('<script>')])) ,/trailing_raster_data/);
  const animated=await sharp(Buffer.concat([Buffer.alloc(10*10*3,0),Buffer.alloc(10*10*3,255)]),{raw:{width:10,height:20,channels:3,pageHeight:10}}).webp({loop:0,delay:[100,100]}).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages,2);
  await assert.rejects(f.studio.importRaster(f.p,'p',input,animated),/animated_import_unavailable/);
  const a=await f.studio.importRaster(f.p,'p',input,bytes);await f.store.db.prepare('UPDATE blobs SET bytes=? WHERE project_id=? AND digest=?').run(Buffer.from('changed'),'p',a.digest);
  await assert.rejects(f.studio.selectStudioMedia(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'select',assetIds:[a.id]}),/asset_bytes_missing_or_changed/);
 }finally{await f.store.close();}
});
async function authority(f:Awaited<ReturnType<typeof fixture>>,key='a'){
 const a:PlanningAuthority={id:key,revision:1,projectId:'p',actorId:f.p.userId,sessionDigest:digest(sessionBinding(f.p)),provider:'openai',model:'fixture-text',purpose:'campaign_planning',inputDigest:planningInputDigest(f.brief),maxInputTokens:20000,maxOutputTokens:4096,maxAttempts:1,maxCost:{value:'100',unit:'usd_ticks_1e10',currency:'USD'},quoteRef:'fixture-quote',expiresAt:new Date(Date.now()+3600000).toISOString(),revokedAt:null,custodyRef:'fixture-custody',billingCapabilityRef:'fixture-billing',evidence:'fixture'};
 await f.store.put('p','planningAuthority',a.id,a);return a;
}
test('structured planning: one dispatch, durable response identity/usage, explicit apply and stale input fence',async()=>{
 let submits=0;const port=new ResponsesPlanningAdapter('openai',async body=>{submits++;assert.equal(body.text.format.type,'json_schema');assert.equal(body.background,false);assert.equal(body.store,false);return {id:'response-1',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({options:[approach]})}]}],usage:{input_tokens:100,output_tokens:120}};});
 const f=await fixture(port);try{
  const a=await authority(f);const input={draftId:f.d.id,expectedRevision:1,requestKey:'plan',authorityId:a.id};
  const r=await f.studio.requestPlan(f.p,'p',input);assert.deepEqual(await f.studio.requestPlan(f.p,'p',input),r);
  const out=await f.studio.dispatchPlanning('p',r.id);assert.equal(out.state,'succeeded');assert.equal(out.providerResponseId,'response-1');assert.equal(out.usage.cost,null);
  await f.studio.dispatchPlanning('p',r.id);assert.equal(submits,1);assert.equal((await f.studio.studio(f.p,'p',{draftId:f.d.id})).draft.studio.selection,null);
  const applied=await f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'apply',requestId:r.id,optionIndex:0});assert.equal(applied.studio.options[0]!.provenance.kind,'planning');assert.equal(applied.studio.selection,null);
  await assert.rejects(f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:2,requestKey:'apply-again',requestId:r.id,optionIndex:0}),/planning_inputs_changed/);
 }finally{await f.store.close();}
});
for(const state of ['malformed','refused','partial','unknown','malformed_envelope'] as const)test(`planning ${state} retains brief and refuses automatic retry`,async()=>{
 let submits=0;const port=new ResponsesPlanningAdapter('openai',async()=>{submits++;if(state==='unknown')throw new Error('lost response');return {id:'response-bad',status:state==='partial'?'incomplete':'completed',output:state==='malformed_envelope'?[null,{content:[null]}]:[{content:[state==='refused'?{type:'refusal'}:{type:'output_text',text:'{"bad":true}'}]}],usage:{input_tokens:10,output_tokens:20}};});
 const f=await fixture(port);try{
  await authority(f);const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'plan',authorityId:'a'});
  const out=await f.studio.dispatchPlanning('p',r.id);assert.equal(out.state,state==='unknown'?'unknown':'failed');
  assert.deepEqual((await f.studio.studio(f.p,'p',{draftId:f.d.id})).draft.studio.brief,f.brief);
  await f.studio.dispatchPlanning('p',r.id);assert.equal(submits,1);
  if(state==='unknown'){await f.studio.reconcilePlanning(f.p,'p',{requestId:r.id});assert.equal(submits,1);await assert.rejects(f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'retry-new',authorityId:'a'}),/planning_pending/);}
  else {assert.equal(out.usage.inputTokens,10);assert.equal(out.providerResponseId,'response-bad');}
 }finally{await f.store.close();}
});
test('planning crash fence, changed session and revoked authority prevent dispatch or application',async()=>{
 let submits=0;const port:PlanningPort={evidence:'fixture',async submit(){submits++;throw new Error('no');}};
 const f=await fixture(port);try{const a=await authority(f);const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'plan',authorityId:a.id});
  await f.store.put('p','planningRequest',r.id,{...r,state:'running'});const restarted=new CampaignStudio(f.store,{sessions:f.host.authority,planning:port},'fixture');
  await restarted.dispatchPlanning('p',r.id);assert.equal(submits,0);
  const session=await f.host.login();const replacement=await f.host.principal(session.token);
  await assert.rejects(restarted.reconcilePlanning(replacement,'p',{requestId:r.id}),/authority_unavailable|session_authority_changed/);
  await f.store.put('p','planningAuthority',a.id,{...a,revokedAt:new Date().toISOString()});await assert.rejects(restarted.reconcilePlanning(f.p,'p',{requestId:r.id}),/authority_unavailable|session_authority_changed/);
 }finally{await f.store.close();}
});

test('draft-owned generation reserves exact current cost, retains bytes without selection, and fences duplicates',async()=>{
 const f=await fixture();try{
  const bytes=await sharp({create:{width:300,height:200,channels:3,background:'#222266'}}).png().toBuffer();let submits=0;
  const quote={receipt:'fixture-cost',currency:'USD',maxUnitMinor:7,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const generation:import('../server/index.js').DraftGenerationPort={version:2,evidence:'fixture',validate:()=>{},quote:async()=>quote,async submit(j,_g,retain,before){submits++;assert.equal('campaignId'in j,false);await before();await retain('media-response');return {state:'retained',requestId:'media-response',bytes,mime:'image/png'};},async reconcile(){throw new Error('never re-submit');}};
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation},'fixture');
  await f.store.put('p','generationGrant','image',{id:'image',projectId:'p',provider:'fixture',model:'fixture-image',kind:'image',maxJobs:3,usedJobs:0,maxSeconds:0,size:'300x200',expiresAt:quote.expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:21},billingCapabilityRef:'fixture-billing'});
  let d=await studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'option',value:approach});d=await studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:d.revision,requestKey:'select',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const input={draftId:d.id,expectedRevision:d.revision,requestKey:'gen',grantId:'image',prompt:'A studio building',rightsReceipt:'I own the concept',quoteReceipt:quote.receipt};
  const j=await studio.generateDraftMedia(f.p,'p',input);assert.equal((await f.store.list('p','campaign')).length,0);
  assert.deepEqual(await studio.generateDraftMedia(f.p,'p',input),j);assert.equal((await f.store.list('p','generationCostReservation')).length,1);
  await assert.rejects(studio.generateDraftMedia(f.p,'p',{...input,requestKey:'duplicate'}),/pending/);
  const out=await studio.dispatchDraftMedia('p',j.id);assert.equal(out.state,'retained');assert.ok(out.assetId);await studio.dispatchDraftMedia('p',j.id);assert.equal(submits,1);
  assert.deepEqual((await studio.studio(f.p,'p',{draftId:d.id})).draft.studio.assetIds,[]);
  await studio.selectStudioMedia(f.p,'p',{draftId:d.id,expectedRevision:d.revision,requestKey:'media',assetIds:[out.assetId!]});
  const retained=await studio.media(f.p,'p',out.assetId!);assert.deepEqual(retained.bytes,bytes);assert.equal(retained.asset.source,'fixture');
 }finally{await f.store.close();}
});

test('xAI Responses adapter preserves raw cost units and treats output beyond authority as failed evidence',async()=>{
 const port=new ResponsesPlanningAdapter('xai',async()=>({id:'xai-response',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({options:[approach]})}]}],usage:{input_tokens:100,output_tokens:5000,cost_in_usd_ticks:'12345678901234567890'}}));
 const f=await fixture(port);try{const a=await authority(f);await f.store.put('p','planningAuthority',a.id,{...a,provider:'xai'});const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,authorityId:a.id,requestKey:'xai'});const out=await f.studio.dispatchPlanning('p',r.id);assert.equal(out.state,'failed');assert.equal(out.usage.cost?.value,'12345678901234567890');assert.equal(out.usage.cost?.unit,'usd_ticks_1e10');assert.equal((await f.store.list('p','planningReservation')).length,1);}finally{await f.store.close();}
});

test('actual executor process loss retains response identity and reservation without another dispatch',async()=>{
 const f=await fixture();let reopened:Awaited<ReturnType<typeof testStore>>|undefined;
 try{
  const user=await f.store.createUser('crash-fixture','');await f.store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,'p','admin');
  const token=(await f.store.login('crash-fixture','','crash-fixture'))!;const p=await f.store.authenticate(token);
  const studio=new CampaignStudio(f.store,{},'fixture');const d=await studio.saveBrief(p,'p',{requestKey:'crash-brief',brief:f.brief});
  const port:PlanningPort={evidence:'fixture',async submit(){throw new Error('must not dispatch in parent');}};
  const service=new CampaignStudio(f.store,{planning:port},'fixture');await authority({...f,p,d});
  const r=await service.requestPlan(p,'p',{draftId:d.id,expectedRevision:1,requestKey:'crash-plan',authorityId:'a'});
  await f.store.close();
  const child=fork(new URL('./studio-crash-child.js',import.meta.url),[f.path,r.id],{stdio:['ignore','ignore','pipe','ipc']});let error='';child.stderr?.on('data',b=>error+=b.toString());const [code]=await once(child,'exit');assert.equal(code,23,error);
  reopened=await testStore(f.path);await reopened.db.acquireExecutor();let calls=0;const resumed=new CampaignStudio(reopened,{planning:{evidence:'fixture',async submit(){calls++;throw new Error('duplicate');}}},'fixture');
  const retained=await resumed.dispatchPlanning('p',r.id);assert.equal(retained.state,'running');assert.equal(retained.providerResponseId,'fixture-response-before-crash');assert.equal(calls,0);
  assert.equal((await reopened.list('p','planningReservation')).length,1);
  const unknown=await resumed.reconcilePlanning(await reopened.authenticate(token),'p',{requestId:r.id});assert.equal(unknown.state,'unknown');assert.equal(calls,0);
 }finally{if(reopened)await reopened.close();else await f.store.close();}
});

test('exact Google promotion is local only, report inputs are reproducible, and account changes stale checks',async()=>{
 const f=await fixture();try{
  const value={...approach,provider:'google' as const,format:'search_text' as const,variants:[{headline:'See the workshop',body:'Book a 30-minute tour.',cta:'Learn more'},{headline:'Meet the makers',body:'Visit our studio.',cta:'Visit'},{headline:'Explore our studio',body:'Arrange your tour.',cta:'Book'}]};
  let d=await f.studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'g-option',value});d=await f.studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'g-select',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const g:import('../core/index.js').Grant={id:'g',projectId:'p',revision:1,provider:'google',accountId:'123',label:'Fixture Search',currency:'USD',timezone:'UTC',permissions:['setup'],expiresAt:new Date(Date.now()+3600000).toISOString(),revokedAt:null,secretRef:'NEVER_EXPOSE'};await f.store.put('p','grant',g.id,g);
  const dest={url:f.brief.destination,digest:'a'.repeat(64),source:'fixture',observedAt:new Date().toISOString()};await f.store.put('p','destination',dest.digest,dest);
  d=await f.studio.saveStudioMaterial(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'g-material',step:'checks',material:{...d.material,destinationDigest:dest.digest,assetIds:[],audience:{provider:'google',locations:['geoTargetConstants/2840'],keywords:['workshop'],expansion:false},budget:{currency:'USD',minor:1000},timezone:'UTC',startAt:'2026-11-01T00:00:00Z',endAt:'2026-11-08T00:00:00Z'}});
  const report=await f.studio.checkStudio(f.p,'p',{draftId:d.id,expectedRevision:4,grantId:g.id});assert.equal(report.inputDigest,digest({revision:4,...report.inputs}));assert.ok(!JSON.stringify(report).includes('NEVER_EXPOSE'));
  const changed={...g,revision:2,accountId:'456'};await f.store.put('p','grant',g.id,changed);const newer=await f.studio.checkStudio(f.p,'p',{draftId:d.id,expectedRevision:4,grantId:g.id});assert.notEqual(newer.inputDigest,report.inputDigest);
  await assert.rejects(f.studio.promoteStudio(f.p,'p',{draftId:d.id,expectedRevision:4,grantId:g.id,expectedGrantRevision:1,requestKey:'stale-promotion'}),/grant_changed/);
  const input={draftId:d.id,expectedRevision:4,grantId:g.id,expectedGrantRevision:2,requestKey:'promote'};
  const campaign=await f.studio.promoteStudio(f.p,'p',input);assert.equal(campaign.state,'draft');assert.equal(campaign.receipt,null);assert.equal(campaign.draftOrigin?.revision,4);assert.notEqual(campaign.creativeSetId,d.studio.creativeSetId);assert.deepEqual(await f.studio.promoteStudio(f.p,'p',input),campaign);
  await f.store.put('p','campaign',campaign.id,{...campaign,state:'enabled'});await assert.rejects(f.studio.setCampaignLifecycle(f.p,'p',{id:campaign.id,kind:'campaign',expectedRevision:1,requestKey:'archive-enabled',lifecycle:'archived'}),/pause_and_reconcile/);
  assert.equal((await f.store.list('p','operation')).length,0);
  const deletion=await f.studio.reviewStudioDeletion(f.p,'p',{draftId:d.id,expectedRevision:4});assert.equal(deletion.eligible,false);assert.equal(deletion.retained.revisions,4);
 }finally{await f.store.close();}
});


test('draft video retains actual MP4 and duration but never passes current advertising format checks',async()=>{
 const f=await fixture();try{
  const bytes=readFileSync('marketing-sdk/tests/fixtures/test-pattern.mp4');const quote={receipt:'video-fixture',currency:'USD',maxUnitMinor:10,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const generation:import('../server/index.js').DraftGenerationPort={version:2,evidence:'fixture',validate:()=>{},quote:async()=>quote,async submit(_j,_g,retain,before){await before();await retain('video-response');return {state:'retained',requestId:'video-response',bytes,mime:'video/mp4'};},async reconcile(){return {state:'unknown',requestId:null};}};
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation},'fixture');
  await f.store.put('p','generationGrant','video',{id:'video',projectId:'p',provider:'fixture',model:'fixture-video',kind:'video',maxJobs:1,usedJobs:0,maxSeconds:15,size:'320x240',expiresAt:quote.expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:10},billingCapabilityRef:'fixture-only'});
  let d=await studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'video-option',value:approach});d=await studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'video-option-select',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const j=await studio.generateDraftMedia(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'video',grantId:'video',prompt:'A tour',rightsReceipt:'Owned fixture',quoteReceipt:quote.receipt});const out=await studio.dispatchDraftMedia('p',j.id);assert.equal(out.state,'retained');
  const media=await studio.media(f.p,'p',out.assetId!);assert.deepEqual(media.bytes,bytes);assert.ok(media.asset.seconds!>0);assert.equal(media.asset.kind,'video');
  d=await studio.selectStudioMedia(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'video-select',assetIds:[media.asset.id]});const report=await studio.checkStudio(f.p,'p',{draftId:d.id,expectedRevision:4});assert.equal(report.checks.find(c=>c.code==='format')!.state,'blocked');assert.equal((await f.store.list('p','operation')).length,0);
 }finally{await f.store.close();}
});


test('draft media unknown fence keeps reservation; session, grant, quote and project changes cannot dispatch',async()=>{
 const f=await fixture();try{
  let submits=0;let quote={receipt:'current-quote',currency:'USD',maxUnitMinor:7,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const generation:import('../server/index.js').DraftGenerationPort={version:2,evidence:'fixture',validate:()=>{},quote:async()=>quote,async submit(_j,_g,retain,before){await before();submits++;await retain('uncertain-media-response');throw new Error('lost ack');},async reconcile(){return {state:'unknown',requestId:'uncertain-media-response'};}};
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation},'fixture');const g:import('../core/index.js').GenerationGrant={id:'image',projectId:'p',provider:'fixture',model:'fixture-image',kind:'image',maxJobs:2,usedJobs:0,maxSeconds:0,size:'300x200',expiresAt:quote.expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:14},billingCapabilityRef:'fixture-only'};await f.store.put('p','generationGrant',g.id,g);
  let d=await studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'o',value:approach});d=await studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'s',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const input={draftId:d.id,expectedRevision:3,requestKey:'media',grantId:g.id,prompt:'A tour',rightsReceipt:'Owned',quoteReceipt:quote.receipt};const j=await studio.generateDraftMedia(f.p,'p',input);
  quote={...quote,receipt:'changed'};await assert.rejects(studio.dispatchDraftMedia('p',j.id),/generation_quote_changed/);assert.equal(submits,0);quote={...quote,receipt:'current-quote'};
  const out=await studio.dispatchDraftMedia('p',j.id);assert.equal(out.state,'unknown');assert.equal(out.providerRequestId,'uncertain-media-response');await studio.dispatchDraftMedia('p',j.id);await studio.reconcileDraftMedia(f.p,'p',{jobId:j.id});assert.equal(submits,1);
  await assert.rejects(studio.generateDraftMedia(f.p,'p',{...input,requestKey:'new-key'}),/generation_pending/);assert.equal((await f.store.list('p','generationCostReservation')).length,1);
  await assert.rejects(studio.reconcileDraftMedia(f.p,'other',{jobId:j.id}),/forbidden|not_found/);
  const other=await f.host.login();await assert.rejects(studio.reconcileDraftMedia(await f.host.principal(other.token),'p',{jobId:j.id}),/generation_grant_unavailable|session_authority_changed/);
  await f.store.put('p','generationGrant',g.id,{...g,usedJobs:1,revokedAt:new Date().toISOString()});await assert.rejects(studio.reconcileDraftMedia(f.p,'p',{jobId:j.id}),/generation_grant_unavailable|session_authority_changed/);assert.equal(submits,1);
 }finally{await f.store.close();}
});

for(const change of ['role','disabled','logout','expiry','project'] as const)test(`independent SQL ${change} during quote denies late Studio data and never holds the local lock`,async()=>{
 const f=await fixture(),side=await testStore(f.path);
 try{
  const expiresAt=new Date(Date.now()+3600000).toISOString();
  await f.store.put('p','generationGrant','image',{id:'image',projectId:'p',provider:'fixture',model:'fixture-image',kind:'image',maxJobs:1,usedJobs:0,maxSeconds:0,size:'300x200',expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:7},billingCapabilityRef:'fixture'});
  const generation:import('../server/index.js').DraftGenerationPort={version:2,evidence:'fixture',validate:()=>{},async quote(){
    if(change==='role')await side.db.prepare("UPDATE fixture_host_memberships SET role='analyst' WHERE subject='alice' AND project_id='p'").run();
    if(change==='disabled')await side.db.prepare("UPDATE fixture_host_users SET disabled=1 WHERE subject='alice'").run();
    if(change==='logout')await side.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(f.session.sessionRef);
    if(change==='expiry')await side.db.prepare('UPDATE fixture_host_sessions SET expires_at=0 WHERE id=?').run(f.session.sessionRef);
    if(change==='project')await side.db.prepare("UPDATE fixture_host_memberships SET project_id='removed' WHERE subject='alice' AND project_id='p'").run();
    return {receipt:'quote',currency:'USD',maxUnitMinor:7,expiresAt};
  },async submit(){throw new Error('must not submit');},async reconcile(){throw new Error('must not reconcile');}};
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation},'fixture');
  await assert.rejects(studio.studio(f.p,'p',{draftId:f.d.id}),/authentication_required|session_authority_changed/);
  assert.equal((await f.store.list('p','draftJob')).length,0);
 }finally{await side.close();await f.store.close();}
});

test('current host role denies mutation even without another HTTP authentication/membership refresh',async()=>{
 const f=await fixture();try{await f.host.changeRole('analyst');await assert.rejects(f.studio.saveBrief(f.p,'p',{id:f.d.id,expectedRevision:1,requestKey:'stale-mapping',brief:f.brief}),/forbidden/);assert.equal((await f.store.get<{revision:number}>('p','campaignDraft',f.d.id)).revision,1);}finally{await f.store.close();}
});

test('import orientation is normalized; session expiry during actual decode prevents retention',async t=>{
 const f=await fixture(),side=await testStore(f.path);try{
  const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const input={draftId:f.d.id,expectedRevision:1,requestKey:'oriented',rights:'Owned fixture'};
  const a=await f.studio.importRaster(f.p,'p',input,bytes);assert.equal(a.width,10);assert.equal(a.height,20);
  const original=sharp.prototype.toBuffer;
  t.mock.method(sharp.prototype,'toBuffer',async function(this:Sharp){await side.db.prepare('UPDATE fixture_host_sessions SET expires_at=0 WHERE id=?').run(f.session.sessionRef);return original.call(this);});
  await assert.rejects(f.studio.importRaster(f.p,'p',{...input,requestKey:'expired'},bytes),/authentication_required/);
  assert.equal((await f.store.list('p','studioAsset')).length,1);
 }finally{await side.close();await f.store.close();}
});

test('two planning options support explicit option two editing; late previous-revision output stays unusable',async()=>{
 let delay:()=>Promise<void>=async()=>{};
 const port=new ResponsesPlanningAdapter('openai',async()=>{await delay();return {id:'two-options',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({options:[approach,{...approach,title:'Second approach'}]})}]}],usage:{input_tokens:12,output_tokens:24}};});
 const f=await fixture(port);try{
  await authority(f);const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,authorityId:'a',requestKey:'two'});
  assert.equal((await f.studio.dispatchPlanning('p',r.id)).options.length,2);
  let d=await f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'keep-second',requestId:r.id,optionIndex:1});
  assert.equal(d.studio.selection,null);const o=d.studio.options[0]!;
  d=await f.studio.saveCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'edit-second',optionId:o.id,value:{...o.value,title:'My edited second approach'}});
  assert.deepEqual(d.studio.options[0]!.provenance,{kind:'planning',requestId:r.id,optionIndex:1,edited:true});
  d=await f.studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'select-second',optionId:o.id,optionRevision:2,variant:0});assert.equal(d.studio.selection?.optionId,o.id);
  await authority(f,'b');const late=await f.studio.requestPlan(f.p,'p',{draftId:d.id,expectedRevision:4,authorityId:'b',requestKey:'late'});
  delay=async()=>{await f.studio.saveBrief(f.p,'p',{id:d.id,expectedRevision:4,requestKey:'new-brief',brief:{...f.brief,offer:'New offer'}});};
  const out=await f.studio.dispatchPlanning('p',late.id);assert.equal(out.state,'failed');assert.match(out.reason!,/revision_conflict/);assert.equal(out.usage.outputTokens,24);assert.deepEqual(out.options,[]);
  await assert.rejects(f.studio.applyPlanningOption(f.p,'p',{draftId:d.id,expectedRevision:5,requestKey:'stale-apply',requestId:late.id,optionIndex:1}),/planning_inputs_changed/);
 }finally{await f.store.close();}
});

test('model-supplied authority fields fail domain validation while paid usage remains recorded',async()=>{
 const port=new ResponsesPlanningAdapter('openai',async()=>({id:'injected-authority',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({options:[{...approach,approved:true,accountId:'forged'}]})}]}],usage:{input_tokens:12,output_tokens:25}}));
 const f=await fixture(port);try{await authority(f);const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,authorityId:'a',requestKey:'injection'});const out=await f.studio.dispatchPlanning('p',r.id);assert.equal(out.state,'failed');assert.equal(out.usage.outputTokens,25);assert.equal(out.providerResponseId,'injected-authority');assert.deepEqual(out.options,[]);}finally{await f.store.close();}
});

for(const changed of ['draft','configuration','lease'] as const)test(`late generated media after changed ${changed} retains request and reservation without selectable partial asset`,async t=>{
 const f=await fixture();try{
  const bytes=readFileSync('marketing-sdk/tests/fixtures/test-pattern.png'),q={receipt:'fixture',currency:'USD',maxUnitMinor:7,expiresAt:new Date(Date.now()+3600000).toISOString()};
  await f.store.put('p','generationGrant','image',{id:'image',projectId:'p',provider:'fixture',model:'fixture-image',kind:'image',maxJobs:1,usedJobs:0,maxSeconds:0,size:'300x200',expiresAt:q.expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:7},billingCapabilityRef:'fixture'});
  let d=await f.studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'o',value:approach});d=await f.studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'s',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  let submissions=0;
  const generation:import('../server/index.js').DraftGenerationPort={version:2,evidence:'fixture',validate:()=>{},quote:async()=>q,async submit(_j,_g,retain,before){await before();submissions++;await retain('late-media');
    if(changed==='draft')await f.studio.saveBrief(f.p,'p',{id:d.id,expectedRevision:3,requestKey:'changed',brief:{...f.brief,offer:'Different offer'}});
    if(changed==='configuration')await f.host.changeConfiguration();
    if(changed==='lease')t.mock.method(f.store.db,'assertExecutionOwner',async()=>{throw new Error('executor_lock_lost');});
    return {state:'retained',requestId:'late-media',bytes,mime:'image/png'};
  },async reconcile(){return {state:'unknown',requestId:'late-media'};}};
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation},'fixture');const j=await studio.generateDraftMedia(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'g',grantId:'image',prompt:'Tour',rightsReceipt:'Owned',quoteReceipt:q.receipt});
  const out=await studio.dispatchDraftMedia('p',j.id);assert.equal(out.state,'unknown');assert.equal(out.providerRequestId,'late-media');assert.equal((await f.store.list('p','studioAsset')).length,0);assert.equal((await f.store.list('p','generationCostReservation')).length,1);assert.equal(submissions,1);
 }finally{await f.store.close();}
});

test('public Connections approved Meta account promotes exact retained media once across independent processes',async()=>{
 const {connectionFixture}=await import('./connection-fixture.js');const {fixtureSettings}=await import('./capability-fixtures.js');
 const f=await connectionFixture('meta',true);
 try{
  const connection=await f.call('resumeConnection',f.change(await f.approved()));assert.equal(connection.phase,'verified');
  const g=await f.store.get<import('../core/index.js').Grant>('p','grant',connection.grantId!);
  const call=<K extends keyof import('../core/index.js').StudioCommands>(command:K,input:import('../core/index.js').StudioCommands[K]['input'])=>f.server.call(f.principal,'p',command,input);
  let d=await call('saveBrief',{requestKey:'brief',brief:{...emptyBrief(),name:'Connections to Studio',offer:'Tour',audience:'Local visitors',destination:'https://example.test'}});
  d=await call('saveCampaignOption',{draftId:d.id,expectedRevision:1,requestKey:'option',value:approach});
  d=await call('selectCampaignOption',{draftId:d.id,expectedRevision:2,requestKey:'select',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const bytes=readFileSync('marketing-sdk/tests/fixtures/test-pattern.png');const a=await f.server.studio.importRaster(f.principal,'p',{draftId:d.id,expectedRevision:3,requestKey:'import',rights:'Owned fixture'},bytes);
  d=await call('selectStudioMedia',{draftId:d.id,expectedRevision:3,requestKey:'media',assetIds:[a.id]});
  const dest=digest('retained destination');await f.store.put('p','destination',dest,{url:'https://example.test',source:'public_https'});
  d=await call('saveStudioMaterial',{draftId:d.id,expectedRevision:4,requestKey:'material',step:'checks',material:{...d.material,destinationDigest:dest,settings:fixtureSettings('meta',g.accountId,g.pageId!),audience:{provider:'meta',locations:['US'],ageMin:25,ageMax:54,expansion:false},budget:{currency:g.currency,minor:1000},timezone:g.timezone,startAt:'2026-11-01T05:00:00Z',endAt:'2026-11-08T06:00:00Z'}});
  const input={draftId:d.id,expectedRevision:5,grantId:g.id,expectedGrantRevision:g.revision,requestKey:'promote'};
  await assert.rejects(call('promoteStudio',{...input,expectedRevision:4}),/revision_conflict/);
  const children=[0,1].map(()=>fork(new URL('./studio-promotion-child.js',import.meta.url),[f.path,JSON.stringify(f.principal),JSON.stringify(input)],{stdio:['ignore','ignore','pipe','ipc']}));
  const ready=children.map(c=>once(c,'message'));await Promise.all(ready);
  const outcomes=children.map(c=>once(c,'message'));const exits=children.map(c=>once(c,'exit'));children.forEach(c=>c.send('go'));
  const results=await Promise.all(outcomes);await Promise.all(exits);
  const first=results[0]![0] as {id?:string;error?:string},second=results[1]![0] as typeof first;
  assert.ok(first.id,first.error);assert.deepEqual(first,second);
  const c=await call('promoteStudio',input);assert.equal(c.id,first.id);assert.equal(c.state,'draft');assert.notEqual(c.creativeSetId,d.studio.creativeSetId);
  const aliases=await f.store.list<import('../core/index.js').Asset>('p','asset');assert.equal(aliases.length,1);assert.equal(aliases[0]!.digest,a.digest);assert.deepEqual(aliases[0]!.parentAssetIds,[a.id]);
  assert.deepEqual((await f.server.studio.media(f.principal,'p',a.id)).bytes,await sharp(bytes).rotate().png().toBuffer());
  await assert.rejects(call('promoteStudio',{...input,expectedGrantRevision:g.revision+1}),/request_key_payload_conflict/);
  const before=JSON.stringify(await f.store.list('p','operation'));await call('setCampaignLifecycle',{id:c.id,kind:'campaign',expectedRevision:1,requestKey:'archive',lifecycle:'archived'});
  assert.equal(JSON.stringify(await f.store.list('p','operation')),before);assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
  const copy=await call('copyToDraft',{id:c.id,kind:'campaign',expectedRevision:2,requestKey:'copy'});assert.equal(copy.grantId,null);assert.equal(copy.material.settings,undefined);assert.equal(copy.receipt,null);
  assert.ok(!f.calls.some(p=>/mutate|\/campaigns|\/ads$/.test(p)));
 }finally{await f.close();}
});

test('valid exact 10 MiB raster imports; one byte over and abandoned/invalid binary intents never retain partial assets',async()=>{
 const f=await fixture();try{
  const png=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
  const size=10*1024*1024,payload=Buffer.alloc(size-png.length-12),kind=Buffer.from('raNd');
  let crc=0xffffffff;for(const byte of Buffer.concat([kind,payload])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length);kind.copy(chunk,4);payload.copy(chunk,8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  const exact=Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]);assert.equal(exact.length,size);
  const input={draftId:f.d.id,expectedRevision:1,requestKey:'exact',rights:'Owned'};
  const a=await f.studio.importRaster(f.p,'p',input,exact);assert.equal(a.width,10);assert.equal(a.height,10);
  await assert.rejects(f.studio.importRaster(f.p,'p',{...input,requestKey:'over'},Buffer.concat([exact,Buffer.from([0])])),/raster_size_limit/);
  const {handleStudioMedia}=await import('../server/index.js');
  for(const intent of ['%','null'])await assert.rejects(handleStudioMedia(f.studio,f.p,'p',f.d.id,new Request('https://fixture.test',{method:'POST',headers:{'content-type':'application/octet-stream','x-studio-intent':intent},body:png})),/invalid_import_intent/);
  const aborted=new ReadableStream<Uint8Array>({start(c){c.enqueue(png.subarray(0,20));c.error(new Error('abandoned fixture upload'));}});
  await assert.rejects(handleStudioMedia(f.studio,f.p,'p',f.d.id,new Request('https://fixture.test',{method:'POST',headers:{'content-type':'application/octet-stream','x-studio-intent':encodeURIComponent(JSON.stringify({...input,requestKey:'abandoned'}))},body:aborted,duplex:'half'} as RequestInit)),/abandoned fixture upload/);
  assert.equal((await f.store.list('p','studioAsset')).length,1);assert.equal((await f.studio.studioImportStatus(f.p,'p',{requestKey:'abandoned'})).asset,null);
 }finally{await f.store.close();}
});

test('missing external session configuration and caller-supplied identity fail closed; legacy save cannot erase Studio',async()=>{
 const f=await fixture();try{
  const {MarketingServer}=await import('../server/index.js');
  await assert.rejects(new CampaignStudio(f.store).studio(f.p,'p',{draftId:f.d.id}),/invalid_session_binding/);
  await assert.rejects(f.studio.studio({userId:f.p.userId},'p',{draftId:f.d.id}),/host_session_authority_required/);
  await assert.rejects(MarketingServer.unconnected(f.store).call(f.p,'p','saveDraft',{id:f.d.id,expectedRevision:1,requestKey:'legacy',material:{name:'Overwrite'}}),/studio/);
  assert.deepEqual(await f.store.get('p','campaignDraft',f.d.id),f.d);
 }finally{await f.store.close();}
});

test('concurrent original-response reconciliation cannot overwrite a settled planning result',async()=>{
 let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>entered=r);let reads=0;
 const port:PlanningPort={evidence:'fixture',async submit(_r,_a,retain,before){await before();await retain('original');throw new Error('lost acknowledgement');},async reconcile(){const n=++reads;if(n===1)await arrived;if(n===2){entered();await wait;}return {state:'completed',providerResponseId:'original',output:{options:[{...approach,title:n===1?'Original stable result':'Late competing result'}]},usage:{inputTokens:10,outputTokens:20,cost:null,unavailableReason:'unknown'}};}};
 const f=await fixture(port);try{await authority(f);const r=await f.studio.requestPlan(f.p,'p',{draftId:f.d.id,expectedRevision:1,authorityId:'a',requestKey:'unknown'});await f.studio.dispatchPlanning('p',r.id);
  const first=f.studio.reconcilePlanning(f.p,'p',{requestId:r.id}),second=f.studio.reconcilePlanning(f.p,'p',{requestId:r.id});
  await arrived;const stable=await first;release();assert.deepEqual(await second,stable);assert.equal(stable.options[0]!.title,'Original stable result');
  assert.equal((await f.store.list('p','planningEvidence')).length,2);
 }finally{release();await f.store.close();}
});

test('real draft OpenAI transport and exact existing-reservation billing compose with synthetic HTTP only',async()=>{
 const f=await fixture();try{
  const {BoundGenerationBilling,createNativeDraftGeneration}=await import('../server/index.js');
  const bytes=readFileSync('marketing-sdk/tests/fixtures/test-pattern.png'),expiresAt=new Date(Date.now()+3600000).toISOString();
  const grant:import('../core/index.js').GenerationGrant={id:'native-image',projectId:'p',provider:'openai',model:'gpt-image-1',kind:'image',maxJobs:1,usedJobs:0,maxSeconds:0,size:'1024x1024',expiresAt,revokedAt:null,ceiling:{currency:'USD',minor:7},billingCapabilityRef:'existing-fixture-billing'};
  const path=f.path+'-billing.json';writeFileSync(path,JSON.stringify([{projectId:'p',grantId:grant.id,provider:'openai',model:grant.model,capabilityRef:grant.billingCapabilityRef,expiresAt,currency:'USD',maxUnitMinor:7,quoteReceipt:'exact-native-quote'}]));
  const billing=new BoundGenerationBilling(f.store,path);let requests=0,credentialChecks=0;
  const native=createNativeDraftGeneration(async()=> 'synthetic-key-never-live',{quote:g=>billing.quote(g),authorize:(g,j)=>billing.authorizeDraft(g,j)},async(url,init)=>{requests++;assert.equal(String(url),'https://api.openai.com/v1/images/generations');assert.equal(JSON.parse(String(init?.body)).model,grant.model);return Response.json({data:[{b64_json:bytes.toString('base64')}]},{headers:{'x-request-id':'native-image-response'}});},async()=>{credentialChecks++;});
  const studio=new CampaignStudio(f.store,{sessions:f.host.authority,generation:native},'fixture');await f.store.put('p','generationGrant',grant.id,grant);
  let d=await studio.saveCampaignOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'o',value:approach});d=await studio.selectCampaignOption(f.p,'p',{draftId:d.id,expectedRevision:2,requestKey:'s',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const job=await studio.generateDraftMedia(f.p,'p',{draftId:d.id,expectedRevision:3,requestKey:'native',grantId:grant.id,prompt:'A tour',rightsReceipt:'Owned fixture',quoteReceipt:'exact-native-quote'});
  assert.equal('campaignId' in job,false);const result=await studio.dispatchDraftMedia('p',job.id);assert.equal(result.state,'retained');assert.deepEqual((await studio.media(f.p,'p',result.assetId!)).bytes,bytes);assert.equal(requests,1);assert.equal(credentialChecks,1);assert.equal((await f.store.list('p','generationCostReservation')).length,1);
  await studio.dispatchDraftMedia('p',job.id);assert.equal(requests,1);
 }finally{await f.store.close();}
});

test('natural external-session expiry at the last local save await rolls back the entire revision',async t=>{
 const f=await fixture();try{
  const append=f.store.append.bind(f.store);t.mock.method(f.store,'append',async(...args:Parameters<typeof append>)=>{await append(...args);t.mock.timers.enable({apis:['Date'],now:Date.now()+7200000});});
  await assert.rejects(f.studio.saveBrief(f.p,'p',{id:f.d.id,expectedRevision:1,requestKey:'expire-before-commit',brief:{...f.brief,offer:'Must roll back'}}),/authentication_required|session_authority_changed/);
  assert.deepEqual(await f.store.get('p','campaignDraft',f.d.id),f.d);assert.equal((await f.store.list('p','studioRevision')).length,1);
 }finally{await f.store.close();}
});
