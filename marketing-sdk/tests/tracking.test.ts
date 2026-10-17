import {sessionBinding} from '../server/session-authority.js';
import { fixtureSettings } from './capability-fixtures.js';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MarketingServer, handleTrackingCollector, DomainError, digest, type CollectorCompletion, type ValidatedCoverage } from '../server/index.js';
import { emptyBrief, TRACKING_OUTCOMES, type TrackingOutcome, type Campaign, type FirstPartyEvent } from '../core/index.js';
import { testStore } from './datastore.js';
import { externalSessionFixture } from './external-session-fixture.js';
import { trackingFixture } from './tracking-fixture.js';

async function fixture() {
  const dir=mkdtempSync(resolve(process.env.MARKETING_TEST_ARTIFACTS??'artifacts','tracking-sql-')),store=await testStore(join(dir,'db'));
  for(const project of ['p','other'])await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project,'Tracking fixture');
  const host=await externalSessionFixture(store),login=await host.login(),p=await host.principal(login.token);
  let service:MarketingServer,source:Awaited<ReturnType<typeof trackingFixture>>,clock=Date.now(),origin='';
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url!,origin);let body='';for await(const b of req)body+=b;
    if(url.pathname==='/collector'||url.pathname==='/coverage'||url.pathname==='/click'||url.pathname==='/test-admission') {
      const request=new Request(origin+'/collector',{method:'POST',headers:{'content-type':'application/json',...req.headers as Record<string,string>},body});
      const response=await handleTrackingCollector(service.tracking,request,url.pathname==='/test-admission'?'test':url.pathname==='/coverage'?'coverage':url.pathname==='/click'?'click':'receipt');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    assert.equal(url.pathname,'/interact');const input=JSON.parse(body) as {testId:string;outcome:TrackingOutcome;receipt?:string;overrides?:Partial<CollectorCompletion>};
    const receipt=input.receipt??randomUUID();const fact:CollectorCompletion={sourceReceipt:receipt,eventId:'event-'+receipt,domain:'127.0.0.1',environment:'production',destinationId:'tour',outcome:input.outcome,occurredAt:new Date(clock).toISOString(),personId:'opaque-person',consent:{basis:'consent',receipt:'retained-consent'},completionReceipt:'completed-'+receipt,testId:input.testId,qa:true,clickId:null,revenue:input.outcome==='purchase'?{minor:2900,currency:'USD'}:null,refundTreatment:input.outcome==='purchase'?'gross_before_refunds':null,...input.overrides};
    await source.retainCompletion(fact);
    const response=await fetch(origin+'/collector',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({sourceReceipt:receipt,testId:input.testId})});res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
  }catch(e){res.writeHead(e instanceof DomainError?e.status:500,{'content-type':'application/json'});res.end(JSON.stringify({error:(e as Error).message}));}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  source=await trackingFixture(store,origin,()=>clock);
  // No model, credential or provider grant needed for the manual journey.
  service=MarketingServer.unconnected(store,{studio:{sessions:host.authority},tracking:source.options});
  const denied=()=>{throw new Error('provider forbidden');};
  service=new MarketingServer(store,{meta:{evidence:'fixture',verify:denied,plan:denied,prepare:denied,activate:denied,pause:denied,reconcile:denied,metrics:denied},google:service.providers.google,linkedin:service.providers.linkedin},service.generation,service.agent,'fixture',()=>clock,undefined,{studio:{sessions:host.authority},tracking:source.options});
  async function bind(outcome:TrackingOutcome='inquiry') {
    const draft=await service.call(p,'p','saveBrief',{requestKey:randomUUID(),brief:{...emptyBrief(),name:'Workshop',offer:'Tour',audience:'Customers',destination:source.source.destinations[0]!.url,outcome:TRACKING_OUTCOMES[outcome].purpose}});
    const owner={kind:'draft' as const,id:draft.id};
    const binding=await service.call(p,'p','bindTracking',{owner,expectedRevision:draft.revision,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome,refundTreatment:outcome==='purchase'?'gross_before_refunds':null,requestKey:randomUUID()});
    return {draft,owner,binding};
  }
  const collectorRequest=()=>new Request(origin+'/collector',{headers:{'x-fixture-collector':'synthetic-collector-only'}});
  return {store,host,login,p,source,origin,path:join(dir,'db'),get service(){return service;},bind,collectorRequest,
    restart(){service=new MarketingServer(store,service.providers,service.generation,service.agent,'fixture',()=>clock,undefined,{studio:{sessions:host.authority},tracking:source.options});},
    advance(ms:number){clock+=ms;},
    async interact(testId:string,outcome:TrackingOutcome,receipt?:string,overrides?:Partial<CollectorCompletion>){const response=await fetch(origin+'/interact',{method:'POST',body:JSON.stringify({testId,outcome,receipt,overrides})});return {status:response.status,body:await response.json()};},
    async close(){await new Promise<void>((r,e)=>server.close(err=>err?e(err):r()));await store.close();}};
}
for(const outcome of ['inquiry','purchase','mou','application'] as const)test(`actual HTTP ${outcome} no-send receipt, restart, duplicate and exact Studio readiness`,async()=>{
  const f=await fixture();try{
    const {owner,binding,draft}=await f.bind(outcome);assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'not_tested');
    const intent={owner,expectedBindingRevision:binding.revision,requestKey:'start'};
    const [a,b]=await Promise.all([f.service.call(f.p,'p','startTrackingTest',intent),f.service.call(f.p,'p','startTrackingTest',{...intent,requestKey:'second-tab'})]);assert.equal(a.id,b.id);
    f.restart();assert.equal((await f.service.call(f.p,'p','startTrackingTest',intent)).id,a.id);
    const receipt=await f.interact(a.id,outcome,'completion');assert.equal(receipt.status,200,JSON.stringify(receipt.body));
    f.restart();const retry=await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'completion',testId:a.id});assert.equal(retry.deduplicated,true);assert.equal(retry.eventRef,receipt.body.eventRef);
    const events=await f.store.list<FirstPartyEvent>('p','event');assert.equal(events.length,1);assert.equal(events[0]!.productionMetricsExcluded,true);assert.equal(events[0]!.kind,TRACKING_OUTCOMES[outcome].kind);
    const view=await f.service.call(f.p,'p','tracking',{owner});assert.equal(view.readiness,'passed');assert.equal(view.diagnostics[0]!.providerDelivery,'unavailable');assert.equal(view.diagnostics[0]!.attribution.campaignId,null);
    const handoff=(await f.service.call(f.p,'p','checkStudio',{draftId:draft.id,expectedRevision:draft.revision})).tracking;assert.equal(handoff.status,'passed');assert.equal(handoff.receipt?.eventRef,receipt.body.eventRef);assert.equal(handoff.receipt?.stages.providerAccepted.state,'unknown');
    assert.equal((await f.store.list('p','validatedCoverage')).length,0);assert.equal((await f.store.list('p','grant')).length,0);assert.equal((await f.store.list('p','operation')).length,0);
    f.advance(300001);assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'expired');
    const saved=await f.store.get<CollectorCompletion>('p','fixtureHostCompletion','completion');await f.source.retainCompletion({...saved,personId:'changed'});
    await assert.rejects(f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'completion',testId:a.id}),/source_event_payload_conflict/);
    await assert.rejects(f.service.event(f.p,'p',{...events[0]!,campaignId:undefined,test:false,productionMetricsExcluded:false}),/use_authenticated_tracking_collector/);
  }finally{await f.close();}
});
test('browser observations, timeout and cancellation retain late QA evidence without readiness',async()=>{
  for(const state of ['expired','cancelled'] as const){const f=await fixture();try{
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'test'});
    await f.service.call(f.p,'p','observeTrackingTest',{owner,testId:t.id});assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'pending');
    if(state==='expired')f.advance(300001);else await f.service.call(f.p,'p','cancelTrackingTest',{owner,testId:t.id});
    const received=await f.interact(t.id,'inquiry','late-completion');assert.equal(received.status,200);assert.equal(received.body.diagnostic.eligibleAtReceipt,false);
    const replay=await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'late-completion',testId:t.id});
    assert.equal(replay.deduplicated,true);assert.equal(replay.eventRef,received.body.eventRef);
    const events=await f.store.list<FirstPartyEvent>('p','event');assert.equal(events.length,1);
    assert.equal(events[0]!.test,true);assert.equal(events[0]!.productionMetricsExcluded,true);
    assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,state);
  }finally{await f.close();}}
});
test('forged trust fields, collector auth, purpose/domain/environment mismatches fail closed',async()=>{
  const f=await fixture();try{
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'t'});
    for(const overrides of [{domain:'evil.example'},{environment:'test' as const},{outcome:'mou' as const},{destinationId:'elsewhere'}])assert.ok((await f.interact(t.id,'inquiry',randomUUID(),overrides)).status>=400);
    for(const fields of [{qa:false},{verified:true},{consent:true},{complete:true},{projectId:'other'}])await assert.rejects(f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'r',testId:t.id,...fields}),/unexpected_fields/);
    await assert.rejects(f.service.tracking.acceptReceipt(new Request(f.origin),{sourceReceipt:'r',testId:t.id}),/collector_authentication_required/);
    await assert.rejects(f.service.call(f.p,'other','tracking',{owner}),/not_found|forbidden/);
    assert.equal((await f.store.list('p','event')).length,0);
    assert.equal((await f.interact(randomUUID(),'inquiry')).status,404);
    assert.equal((await f.store.list('p','event')).length,0);
    assert.equal((await f.interact(t.id,'inquiry','qa-cannot-be-cleared',{qa:false})).status,200);
    assert.equal((await f.store.list<FirstPartyEvent>('p','event'))[0]!.productionMetricsExcluded,true);
  }finally{await f.close();}
});
test('changed material, revoked human session, role and source retain history and invalidate readiness',async()=>{
  for(const change of ['material','session','role','source'] as const){const f=await fixture();try{
    const {owner,draft}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'t'});
    if(change==='material')await f.service.call(f.p,'p','saveBrief',{id:draft.id,expectedRevision:1,requestKey:'change',brief:{...draft.studio.brief,offer:'changed'}});
    if(change==='session')await f.host.revoke(f.login.sessionRef);
    if(change==='role')await f.host.changeRole('analyst');
    if(change==='source')await f.source.saveSource({...f.source.source,revision:'2'});
    assert.equal((await f.interact(t.id,'inquiry')).body.diagnostic.eligibleAtReceipt,false);
    const login=await f.host.login('bob'),p=await f.host.principal(login.token);assert.notEqual((await f.service.call(p,'p','tracking',{owner})).readiness,'passed');
    assert.equal((await f.store.list<FirstPartyEvent>('p','event'))[0]!.test,true);
  }finally{await f.close();}}
});
test('revocation while collector verifies remote facts and while source catalogue resolves rejects acceptance/configuration',async()=>{
  const f=await fixture();try{
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'t'});
    const verify=f.source.options.collector!.verifyCompletion;
    f.source.options.collector!.verifyCompletion=async(...args)=>{const fact=await verify(...args);await f.source.saveSource({...f.source.source,active:false,revision:'2'});return fact;};
    const response=await f.interact(t.id,'inquiry');assert.equal(response.status,401);assert.equal((await f.store.list('p','event')).length,0);
    await f.source.saveSource(f.source.source);const catalogue=f.source.options.sources!.catalogue;
    f.source.options.sources!.catalogue=async s=>{const sources=await catalogue(s);await f.host.changeRole('analyst');return sources;};
    await assert.rejects(f.service.call(f.p,'p','tracking',{owner}),/session_authority_changed/);
  }finally{await f.close();}
});
test('Results requires authenticated retained completeness; separate submissions, people, QA and provider totals',async()=>{
  const f=await fixture();try{
    await f.bind();const now=Date.now()-1000,from=new Date(now-86400000).toISOString(),until=new Date(now-1).toISOString();
    const campaign:Campaign={id:'campaign',projectId:'p',revision:1,grantId:'none',creativeSetId:'set',state:'draft',receipt:null,material:{name:'Results',purpose:'acquisition',headline:'Tour',body:'Visit',destination:f.source.source.destinations[0]!.url,destinationDigest:'fixture',assetIds:[],budget:{minor:10000,currency:'USD'},audience:{provider:'meta',locations:[],expansion:false},timezone:'UTC',startAt:from,endAt:until}};
    await f.store.put('p','campaign',campaign.id,campaign);
    const owner={kind:'campaign' as const,id:campaign.id};await f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry',refundTreatment:null,requestKey:'campaign-bind'});
    const window={campaignId:campaign.id,from,until};await f.store.put('p','firstPartyCoverage','untrusted',{from,until,purpose:'acquisition',complete:true,verified:true});
    assert.equal((await f.service.results(f.p,'p',window)).completedSubmissions?.value,null);
    const occurredAt=new Date(now-5000).toISOString();await f.source.retainCampaignClick({sourceReceipt:'paid-click',eventId:'click',campaignId:campaign.id,personId:'person',occurredAt});await f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:'paid-click'});
    for(let n=0;n<3;n++){
      const fact:CollectorCompletion={sourceReceipt:'submission-'+n,eventId:'form-'+n,domain:'127.0.0.1',environment:'production',destinationId:'tour',outcome:'inquiry',occurredAt:new Date(now-4000+n).toISOString(),personId:'person',consent:{basis:'consent',receipt:'consent'},completionReceipt:'verified-'+n,testId:null,qa:n===2,clickId:n===2?null:'click',revenue:null,refundTreatment:null};
      await f.source.retainCompletion(fact);await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:fact.sourceReceipt,testId:null});
    }
    await f.source.retainCheckpoint({id:'checkpoint',campaignId:campaign.id,from,until,purpose:'acquisition',sourceRevision:'1',provenance:'retained collector watermark including absence and QA exclusions',complete:true});
    const attested=await f.service.tracking.attestCoverage(f.collectorRequest(),{checkpoint:'checkpoint'});assert.equal(attested.sourceId,'site');
    assert.deepEqual(await f.service.tracking.attestCoverage(f.collectorRequest(),{checkpoint:'checkpoint'}),attested);
    await f.store.put('p','metrics','snapshot',{id:'snapshot',campaignId:campaign.id,projectId:'p',from,until,timezone:'UTC',currency:'USD',observedAt:new Date(now).toISOString(),source:'fixture',spendMinor:1000,impressions:1000,clicks:25,providerConversions:7});
    const result=await f.service.results(f.p,'p',window);assert.equal(result.completedSubmissions?.value,2);assert.equal(result.uniquePeople?.value,1);assert.equal(result.ctr.value,.025);assert.equal(result.providerConversions.value,null);assert.equal(result.providerConversions.reason,'meta_conversion_mapping_unqualified');assert.equal(result.coverage?.state,'validated');
    // Current source universe and producer authority matter even without an event
    // from a newly added source. History is retained, never silently upgraded.
    const originalUniverse=f.source.options.sources!.inspectUniverse!;
    f.source.options.sources!.inspectUniverse=async()=>[f.source.source,{...f.source.source,id:'second-site'}];
    assert.equal((await f.service.results(f.p,'p',window)).coverage?.state,'unknown');
    await assert.rejects(f.service.tracking.attestCoverage(f.collectorRequest(),{checkpoint:'checkpoint'}),/multi_source_completeness_unsupported/);
    f.source.options.sources!.inspectUniverse=originalUniverse;
    await f.source.saveSource({...f.source.source,revision:'2'});
    assert.equal((await f.service.results(f.p,'p',window)).coverage?.state,'unknown');
    await f.source.saveSource(f.source.source);
    const inspectCollector=f.source.options.collector!.inspectCollector!;
    f.source.options.collector!.inspectCollector=async()=>null;
    assert.equal((await f.service.results(f.p,'p',window)).coverage?.state,'unknown');
    f.source.options.collector!.inspectCollector=inspectCollector;
    assert.equal((await f.service.results(f.p,'p',window)).completedSubmissions?.value,2);
    const coverage=await f.store.list<ValidatedCoverage>('p','validatedCoverage');assert.equal(coverage.length,1);assert.equal(coverage[0]!.materialDigest,digest(campaign.material));
    const unavailable=await f.service.results(f.p,'p',{...window,until:new Date(now-2).toISOString()});assert.equal(unavailable.providerConversions.value,null);assert.equal(unavailable.providerConversions.reason,'meta_conversion_mapping_unqualified');
    await assert.rejects(f.service.call(f.p,'p','attestCoverage' as never,{checkpoint:'checkpoint'} as never),/unknown_command/);
    await f.service.event(f.p,'p',{id:'other-namespace',kind:'form_completed',personId:'person',occurredAt:new Date(now-3000).toISOString(),consentReceipt:'consent',sourceReceipt:'other-source-receipt',sourceId:'other-source',clickId:'click',revenue:null});
    assert.equal((await f.service.results(f.p,'p',window)).completedSubmissions?.value,null);
    await f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:1,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry',refundTreatment:null,requestKey:'replace-binding'});
    assert.equal((await f.service.results(f.p,'p',window)).completedSubmissions?.value,null);
    const settings=fixtureSettings('meta','act_fixture','page');assert.equal(settings.provider,'meta');if(settings.provider==='meta')settings.conversion={pixelId:'pixel',customConversionId:'conversion',event:'ApplicantRequestMOU'};
    await f.store.put('p','campaign',campaign.id,{...campaign,material:{...campaign.material,settings}});
    await assert.rejects(f.service.prepare(f.p,'p',{campaignId:campaign.id,requestKey:'prepare'}),/provider_event_delivery_unqualified/);
    await f.store.db.acquireExecutor();const queued={id:'queued',kind:'activate',state:'queued',campaignId:campaign.id};await f.store.put('p','operation','queued',queued);
    await f.store.put('p','advertisingBudgetReservation','held',{id:'held',state:'held'});
    await assert.rejects(f.service.dispatch('p','queued'),/provider_event_delivery_unqualified/);
    assert.deepEqual(await f.store.get('p','operation','queued'),queued);assert.deepEqual(await f.store.get('p','advertisingBudgetReservation','held'),{id:'held',state:'held'});

  }finally{await f.close();}
});

for(const action of ['role','logout'] as const)test(`independent process ${action} during catalogue lookup rejects stale status`,async()=>{
  const f=await fixture();let child:ReturnType<typeof fork>|undefined;try{
    const {owner}=await f.bind();child=fork(new URL('./session-race-child.js',import.meta.url),[f.path],{stdio:['ignore','ignore','inherit','ipc']});await once(child,'message');
    const catalogue=f.source.options.sources!.catalogue;
    f.source.options.sources!.catalogue=async s=>{const result=await catalogue(s);const exit=once(child!,'exit');child!.send({session:f.login.sessionRef,hold:false,action});await exit;return result;};
    await assert.rejects(f.service.call(f.p,'p','tracking',{owner}),/session_authority_changed|authentication_required/);
  }finally{if(child?.connected)child.kill();await f.close();}
});

test('HTTP receipt survives process loss before acknowledgement; retry keeps one event and original evidence',async()=>{
  const f=await fixture();let child:ReturnType<typeof fork>|undefined;try{
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'crash'});
    const fact:CollectorCompletion={sourceReceipt:'crash-receipt',eventId:'crash-event',domain:'127.0.0.1',environment:'production',destinationId:'tour',outcome:'inquiry',occurredAt:t.createdAt,personId:'opaque',consent:{basis:'consent',receipt:'retained'},completionReceipt:'actual-completion',testId:t.id,qa:true,clickId:null,revenue:null,refundTreatment:null};
    await f.source.retainCompletion(fact);
    child=fork(new URL('./tracking-crash-child.js',import.meta.url),[f.path,f.origin],{stdio:['ignore','ignore','inherit','ipc']});
    const [listening]=await once(child,'message');const exit=once(child,'exit');
    await assert.rejects(fetch(`http://127.0.0.1:${listening.port}/receipt`,{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({sourceReceipt:fact.sourceReceipt,testId:t.id})}));await exit;
    f.restart();const response=await fetch(f.origin+'/collector',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({sourceReceipt:fact.sourceReceipt,testId:t.id})});assert.equal(response.status,200);assert.equal((await response.json()).deduplicated,true);
    assert.equal((await f.store.list('p','event')).length,1);assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'passed');
  }finally{if(child?.connected)child.kill();await f.close();}
});

test('delayed completion verifier leaves independent SQL writes and revocation available',async()=>{
  const f=await fixture(), other=await testStore(f.path);let release!:()=>void;
  const wait=new Promise<void>(r=>{release=r;});let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
  try {
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'delay'});
    const verify=f.source.options.collector!.verifyCompletion;
    f.source.options.collector!.verifyCompletion=async(...args)=>{const fact=await verify(...args);entered();await wait;return fact;};
    const accepting=f.interact(t.id,'inquiry');await started;
    const otherHost=await externalSessionFixture(other,other,other,false);
    await Promise.race([Promise.all([other.put('other','unrelated','write',{id:'write'}),otherHost.revoke(f.login.sessionRef)]),new Promise((_,reject)=>setTimeout(()=>reject(new Error('external verifier held a write guard')),1500))]);
    release();const received=await accepting;assert.equal(received.status,200);assert.equal(received.body.diagnostic.eligibleAtReceipt,false);
    assert.equal((await f.store.list<FirstPartyEvent>('p','event'))[0]!.productionMetricsExcluded,true);
  } finally {release();await other.close();await f.close();}
});

for(const change of ['cancel','source','binding','expiry'] as const)test(`Studio handoff rechecks ${change} after Tracking resolution`,async()=>{
  const f=await fixture();try {
    const {owner,draft}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'handoff'});
    assert.equal((await f.interact(t.id,'inquiry')).status,200);
    const tracking=f.service.studio.options.tracking!;
    f.service.studio.options.tracking=async(...args)=>{
      const view=await tracking(...args);
      if(change==='cancel')await f.service.call(f.p,'p','cancelTrackingTest',{owner,testId:t.id});
      if(change==='source')await f.source.saveSource({...f.source.source,revision:'2'});
      if(change==='binding')await f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:1,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'purchase',refundTreatment:'gross_before_refunds',requestKey:'new'});
      if(change==='expiry')f.advance(300001);
      return view;
    };
    await assert.rejects(f.service.call(f.p,'p','checkStudio',{draftId:draft.id,expectedRevision:1}),/tracking_test_closed|source_changed|tracking_material_or_binding_changed/);
    assert.equal((await f.store.list('p','studioReport')).length,0);
    assert.equal((await f.store.list('p','trackingDiagnostic')).length,1);
  }finally{await f.close();}
});

async function reportFixture() {
  const f=await fixture();const from='2026-01-01T00:00:00.000Z',until='2026-01-03T00:00:00.000Z';
  const campaign:Campaign={id:'coverage-campaign',projectId:'p',revision:1,grantId:'none',creativeSetId:'set',state:'draft',receipt:null,material:{name:'Coverage',purpose:'acquisition',headline:'Tour',body:'Visit',destination:f.source.source.destinations[0]!.url,destinationDigest:'fixture',assetIds:[],budget:{minor:10000,currency:'USD'},audience:{provider:'linkedin',locations:[],expansion:false},timezone:'UTC',startAt:from,endAt:until}};
  await f.store.put('p','campaign',campaign.id,campaign);
  await f.service.call(f.p,'p','bindTracking',{owner:{kind:'campaign',id:campaign.id},expectedRevision:1,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry',refundTreatment:null,requestKey:'coverage-bind'});
  const checkpoint={id:'cp',campaignId:campaign.id,from,until,purpose:'acquisition' as const,sourceRevision:'1',provenance:'retained fixture complete-source checkpoint',complete:true as const};
  const attest=async(fact=checkpoint)=>{await f.source.retainCheckpoint(fact);return fetch(f.origin+'/coverage',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({checkpoint:fact.id})});};
  return {...f,campaign,checkpoint,attest,window:{campaignId:campaign.id,from,until}};
}
test('HTTP coverage distinguishes exact checkpoints, gaps, overlaps, partial capability and legacy evidence',async()=>{
  const f=await reportFixture();try {
    const first=await f.attest({...f.checkpoint,until:'2026-01-02T00:00:00.000Z'});assert.equal(first.status,200);
    const accepted=await first.json();
    assert.deepEqual(await (await f.attest({...f.checkpoint,until:'2026-01-02T00:00:00.000Z'})).json(),accepted);
    assert.equal((await f.attest({...f.checkpoint,until:'2026-01-02T00:00:00.001Z'})).status,409);
    assert.equal((await f.attest({...f.checkpoint,id:'gap',from:'2026-01-02T00:00:00.001Z'})).status,200);
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'unknown');
    assert.equal((await f.attest({...f.checkpoint,id:'overlap',from:'2026-01-01T23:59:59.999Z'})).status,200);
    // This implementation deliberately does not union partial windows.
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'unknown');
    assert.equal((await f.attest({...f.checkpoint,id:'whole'})).status,200);
    assert.equal((await f.service.results(f.p,'p',f.window)).completedSubmissions?.value,0);
    await f.source.saveSource({...f.source.source,outcomes:['inquiry']});
    assert.equal((await f.attest({...f.checkpoint,id:'partial'})).status,409);
    await f.source.saveSource(f.source.source);
    const universe=f.source.options.sources!.inspectUniverse;delete f.source.options.sources!.inspectUniverse;
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'unknown');
    assert.equal((await f.attest({...f.checkpoint,id:'unsupported'})).status,409);
    f.source.options.sources!.inspectUniverse=universe;
    assert.equal((await f.store.list('p','validatedCoverage')).length,4);
  } finally {await f.close();}
});
test('delayed coverage and result producer verification permit independent revocation, then reject stale authority',async()=>{
  const f=await reportFixture(), other=await testStore(f.path);try {
    const verify=f.source.options.collector!.verifyCheckpoint;
    f.source.options.collector!.verifyCheckpoint=async(...args)=>{const fact=await verify(...args);await other.put('p','fixtureHostSource','site',{...f.source.source,active:false,revision:'2'});return fact;};
    const rejected=await f.attest();assert.equal(rejected.status,401,await rejected.text());assert.equal((await f.store.list('p','validatedCoverage')).length,0);
    await f.source.saveSource(f.source.source);f.source.options.collector!.verifyCheckpoint=verify;assert.equal((await f.attest()).status,200);
    const otherHost=await externalSessionFixture(other,other,other,false),inspect=f.source.options.collector!.inspectCollector!;
    f.source.options.collector!.inspectCollector=async id=>{const c=await inspect(id);await otherHost.disable();return c;};
    await assert.rejects(f.service.results(f.p,'p',f.window),/authentication_required|session_authority_changed/);
    assert.equal((await f.store.list('p','validatedCoverage')).length,1);
  } finally {await other.close();await f.close();}
});
test('per-source permission change after catalogue resolution cannot bind; defaults cannot establish tracking',async()=>{
  const f=await fixture();try {
    const {owner}=await f.bind();const catalogue=f.source.options.sources!.catalogue;
    f.source.options.sources!.catalogue=async s=>{const rows=await catalogue(s);f.source.options.sources!.inspectAccess=async()=>false;return rows;};
    await assert.rejects(f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:1,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry',refundTreatment:null,requestKey:'denied'}),/tracking_source_not_authorized/);
    const unconfigured=MarketingServer.unconnected(f.store,{studio:{sessions:f.host.authority}});
    await assert.rejects(unconfigured.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'fake',testId:null}),/authenticated_collector_unavailable/);
    await assert.rejects(unconfigured.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'no-host'}),/tracking_source_integration_required|tracking_source_changed/);
  } finally {await f.close();}
});
test('copy, trash and restore retain media identity and historic evidence without copying test authority',async()=>{
  const f=await fixture();try {
    const {owner,draft}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'lifecycle'});assert.equal((await f.interact(t.id,'inquiry')).status,200);
    const copied=await f.service.call(f.p,'p','copyToDraft',{kind:'draft',id:draft.id,expectedRevision:1,requestKey:'copy'});
    assert.notEqual(copied.studio.creativeSetId,draft.studio.creativeSetId);assert.equal((await f.service.call(f.p,'p','tracking',{owner:{kind:'draft',id:copied.id}})).binding,null);
    await f.service.call(f.p,'p','setCampaignLifecycle',{kind:'draft',id:draft.id,expectedRevision:1,lifecycle:'trash',requestKey:'trash'});
    await f.service.call(f.p,'p','setCampaignLifecycle',{kind:'draft',id:draft.id,expectedRevision:2,lifecycle:'active',requestKey:'restore'});
    const restored=await f.service.call(f.p,'p','tracking',{owner});assert.equal(restored.readiness,'stale');assert.equal(restored.diagnostics.length,1);
    assert.equal((await f.service.call(f.p,'p','studio',{draftId:draft.id})).draft.studio.creativeSetId,draft.studio.creativeSetId);
  } finally {await f.close();}
});

test('completion-only producer cannot attest coverage, and independent collector revocation wins verification races',async()=>{
  const f=await reportFixture(),other=await testStore(f.path);try {
    await f.source.saveProducer({...f.source.producer,permissions:['completion']});
    assert.equal((await f.attest()).status,403);
    await f.source.saveProducer(f.source.producer);
    const verify=f.source.options.collector!.verifyCheckpoint;
    f.source.options.collector!.verifyCheckpoint=async(...args)=>{const fact=await verify(...args);await other.put('p','fixtureHostCollector',f.source.producer.id,{...f.source.producer,active:false,revision:'2'});return fact;};
    const rejected=await f.attest();assert.equal(rejected.status,401,await rejected.text());assert.equal((await f.store.list('p','validatedCoverage')).length,0);
    await f.source.saveProducer(f.source.producer);
    for(const extra of [{complete:true},{projectId:'other'},{verified:true}]){
      const response=await fetch(f.origin+'/coverage',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({checkpoint:'cp',...extra})});assert.equal(response.status,422);
    }
  } finally {await other.close();await f.close();}
});

test('external users, host configuration and expiration cannot inherit original session test authority',async()=>{
  for(const change of ['other-user','configuration','expiry','disable'] as const){const f=await fixture();try {
    const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'original'});assert.equal((await f.interact(t.id,'inquiry')).status,200);
    const bob=await f.host.login('bob'),p=await f.host.principal(bob.token);
    assert.equal((await f.service.call(p,'p','tracking',{owner})).readiness,'stale');
    if(change==='configuration')await f.host.changeConfiguration();
    if(change==='expiry')await f.store.db.prepare('UPDATE fixture_host_sessions SET expires_at=? WHERE id=?').run(Date.now()-1,f.login.sessionRef);
    if(change==='disable')await f.host.disable();
    if(change==='other-user')await assert.rejects(f.service.call(p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'bob'}),/test_in_progress_in_another_session/);
    else if(change==='configuration')assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'stale');
    else await assert.rejects(f.service.call(f.p,'p','tracking',{owner}),/authentication_required/);
    assert.equal((await f.store.list('p','trackingDiagnostic')).length,1);
  }finally{await f.close();}}
});


test('Studio handoff and Results do not recursively acquire the external host session guard',async()=>{
  const f=await reportFixture();try {
    assert.equal((await f.attest()).status,200);
    const {owner,draft}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'non-reentrant'});assert.equal((await f.interact(t.id,'inquiry')).status,200);
    const guard=f.host.authority.withLiveSessions;let held=false;
    f.host.authority.withLiveSessions=async(expected,local)=>{
      assert.equal(held,false,'Host lock acquired recursively');held=true;
      try{return await guard(expected,local);}finally{held=false;}
    };
    assert.equal((await f.service.call(f.p,'p','checkStudio',{draftId:draft.id,expectedRevision:1})).tracking.status,'passed');
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'validated');
  }finally{await f.close();}
});


test('a fresh authenticated checkpoint recovers completeness after collector rotation without rewriting history',async()=>{
  const f=await reportFixture();try {
    assert.equal((await f.attest()).status,200);const history=await f.store.list<ValidatedCoverage>('p','validatedCoverage');
    await f.source.saveProducer({...f.source.producer,revision:'2'});
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'unknown');
    assert.equal((await f.attest()).status,409); // Original checkpoint is immutable.
    assert.equal((await f.attest({...f.checkpoint,id:'rotated-checkpoint'})).status,200);
    assert.equal((await f.service.results(f.p,'p',f.window)).coverage?.state,'validated');
    assert.deepEqual((await f.store.list<ValidatedCoverage>('p','validatedCoverage')).slice(0,1),history);
  } finally {await f.close();}
});

test('declared destination scopes retain exact campaign URLs without creating tests or coverage',async()=>{
 const f=await fixture();try{
  const origin=f.origin.replace('http:','https:');
  const source={...f.source.source,revision:'2',destinationScopes:[{origin,pathPrefix:'/owned'}]};
  await f.source.saveSource(source);
  const raw=origin+'/owned/landing?utm_campaign=original&value=a%2Bb&utm_source=linkedin#form';
  const draft=await f.service.call(f.p,'p','saveBrief',{requestKey:randomUUID(),brief:{...emptyBrief(),name:'Original destination',offer:'Tour',audience:'Customers',destination:raw}});
  const owner={kind:'draft' as const,id:draft.id};
  const view=await f.service.call(f.p,'p','tracking',{owner});
  const destination=view.destinations.find(d=>d.sourceId===source.id&&d.url===raw)!;
  assert.ok(destination);assert.equal(destination.testUrl,null);assert.equal(destination.url,raw);
  assert.deepEqual(view.sources[0],source,'source identity and its complete registered catalogue remain canonical');
  const intent={owner,expectedRevision:draft.revision,expectedBindingRevision:0,sourceId:source.id,sourceRevision:source.revision,destinationId:destination.id,outcome:'inquiry' as const,refundTreatment:null,requestKey:randomUUID()};
  const binding=await f.service.call(f.p,'p','bindTracking',intent);assert.equal(binding.destination,raw);
  f.restart();assert.deepEqual(await f.service.call(f.p,'p','bindTracking',intent),binding);
  assert.equal((await f.service.call(f.p,'p','tracking',{owner})).destinations.find(d=>d.url===raw)?.id,destination.id);
  assert.deepEqual(await f.store.get('p','campaignDraft',draft.id),draft,'binding does not rewrite material or attribution parameters');
  await assert.rejects(f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:randomUUID()}),/no_send_test_destination_required/);
  f.advance(1000);
  const fact:CollectorCompletion={sourceReceipt:'scoped-receipt',eventId:'scoped-event',domain:source.domain,environment:'production',destinationId:destination.id,destinationUrl:raw,outcome:'inquiry',occurredAt:new Date().toISOString(),personId:'opaque',consent:{basis:'consent',receipt:'retained-consent'},completionReceipt:'retained-completion',testId:null,qa:true,clickId:null,revenue:null,refundTreatment:null};
  await f.source.retainCompletion(fact);
  const received=await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:fact.sourceReceipt,testId:null});assert.equal(received.diagnostic,null);
  assert.equal((await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:fact.sourceReceipt,testId:null})).deduplicated,true);
  for(const changed of [{destinationUrl:undefined},{destinationUrl:origin+'/outside'},{destinationUrl:raw+'&different'}]){
   const receipt={...fact,...changed,sourceReceipt:randomUUID()};
   await f.source.retainCompletion(receipt);
   await assert.rejects(f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:receipt.sourceReceipt,testId:null}),/collector_scope_mismatch/);
  }
  assert.equal((await f.store.list('p','trackingTest')).length,0);assert.equal((await f.store.list('p','validatedCoverage')).length,0);
  assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'not_tested');
  await f.source.saveSource({...source,revision:'3',destinationScopes:[]});
  assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'stale');
 }finally{await f.close();}
});

test('destination scopes reject off-origin paths, prefix confusion, encoded separators and malformed declarations',async()=>{
 const f=await fixture();try{
  const origin=f.origin.replace('http:','https:'),source={...f.source.source,revision:'2',destinationScopes:[{origin,pathPrefix:'/owned'}]};
  await f.source.saveSource(source);
  await assert.rejects(f.service.call(f.p,'p','saveBrief',{requestKey:randomUUID(),brief:{...emptyBrief(),name:'HTTP rejected',offer:'Tour',audience:'Customers',destination:f.origin+'/owned'}}),/https_destination_required/);
  for(const raw of [origin+'/ownedness',origin+'/owned/../outside',origin+'/owned/%2e%2e/outside',origin+'/owned/%2f..%2foutside',origin+'/owned/%5c..%5coutside',origin.replace('127.0.0.1','example.invalid')+'/owned']){
   const draft=await f.service.call(f.p,'p','saveBrief',{requestKey:randomUUID(),brief:{...emptyBrief(),name:'Scope rejection',offer:'Tour',audience:'Customers',destination:raw}});
   const owner={kind:'draft' as const,id:draft.id},view=await f.service.call(f.p,'p','tracking',{owner});
   assert.ok(!view.destinations.some(d=>d.url===raw));
   await assert.rejects(f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:0,sourceId:source.id,sourceRevision:source.revision,destinationId:'destination_'+digest([source.id,raw]),outcome:'inquiry',refundTreatment:null,requestKey:randomUUID()}),/tracking_destination_mismatch/);
  }
  await f.source.saveSource(f.source.source);
  const {owner}=await f.bind();
  for(const scope of [{origin:'not a URL',pathPrefix:'/owned'},{origin:'https://unowned.example',pathPrefix:'/owned'},{origin,pathPrefix:'//unowned.example'},{origin,pathPrefix:'/owned/../outside'},{origin,pathPrefix:'/owned?query=1'}]){
   await f.source.saveSource({...f.source.source,destinationScopes:[scope]});
   await assert.rejects(f.service.call(f.p,'p','tracking',{owner}),/invalid_tracking_destination_scope/);
  }
 }finally{await f.close();}
});

async function clickCampaign(f:Awaited<ReturnType<typeof fixture>>) {
  const campaign:Campaign={id:'click-campaign',projectId:'p',revision:1,grantId:'none',creativeSetId:'set',state:'paused',receipt:null,
    material:{name:'Click attribution',purpose:'acquisition',headline:'Tour',body:'Visit',destination:f.source.source.destinations[0]!.url,
      destinationDigest:'fixture',assetIds:[],budget:{minor:10000,currency:'USD'},audience:{provider:'meta',locations:[],expansion:false},
      timezone:'UTC',startAt:new Date(Date.now()-86400000).toISOString(),endAt:null}};
  await f.store.put('p','campaign',campaign.id,campaign);return campaign;
}

test('authenticated click HTTP receipts join inquiry and qualification without granting coverage or provider effects',async()=>{
  const f=await fixture();try {
    const campaign=await clickCampaign(f),at=new Date(Date.now()-1000).toISOString();
    const click=await f.source.retainCampaignClick({sourceReceipt:'paid-click',eventId:'tracked-click',campaignId:campaign.id,personId:'same-person',occurredAt:at});
    const response=await fetch(f.origin+'/click',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({sourceReceipt:click.sourceReceipt})});
    assert.equal(response.status,200);const accepted=await response.json();assert.equal(accepted.deduplicated,false);
    f.restart();assert.deepEqual(await f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:click.sourceReceipt}),{eventRef:accepted.eventRef,deduplicated:true});
    for(const outcome of ['inquiry','qualified'] as const){
      await f.source.retainCompletion({sourceReceipt:outcome,eventId:'event-'+outcome,domain:'127.0.0.1',environment:'production',destinationId:'tour',
        outcome,occurredAt:new Date(Date.now()-500).toISOString(),personId:'same-person',consent:{basis:'consent',receipt:'fixture-consent'},
        completionReceipt:'retained-'+outcome,testId:null,qa:false,clickId:accepted.eventRef,revenue:null,refundTreatment:null});
      const result=await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:outcome,testId:null});
      const event=await f.store.get<FirstPartyEvent>('p','event',result.eventRef);assert.equal(event.campaignId,campaign.id);
      assert.equal(event.kind,TRACKING_OUTCOMES[outcome].kind);assert.equal(event.sourceId,'site');
    }
    assert.equal((await f.store.list('p','trackingClickReceipt')).length,1);
    assert.equal((await f.store.list('p','validatedCoverage')).length,0);
    assert.equal((await f.store.list('p','operation')).length,0);
    // A legitimate accepted receipt survives a later material revision without
    // pretending that newly arriving old material is still current.
    await f.store.put('p','campaign',campaign.id,{...campaign,revision:2,material:{...campaign.material,headline:'Changed'}});
    assert.equal((await f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:click.sourceReceipt})).deduplicated,true);
    await f.source.retainClick({...click,sourceReceipt:'late-click',eventId:'late-click'});
    await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:'late-click'}),/click_campaign_identity_mismatch/);
    await f.source.retainClick({...click,personId:'changed'});
    await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:click.sourceReceipt}),/source_event_payload_conflict/);
  }finally{await f.close();}
});

test('click receipt admission rejects caller attribution, wrong identity, absent permissions and changed source facts',async()=>{
  const f=await fixture();try {
    const campaign=await clickCampaign(f);
    const fact=await f.source.retainCampaignClick({sourceReceipt:'click-proof',eventId:'click-proof',campaignId:campaign.id,personId:'person',occurredAt:new Date(Date.now()-1000).toISOString()});
    const input={sourceReceipt:fact.sourceReceipt};
    for(const fields of [{campaignId:campaign.id},{qa:false},{personId:'forged'},{consent:true},{projectId:'other'}])
      await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),{...input,...fields}),/unexpected_fields/);
    await assert.rejects(f.service.tracking.acceptClick(new Request(f.origin),input),/collector_authentication_required/);
    await f.source.saveProducer({...f.source.producer,permissions:['completion','coverage']});
    await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),input),/collector_permission_required/);
    await f.source.saveProducer(f.source.producer);
    for(const patch of [{domain:'unowned.example'},{environment:'test' as const},{destinationId:'other'},
      {campaignRevision:2},{materialDigest:'changed'},{purpose:'recruitment' as const},{consent:{basis:'consent' as const,receipt:''}},
      {occurredAt:new Date(Date.now()+86400000).toISOString()}]) {
      await f.source.retainClick({...fact,...patch});await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),input));
    }
    await f.source.retainClick(fact);
    const verify=f.source.options.collector!.verifyClick!;
    f.source.options.collector!.verifyClick=async(...args)=>{const read=await verify(...args);await f.source.retainClick({...read,personId:'changed-during-verification'});return read;};
    await assert.rejects(f.service.tracking.acceptClick(f.collectorRequest(),input),/click_evidence_changed/);
    assert.equal((await f.store.list('p','event')).length,0);
    assert.equal((await f.store.list('p','trackingClickReceipt')).length,0);
  }finally{await f.close();}
});

test('completion attribution rejects generic-event clicks and keeps QA clicks outside business outcomes',async()=>{
  const f=await fixture();try {
    const campaign=await clickCampaign(f),occurredAt=new Date(Date.now()-1000).toISOString();
    await f.service.event(f.p,'p',{id:'unverified',kind:'click',campaignId:campaign.id,personId:'person',occurredAt,consentReceipt:'legacy',sourceReceipt:'legacy-click',clickId:null,revenue:null});
    const completion:CollectorCompletion={sourceReceipt:'submission',eventId:'submission',domain:'127.0.0.1',environment:'production',destinationId:'tour',outcome:'inquiry',
      occurredAt:new Date(Date.now()-500).toISOString(),personId:'person',consent:{basis:'consent',receipt:'consent'},completionReceipt:'retained',testId:null,qa:false,clickId:'unverified',revenue:null,refundTreatment:null};
    await f.source.retainCompletion(completion);
    await assert.rejects(f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'submission',testId:null}),/authenticated_click_receipt_required/);
    const click=await f.source.retainCampaignClick({sourceReceipt:'qa-click',eventId:'qa-click',campaignId:campaign.id,personId:'person',occurredAt,qa:true});
    await f.service.tracking.acceptClick(f.collectorRequest(),{sourceReceipt:click.sourceReceipt});
    assert.equal((await f.store.get<FirstPartyEvent>('p','event',click.eventId)).productionMetricsExcluded,true);
    await f.source.retainCompletion({...completion,clickId:click.eventId});
    await assert.rejects(f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'submission',testId:null}),/attribution_identity_mismatch/);
    assert.equal((await f.store.list('p','trackingReceipt')).length,0);
  }finally{await f.close();}
});


test('authenticated source resolves an exact no-send test across restart without creating evidence or exposing setup session',async()=>{
  const f=await fixture();try{
    const {owner,binding}=await f.bind();
    const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:binding.revision,requestKey:'admission'});
    f.restart();
    const response=await fetch(f.origin+'/test-admission',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':'synthetic-collector-only'},body:JSON.stringify({testId:t.id,interactionUrl:t.destinationUrl})});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    const value=await response.json();
    assert.deepEqual(value,{testId:t.id,sourceId:'site',sourceRevision:'1',domain:'127.0.0.1',environment:'production',bindingId:binding.id,bindingRevision:binding.revision,owner,ownerRevision:binding.ownerRevision,materialDigest:binding.materialDigest,destinationId:binding.destinationId,destinationUrl:binding.destination,interactionUrl:t.destinationUrl,purpose:binding.purpose,outcome:binding.outcome,createdAt:t.createdAt,expiresAt:t.expiresAt,productionMetricsExcluded:true});
    assert.equal(JSON.stringify(value).includes(f.login.sessionRef),false);
    assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'pending');
    for(const kind of ['event','trackingReceipt','trackingDiagnostic','validatedCoverage','operation','grant'])assert.equal((await f.store.list('p',kind)).length,0,kind);
    const repeat=await f.service.tracking.inspectTest(f.collectorRequest(),{testId:t.id,interactionUrl:t.destinationUrl});assert.deepEqual(repeat,value);
  }finally{await f.close();}
});
test('no-send admission rejects browser assertions, wrong destination, unrelated source and missing permission',async()=>{
  const f=await fixture();try{
    const {owner}=await f.bind(),t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'admission'});
    const input={testId:t.id,interactionUrl:t.destinationUrl};
    await assert.rejects(f.service.tracking.inspectTest(new Request(f.origin),input),/collector_authentication_required/);
    for(const extra of [{outcome:'qualified'},{campaignId:'forged'},{productionMetricsExcluded:false}])await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),{...input,...extra}),/unexpected_fields/);
    await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),{...input,interactionUrl:t.destinationUrl+'&campaign=other'}),/tracking_test_destination_mismatch/);
    await f.source.saveProducer({...f.source.producer,permissions:['completion']});
    await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),input),/collector_permission_required/);
    await f.source.saveProducer(f.source.producer);
    const testGuard=f.source.options.collector!.withLiveTestAuthority;delete f.source.options.collector!.withLiveTestAuthority;
    await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),input),/collector_test_authority_unavailable/);
    f.source.options.collector!.withLiveTestAuthority=testGuard;
    await f.source.saveSource({...f.source.source,id:'other-source'});
    await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),input),/tracking_source_changed|source_changed|source_denied/);
    assert.equal((await f.store.list('p','event')).length,0);
  }finally{await f.close();}
});
test('no-send admission rechecks cancellation, expiry, binding/material, source and original setup authority',async()=>{
  for(const state of ['cancel','expire','material','binding','source','session','role'] as const){
    const f=await fixture();try{
      const {owner,draft}=await f.bind(),t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'admission'});
      if(state==='cancel')await f.service.call(f.p,'p','cancelTrackingTest',{owner,testId:t.id});
      if(state==='expire')f.advance(300001);
      if(state==='material')await f.service.call(f.p,'p','saveBrief',{id:draft.id,expectedRevision:1,requestKey:'change',brief:{...draft.studio.brief,offer:'changed'}});
      if(state==='binding')await f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:1,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'qualified',refundTreatment:null,requestKey:'rebind'});
      if(state==='source')await f.source.saveSource({...f.source.source,revision:'2'});
      if(state==='session')await f.host.revoke(f.login.sessionRef);
      if(state==='role')await f.host.changeRole('analyst');
      await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),{testId:t.id,interactionUrl:t.destinationUrl}));
      assert.equal((await f.store.list('p','event')).length,0,state);
    }finally{await f.close();}
  }
});
test('no-send admission holds source/collector revocation guards and fails on authority changes during verification',async()=>{
  const f=await fixture();try{
    const {owner}=await f.bind(),t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'admission'});
    const inspect=f.source.options.sources!.inspectAccess;
    f.source.options.sources!.inspectAccess=async(...args)=>{await f.source.saveProducer({...f.source.producer,active:false});return inspect(...args);};
    await assert.rejects(f.service.tracking.inspectTest(f.collectorRequest(),{testId:t.id,interactionUrl:t.destinationUrl}),/collector_revoked/);
    assert.equal((await f.store.list('p','event')).length,0);
  }finally{await f.close();}
});


test('host-declared scoped no-send URLs preserve campaign bytes and include exact authenticated source selection',async()=>{
 const f=await fixture();try{
  const origin=f.origin.replace('http:','https:');
  const source={...f.source.source,revision:'2',destinationScopes:[{origin,pathPrefix:'/owned',testQuery:{handrail_capture_mode:'synthetic_no_send'}}]};
  await f.source.saveSource(source);
  const raw=origin+'/owned/form?utm_campaign=space%20here&x=~&x=%2f#form';
  const draft=await f.service.call(f.p,'p','saveBrief',{requestKey:'scoped-test',brief:{...emptyBrief(),name:'Scoped test',offer:'Offer',audience:'Customers',destination:raw,outcome:'acquisition'}});
  const owner={kind:'draft' as const,id:draft.id},view=await f.service.call(f.p,'p','tracking',{owner});
  const destination=view.destinations.find(d=>d.url===raw)!;assert.ok(destination.testUrl);
  assert.equal(destination.testUrl,raw.replace('#form','&handrail_capture_mode=synthetic_no_send#form'));
  const binding=await f.service.call(f.p,'p','bindTracking',{owner,expectedRevision:1,expectedBindingRevision:0,sourceId:source.id,sourceRevision:source.revision,destinationId:destination.id,outcome:'inquiry',refundTreatment:null,requestKey:'bind-scoped-test'});
  const test=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:binding.revision,requestKey:'start-scoped-test'});
  assert.ok(test.destinationUrl.startsWith(raw.split('#')[0]+'&handrail_capture_mode=synthetic_no_send&'));
  assert.equal(new URL(test.destinationUrl).searchParams.get('marketing_source'),source.id);
  const inspected=await f.service.tracking.inspectTest(f.collectorRequest(),{testId:test.id,interactionUrl:test.destinationUrl});
  assert.equal(inspected.destinationUrl,raw);assert.equal(inspected.sourceId,source.id);
  assert.equal((await f.store.list('p','event')).length,0);
  await f.source.saveSource({...source,revision:'3',destinationScopes:[{origin,pathPrefix:'/owned'}]});
  const changed=await f.service.call(f.p,'p','tracking',{owner});assert.equal(changed.destinations.find(d=>d.url===raw)!.testUrl,null);assert.equal(changed.readiness,'stale');
 }finally{await f.close();}
});
test('scoped no-send query declarations cannot replace reserved SDK identity or ambiguous ownership',async()=>{
 const f=await fixture();try{
  const origin=f.origin.replace('http:','https:'),{owner}=await f.bind();
  for(const testQuery of [{marketing_test:'forged'},{}] as Record<string,string>[]){
   await f.source.saveSource({...f.source.source,destinationScopes:[{origin,pathPrefix:'/',testQuery}]});
   await assert.rejects(f.service.call(f.p,'p','tracking',{owner}),/tracking_test_query/);
  }
  const raw=origin+'/owned/ambiguous';
  const draft=await f.service.call(f.p,'p','saveBrief',{requestKey:'ambiguous-test',brief:{...emptyBrief(),name:'Ambiguous',offer:'Offer',audience:'Customers',destination:raw,outcome:'acquisition'}});
  await f.source.saveSource({...f.source.source,destinationScopes:[{origin,pathPrefix:'/',testQuery:{mode:'no-send'}},{origin,pathPrefix:'/owned',testQuery:{mode:'other'}}]});
  const view=await f.service.call(f.p,'p','tracking',{owner:{kind:'draft',id:draft.id}});
  assert.equal(view.destinations.find(d=>d.url===raw)!.testUrl,null);
 }finally{await f.close();}
});


test('source-retained admission digest binds the original test snapshot and preserves late QA evidence',async()=>{
 const f=await fixture();try{
  const {owner}=await f.bind();const t=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'retained-admission'});
  const admission=await f.service.tracking.inspectTest(f.collectorRequest(),{testId:t.id,interactionUrl:t.destinationUrl});
  const changed=await f.interact(t.id,'inquiry','changed-admission',{testAdmissionDigest:digest({...admission,outcome:'qualified'})});
  assert.equal(changed.status,422);assert.equal(changed.body.error,'tracking_admission_mismatch');
  assert.equal((await f.store.list('p','event')).length,0);
  f.advance(300001);
  const accepted=await f.interact(t.id,'inquiry','late-attested',{testAdmissionDigest:digest(admission)});
  assert.equal(accepted.status,200);assert.equal(accepted.body.diagnostic.eligibleAtReceipt,false);
  assert.equal((await f.service.call(f.p,'p','tracking',{owner})).readiness,'expired');
  f.restart();const repeated=await f.service.tracking.acceptReceipt(f.collectorRequest(),{sourceReceipt:'late-attested',testId:t.id});assert.equal(repeated.deduplicated,true);
  const events=await f.store.list<FirstPartyEvent>('p','event');assert.equal(events.length,1);assert.equal(events[0]!.productionMetricsExcluded,true);
 }finally{await f.close();}
});


test('material tracking carry-forward preserves history, requires host authority and cannot edit configuration',async()=>{
  const f=await fixture();try{
    const campaign:Campaign={id:'budget-tracking',projectId:'p',revision:1,grantId:'none',creativeSetId:'set',state:'paused',
      receipt:{ids:{campaignId:'existing-provider'},payloadDigest:'original',intent:'paused',delivery:'unverified',providerRequestId:null,observedAt:new Date().toISOString(),evidence:'fixture'},
      material:{name:'Budget fixture',purpose:'acquisition',headline:'Tour',body:'Visit',destination:f.source.source.destinations[0]!.url,destinationDigest:'fixture',assetIds:[],
        budget:{minor:10000,currency:'USD'},advertisingBudget:{daily:{minor:100,currency:'USD'},lifetime:{minor:10000,currency:'USD'}},audience:{provider:'meta',locations:[],expansion:false},timezone:'UTC',startAt:new Date().toISOString(),endAt:null}};
    await f.store.put('p','campaign',campaign.id,campaign);await f.store.put('p','campaignVersion',campaign.id+':1',campaign);
    const owner={kind:'campaign' as const,id:campaign.id};
    const setup={owner,expectedRevision:1,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry' as const,refundTreatment:null,requestKey:'original'};
    const binding=await f.service.call(f.p,'p','bindTracking',setup);
    const testReceipt=await f.service.call(f.p,'p','startTrackingTest',{owner,expectedBindingRevision:1,requestKey:'before-budget'});
    await f.interact(testReceipt.id,'inquiry','original-qa');
    const events=await f.store.list('p','event'),tests=await f.store.list('p','trackingTest');
    const inspect=f.host.host.inspect;f.host.host.inspect=async(...args)=>{const result=await inspect(...args);return result&&args[0].subject==='bob'?{...result,kind:'agent'}:result;};
    const agentLogin=await f.host.login('bob'),agent=await f.host.principal(agentLogin.token);
    let authorized=true,revokeAfter=false;
    const check=async()=>{if(!authorized)throw new Error('budget_authority_revoked');};
    const base=f.service;
    const service=new MarketingServer(f.store,base.providers,base.generation,base.agent,'fixture',undefined,undefined,{studio:{sessions:f.host.authority},tracking:f.source.options,
      executionAuthority:{assertCurrent:check,withCurrent:async(_p,c,a,local)=>{assert.equal(c.id,campaign.id);assert.equal(a,'prepare');await check();const result=await local();if(revokeAfter)throw new Error('budget_authority_revoked');await check();return result;}}});
    await assert.rejects(service.call(agent,'p','bindTracking',{...setup,expectedBindingRevision:1,requestKey:'agent-edit'}),/forbidden/);
    const changed=structuredClone(campaign);changed.preparedMaterial=structuredClone(campaign.material);changed.revision=2;changed.state='draft';changed.material.advertisingBudget!.daily!.minor=110;
    const input={campaignId:campaign.id,previousRevision:1,expectedRevision:2,expectedBindingRevision:1,requestKey:'budget-only'};
    await f.store.put('p','campaign',campaign.id,changed);
    await assert.rejects(base.rebindCampaignMaterialTracking(agent,'p',input),/host_execution_authority_required/);
    for(const field of ['purpose','destination','currency','account','receipt','grant','enabled'] as const){
      const bad=structuredClone(changed);
      if(field==='purpose')bad.material.purpose='recruitment';
      if(field==='enabled')bad.state='enabled';
      if(field==='destination')bad.material.destination+='?changed=1';
      if(field==='currency')bad.material.advertisingBudget!.daily!.currency='EUR';
      if(field==='account')bad.material.settings={provider:'meta',accountId:'other'} as NonNullable<Campaign['material']['settings']>;
      if(field==='receipt')bad.receipt!.ids.campaignId='different-provider';
      if(field==='grant')bad.grantId='other-account';
      await f.store.put('p','campaign',campaign.id,bad);
      await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/tracking_/);
      assert.deepEqual(await f.store.get('p','trackingBinding',binding.id),binding);
    }
    await f.store.put('p','campaign',campaign.id,changed);
    authorized=false;await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/budget_authority_revoked/);authorized=true;
    revokeAfter=true;await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/budget_authority_revoked/);revokeAfter=false;
    assert.deepEqual(await f.store.get('p','trackingBinding',binding.id),binding);
    const access=f.source.options.sources!.inspectAccess;f.source.options.sources!.inspectAccess=async()=>false;
    await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/tracking_source_not_authorized/);f.source.options.sources!.inspectAccess=access;
    // Studio versions precede provider preparation. Their material is durable,
    // but the later successful operation owns the prepared provider receipt.
    await f.store.put('p','campaignVersion',campaign.id+':1',{...campaign,state:'draft',receipt:null});
    await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/tracking_material_revision_mismatch/);
    await f.store.put('p','operation','original-preparation',{id:'original-preparation',projectId:'p',campaignId:campaign.id,
      kind:'prepare',campaignRevision:1,state:'succeeded',receipt:campaign.receipt});
    const updated=await service.rebindCampaignMaterialTracking(agent,'p',input);
    assert.equal(updated.revision,2);assert.equal(updated.ownerRevision,2);assert.equal(updated.materialDigest,digest(changed.material));
    assert.deepEqual({...updated,revision:binding.revision,ownerRevision:binding.ownerRevision,materialDigest:binding.materialDigest,createdAt:binding.createdAt},binding);
    assert.deepEqual(await f.store.get('p','trackingBindingHistory',binding.id+':1'),binding);
    assert.deepEqual(await f.store.list('p','event'),events);assert.deepEqual(await f.store.list('p','trackingTest'),tests);
    assert.notEqual((await service.call(agent,'p','tracking',{owner})).readiness,'passed');
    assert.deepEqual(await service.rebindCampaignMaterialTracking(agent,'p',input),updated);
    const actorSession=await f.host.authority.inspectSession(sessionBinding(agent),'p');
    const originalRequest=await f.store.get<{result:unknown}>('p','trackingRequest',digest([actorSession.binding,'rebindCampaignBudget',input.requestKey]));
    assert.deepEqual(originalRequest.result,updated,'Persisted budget request identities survive the API generalization');
    await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',{...input,expectedRevision:1}),/invalid_material_tracking_revision/);
    authorized=false;await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',input),/budget_authority_revoked/);authorized=true;
    // Multiple local revisions retain the same provider hierarchy. Carrying
    // configuration to targeting/creative/budget material never copies tests.
    await f.store.put('p','campaignVersion',campaign.id+':2',changed);
    const revised=structuredClone(changed);revised.revision=4;
    revised.material.headline='Different offer';revised.material.audience.locations=['US'];
    revised.material.advertisingBudget!.lifetime!.minor=20000;
    await f.store.put('p','campaign',campaign.id,revised);
    const next={...input,previousRevision:2,expectedRevision:4,expectedBindingRevision:2,requestKey:'material-revision'};
    await f.store.put('p','operation','pending-edit',{id:'pending-edit',projectId:'p',campaignId:campaign.id,state:'unknown'});
    await assert.rejects(service.rebindCampaignMaterialTracking(agent,'p',next),/tracking_execution_pending/);
    await f.store.put('p','operation','pending-edit',{id:'pending-edit',projectId:'p',campaignId:campaign.id,state:'failed'});
    const rebound=await service.rebindCampaignMaterialTracking(agent,'p',next);
    assert.equal(rebound.ownerRevision,4);assert.equal(rebound.revision,3);assert.equal(rebound.materialDigest,digest(revised.material));
    assert.deepEqual(rebound.source,binding.source);assert.equal(rebound.outcome,binding.outcome);
    assert.equal(rebound.destination,binding.destination);assert.deepEqual(rebound.providerMapping,binding.providerMapping);
    assert.deepEqual(await f.store.list('p','trackingTest'),tests);
    assert.notEqual((await service.call(agent,'p','tracking',{owner})).readiness,'passed');
    assert.deepEqual(await service.rebindCampaignMaterialTracking(agent,'p',next),rebound);
  }finally{await f.close();}
});
