import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyBrief, type Grant, type TrackingBinding, type Commands } from '../core/index.js';
import { MarketingServer, CampaignStudio, FixtureProvider, NativeProvider, handleCampaignMedia, byteDigest, digest } from '../server/index.js';
import { connectionFixture } from './connection-fixture.js';
import { fixtureSettings } from './capability-fixtures.js';
import { trackingFixture } from './tracking-fixture.js';
import { testStore } from './datastore.js';

async function fixture() {
  const f=await connectionFixture('meta',true);
  const c=await f.call('resumeConnection',f.change(await f.approved()));
  const g=await f.store.get<Grant>('p','grant',c.grantId!);
  const source=await trackingFixture(f.store,'http://127.0.0.1:12345');
  const provider=new FixtureProvider(f.store);
  const server=new MarketingServer(f.store,{meta:provider,google:provider,linkedin:provider},f.server.generation,f.server.agent,'fixture',undefined,undefined,{tracking:source.options});
  const call=<K extends keyof Commands>(command:K,input:Commands[K]['input'])=>server.call(f.principal,'p',command,input);
  const destination=source.source.destinations[0]!.url;
  let d=await call('saveBrief',{requestKey:'brief',brief:{...emptyBrief(),name:'Same campaign journey',offer:'Tour',destination}});
  d=await call('saveCampaignOption',{draftId:d.id,expectedRevision:d.revision,requestKey:'option',value:{title:'Tour',audienceHypothesis:'Visitors',offer:'Tour',rationale:'Invitation',unknowns:[],provider:'meta',format:'single_image',destination,variants:[{headline:'Visit',body:'Tour the workshop',cta:'Learn more'}]}});
  d=await call('selectCampaignOption',{draftId:d.id,expectedRevision:d.revision,requestKey:'select',optionId:d.studio.options[0]!.id,optionRevision:1,variant:0});
  const asset=await server.studio.importRaster(f.principal,'p',{draftId:d.id,expectedRevision:d.revision,requestKey:'import',rights:'Owned synthetic artwork'},readFileSync('marketing-sdk/tests/fixtures/test-pattern.png'));
  d=await call('selectStudioMedia',{draftId:d.id,expectedRevision:d.revision,requestKey:'media',assetIds:[asset.id]});
  const captured=await call('captureDestination',{url:destination});
  d=await call('saveStudioMaterial',{draftId:d.id,expectedRevision:d.revision,requestKey:'material',step:'tracking',material:{...d.material,destinationDigest:captured.digest,settings:fixtureSettings('meta',g.accountId,g.pageId!),audience:{provider:'meta',locations:['US'],ageMin:25,ageMax:54,expansion:false},budget:{currency:g.currency,minor:1000},timezone:g.timezone,startAt:'2026-11-01T05:00:00Z',endAt:'2026-11-08T06:00:00Z'}});
  const owner={kind:'draft' as const,id:d.id};
  const binding=await call('bindTracking',{owner,expectedRevision:d.revision,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry',refundTreatment:null,requestKey:'bind'});
  const input={draftId:d.id,expectedRevision:d.revision,grantId:g.id,expectedGrantRevision:g.revision,requestKey:'promote'};
  return {...f,server,call,d,asset,source,binding,owner,input};
}

test('exact promotion atomically retains Tracking configuration and media lineage without copying test authority',async()=>{
  const f=await fixture();try{
    const qa=await f.call('startTrackingTest',{owner:f.owner,expectedBindingRevision:1,requestKey:'qa'});
    const children=[f.input,{...f.input,requestKey:'another-click'}].map(input=>fork(new URL('./journey-promotion-child.js',import.meta.url),[f.path,JSON.stringify(f.principal),JSON.stringify(input)],{stdio:['ignore','ignore','inherit','ipc']}));
    await Promise.all(children.map(c=>once(c,'message')));
    const outcomes=children.map(c=>once(c,'message')),exits=children.map(c=>once(c,'exit'));children.forEach(c=>c.send('go'));
    const [first,second]=await Promise.all(outcomes);assert.deepEqual((await Promise.all(exits)).map(e=>e[0]),[0,0]);
    assert.ok(first![0].id,first![0].error);assert.deepEqual(first,second);
    const a=await f.call('promoteStudio',f.input);assert.equal(a.id,first![0].id);assert.equal((await f.store.list('p','campaign')).length,1);
    const view=await f.call('tracking',{owner:{kind:'campaign',id:a.id}});
    assert.equal(view.binding?.outcome,'inquiry');assert.equal(view.binding?.materialDigest,digest(a.material));
    assert.deepEqual(view.binding?.promotedFrom,{owner:f.owner,bindingId:f.binding.id,bindingRevision:1,ownerRevision:f.d.revision});
    assert.equal(view.readiness,'not_tested');assert.deepEqual(view.tests,[]);assert.deepEqual(view.diagnostics,[]);
    assert.equal((await f.call('tracking',{owner:f.owner})).tests[0]?.id,qa.id);
    const response=await handleCampaignMedia(f.server.studio,f.principal,'p',a.material.assetIds[0]!,new Request('http://localhost/assets'));
    assert.equal(response.status,200);const media=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(media,(await f.server.studio.media(f.principal,'p',f.asset.id)).bytes);
    const range=await handleCampaignMedia(f.server.studio,f.principal,'p',a.material.assetIds[0]!,new Request('http://localhost/assets',{headers:{range:'bytes=0-9'}}));
    assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),media.subarray(0,10));
    for(const spec of ['bytes=999999999-','bytes=10-9','bytes=-0','bytes=-','bytes=0-1,3-4','bytes=0-9007199254740992']) {
      const invalid=await handleCampaignMedia(f.server.studio,f.principal,'p',a.material.assetIds[0]!,new Request('http://localhost/assets',{headers:{range:spec}}));
      assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),`bytes */${media.length}`);assert.equal(invalid.headers.get('cache-control'),'private, no-store');
    }
    for(const [spec,start,end] of [['bytes=-10',media.length-10,media.length],['bytes=10-',10,media.length],['bytes=0-999999999',0,media.length]] as const){
      const ranged=await handleCampaignMedia(f.server.studio,f.principal,'p',a.material.assetIds[0]!,new Request('http://localhost/assets',{headers:{range:spec}}));
      assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-type'),'image/png');assert.equal(ranged.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),media.subarray(start,end));
    }
    await assert.rejects(handleCampaignMedia(f.server.studio,f.principal,'other',a.material.assetIds[0]!,new Request('http://localhost/assets')),/authentication_required|forbidden|not_found/);

    assert.equal((await f.store.list('p','validatedCoverage')).length,0);
    const aliases=await f.store.list<{parentAssetIds:string[];digest:string}>('p','asset');assert.deepEqual(aliases[0]?.parentAssetIds,[f.asset.id]);assert.equal(aliases[0]?.digest,f.asset.digest);
    // Simulates committed promotion with lost acknowledgement, then another edit.
    await f.call('saveBrief',{id:f.d.id,expectedRevision:f.d.revision,requestKey:'later',brief:{...f.d.studio.brief,offer:'A changed offer'}});
    await f.source.saveSource({...f.source.source,active:false,revision:'2'});
    const restarted=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,{tracking:f.source.options});
    assert.equal((await restarted.call(f.principal,'p','promoteStudio',f.input)).id,a.id);
    assert.equal((await f.store.list<TrackingBinding>('p','trackingBinding')).length,2);
    assert.equal((await f.store.list('p','operation')).length,0);
  }finally{await f.close();}
});

for(const change of ['draft','source','permission'] as const)test(`promotion rejects independent ${change} change while resolving Tracking`,async()=>{
  const f=await fixture(),other=await testStore(f.path);
  let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
  const catalogue=f.source.options.sources!.catalogue;
  f.source.options.sources!.catalogue=async s=>{const result=await catalogue(s);entered();await held;return result;};
  try{
    const pending=f.call('promoteStudio',f.input);await ready;
    if(change==='draft')await new CampaignStudio(other,{},'fixture').saveBrief(f.principal,'p',{id:f.d.id,expectedRevision:f.d.revision,requestKey:'independent-change',brief:{...f.d.studio.brief,offer:'Changed while promotion waits'}});
    else if(change==='source')await other.put('p','fixtureHostSource','site',{...f.source.source,revision:'2'});
    else await other.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND project_id=?').run('analyst',f.principal.userId,'p');
    release();await assert.rejects(pending,/tracking_material_or_binding_changed|revision_conflict|tracking_source_changed|source_changed|session_authority_changed|forbidden/);
    assert.equal((await f.store.list('p','campaign')).length,0);assert.equal((await f.store.list('p','asset')).length,0);assert.equal((await f.store.list('p','trackingBinding')).length,1);
  }finally{release();await other.close();await f.close();}
});

test('public synthetic advertising boundary cannot be used in live Marketing mode',async()=>{
  const f=await connectionFixture();try{
    const provider=new FixtureProvider(f.store);
    assert.equal(Reflect.set(provider,'evidence','provider'),false);
    assert.throws(()=>Object.defineProperty(provider,'evidence',{value:'provider'}));
    assert.throws(()=>new MarketingServer(f.store,{meta:provider,google:provider,linkedin:provider},f.server.generation,f.server.agent,'live'),/fixture_provider_requires_fixture_mode/);
    assert.equal(provider.evidence,'fixture');
  }finally{await f.close();}
});


test('launch approval binds exact promoted Tracking configuration and rejects later edits',async()=>{
  const f=await fixture();try{
    await f.store.db.acquireExecutor();const campaign=await f.call('promoteStudio',f.input);
    const operation=await f.call('prepare',{campaignId:campaign.id,requestKey:'prepare'});await f.server.dispatch('p',operation.id);
    const packet=await f.call('packet',{campaignId:campaign.id});assert.equal(packet.tracking?.promotedFrom?.bindingId,f.binding.id);
    assert.equal(packet.tracking?.outcome,'inquiry');
    await f.call('decide',{packetId:packet.id,digest:packet.digest,decision:'approved'});
    await f.call('bindTracking',{owner:{kind:'campaign',id:campaign.id},expectedRevision:campaign.revision,expectedBindingRevision:1,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'qualified',refundTreatment:null,requestKey:'changed-outcome'});
    await assert.rejects(f.call('execute',{packetId:packet.id,digest:packet.digest,requestKey:'launch'}),/tracking_configuration_changed_review_packet/);
    const current=await f.call('packet',{campaignId:campaign.id});assert.equal(current.tracking?.outcome,'qualified');assert.equal(current.tracking?.promotedFrom?.bindingId,f.binding.id);
    assert.equal((await f.store.list('p','operation')).length,1);
  }finally{await f.close();}
});

// Missing new SDK-owned proof still blocks the original operation. The positive
// public NativeProvider producer and joined journey are qualified separately.
test('joined public NativeProvider stops without exact material capability evidence and makes zero advertising requests',async()=>{
  const f=await fixture();try{
    let calls=0;const native=new NativeProvider('meta',f.custody,f.store,async()=>{calls++;throw new Error('No advertising HTTP expected before eligibility');});
    const server=new MarketingServer(f.store,{...f.server.providers,meta:native},f.server.generation,f.server.agent,'fixture',undefined,undefined,{tracking:f.source.options});
    const c=await server.call(f.principal,'p','promoteStudio',f.input);await f.store.db.acquireExecutor();
    const op=await server.call(f.principal,'p','prepare',{campaignId:c.id,requestKey:'native-attempt'});await server.dispatch('p',op.id);
    const retained=await f.store.get<import('../core/index.js').Operation>('p','operation',op.id);
    assert.equal(retained.state,'blocked');assert.equal(retained.reason,'campaign_prerequisites_not_checked');assert.equal(retained.receipt,null);assert.equal(calls,0);
    assert.equal((await f.store.get<Grant>('p','grant',c.grantId)).capabilityEvidence,undefined);
  }finally{await f.close();}
});

test('equivalent UTC timestamp spellings find the original public sync snapshot without merging different windows or rewriting history',async()=>{
  const f=await fixture();try{
    const c=await f.call('promoteStudio',f.input),input={campaignId:c.id,from:'2026-10-01T05:00:00.000Z',until:'2026-10-02T05:00:00.000Z'};
    await f.call('syncMetrics',input);const history=await f.store.list('p','metrics');
    const exact=await f.call('results',input),equivalent=await f.call('results',{...input,from:input.from.replace('.000Z','Z'),until:input.until.replace('.000Z','Z')});
    assert.deepEqual(equivalent.impressions,exact.impressions);assert.deepEqual(equivalent.spendMinor,exact.spendMinor);assert.ok(equivalent.observedAt);
    assert.equal((await f.call('results',{...input,until:'2026-10-02T05:00:00.001Z'})).spendMinor.value,null);
    for(const from of ['invalid','2026-02-30T05:00:00Z','2026-10-01T05:00:00+00:00'])await assert.rejects(f.call('results',{...input,from}),/invalid_instant/);
    await assert.rejects(f.call('results',{...input,from:input.until}),/invalid_report_window/);
    assert.deepEqual(await f.store.list('p','metrics'),history);
    const native=new NativeProvider('meta',f.custody,f.store,async()=>{throw new Error('No HTTP for incomplete provider days');});
    const server=new MarketingServer(f.store,{...f.server.providers,meta:native},f.server.generation,f.server.agent,'fixture');
    await assert.rejects(server.call(f.principal,'p','syncMetrics',{...input,until:'2026-10-02T05:00:00.001Z'}),/provider_report_requires_local_midnights/);
  }finally{await f.close();}
});

// Binary transport isolation: a retained video asset is arranged here only to
// test bytes/ranges. It is not a supported ad format or a joined launch proof.
test('campaign video ranges retain bytes after draft lifecycle and reject lost project authority',async()=>{
  const f=await fixture();try{
    const c=await f.call('promoteStudio',f.input);
    const bytes=readFileSync('marketing-sdk/tests/fixtures/test-pattern.mp4'),hash=byteDigest(bytes);
    await f.store.db.prepare('INSERT INTO blobs(project_id,digest,bytes) VALUES(?,?,?)').run('p',hash,bytes);
    const original=await f.store.get<import('../core/index.js').Asset>('p','asset',c.material.assetIds[0]!);
    const video={...original,id:'retained-video',kind:'video' as const,mime:'video/mp4',digest:hash};await f.store.put('p','asset',video.id,video);
    let revision=f.d.revision;
    for(const lifecycle of ['archived','active','trash','active'] as const){
      const row=await f.call('setCampaignLifecycle',{kind:'draft',id:f.d.id,expectedRevision:revision,requestKey:lifecycle+revision,lifecycle});revision=row.revision;
      const r=await handleCampaignMedia(f.server.studio,f.principal,'p',video.id,new Request('http://localhost/video',{headers:{range:'bytes=-16'}}));
      assert.equal(r.status,206);assert.equal(r.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(-16));
    }
    await f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND project_id=?').run(f.bobPrincipal.userId,'p');
    await assert.rejects(handleCampaignMedia(f.server.studio,f.bobPrincipal,'p',video.id,new Request('http://localhost/video')),/forbidden|session_authority|authentication_required/);
    // The actual bytes are integrity checked even if private storage is corrupted.
    await f.store.db.prepare('UPDATE blobs SET bytes=? WHERE project_id=? AND digest=?').run(Buffer.from('corrupt'),'p',hash);
    await assert.rejects(handleCampaignMedia(f.server.studio,f.principal,'p',video.id,new Request('http://localhost/video')),/asset_integrity_failure/);
  }finally{await f.close();}
});
