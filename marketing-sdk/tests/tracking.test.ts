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
    if(url.pathname==='/collector'||url.pathname==='/coverage') {
      const request=new Request(origin+'/collector',{method:'POST',headers:{'content-type':'application/json',...req.headers as Record<string,string>},body});
      const response=await handleTrackingCollector(service.tracking,request,url.pathname==='/coverage'?'coverage':'receipt');res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());return;
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
    const occurredAt=new Date(now-5000).toISOString();await f.service.event(f.p,'p',{id:'click',kind:'click',campaignId:campaign.id,personId:'person',occurredAt,consentReceipt:'consent',sourceReceipt:'paid-click',clickId:null,revenue:null});
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
