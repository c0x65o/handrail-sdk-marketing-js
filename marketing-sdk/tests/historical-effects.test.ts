import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {testStore} from './datastore.js';
import {HistoricalCampaignImports,readHistoricalCampaignSnapshot} from '../server/adoption.js';
import {HistoricalEffectResolutions,readHistoricalEffectResolution,type HistoricalEffectCandidate,type HistoricalEffectSource} from '../server/historical-effects.js';
import {createStoreSessionAuthority} from '../server/session-authority.js';
import {digest} from '../server/store.js';
import type {HistoricalCampaignSnapshot,HistoricalRecord} from '../core/adoption.js';
import type {ProviderPort,ExistingMetaHierarchyInspection} from '../server/ports.js';

async function fixture(pauseFailure=false){
  const dir=mkdtempSync(join(tmpdir(),'marketing-effects-')),path=join(dir,'db'),store=await testStore(path);
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Effects');
  const user=await store.createUser('owner','fixture');await store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,'p','admin');
  const principal=await store.authenticate((await store.login('owner','fixture','fixture'))!);
  const row=(kind:HistoricalRecord['kind'],sourceId:string,payload:HistoricalRecord['payload']):HistoricalRecord=>({kind,sourceId,payload,sourceRevision:'1',recordedAt:null,collectedAt:null,provenance:'legacy_observation',evidenceId:null,missingReasons:['original_receipts_missing']});
  const snapshot:HistoricalCampaignSnapshot={schemaVersion:1,projectId:'p',nativeCampaignId:'native',provider:'meta',accountId:'123',providerCampaignIds:['100'],identityMissingReasons:[],purpose:'unknown',purposeReason:'not_recorded',
    source:{system:'fixture',revision:'1',capturedAt:'2026-10-15T00:00:00Z',receiptRefs:['original']},records:[row('campaign','native',{providerId:'100'}),row('operation','op',{status:'partial',originalRequestCoverage:'unknown'}),row('provider_object','campaign',{id:'100'}),row('provider_object','adset',{id:'101'})],expectedCounts:{campaign:1,operation:1,provider_object:2},totals:[],unsettledOperationIds:['op']};
  if(pauseFailure){
    snapshot.records.push(row('provider_object','image',{provider:'meta',object_type:'image',provider_object_id:'image-hash'}),
      row('provider_object','old-creative',{provider:'meta',object_type:'creative',provider_object_id:'old-creative'}));
    snapshot.expectedCounts.provider_object=4;
  }
  const imported=await new HistoricalCampaignImports(store,{authorize:async()=>{},capture:async()=>snapshot,assertCurrent:async()=>{},withCurrentSnapshot:async(_p,_s,commit)=>commit()}).stage(principal,'p','native','import');
  const candidate:HistoricalEffectCandidate={projectId:'p',nativeCampaignId:'native',historyImportId:imported.id,operationId:'op',sourceRevision:'source-1',basis:'mapped_objects_after_material_readback_failure',originalStatus:'partial',originalRequestCoverage:'unknown',evidenceRecordIds:imported.recordRefs.filter(r=>['operation','provider_object'].includes(r.kind)).map(r=>r.digest),affectedProviderIds:['100','101'],providerIds:{campaign:'100',adset:'101',ad:'103',creative:'102'},
    grant:{id:'g',projectId:'p',revision:1,provider:'meta',accountId:'act_123',pageId:'42',currency:'USD',timezone:'UTC',label:'Fixture',permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'}};
  if(pauseFailure){candidate.basis='mapped_objects_after_pause_readback_failure';candidate.affectedProviderIds=['103','old-creative','image-hash'];}
  const state={account:{id:'act_123',currency:'USD',timezone:'UTC'},campaign:{id:'100',accountId:'123',status:'PAUSED',effectiveStatus:'PAUSED'},
    adsets:[{id:'101',accountId:'123',campaignId:'100',status:'PAUSED',effectiveStatus:'CAMPAIGN_PAUSED'}],
    ads:[{id:'103',accountId:'123',campaignId:'100',adsetId:'101',creativeId:'102',status:'PAUSED',effectiveStatus:'ADSET_PAUSED'}]};
  const evidence:ExistingMetaHierarchyInspection={provider:'meta',source:'provider_api',snapshot:state,digest:digest(state),observedAt:new Date().toISOString(),inventoryComplete:true,allPaused:true,scope:'exact_campaign_and_complete_children',historicalEffectsSettled:false,materialVerified:false,executionTransferred:false,spendingAuthorityGranted:false};
  let denied=false,changed=false,failCommit=false,reads=0,afterRead=async()=>{};
  const source:HistoricalEffectSource={authorize:async()=>{if(denied)throw Error('native authority revoked');},capture:async()=>structuredClone(candidate),
    assertCurrent:async()=>{if(changed)throw Error('native evidence changed');},withCurrentSource:async(_p,_c,commit)=>{if(failCommit)throw Error('source lock failed');return commit();}};
  const provider={evidence:'provider',inspectExistingMetaHierarchy:async(_g:unknown,_ids:unknown,guard:()=>Promise<void>)=>{reads++;await guard();await afterRead();await guard();return structuredClone(evidence);}} as ProviderPort;
  const sessions=createStoreSessionAuthority(store),service=new HistoricalEffectResolutions(store,source,sessions,{meta:provider});
  const input={historyImportId:imported.id,operationId:'op',requestKey:'resolve'};
  return {store,path,principal,snapshot,imported,candidate,evidence,source,provider,service,input,resolve:()=>service.resolve(principal,'p',input),
    after:(fn:()=>Promise<void>)=>{afterRead=fn;},deny:()=>{denied=true;},change:()=>{changed=true;},fail:()=>{failCommit=true;},reads:()=>reads,
    close:async()=>{await store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('effect reconciliation preserves original failure, request gaps and immutable history through replay and reopen',async()=>{
  const f=await fixture();try{
    const receipt=await f.resolve();assert.equal(receipt.resolution,'known_effects_preserved_paused');assert.equal(receipt.originalStatus,'partial');
    assert.equal(receipt.originalRequestCoverage,'unknown');assert.equal(receipt.originalOperationRewritten,false);assert.equal(receipt.spendingAuthorityGranted,false);
    assert.deepEqual(receipt.missingReasons,['historical_request_receipts_unavailable']);
    assert.deepEqual((await readHistoricalCampaignSnapshot(f.store,'p',f.imported.id)).snapshot,f.snapshot);
    assert.deepEqual(await f.resolve(),receipt);assert.equal(f.reads(),1);
    assert.deepEqual(await f.service.readRequest(f.principal,'p','resolve'),receipt);
    for(const kind of ['campaign','grant','campaignExecutionOwner','advertisingBudgetReservation','operation'])assert.deepEqual(await f.store.list('p',kind),[]);
    const reopened=await testStore(f.path);try{assert.deepEqual(await readHistoricalEffectResolution(reopened,'p',f.imported.id,'op'),receipt);}finally{await reopened.close();}
    await assert.rejects(f.service.resolve(f.principal,'p',{...f.input,operationId:'other'}),{code:'historical_effect_request_conflict'});
  }finally{await f.close();}
});
for(const [label,mutate] of Object.entries({
  operation:(f:Awaited<ReturnType<typeof fixture>>)=>{f.candidate.operationId='other';},
  account:(f:Awaited<ReturnType<typeof fixture>>)=>{f.candidate.grant.accountId='act_999';},
  missingEvidence:(f:Awaited<ReturnType<typeof fixture>>)=>{f.candidate.evidenceRecordIds=[];},
  unknownRecord:(f:Awaited<ReturnType<typeof fixture>>)=>{f.candidate.evidenceRecordIds.push('f'.repeat(64));},
  foreignAffected:(f:Awaited<ReturnType<typeof fixture>>)=>{f.candidate.affectedProviderIds=['999'];},
  falseCoverage:(f:Awaited<ReturnType<typeof fixture>>)=>{(f.candidate as any).originalRequestCoverage='complete';},
}))test(`effect reconciliation rejects ${label} before provider reads`,async()=>{const f=await fixture();try{mutate(f);await assert.rejects(f.resolve());assert.equal(f.reads(),0);assert.deepEqual(await f.store.list('p','historicalEffectResolution'),[]);}finally{await f.close();}});
for(const [label,mutate] of Object.entries({
  active:(f:Awaited<ReturnType<typeof fixture>>)=>{f.evidence.snapshot.ads[0]!.status='ACTIVE';},
  extra:(f:Awaited<ReturnType<typeof fixture>>)=>{f.evidence.snapshot.adsets.push({...f.evidence.snapshot.adsets[0]!,id:'999'});},
  wrongParent:(f:Awaited<ReturnType<typeof fixture>>)=>{f.evidence.snapshot.ads[0]!.campaignId='999';},
  wrongChildAccount:(f:Awaited<ReturnType<typeof fixture>>)=>{f.evidence.snapshot.ads[0]!.accountId='999';},
  incomplete:(f:Awaited<ReturnType<typeof fixture>>)=>{(f.evidence as any).inventoryComplete=false;},
}))test(`effect reconciliation rejects ${label} provider evidence`,async()=>{const f=await fixture();try{mutate(f);f.evidence.digest=digest(f.evidence.snapshot);await assert.rejects(f.resolve(),{code:'historical_effect_provider_evidence_invalid'});assert.deepEqual(await f.store.list('p','historicalEffectResolution'),[]);}finally{await f.close();}});
test('source change, revocation and failed commit leave no resolution or request receipt',async()=>{
  for(const mode of ['source','revoke','commit']){const f=await fixture();try{
    f.after(async()=>{if(mode==='source')f.change();if(mode==='revoke')f.deny();if(mode==='commit')f.fail();});
    await assert.rejects(f.resolve());assert.deepEqual(await f.store.list('p','historicalEffectResolution'),[]);assert.equal(await f.service.readRequest(f.principal,'p','absent'),null);
  }finally{await f.close();}}
});
test('adopted campaigns cannot receive replacement effect settlement',async()=>{const f=await fixture();try{
  await f.store.put('p','campaignExecutionOwner','native',{owner:'sdk'});await assert.rejects(f.resolve(),{code:'historical_effect_already_adopted'});
}finally{await f.close();}});
test('revocation after the resolution write rolls back the resolution, request and current pointer',async()=>{
  const f=await fixture();try{
    const put=f.store.put.bind(f.store);f.store.put=async(...args)=>{await put(...args);if(args[1]==='historicalEffectResolution')f.change();};
    await assert.rejects(f.resolve(),/native evidence changed/);
    for(const kind of ['historicalEffectResolution','historicalEffectRequest','historicalEffectCurrent'])assert.deepEqual(await f.store.list('p',kind),[]);
  }finally{await f.close();}
});
test('concurrent requests retain one immutable resolution; tampering is detected',async()=>{
  const f=await fixture();try{
    const [a,b]=await Promise.all([f.resolve(),f.resolve()]);assert.deepEqual(a,b);
    assert.equal((await f.store.list('p','historicalEffectResolution')).length,1);
    await f.store.put('p','historicalEffectResolution',a.id,{...a,sourceRevision:'tampered'});
    await assert.rejects(f.service.read(f.principal,'p',f.imported.id,'op'),{code:'historical_effect_receipt_invalid'});
  }finally{await f.close();}
});

test('paused readback reconciliation preserves mapped non-delivery assets and historical receipt gaps',async()=>{
  const f=await fixture(true);try{
    const receipt=await f.resolve();assert.equal(receipt.basis,'mapped_objects_after_pause_readback_failure');
    assert.deepEqual(receipt.affectedProviderIds,['103','old-creative','image-hash']);
    assert.equal(receipt.originalRequestCoverage,'unknown');assert.equal(receipt.providerEvidence.allPaused,true);
    assert.equal(receipt.providerEvidence.snapshot.ads[0]!.creativeId,'102');
    assert.deepEqual((await readHistoricalCampaignSnapshot(f.store,'p',f.imported.id)).snapshot,f.snapshot);
    assert.deepEqual(await f.resolve(),receipt);assert.equal(f.reads(),1);
    for(const kind of ['campaign','grant','campaignExecutionOwner','advertisingBudgetReservation','operation'])assert.deepEqual(await f.store.list('p',kind),[]);
  }finally{await f.close();}
});
for(const mode of ['foreignAsset','missingAssetReference','noDeliveryObject','unknownBasis'])test(`paused readback rejects ${mode}`,async()=>{
  const f=await fixture(true);try{
    if(mode==='foreignAsset')f.candidate.affectedProviderIds.push('unmapped-image');
    if(mode==='missingAssetReference')f.candidate.evidenceRecordIds=f.candidate.evidenceRecordIds.filter(id=>id!==f.imported.recordRefs.find(r=>r.sourceId==='image')!.digest);
    if(mode==='noDeliveryObject')f.candidate.affectedProviderIds=['image-hash'];
    if(mode==='unknownBasis')(f.candidate as any).basis='currently_paused';
    await assert.rejects(f.resolve(),{code:'historical_effect_evidence_missing'});assert.equal(f.reads(),0);
    assert.deepEqual(await f.store.list('p','historicalEffectResolution'),[]);
  }finally{await f.close();}
});
