import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketingServer,CampaignStudio,CampaignExecutionConnections,assertSessionInspection,sessionExpiryBound,
  inspectLiveSessions,digest,requireThat,sessionBinding,type SessionInspection,type SessionAuthority,type Store} from '../server/index.js';
import {emptyBrief,type Grant} from '../core/index.js';
import {testStore} from './datastore.js';
import {nativePreflightFixture} from './preflight-fixture.js';

async function invocation(store:Store,ref='native:action-one'){
  const identity={issuer:'fixture-native-action',subject:'owner',kind:'agent' as const};
  const principal=await store.bindExternalPrincipal('p',identity,'editor');
  principal.externalIdentity={issuer:identity.issuer,subject:identity.subject};principal.externalSessionRef=ref;
  const binding=sessionBinding(principal);
  const snapshot:SessionInspection={binding,projectId:'p',kind:'agent',role:'editor',expiresAt:null,
    lifetime:{kind:'invocation',invocationRef:ref},revision:digest(['running',ref,'editor'])};
  let active=true,endBeforeCommit=false;
  const authority:SessionAuthority={
    async authenticateRequest(){throw Error('native_context_required');},
    async inspectSession(b,project){
      requireThat(active&&project==='p'&&digest(b)===digest(binding),'native_action_finished',403);
      return structuredClone(snapshot);
    },
    async withLiveSessions(expected,local){
      return store.transaction(async()=>{
        await inspectLiveSessions(authority,expected);const result=await local();
        if(endBeforeCommit)active=false;
        await inspectLiveSessions(authority,expected);return result;
      });
    },
  };
  return {principal,binding,snapshot,authority,end:()=>{active=false;},endAtCommit:()=>{endBeforeCommit=true;}};
}

test('invocation lifetime is explicit, agent-only and bound to the exact external action',()=>{
  const binding={issuer:'native-action',subject:'owner',userId:'external:owner',sessionRef:'action-123'};
  const value:SessionInspection={binding,projectId:'p',kind:'agent',role:'editor',expiresAt:null,
    lifetime:{kind:'invocation',invocationRef:binding.sessionRef},revision:'running'};
  assertSessionInspection(value,binding,'p');assert.equal(sessionExpiryBound(value),Infinity);
  assert.equal(JSON.parse(JSON.stringify(value)).expiresAt,null,'no fake persisted deadline');
  for(const change of [{kind:'human'},{lifetime:undefined},{expiresAt:Infinity},{expiresAt:Date.now()+10000},
    {lifetime:{kind:'invocation',invocationRef:'other'}},{binding:{...binding,issuer:'marketing:store'}}]){
    const altered={...value,...change} as SessionInspection;
    assert.throws(()=>assertSessionInspection(altered,altered.binding,'p'),/session_authority_changed/);
  }
  for(const kind of ['human','agent'] as const){
    const timed:SessionInspection={binding,projectId:'p',kind,role:'editor',expiresAt:Date.now()+10000,revision:'timed'};
    assertSessionInspection(timed,binding,'p');assert.equal(sessionExpiryBound(timed),timed.expiresAt);
    assert.throws(()=>assertSessionInspection({...timed,expiresAt:Date.now()-1},binding,'p'),/session_authority_changed/);
  }
});

test('native invocation edits Studio through SQL, rejects a finished action, rolls back revocation and preserves original retries',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sdk-invocation-')),store=await testStore(join(dir,'db'));
  try{
    await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Invocation fixture');
    const first=await invocation(store),studio=new CampaignStudio(store,{sessions:first.authority},'fixture');
    const input={requestKey:'original-brief',brief:{...emptyBrief(),name:'Native campaign',offer:'A tour',audience:'Local customers'}};
    const saved=await studio.saveBrief(first.principal,'p',input);
    assert.equal(saved.revision,1);assert.deepEqual(await studio.saveBrief(first.principal,'p',input),saved);
    assert.equal(Number((await store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n),0);
    await assert.rejects(store.authorize(first.principal,'p',['editor'],true),/forbidden/,'agent cannot provide human approval');
    first.end();await assert.rejects(studio.saveBrief(first.principal,'p',input),/native_action_finished/);
    const second=await invocation(store,'native:action-two'),resumed=new CampaignStudio(store,{sessions:second.authority},'fixture');
    assert.deepEqual(await resumed.saveBrief(second.principal,'p',input),saved,'stable actor retains original receipt across invocations');
    const before=digest(await store.list('p','draft'));second.endAtCommit();
    await assert.rejects(resumed.saveBrief(second.principal,'p',{...input,requestKey:'revoked-write',brief:{...input.brief,name:'Must roll back'}}),/native_action_finished/);
    assert.equal(digest(await store.list('p','draft')),before);
    assert.equal((await store.list('p','operation')).length,0);
    assert.equal((await store.list('p','advertisingBudgetReservation')).length,0);
  }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('invocation-bound execution connection still requires finite current campaign grants and host authority',async()=>{
  const f=await nativePreflightFixture(true);try{
    const actor=await invocation(f.store),planning={...await f.store.get<Grant>('p','grant',f.c.grantId),permissions:[]};
    await f.store.put('p','grant',planning.id,planning);
    const grant:Grant={...planning,id:'invocation-campaign-grant',revision:1,campaignId:f.c.id,
      secretRef:'host:invocation-grant',permissions:['prepare','pause','report'],expiresAt:new Date(Date.now()+120000).toISOString()};
    let allowed=false;
    const service=new CampaignExecutionConnections(f.store,actor.authority,{withBinding:async(_p,_scope,local)=>{
      requireThat(allowed,'host_policy_denied',403);return local();
    }});
    const input={campaignId:f.c.id,expectedRevision:f.c.revision,expectedGrantRevision:planning.revision,requestKey:'connect'};
    const candidate={grant,authorityDigest:'current-host-policy',receiptReferences:['action:real-host-guard']};
    await assert.rejects(service.bind(actor.principal,'p',input,candidate),/host_policy_denied/);allowed=true;
    await assert.rejects(service.bind(actor.principal,'p',input,{...candidate,grant:{...grant,expiresAt:'2000-01-01T00:00:00Z'}}),/invalid_campaign_execution_grant/);
    const result=await service.bind(actor.principal,'p',input,candidate);
    assert.equal(result.campaign.id,f.c.id);assert.equal(result.campaign.state,'draft');
    assert.equal(result.receipt.activationAuthorized,false);assert.equal(result.receipt.providerEffectsPerformed,false);
    assert.equal((await f.store.get<Grant>('p','grant',grant.id)).expiresAt,grant.expiresAt);
    assert.deepEqual(await service.readRequest(actor.principal,'p',input.requestKey),result);
    actor.end();await assert.rejects(service.readRequest(actor.principal,'p',input.requestKey),/native_action_finished/);
    assert.equal((await f.store.list('p','operation')).length,0);
  }finally{await f.close();}
});

test('agent promotion requires current host authority, copies exact human tracking and rolls back revocation without granting consent or coverage',async()=>{
  const f=await nativePreflightFixture(true);try{
    let draft=await f.call('copyToDraft',{id:f.d.id,kind:'draft',expectedRevision:f.d.revision,requestKey:'agent-copy'});
    const snapshot=await f.call('captureDestination',{url:draft.material.destination!});
    draft=await f.call('saveStudioMaterial',{draftId:draft.id,expectedRevision:draft.revision,requestKey:'copy-material',step:'tracking',material:{...draft.material,settings:f.d.material.settings,destinationDigest:snapshot.digest}});
    const owner={kind:'draft' as const,id:draft.id};
    const bind={owner,expectedRevision:draft.revision,expectedBindingRevision:0,sourceId:'site',sourceRevision:'1',destinationId:'tour',outcome:'inquiry' as const,refundTreatment:null,requestKey:'copy-binding'};
    const binding=await f.call('bindTracking',bind);
    const actor=await invocation(f.store);
    const options={...f.server.options,studio:{sessions:actor.authority}};
    const unbound=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,options);
    const input={...f.input,draftId:draft.id,expectedRevision:draft.revision,requestKey:'agent-promotion'};
    await assert.rejects(unbound.call(actor.principal,'p','promoteStudio',input),/forbidden/);
    await assert.rejects(unbound.call(actor.principal,'p','bindTracking',{...bind,expectedBindingRevision:1,requestKey:'agent-consent'}),/forbidden/);
    await assert.rejects(unbound.call(actor.principal,'p','startTrackingTest',{owner,expectedBindingRevision:binding.revision,requestKey:'agent-test'}),/forbidden/);
    let allowed=true,revokeAfterRetention=true;
    const server=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,
      {...options,studio:{...options.studio,withPromotion:async(p,project,id,local)=>{
        requireThat(allowed&&p.userId===actor.principal.userId&&project==='p'&&id===draft.id,'host_promotion_revoked',403);
        return local(async campaign=>{
          await f.store.put(project,'fixtureNativeCampaignIdentity',campaign.id,{id:campaign.id});
          if(revokeAfterRetention)allowed=false;
        });
      }}});
    const before=await f.store.list('p','campaign'),bindings=await f.store.list('p','trackingBinding');
    await assert.rejects(server.call(actor.principal,'p','promoteStudio',input),/host_promotion_revoked/);
    assert.deepEqual(await f.store.list('p','campaign'),before);
    assert.deepEqual(await f.store.list('p','trackingBinding'),bindings);
    assert.deepEqual(await f.store.list('p','fixtureNativeCampaignIdentity'),[]);
    allowed=true;revokeAfterRetention=false;
    const campaign=await server.call(actor.principal,'p','promoteStudio',input);
    assert.equal(campaign.state,'draft');assert.equal(campaign.receipt,null);
    assert.equal(campaign.draftOrigin?.actorId,actor.principal.userId);
    const copied=(await server.call(actor.principal,'p','tracking',{owner:{kind:'campaign',id:campaign.id}})).binding!;
    assert.deepEqual(copied.source,binding.source);assert.equal(copied.outcome,binding.outcome);
    assert.deepEqual(copied.promotedFrom,{owner,bindingId:binding.id,bindingRevision:binding.revision,ownerRevision:draft.revision});
    allowed=false;
    assert.deepEqual(await server.call(actor.principal,'p','promoteStudio',input),campaign,'committed result is read without repeating promotion');
    for(const kind of ['operation','validatedCoverage','event','advertisingBudgetReservation'])assert.equal((await f.store.list('p',kind)).length,0);
  }finally{await f.close();}
});
