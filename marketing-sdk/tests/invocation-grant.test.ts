import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeProvider,DomainError,digest,assertCurrentGrant} from '../server/index.js';
import type {Campaign,Grant} from '../core/index.js';
import {nativePreflightFixture} from './preflight-fixture.js';

test('native provider stop/read invocation has no fabricated deadline and is fenced through every HTTP boundary',async()=>{
 const f=await nativePreflightFixture();try{
  assert.equal((await f.call('checkCampaign',f.check)).state,'ready');
  await f.store.db.acquireExecutor();
  const prepared=await f.call('prepare',{campaignId:f.c.id,requestKey:'prepare'});
  assert.equal((await f.server.dispatch('p',prepared.id)).state,'succeeded');
  const campaign=await f.store.get<Campaign>('p','campaign',f.c.id);
  const original=await f.store.get<Grant>('p','grant',campaign.grantId);
  const credentials=await f.custody.useReadOnly(original,async()=>{},async c=>structuredClone(c));
  const grant:Grant={...original,revision:original.revision+1,campaignId:campaign.id,permissions:['pause','report'],expiresAt:null,
   lifetime:{kind:'invocation',invocationRef:'exact-running-host-action'}};
  await f.store.put('p','grant',grant.id,grant);
  let alive=true,checks=0;
  const assertInvocationGrant=async(g:Grant)=>{checks++;if(!alive)throw new DomainError('native_invocation_ended',403);
   assert.equal(g.projectId,'p');assert.equal(g.campaignId,campaign.id);assert.equal(g.id,grant.id);
   assert.equal(g.lifetime?.invocationRef,'exact-running-host-action');};
  const use=async<T>(g:Grant,action:(c:typeof credentials)=>Promise<T>)=>{await assertInvocationGrant(g);const result=await action(credentials);await assertInvocationGrant(g);return result;};
  const provider=new NativeProvider('meta',{use,assertInvocationGrant},f.store,f.http.fetch);
  const preparation={...grant,permissions:['prepare','pause','report'] as Grant['permissions']};
  await assert.rejects(assertCurrentGrant(preparation,Date.now(),{assertInvocationGrant}),/invalid_invocation_grant/);
  let preparationChecks=0;
  const assertInvocationPreparationGrant=async(g:Grant)=>{preparationChecks++;await assertInvocationGrant(g);};
  await assertCurrentGrant(preparation,Date.now(),{assertInvocationPreparationGrant});
  assert.equal(preparationChecks,1);
  await assert.rejects(assertCurrentGrant({...preparation,permissions:['prepare','activate']},Date.now(),
    {assertInvocationPreparationGrant,assertInvocationActivationGrant:assertInvocationGrant}),/invalid_invocation_grant/);
  const before=f.http.trace.length;
  await assert.rejects(new NativeProvider('meta',{use},f.store,f.http.fetch).pause(campaign,grant,async()=>{}),/invocation_grant_authority_required/);
  await assert.rejects(provider.activate(campaign,grant,async()=>{}),/invocation_grant_operation_denied/);
  assert.equal(f.http.trace.length,before);
  f.http.boundary=async()=>{alive=false;};
  await assert.rejects(provider.pause(campaign,grant,async()=>{}),/native_invocation_ended/);
  assert.ok(f.http.trace.slice(before).every(r=>r.method==='GET'));
  f.http.boundary=null;alive=true;
  await f.store.put('p','grant',grant.id,{...grant,lifetime:{...grant.lifetime!,invocationRef:'different-action'}});
  await assert.rejects(provider.pause(campaign,grant,async()=>{}),/provider_custody_changed/);
  await f.store.put('p','grant',grant.id,grant);
  const receipt=await provider.pause(campaign,grant,async()=>assertInvocationGrant(grant));
  assert.equal(receipt.intent,'paused');assert.equal(f.http.trace.slice(before).filter(r=>r.method==='POST').length,3);
  assert.equal(digest(receipt.ids),digest(campaign.receipt!.ids));
  const recovered=await provider.reconcile(campaign,grant,{kind:'pause',payloadDigest:campaign.receipt!.payloadDigest,receipt:null});
  assert.equal(recovered?.intent,'paused');assert.equal(f.http.trace.slice(before).filter(r=>r.method==='POST').length,3);
  assert.ok(checks>10);assert.equal((await f.store.get<Grant>('p','grant',grant.id)).expiresAt,null);
  const report={...grant,permissions:['report'] as Grant['permissions']};await f.store.put('p','grant',grant.id,report);
  await assert.rejects(provider.pause(campaign,report,async()=>{}),/invocation_grant_operation_denied/);
 }finally{await f.close();}
});
