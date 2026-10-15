import test from "node:test";
import assert from "node:assert/strict";
import { nativePreflightFixture } from "./preflight-fixture.js";
import type { TrackingBinding, Campaign } from "../core/index.js";
import { MarketingServer, digest } from "../server/index.js";

test("public server composes host promotion authority and native identity retention with tracking in one SQL commit",async()=>{
  let guardCalls=0,retentionAttempts=0,guardHeld=false;
  const f=await nativePreflightFixture(true,context=>({withPromotion:async(p,project,draftId,local)=>{
    guardCalls++;assert.equal(project,'p');assert.equal(p.userId,context.principal.userId);guardHeld=true;
    const before=await context.store.list<TrackingBinding>(project,'trackingBinding');
    assert.equal(before.length,1);assert.equal(before[0]!.owner.id,draftId);
    const originalSource=await context.store.get(project,'fixtureHostSource','site');
    const retain=async(c:Campaign)=>{
      retentionAttempts++;assert.equal(guardHeld,true);assert.equal(c.projectId,project);assert.equal(c.draftOrigin?.draftId,draftId);
      // Host writes must join the SDK transaction; a separate native ledger
      // commit would not roll back with the campaign and tracking binding.
      await context.store.put(project,'fixtureNativeCampaignIdentity',c.id,{id:c.id,sourceDraft:draftId,materialDigest:digest(c.material),executor:'sdk'});
    };
    for(const failure of ['identity','tracking']){
      await assert.rejects(local(async c=>{
        await retain(c);
        if(failure==='identity')throw Error('native_identity_rejected');
        await context.store.put(project,'fixtureHostSource','site',{...originalSource as object,revision:'2'});
      }),failure==='identity'?/native_identity_rejected/:/source_changed|tracking_source_changed/);
      for(const kind of ['campaign','campaignVersion','asset','studioPromotion','fixtureNativeCampaignIdentity'])
        assert.deepEqual(await context.store.list(project,kind),[],kind+' must roll back');
      assert.deepEqual(await context.store.list(project,'trackingBinding'),before);
      assert.deepEqual(await context.store.get(project,'fixtureHostSource','site'),originalSource);
    }
    try{return await local(retain);}finally{guardHeld=false;}
  }}));
  try{
    assert.equal(guardCalls,1);assert.equal(retentionAttempts,3);
    assert.equal(f.c.state,'draft');assert.equal(f.c.receipt,null);
    const retained=await f.store.get<{id:string;sourceDraft:string;executor:string}>('p','fixtureNativeCampaignIdentity',f.c.id);
    assert.equal(retained.id,f.c.id);assert.equal(retained.executor,'sdk');assert.equal(retained.sourceDraft,f.d.id);
    const bindings=await f.store.list<TrackingBinding>('p','trackingBinding');
    const promoted=bindings.find(b=>b.owner.kind==='campaign');assert.equal(promoted?.owner.id,f.c.id);
    assert.deepEqual(promoted?.promotedFrom,{owner:f.owner,bindingId:f.binding.id,bindingRevision:f.binding.revision,ownerRevision:f.d.revision});
    assert.equal(bindings.length,2);
    assert.deepEqual(await f.call('promoteStudio',f.input),f.c);assert.equal(guardCalls,1);
    // An uncertain response is read from the original request receipt even in
    // a newly composed runtime. It does not repeat host retention or tracking.
    const resumed=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,
      {...f.server.options,studio:{...f.server.options.studio,withPromotion:async()=>{throw Error('duplicate host promotion');}}});
    assert.deepEqual(await resumed.call(f.principal,'p','promoteStudio',f.input),f.c);
    assert.equal((await f.store.list('p','fixtureNativeCampaignIdentity')).length,1);
    assert.equal((await f.store.list('p','operation')).length,0);
    assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
  }finally{await f.close();}
});

test("a host promotion refusal is not replaced by successful tracking composition",async()=>{
  let refused=false;
  const f=await nativePreflightFixture(true,()=>({withPromotion:async(_p,_project,_draft,local)=>{
    refused=true;
    // This fixture needs one campaign to finish setup; after setup a second
    // draft is promoted through the public runtime with a refusing host guard.
    return local(async()=>{});
  }}));
  try{
    assert.equal(refused,true);
    const copy=await f.call('copyToDraft',{id:f.d.id,kind:'draft',expectedRevision:f.d.revision,requestKey:'second-draft'});
    const server=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,
      {...f.server.options,studio:{...f.server.options.studio,withPromotion:async()=>{throw Error('native_campaign_creation_held');}}});
    const prior=await f.store.list('p','campaign');
    await assert.rejects(server.call(f.principal,'p','promoteStudio',{...f.input,draftId:copy.id,expectedRevision:copy.revision,requestKey:'held'}),/native_campaign_creation_held/);
    assert.deepEqual(await f.store.list('p','campaign'),prior);
    assert.equal((await f.store.list('p','operation')).length,0);
  }finally{await f.close();}
});
