import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {testStore} from './datastore.js';
import {HistoricalCampaignImports,readHistoricalCampaignSnapshot} from '../server/adoption.js';
import {HistoricalEffectResolutions,type HistoricalEffectCandidate,type HistoricalEffectSource} from '../server/historical-effects.js';
import {createStoreSessionAuthority} from '../server/session-authority.js';
import {digest} from '../server/store.js';
import type {HistoricalCampaignSnapshot,HistoricalRecord} from '../core/adoption.js';
import type {ProviderPort,ExistingLinkedInHierarchyInspection} from '../server/ports.js';
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'linkedin-effects-')),path=join(dir,'db'),store=await testStore(path);
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Effects');
  const user=await store.createUser('owner','fixture');await store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,'p','admin');
  const principal=await store.authenticate((await store.login('owner','fixture','fixture'))!);
  const row=(kind:HistoricalRecord['kind'],sourceId:string,payload:HistoricalRecord['payload']):HistoricalRecord=>({kind,sourceId,payload,sourceRevision:'1',recordedAt:null,collectedAt:null,provenance:'legacy_observation',evidenceId:null,missingReasons:['original_receipts_missing']});
  const snapshot:HistoricalCampaignSnapshot={schemaVersion:1,projectId:'p',nativeCampaignId:'native',provider:'linkedin',accountId:'123',providerCampaignIds:['100'],identityMissingReasons:[],purpose:'unknown',purposeReason:'not_recorded',
    source:{system:'fixture',revision:'1',capturedAt:'2026-10-15T00:00:00Z',receiptRefs:['original']},records:[row('campaign','native',{providerId:'100'}),row('operation','op',{status:'partial',current_step:'provider_creation_reconciled'}),
      row('provider_object','creative',{provider:'linkedin',object_type:'creative',provider_object_id:'102',parent_provider_object_id:'100'}),
      row('provider_object','image',{provider:'linkedin',object_type:'image',provider_object_id:'urn:li:image:original',parent_provider_object_id:'100'})],
    expectedCounts:{campaign:1,operation:1,provider_object:2},totals:[],unsettledOperationIds:['op']};
  const imported=await new HistoricalCampaignImports(store,{authorize:async()=>{},capture:async()=>snapshot,assertCurrent:async()=>{},withCurrentSnapshot:async(_p,_s,commit)=>commit()}).stage(principal,'p','native','import');
  const candidate:HistoricalEffectCandidate={projectId:'p',nativeCampaignId:'native',historyImportId:imported.id,operationId:'op',sourceRevision:'original',basis:'mapped_creative_after_creation_reconciliation',originalStatus:'partial',originalRequestCoverage:'unknown',evidenceRecordIds:imported.recordRefs.filter(r=>['operation','provider_object'].includes(r.kind)).map(r=>r.digest),affectedProviderIds:['102','urn:li:image:original'],providerIds:{group:'99',campaign:'100',creative:'102'},
    grant:{id:'g',projectId:'p',revision:1,provider:'linkedin',accountId:'123',organizationId:'42',currency:'USD',timezone:'UTC',label:'Fixture',permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'}};
  const state={account:{id:'123',currency:'USD',timezone:'UTC'},group:{id:'99',accountId:'123',status:'ACTIVE'},
    campaign:{id:'100',accountId:'123',groupId:'99',organizationId:'42',status:'PAUSED'},creatives:[{id:'102',campaign:'urn:li:sponsoredCampaign:100',intendedStatus:'PAUSED'}]};
  const evidence:ExistingLinkedInHierarchyInspection={provider:'linkedin',source:'provider_api',snapshot:state,digest:digest(state),observedAt:new Date().toISOString(),inventoryComplete:true,allPaused:true,scope:'exact_campaign_and_complete_children',sharedGroupModified:false,historicalEffectsSettled:false,materialVerified:false,executionTransferred:false,spendingAuthorityGranted:false};
  let reads=0,changed=false;
  const source:HistoricalEffectSource={authorize:async()=>{},capture:async()=>structuredClone(candidate),assertCurrent:async()=>{if(changed)throw Error('source changed');},withCurrentSource:async(_p,_c,commit)=>commit()};
  const provider={evidence:'provider',inspectExistingLinkedInHierarchy:async(_g:unknown,_ids:unknown,guard:()=>Promise<void>)=>{reads++;await guard();return structuredClone(evidence);}} as ProviderPort;
  const service=new HistoricalEffectResolutions(store,source,createStoreSessionAuthority(store),{linkedin:provider}),input={historyImportId:imported.id,operationId:'op',requestKey:'resolve'};
  return {store,path,principal,snapshot,imported,candidate,evidence,service,input,resolve:()=>service.resolve(principal,'p',input),reads:()=>reads,change:()=>{changed=true;},close:async()=>{await store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('LinkedIn effect evidence preserves partial creation, shared group, request gaps and immutable history',async()=>{
  const f=await fixture();try{
    const receipt=await f.resolve();assert.equal(receipt.basis,'mapped_creative_after_creation_reconciliation');assert.equal(receipt.originalStatus,'partial');assert.equal(receipt.originalRequestCoverage,'unknown');
    assert.equal(receipt.originalOperationRewritten,false);assert.equal(receipt.executionTransferred,false);assert.equal(receipt.spendingAuthorityGranted,false);
    assert.deepEqual(await f.resolve(),receipt);assert.equal(f.reads(),1);assert.deepEqual(await f.service.readRequest(f.principal,'p','resolve'),receipt);
    assert.deepEqual((await readHistoricalCampaignSnapshot(f.store,'p',f.imported.id)).snapshot,f.snapshot);
    for(const kind of ['campaign','grant','campaignExecutionOwner','advertisingBudgetReservation','operation'])assert.deepEqual(await f.store.list('p',kind),[]);
    const reopened=await testStore(f.path);try{assert.deepEqual(await reopened.get('p','historicalEffectResolution',receipt.id),receipt);}finally{await reopened.close();}
  }finally{await f.close();}
});
for(const mode of ['account','foreignCreative','missingReference','groupAffected','noCreative','wrongProvider'])test(`LinkedIn effect rejects ${mode} before reads`,async()=>{
  const f=await fixture();try{
    if(mode==='account')f.candidate.grant.accountId='999';if(mode==='wrongProvider')f.candidate.grant.provider='meta';
    if(mode==='foreignCreative')f.candidate.affectedProviderIds.push('999');if(mode==='groupAffected')f.candidate.affectedProviderIds.push('99');
    if(mode==='noCreative')f.candidate.affectedProviderIds=['urn:li:image:original'];
    if(mode==='missingReference')f.candidate.evidenceRecordIds=f.candidate.evidenceRecordIds.filter(id=>id!==f.imported.recordRefs.find(r=>r.sourceId==='creative')!.digest);
    await assert.rejects(f.resolve());assert.equal(f.reads(),0);assert.deepEqual(await f.store.list('p','historicalEffectResolution'),[]);
  }finally{await f.close();}
});
for(const mode of ['active','extra','wrongParent','wrongGroup','wrongOrganization','incomplete','groupModified'])test(`LinkedIn effect rejects ${mode} provider evidence`,async()=>{
  const f=await fixture();try{
    const s=f.evidence.snapshot;if(mode==='active')s.creatives[0]!.intendedStatus='ACTIVE';if(mode==='extra')s.creatives.push({...s.creatives[0]!,id:'999'});
    if(mode==='wrongParent')s.creatives[0]!.campaign='urn:li:sponsoredCampaign:999';if(mode==='wrongGroup')s.campaign.groupId='999';if(mode==='wrongOrganization')s.campaign.organizationId='999';
    if(mode==='incomplete')(f.evidence as any).inventoryComplete=false;if(mode==='groupModified')(f.evidence as any).sharedGroupModified=true;
    f.evidence.digest=digest(s);await assert.rejects(f.resolve(),{code:'historical_effect_provider_evidence_invalid'});assert.equal(await f.service.readRequest(f.principal,'p','resolve'),null);
  }finally{await f.close();}
});
test('LinkedIn source change during save rolls back all evidence and request pointers',async()=>{
  const f=await fixture();try{const put=f.store.put.bind(f.store);f.store.put=async(...args)=>{await put(...args);if(args[1]==='historicalEffectResolution')f.change();};
    await assert.rejects(f.resolve(),/source changed/);for(const kind of ['historicalEffectResolution','historicalEffectRequest','historicalEffectCurrent'])assert.deepEqual(await f.store.list('p',kind),[]);
  }finally{await f.close();}
});
