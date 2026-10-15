import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignExecutionConnections,digest,requireThat,sessionBinding,type CampaignExecutionConnectionAuthority,type CampaignExecutionConnectionCandidate} from '../server/index.js';
import type {Grant} from '../core/index.js';
import {nativePreflightFixture} from './preflight-fixture.js';
import {testStore} from './datastore.js';
import {fixtureSettings} from './capability-fixtures.js';

async function fixture(){
  const f=await nativePreflightFixture(true);
  const planning={...await f.store.get<Grant>('p','grant',f.c.grantId),permissions:[]};
  await f.store.put('p','grant',planning.id,planning);
  // Changing fixture access must not leave an accidentally stale starting
  // tracking binding that masks the campaign-scope assertion under test.
  for(const owner of [{kind:'draft' as const,id:f.d.id},{kind:'campaign' as const,id:f.c.id}]){
    const view=await f.server.tracking.tracking(f.principal,'p',{owner}),binding=view.binding!;
    await f.server.tracking.bindTracking(f.principal,'p',{owner,expectedRevision:view.ownerRevision,
      expectedBindingRevision:binding.revision,sourceId:binding.source.id,sourceRevision:binding.source.revision,
      destinationId:binding.destinationId,outcome:binding.outcome,refundTreatment:binding.refundTreatment,requestKey:`refresh-fixture-${owner.kind}`});
  }
  const candidate:CampaignExecutionConnectionCandidate={grant:{...planning,id:'campaign-specific',revision:1,campaignId:f.c.id,
    secretRef:'host-vault:campaign-specific',permissions:['prepare','pause','report'],expiresAt:new Date(Date.now()+300000).toISOString()},
    authorityDigest:'current-native-policy-and-custody',receiptReferences:['native:current-preparation']};
  const input={campaignId:f.c.id,expectedRevision:f.c.revision,expectedGrantRevision:planning.revision,requestKey:'bind-one'};
  let allowed=true,before:(()=>Promise<void>)|null=null,after:(()=>Promise<void>)|null=null;
  const sessions=f.connections.sessionAuthority;
  const authority:CampaignExecutionConnectionAuthority={withBinding:async(p,scope,local)=>{
    if(before)await before();
    assert.equal(scope.campaign.id,input.campaignId);assert.equal(scope.candidate.authorityDigest,candidate.authorityDigest);
    const session=await sessions.inspectSession(sessionBinding(p),'p');
    return sessions.withLiveSessions([session],()=>f.store.transaction(async()=>{
      requireThat(allowed,'native_permission_missing');
      const result=await local();if(after)await after();requireThat(allowed,'native_permission_missing');return result;
    }));
  }};
  const service=new CampaignExecutionConnections(f.store,sessions,authority);
  const bind=()=>service.bind(f.principal,'p',input,candidate);
  const deny=()=>{allowed=false;};
  return {...f,planning,candidate,input,service,authority,bind,deny,before:(fn:()=>Promise<void>)=>{before=fn;},after:(fn:()=>Promise<void>)=>{after=fn;}};
}

test('binding preserves a Studio campaign, shared planning grant and history; exact receipt survives a new SQL connection',async()=>{
  const f=await fixture();try{
    const second={...f.c,id:'second-campaign'};await f.store.put('p','campaign',second.id,second);
    const original=digest(f.c.material),trace=digest(f.http.trace);
    const beforeAssets=await f.store.list('p','asset'),beforeTracking=await f.store.list('p','trackingBinding');
    const result=await f.bind();
    assert.equal(result.campaign.id,f.c.id);assert.equal(result.campaign.revision,2);assert.equal(result.campaign.grantId,f.candidate.grant.id);
    assert.equal(digest(result.campaign.material),original);assert.deepEqual(result.campaign.draftOrigin,f.c.draftOrigin);
    assert.deepEqual(await f.store.get('p','grant',f.planning.id),f.planning);assert.deepEqual(await f.store.get('p','campaign',second.id),second);
    assert.deepEqual(await f.store.get('p','campaignVersion',`${f.c.id}:1`),f.c);
    assert.deepEqual(await f.store.get('p','campaignVersion',`${f.c.id}:2`),result.campaign);
    assert.deepEqual(await f.store.list('p','asset'),beforeAssets);assert.deepEqual(await f.store.list('p','trackingBinding'),beforeTracking);
    assert.equal(result.receipt.activationAuthorized,false);assert.equal(result.receipt.providerEffectsPerformed,false);
    assert.ok(!JSON.stringify(result).includes(f.candidate.grant.secretRef));assert.equal(digest(f.http.trace),trace);
    assert.deepEqual(await f.bind(),result);
    await assert.rejects(f.server.saveCampaign(f.principal,'p',{id:second.id,expectedRevision:second.revision,grantId:f.candidate.grant.id,material:second.material,requestKey:'wrong-target'}),/campaign_grant_scope_mismatch/);
    await assert.rejects(f.server.call(f.principal,'p','promoteStudio',{draftId:f.d.id,expectedRevision:f.d.revision,grantId:f.candidate.grant.id,expectedGrantRevision:1,requestKey:'another-promotion'}),/campaign_specific_grant_cannot_promote/);
    await f.store.put('p','setup','bound-fixture-setup',{id:'bound-fixture-setup',grantId:f.candidate.grant.id,state:'ready'});
    await f.store.put('p','campaign',second.id,{...second,grantId:f.candidate.grant.id});
    await assert.rejects(f.server.prepare(f.principal,'p',{campaignId:second.id,requestKey:'wrong-target-prepare'}),/campaign_grant_scope_mismatch/);
    await f.store.put('p','campaign',second.id,second);
    const tracking=await f.server.tracking.tracking(f.principal,'p',{owner:{kind:'campaign',id:f.c.id}});
    assert.equal(tracking.readiness,'stale','Binding cannot pass old tracking evidence as current');
    f.deny();assert.deepEqual(await f.service.readRequest(f.principal,'p',f.input.requestKey),result);
    const reopened=await testStore(f.path);try{
      const reader=new CampaignExecutionConnections(reopened,f.connections.sessionAuthority,f.authority);
      assert.deepEqual(await reader.readRequest(f.principal,'p',f.input.requestKey),result);
    }finally{await reopened.close();}
    await assert.rejects(f.service.bind(f.principal,'p',f.input,{...f.candidate,authorityDigest:'different'}),/request_key_payload_conflict/);
    for(const kind of ['operation','decision','packet','advertisingBudgetReservation'])assert.deepEqual(await f.store.list('p',kind),[]);
  }finally{await f.close();}
});

for(const change of ['wrong-campaign','account','currency','timezone','page','activate','expired','shared-secret','stale-material','stale-grant','used-grant','used-version','archived','adopted','prepared','pending','failed-attempt'] as const)
 test(`binding refuses ${change} without upgrading planning or adding execution records`,async()=>{
  const f=await fixture();try{
    const g=f.candidate.grant;
    if(change==='wrong-campaign')g.campaignId='other';
    if(change==='account')g.accountId='act_999';
    if(change==='currency')g.currency='EUR';
    if(change==='timezone')g.timezone='UTC';
    if(change==='page')g.pageId='999';
    if(change==='activate')g.permissions.push('activate');
    if(change==='expired')g.expiresAt='2000-01-01T00:00:00.000Z';
    if(change==='shared-secret')g.secretRef=f.planning.secretRef;
    if(change==='stale-material')f.input.expectedRevision++;
    if(change==='stale-grant')f.input.expectedGrantRevision++;
    if(change==='used-grant')await f.store.put('p','grant',g.id,g);
    if(change==='used-version')await f.store.put('p','campaignVersion',`${f.c.id}:2`,{historical:'must retain'});
    if(change==='archived')await f.store.put('p','campaignLifecycle',f.c.id,{id:f.c.id,lifecycle:'archived'});
    if(change==='adopted')await f.store.put('p','campaign',f.c.id,{...f.c,adoptionOrigin:{receiptId:'original'}});
    if(change==='prepared')await f.store.put('p','campaign',f.c.id,{...f.c,state:'paused',receipt:{intent:'paused'}});
    if(change==='pending'||change==='failed-attempt')await f.store.put('p','operation','old-operation',{id:'old-operation',campaignId:f.c.id,state:change==='pending'?'unknown':'blocked'});
    const before=digest(await f.store.list('p','campaign'));
    await assert.rejects(f.bind());
    assert.equal(digest(await f.store.list('p','campaign')),before);
    assert.deepEqual(await f.store.get('p','grant',f.planning.id),f.planning);
    assert.deepEqual(await f.store.list('p','campaignExecutionConnection'),[]);
    assert.equal(await f.service.readRequest(f.principal,'p',f.input.requestKey),null);
    if(change==='used-version')assert.deepEqual(await f.store.get('p','campaignVersion',`${f.c.id}:2`),{historical:'must retain'});
    if(change!=='used-grant')await assert.rejects(f.store.get('p','grant',g.id),/not_found/);
  }finally{await f.close();}
 });

test('authority denial and rollback retain no binding; subsequent original request is safe',async()=>{
 const f=await fixture();try{
   f.after(async()=>{throw Error('fixture_commit_failure');});
   await assert.rejects(f.bind(),/fixture_commit_failure/);
   assert.deepEqual(await f.store.get('p','campaign',f.c.id),f.c);
   assert.deepEqual(await f.store.list('p','campaignExecutionConnection'),[]);
   await assert.rejects(f.store.get('p','grant',f.candidate.grant.id),/not_found/);
   assert.equal(await f.service.readRequest(f.principal,'p',f.input.requestKey),null);
   f.after(async()=>{});const result=await f.bind();assert.equal(result.campaign.revision,2);
 }finally{await f.close();}
});

test('current host session, role and material are rechecked at commit',async()=>{
 const f=await fixture();try{
   f.before(async()=>{await f.store.put('p','campaign',f.c.id,{...f.c,revision:2});});
   await assert.rejects(f.bind(),/revision_conflict/);
   await f.store.put('p','campaign',f.c.id,f.c);f.before(async()=>{f.deny();});
   await assert.rejects(f.bind(),/native_permission_missing/);
   assert.equal(await f.service.readRequest(f.principal,'p',f.input.requestKey),null);
   await f.host!.changeRole('analyst');
   await assert.rejects(f.bind(),/forbidden/);
   await assert.rejects(f.service.readRequest(f.principal,'p',f.input.requestKey),/forbidden/);
 }finally{await f.close();}
});

test('LinkedIn binding retains daily-only material, UTC and original campaign identity',async()=>{
 const f=await fixture();try{
   const planning:Grant={...f.planning,provider:'linkedin',accountId:'123',organizationId:'456',pageId:undefined,instagramUserId:undefined,
     timezone:'UTC',targetingOptions:[{kind:'locations',id:'urn:li:geo:1',label:'Fixture geography'}],capabilityEvidence:undefined,selectionOptions:undefined};
   const campaign={...f.c,draftOrigin:{...f.c.draftOrigin!,accountId:'123'},material:{...f.c.material,
     settings:fixtureSettings('linkedin','123','456'),audience:{provider:'linkedin' as const,locations:['urn:li:geo:1'],expansion:false},
     budget:null,advertisingBudget:{daily:{currency:'USD',minor:1500}},timezone:'UTC',startAt:'2026-11-01T00:00:00Z',endAt:null}};
   await f.store.put('p','grant',planning.id,planning);await f.store.put('p','campaign',campaign.id,campaign);
   await f.store.put('p','campaignVersion',`${campaign.id}:1`,campaign);
   const candidate={...f.candidate,grant:{...planning,id:f.candidate.grant.id,campaignId:campaign.id,revision:1,
     secretRef:f.candidate.grant.secretRef,expiresAt:f.candidate.grant.expiresAt,permissions:f.candidate.grant.permissions}};
   const result=await f.service.bind(f.principal,'p',f.input,candidate);
   assert.equal(result.campaign.material.budget,null);assert.equal(result.campaign.material.endAt,null);
   assert.equal(result.campaign.material.advertisingBudget!.daily!.minor,1500);
   assert.deepEqual(result.campaign.material,campaign.material);assert.equal(result.campaign.id,campaign.id);
   assert.equal((await f.store.get<Grant>('p','grant',candidate.grant.id)).campaignId,campaign.id);
 }finally{await f.close();}
});
