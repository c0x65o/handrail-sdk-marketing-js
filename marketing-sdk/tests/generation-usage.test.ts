import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testStore} from './datastore.js';
import {BoundGenerationBilling,NativeGeneration,generationUsageObservation,readGenerationUsageEvidence} from '../server/index.js';
import type {GenerationGrant,GenerationJob} from '../core/index.js';

test('generation observations distinguish zero, missing, invalid and discrepant counts without copying private payloads',()=>{
  const o=generationUsageObservation('submit','response','req_original',200,{input_tokens:0,output_tokens:4,total_tokens:9,
    input_tokens_details:{cached_tokens:0,image_tokens:-1,text_tokens:'0',private:'secret'},output_tokens_details:{reasoning_tokens:2},private:'secret'});
  assert.equal(o.usage.inputTokens,0);assert.equal(o.usage.cachedInputTokens,0);
  assert.equal(o.usage.inputImageTokens,null);assert.equal(o.usage.inputTextTokens,null);assert.equal(o.usage.outputImageTokens,null);
  assert.ok(o.usage.reasons.includes('totalTokens:provider_counts_disagree'));assert.equal(o.measuredCost,null);
  assert.doesNotMatch(JSON.stringify(o),/secret/);
  const missing=generationUsageObservation('reconcile','unknown','https://private.invalid',null,null);
  assert.equal(missing.requestId,null);assert.equal(missing.usage.totalTokens,null);
  assert.ok(missing.usage.reasons.includes('totalTokens:missing'));
});

test('real image transport retains immutable usage after revocation and malformed media, preserving reservations',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'generation-usage-')),store=await testStore(join(dir,'db'));
  try{
    await store.db.prepare("INSERT INTO projects(id,name) VALUES('p','Fixture')").run();
    const g:GenerationGrant={id:'g',projectId:'p',provider:'openai',model:'gpt-image-1',kind:'image',maxJobs:5,usedJobs:0,
      maxSeconds:0,size:'1024x1024',quality:'medium',expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,ceiling:{currency:'USD',minor:100},billingCapabilityRef:'fixture'};
    await store.put('p','generationGrant','g',g);
    const path=join(dir,'billing.json');writeFileSync(path,JSON.stringify([{projectId:'p',grantId:'g',provider:'openai',model:g.model,kind:g.kind,size:g.size,quality:g.quality,maxSeconds:g.maxSeconds,
      capabilityRef:'fixture',expiresAt:g.expiresAt,currency:'USD',maxUnitMinor:7,quoteReceipt:'q'}]));
    const billing=new BoundGenerationBilling(store,path);
    const j:GenerationJob={id:'j',projectId:'p',campaignId:'c',grantId:'g',kind:'image',prompt:'private prompt',promptDigest:'digest',
      parentAssetIds:[],rightsReceipt:'rights',state:'running',providerRequestId:null,assetId:null,reason:null,createdAt:new Date().toISOString()};
    let calls=0,retained='';
    const native=new NativeGeneration(async()=> 'private-key',billing,async()=>{
      calls++;await store.put('p','generationGrant','g',{...g,revokedAt:new Date().toISOString()});
      return Response.json({data:[{b64_json:'bm90IGFuIGltYWdl'}],usage:{input_tokens:5,output_tokens:8,total_tokens:13,
        input_tokens_details:{text_tokens:5,cached_tokens:0},private:'private-key'}},{headers:{'x-request-id':'req_original'}});
    });
    await assert.rejects(native.submit(j,g,id=>{retained=id;}),/invalid_image_bytes/);
    assert.equal(calls,1);assert.equal(retained,'req_original');
    const rows=await store.list<any>('p','generationUsageEvidence');assert.equal(rows.length,1);
    const original=rows[0];assert.equal(original.size,g.size);assert.equal(original.quality,g.quality);assert.equal(original.maxSeconds,g.maxSeconds);
    assert.equal(original.observation.usage.totalTokens,13);assert.equal(original.observation.measuredCost,null);
    assert.doesNotMatch(JSON.stringify(original),/private-key|private prompt|bm90IGFu/);
    await billing.observe(g,j,{...original.observation,observedAt:'2098-01-01T00:00:00Z'});
    assert.deepEqual(await store.get('p','generationUsageEvidence',original.id),original,'duplicate reads cannot overwrite collection time');
    await billing.observe(g,j,{...original.observation,usage:{...original.observation.usage,totalTokens:14}});
    assert.equal((await store.list('p','generationUsageEvidence')).length,2,'changed observations preserve their predecessor');
    const first=await readGenerationUsageEvidence(store,'p','j',{limit:1});assert.equal(first.items.length,1);assert.ok(first.nextAfter);
    const second=await readGenerationUsageEvidence(store,'p','j',{limit:1,after:first.nextAfter!});assert.equal(second.items.length,1);
    assert.notEqual(first.items[0]!.id,second.items[0]!.id);assert.equal(second.nextAfter,null);
    assert.deepEqual(await readGenerationUsageEvidence(store,'other','j'),{items:[],nextAfter:null});
    await assert.rejects(readGenerationUsageEvidence(store,'p','other',{after:first.nextAfter!}),/generation_usage_cursor_scope/);
    assert.deepEqual(await store.get('p','generationUsageEvidence',original.id),original);
    assert.equal((await store.list<any>('p','generationCostReservation'))[0].minor,7,'a quote is not a measured charge or refund');
    await assert.rejects(billing.observe(g,{...j,projectId:'other'},original.observation),/generation_usage_scope_mismatch/);
    await assert.rejects(native.submit(j,g,()=>{}),/generation_grant_unavailable/);assert.equal(calls,1);
  }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed provider attempts and metering failures retain unknown usage without retries or private errors',async()=>{
  const g:GenerationGrant={id:'g',projectId:'p',provider:'openai',model:'gpt-image-1',kind:'image',maxJobs:5,usedJobs:0,maxSeconds:0,
    size:'1024x1024',quality:'medium',expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,ceiling:{currency:'USD',minor:100},billingCapabilityRef:'fixture'};
  const j:GenerationJob={id:'j',projectId:'p',campaignId:'c',grantId:'g',kind:'image',prompt:'private',promptDigest:'digest',parentAssetIds:[],
    rightsReceipt:'rights',state:'running',providerRequestId:null,assetId:null,reason:null,createdAt:new Date().toISOString()};
  for(const mode of ['http','network','metering'] as const){
    let calls=0,retained='';const observations:any[]=[];
    const native=new NativeGeneration(async()=> 'secret',{authorize:async()=>{},observe:async(_g,_j,o)=>{
      observations.push(o);if(mode==='metering')throw Error('private-ledger-error');
    }},async()=>{calls++;if(mode==='network')throw Error('private-network-error');
      return mode==='http'?Response.json({error:{message:'private-provider-error',type:'server_error'}},{status:503,headers:{'x-request-id':'req_error'}})
        :Response.json({data:[{b64_json:'AA=='}]},{headers:{'x-request-id':'req_success'}});
    });
    await assert.rejects(native.submit(j,g,id=>{retained=id;}),mode==='metering'?/generation_metering_failed/:/generation_submission_uncertain/);
    assert.equal(calls,1);assert.equal(observations.length,1);assert.equal(observations[0].usage.totalTokens,null);
    assert.equal(observations[0].httpStatus,mode==='http'?503:mode==='metering'?200:null);
    if(mode==='metering')assert.equal(retained,'req_success');
    assert.doesNotMatch(JSON.stringify(observations),/private|secret/);
  }
  let calls=0;
  const absent=new NativeGeneration(async()=>{calls++;return 'secret';},{authorize:async()=>{}} as any);
  await assert.rejects(absent.submit(j,g,()=>{}),/generation_metering_unavailable/);assert.equal(calls,0);
});
