import test from 'node:test';
import sharp from 'sharp';
import {prepareMetaImageUpload} from '../server/meta-image.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testStore } from './datastore.js';
import { fixtureSettings } from './capability-fixtures.js';
import { CampaignExecutionAdoptions, type ExecutionAdoptionCandidate, type ExecutionAdoptionSource, type ExecutionAdoptionMedia } from '../server/execution-adoption.js';
import { HistoricalCampaignImports } from '../server/adoption.js';
import { HistoricalPurposeResolutions } from '../server/historical-purpose.js';
import { MarketingServer } from '../server/service.js';
import { DomainError } from '../server/store.js';
import type { ExecutionAuthority } from '../server/execution-authority.js';
import { bindAdoptedMeasurementIdentity } from '../server/measurement-adoption.js';
import { measured, unknownMeasurement, saveMeasurementRevision, readMeasurementEvidence } from '../server/measurement.js';
import type { MeasurementInput } from '../core/measurement.js';
import { createStoreSessionAuthority, inspectLiveSessions } from '../server/session-authority.js';
import { byteDigest, digest } from '../server/store.js';
import type { Asset, Campaign, Grant, Material, Receipt } from '../core/index.js';
import type { HistoricalCampaignSnapshot, HistoricalRecord } from '../core/adoption.js';
import type { ProviderPort } from '../server/ports.js';

async function fixture(providerName: "meta" | "linkedin" = "meta", withOriginal=false, unknownPurpose=false) {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-execution-adoption-')), path = join(dir, 'db');
  const store = await testStore(path);
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p', 'Adoption');
  const user = await store.createUser('owner', 'fixture');
  await store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user, 'p', 'admin');
  const principal = await store.authenticate((await store.login('owner', 'fixture', 'fixture'))!);
  const rawBytes=readFileSync(new URL('../../marketing-sdk/tests/fixtures/test-pattern.png', import.meta.url));
  const sourceBytes=withOriginal?await sharp(rawBytes).webp().toBuffer():null;
  const bytes=sourceBytes?(await prepareMetaImageUpload({bytes:sourceBytes,mime:'image/webp',filename:'original.webp'})).bytes:rawBytes,hash=byteDigest(bytes);
  const grant: Grant = { id: 'existing-grant', projectId: 'p', provider: providerName, revision: 1, accountId: providerName === 'meta' ? 'act_123' : '123', pageId: '42', organizationId: '42',
    label: 'Existing fixture authority', currency: 'USD', timezone: 'UTC', permissions: ['pause', 'report'],
    expiresAt: '2099-01-01T00:00:00Z', revokedAt: null, secretRef: 'retained-vault-reference' };
  const asset: Asset = { id: 'original-asset', projectId: 'p', campaignId: 'native', version: 1, kind: 'image', digest: hash,
    mime: withOriginal?'image/jpeg':'image/png', width: 320, height: 180, seconds: null, source: 'uploaded', jobId: null, rightsReceipt: 'original-rights', parentAssetIds: [] };
  const material: Material = { name: 'Retained ad', headline: 'Original headline', body: 'Original body', purpose: 'acquisition',
    settings: fixtureSettings(providerName, grant.accountId, '42'), destination: 'https://example.com', destinationDigest: 'a'.repeat(64),
    assetIds: [asset.id], audience: { provider: 'meta', locations: ['US'], ageMin: 25, ageMax: 54, expansion: false },
    budget: { currency: 'USD', minor: 42000 }, startAt: '2026-10-01T00:00:00Z', endAt: '2026-11-01T00:00:00Z', timezone: 'UTC' };
  if(providerName==='linkedin'){material.audience={provider:'linkedin',locations:['urn:li:geo:1'],expansion:false};material.advertisingBudget={lifetime:material.budget!,daily:{currency:'USD',minor:3000}};}
  await store.put('p', 'grant', grant.id, grant);
  const row = (kind: HistoricalRecord['kind'], sourceId: string, payload: HistoricalRecord['payload']): HistoricalRecord => ({
    kind, sourceId, sourceRevision: '1', recordedAt: null, collectedAt: '2026-10-14T00:00:00Z', provenance: 'legacy_observation',
    evidenceId: null, missingReasons: ['historical_timestamp_unknown'], payload });
  const snapshot: HistoricalCampaignSnapshot = { schemaVersion: 1, projectId: 'p', nativeCampaignId: 'native', provider: providerName, accountId: '123',
    providerCampaignIds: ['100'], identityMissingReasons: [], purpose: 'acquisition', purposeReason: null,
    source: { system: 'native-fixture', revision: '1', capturedAt: '2026-10-14T00:00:00Z', receiptRefs: ['original-source'] },
    records: [row('campaign', 'native', { providerId: '100' }), row('provider_object', 'upload', { image: 'original-image', digest: hash, status: 'accepted' }),
      row('operation', 'historical-unknown', { status: 'unknown' }), row('event', 'original-conversion', { attribution: 'original-attribution' })],
    expectedCounts: { campaign: 1, provider_object: 1, operation: 1, event: 1 }, totals: [], unsettledOperationIds: ['historical-unknown'] };
  if(withOriginal){snapshot.records.push(row('material','source-asset',{digest:byteDigest(sourceBytes!)}));snapshot.expectedCounts.material=1;}
  if(unknownPurpose){snapshot.purpose='unknown';snapshot.purposeReason='native_purpose_not_recorded';}
  const historical = new HistoricalCampaignImports(store, { authorize: async () => {}, capture: async () => snapshot,
    assertCurrent: async () => {}, withCurrentSnapshot: async (_p, _s, commit) => commit() });
  const history = await historical.stage(principal, 'p', 'native', 'history');
  const candidate: ExecutionAdoptionCandidate = { projectId: 'p', nativeCampaignId: 'native', historyImportId: history.id, sourceRevision: '1',
    grantId: grant.id, material, providerIds: { campaign: '100', adset: '101', ad: '102', creative: '103', image: 'original-image' },
    media: [{ assetId: asset.id, uploadedDigest: hash, providerImageId: 'original-image', historyRecordId: history.recordRefs.find(r => r.sourceId === 'upload')!.digest }],
    retirement: { state: 'all_legacy_writes_disabled', receiptRefs: ['monotonic-retirement'] }, unsettledOperationIds: [],
    settlements: [{ operationId: 'historical-unknown', receiptRefs: ['actual-read-only-reconciliation'] }] };
  if(providerName==='linkedin')candidate.providerIds={group:'shared-group',campaign:'100',creative:'103',image:'original-image'};
  let denied = false, failCommit = false, reads = 0;
  const nativeMedia:ExecutionAdoptionMedia[] = [{asset, bytes}];
  if(withOriginal){
    const original={...structuredClone(asset),id:'source-asset',version:7,mime:'image/webp',digest:byteDigest(sourceBytes!)};
    asset.parentAssetIds=[original.id];
    nativeMedia[0]!.original={asset:original,bytes:sourceBytes!};
    candidate.media[0]!.original={assetId:original.id,digest:original.digest,historyRecordId:history.recordRefs.find(r=>r.sourceId==='source-asset')!.digest};
  }
  const source: ExecutionAdoptionSource = { authorize: async (_p, project, campaign) => {
    assert.equal(project, 'p'); assert.equal(campaign, 'native'); if (denied) throw Error('current-native-access-revoked');
  }, capture: async () => structuredClone(candidate), readMedia: async () => structuredClone(nativeMedia), assertCurrent: async (_p, expected) => {
    if (denied) throw Error('current-native-access-revoked'); assert.equal(digest(expected), digest(candidate));
  }, withRetiredExecution: async (_p, _c, commit) => { if (failCommit) throw Error('legacy-writer-not-settled'); return commit(); } };
  const unavailable = async (): Promise<never> => { throw Error('Adoption must not call a provider write or approval'); };
  const provider: ProviderPort = { evidence: 'fixture', plan: c => ({ material: c.material }), verify: unavailable, prepare: unavailable,
    activate: unavailable, pause: unavailable, reconcile: unavailable, metrics: unavailable,
    inspectExistingCampaign: async (c, _g, _a, ids, guard) => {
      reads++; await guard(); return { candidateReceipt: { ids: { ...ids, readbackDigest: digest(material) }, payloadDigest: digest({ material: c.material }),
        intent: 'paused', delivery: 'unverified', providerRequestId: 'read-only-observation', observedAt: new Date().toISOString(), evidence: 'fixture' },
        originalMediaContentVerified: false, executionReady: false, missingReasons: ['original_media_content_binding_unverified', 'execution_ownership_not_transferred'] };
    } };
  const sessions = createStoreSessionAuthority(store);
  const service = new CampaignExecutionAdoptions(store, source, sessions, { meta: provider, linkedin: provider }, 'fixture');
  return { store, path, principal, grant, candidate, history, historical, source, provider, service, sessions, nativeMedia,
    deny: () => { denied = true; }, fail: () => { failCommit = true; }, reads: () => reads,
    close: async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('explicit purpose assessment preserves unknown history, records evidence, survives correction/replay and binds paused adoption',async()=>{
  const f=await fixture('meta',false,true);try{
    const service=new HistoricalPurposeResolutions(f.store,f.sessions,f.source.authorize);
    const input={historyImportId:f.history.id,purpose:'acquisition' as const,rationale:'The retained material describes a customer software offer.',
      evidenceRecordIds:[f.history.recordRefs.find(r=>r.kind==='campaign')!.digest],previousResolutionId:null,requestKey:'purpose-1'};
    const first=await service.resolve(f.principal,'p',input);
    assert.equal(first.originalPurpose,'unknown');assert.equal(first.basis,'recorded_assessment');assert.equal(first.spendingAuthorityGranted,false);
    assert.deepEqual(await service.resolve(f.principal,'p',input),first);
    assert.equal((await service.readRequest(f.principal,'p',input.requestKey))!.resolution.id,first.id);
    await assert.rejects(service.resolve(f.principal,'p',{...input,rationale:'Changed'}),/historical_purpose_request_conflict/);
    await assert.rejects(service.resolve(f.principal,'p',{...input,requestKey:'race'}),/historical_purpose_revision_conflict/);
    const second=await service.resolve(f.principal,'p',{...input,previousResolutionId:first.id,requestKey:'purpose-2',rationale:'Rechecked the original customer offer and recorded source.'});
    assert.equal((await service.read(f.principal,'p',f.history.id,first.id))!.current,false);
    assert.deepEqual((await service.read(f.principal,'p',f.history.id))!.resolution,second);
    assert.equal((await f.historical.read(f.principal,'p',f.history.id)).snapshot.purpose,'unknown');
    for(const kind of ['campaign','grant','operation','decision','advertisingBudgetReservation'])assert.equal((await f.store.list('p',kind)).length,kind==='grant'?1:0);
    f.candidate.purposeResolutionId=first.id;
    await assert.rejects(f.service.adopt(f.principal,'p','native','old-assessment'),/adoption_purpose_unverified/);
    f.candidate.purposeResolutionId=second.id;
    const adoption=await f.service.adopt(f.principal,'p','native','assessed-adoption');assert.equal(adoption.purposeResolutionId,second.id);
    await assert.rejects(service.resolve(f.principal,'p',{...input,previousResolutionId:second.id,requestKey:'after-adoption'}),/historical_purpose_already_adopted/);
    const reopened=await testStore(f.path);try{
      const read=new HistoricalPurposeResolutions(reopened,createStoreSessionAuthority(reopened),f.source.authorize);
      assert.deepEqual((await read.read(f.principal,'p',f.history.id,first.id))!.resolution,first);
    }finally{await reopened.close();}
  }finally{await f.close();}
});
for(const mode of ['wrong-record','duplicate-record','no-reason','unknown-purpose','wrong-history','revoked','wrong-material','changed-during-read'])test(`purpose assessment rejects ${mode} without inventing original intent or approval`,async()=>{
  const f=await fixture('meta',false,true);try{
    const service=new HistoricalPurposeResolutions(f.store,f.sessions,f.source.authorize);
    const input:any={historyImportId:f.history.id,purpose:'acquisition',rationale:'Customer offer in retained evidence.',
      evidenceRecordIds:[f.history.recordRefs.find(r=>r.kind==='campaign')!.digest],previousResolutionId:null,requestKey:'purpose'};
    if(mode==='wrong-record')input.evidenceRecordIds=[f.history.recordRefs.find(r=>r.kind==='event')!.digest];
    if(mode==='duplicate-record')input.evidenceRecordIds.push(input.evidenceRecordIds[0]);
    if(mode==='no-reason')input.rationale='';
    if(mode==='unknown-purpose')input.purpose='unknown';
    if(mode==='wrong-history')input.historyImportId='other';
    if(mode==='revoked')f.deny();
    if(['wrong-material','changed-during-read'].includes(mode)){
      const first=await service.resolve(f.principal,'p',input);f.candidate.purposeResolutionId=first.id;
      if(mode==='wrong-material')f.candidate.material.purpose='recruitment';
      else {const inspect=f.provider.inspectExistingCampaign!;f.provider.inspectExistingCampaign=async(...args)=>{
        const observed=await inspect(...args);await service.resolve(f.principal,'p',{...input,previousResolutionId:first.id,requestKey:'changed',rationale:'New assessment.'});return observed;};}
      await assert.rejects(f.service.adopt(f.principal,'p','native','reject-purpose'));
    }else await assert.rejects(service.resolve(f.principal,'p',input));
    assert.equal((await f.store.list('p','campaign')).length,0);assert.equal((await f.store.list('p','decision')).length,0);
    assert.equal((await f.store.get<any>('p','historicalSnapshot',f.history.id)).purpose,'unknown');
  }finally{await f.close();}
});

async function unknownUploadFixture() {
  const f=await fixture('meta',true),original=f.nativeMedia[0]!.original!;
  f.nativeMedia[0]={asset:original.asset,bytes:original.bytes};
  f.candidate.material.assetIds=[original.asset.id];
  f.candidate.media[0]={assetId:original.asset.id,uploadedDigest:null,providerImageId:f.candidate.providerIds.image!,
    historyRecordId:f.candidate.media[0]!.historyRecordId,retainedSource:{digest:original.asset.digest,
      historyRecordId:f.history.recordRefs.find(r=>r.sourceId==='source-asset')!.digest,
      providerFilename:'legacy-image.jpg',missingReason:'historical_filename_hash_is_lossy_text'}};
  const image={accountId:'123',hash:f.candidate.providerIds.image!,name:'legacy-image.jpg',width:320,height:180,status:'ACTIVE',updatedAt:null};
  f.provider.inspectExistingMetaImage=async(g,id,guard)=>{
    assert.equal(g.id,f.grant.id);assert.equal(id,image.hash);await guard();
    return {image:structuredClone(image),providerSnapshotDigest:digest(image),observedAt:new Date().toISOString(),
      originalUploadBytesVerified:false,providerImageReadbackVerified:true,executionTransferred:false,spendingAuthorityGranted:false};
  };
  return {...f,image};
}
test('paused adoption retains unknown upload provenance, original source bytes and independent image readback across replay and reopen',async()=>{
  const f=await unknownUploadFixture();try{
    const receipt=await f.service.adopt(f.principal,'p','native','unknown-upload');
    assert.equal(receipt.mediaProvenance![0]!.originalUploadBytesVerified,false);
    assert.equal(receipt.mediaProvenance![0]!.uploadedDigest,null);
    assert.equal(receipt.mediaProvenance![0]!.missingReason,'historical_filename_hash_is_lossy_text');
    assert.deepEqual(receipt.mediaProvenance![0]!.providerImage!.image,f.image);
    assert.deepEqual(await f.store.get('p','asset','source-asset'),f.nativeMedia[0]!.asset);
    assert.equal((await f.store.list('p','asset')).length,1,'No guessed upload or re-encoded asset is persisted');
    const blob=await f.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get('p',f.nativeMedia[0]!.asset.digest);
    assert.deepEqual(Buffer.from(blob!.bytes as Uint8Array),f.nativeMedia[0]!.bytes);
    assert.deepEqual((await f.historical.read(f.principal,'p',f.history.id)).receipt,f.history);
    assert.equal((await f.store.get<Campaign>('p','campaign','native')).state,'paused');
    assert.deepEqual(await f.store.get('p','grant',f.grant.id),f.grant);
    for(const kind of ['decision','packet','operation','event','advertisingBudgetReservation'])assert.equal((await f.store.list('p',kind)).length,0);
    const before=f.reads();assert.deepEqual(await f.service.adopt(f.principal,'p','native','unknown-upload'),receipt);assert.equal(f.reads(),before);
    const reopened=await testStore(f.path);try{assert.deepEqual(await reopened.get('p','executionAdoption',receipt.id),receipt);}finally{await reopened.close();}
  }finally{await f.close();}
});
for(const failure of ['no-source','source-digest','source-history','bytes','missing-reason','provider-unavailable','account','image','filename','dimensions','inactive','changed-during-image-read','claimed-byte-proof','grant-during-read','missing-settlement'])test(`unknown upload adoption refuses ${failure} without transferring ownership`,async()=>{
  const f=await unknownUploadFixture();try{
    const m=f.candidate.media[0]!;
    if(failure==='no-source')delete m.retainedSource;
    if(failure==='source-digest')m.retainedSource!.digest='f'.repeat(64);
    if(failure==='source-history')m.retainedSource!.historyRecordId=m.historyRecordId;
    if(failure==='bytes')f.nativeMedia[0]!.bytes=Buffer.from('changed');
    if(failure==='missing-reason')m.retainedSource!.missingReason='';
    if(failure==='provider-unavailable')delete f.provider.inspectExistingMetaImage;
    if(failure==='account')f.image.accountId='999';
    if(failure==='image')f.image.hash='other';
    if(failure==='filename')f.image.name='other.jpg';
    if(failure==='dimensions')f.image.width=1;
    if(failure==='inactive')f.image.status='DELETED';
    if(failure==='missing-settlement')f.candidate.settlements=[];
    if(['changed-during-image-read','claimed-byte-proof','grant-during-read'].includes(failure)){
      const inspect=f.provider.inspectExistingMetaImage!;
      f.provider.inspectExistingMetaImage=async(...args)=>{const r=await inspect(...args);
        if(failure==='changed-during-image-read')f.nativeMedia[0]!.asset.rightsReceipt='changed';
        if(failure==='claimed-byte-proof')(r as any).originalUploadBytesVerified=true;
        if(failure==='grant-during-read')await f.store.put('p','grant',f.grant.id,{...f.grant,revision:2});return r;};
    }
    await assert.rejects(f.service.adopt(f.principal,'p','native','reject-unknown-upload'));
    for(const kind of ['campaign','asset','campaignExecutionOwner','providerExecutionOwner','executionAdoption'])assert.equal((await f.store.list('p',kind)).length,0);
    assert.deepEqual((await f.historical.read(f.principal,'p',f.history.id)).receipt,f.history);
  }finally{await f.close();}
});

for(const mode of ['explicit-history','revoked-before-commit'])test(`purpose assessment preserves original records on ${mode}`,async()=>{
  const f=await fixture('meta',false,mode!=='explicit-history');try{
    let checks=0;
    const service=new HistoricalPurposeResolutions(f.store,f.sessions,async(...args)=>{
      if(mode==='revoked-before-commit'&&++checks===2)f.deny();await f.source.authorize(...args);
    });
    await assert.rejects(service.resolve(f.principal,'p',{historyImportId:f.history.id,purpose:'recruitment',rationale:'Assessment fixture.',
      evidenceRecordIds:[f.history.recordRefs.find(r=>r.kind==='campaign')!.digest],previousResolutionId:null,requestKey:'reject'}));
    for(const kind of ['historicalPurposeResolution','historicalPurposeCurrent','historicalPurposeRequest'])assert.equal((await f.store.list('p',kind)).length,0);
  }finally{await f.close();}
});

test('adopted execution uses current host action authority, preserves uncertain effects and recovers without a browser session or replay',async()=>{
  const f=await fixture();try{
    await f.service.adopt(f.principal,'p','native','transfer');
    const principal=await f.store.bindExternalPrincipal('p',{issuer:'native-action',subject:'owner',kind:'agent'},'editor');
    let held=0,revoked=false,revokeAt='',writes=0,reads=0,loseHostAck=false;
    const check=async()=>{if(revoked)throw new DomainError('native_authority_revoked',403);};
    const authority:ExecutionAuthority={assertCurrent:async(p,c)=>{assert.equal(p.userId,principal.userId);assert.equal(c.id,'native');await check();},
      withCurrent:async(_p,_c,_a,local)=>{await check();held++;try{const result=await local();await check();if(loseHostAck&&(result as any)?.state==='succeeded')throw new DomainError('host_commit_ack_lost');return result;}finally{held--;}}};
    const base=MarketingServer.unconnected(f.store);
    const provider:ProviderPort={...f.provider,verify:async()=>{assert.equal(held,0);reads++;if(revokeAt==='verify')revoked=true;return {accountId:f.grant.accountId,currency:'USD',timezone:'UTC',permissions:['pause','report']};},
      pause:async(c,_g,guard)=>{assert.equal(held,0);await guard();writes++;if(revokeAt==='write')revoked=true;return {...c.receipt!,observedAt:new Date().toISOString()};},
      reconcile:async c=>{assert.equal(held,0);reads++;return {...c.receipt!,observedAt:new Date().toISOString()};}};
    const without=new MarketingServer(f.store,{...base.providers,meta:provider},base.generation,base.agent,'fixture');
    await assert.rejects(without.pause(principal,'p',{campaignId:'native',requestKey:'denied'}),/adopted_execution_authority_required/);
    const service=new MarketingServer(f.store,{...base.providers,meta:provider},base.generation,base.agent,'fixture',undefined,undefined,{executionAuthority:authority});
    await f.store.db.acquireExecutor();
    revokeAt='verify';let o=await service.pause(principal,'p',{campaignId:'native',requestKey:'preflight'});
    o=await service.dispatch('p',o.id);assert.equal(o.state,'blocked');assert.equal(writes,0);
    revoked=false;revokeAt='write';o=await service.pause(principal,'p',{campaignId:'native',requestKey:'uncertain'});
    o=await service.dispatch('p',o.id);assert.equal(o.state,'unknown');assert.equal(writes,1);
    assert.equal((await f.store.db.prepare('SELECT operation_id FROM leases WHERE project_id=?').get('p'))!.operation_id,o.id);
    await assert.rejects(service.reconcile(principal,'p',{operationId:o.id}),/native_authority_revoked/);
    revoked=false;revokeAt='';
    const grant=await f.store.get<Grant>('p','grant',f.grant.id);await f.store.put('p','grant',grant.id,{...grant,revision:grant.revision+1});
    await f.store.put('p','operation',o.id,{...o,state:'running'});
    o=await service.recoverExecution(principal,'p',o.id);assert.equal(o.state,'unknown');
    o=await service.reconcile(principal,'p',{operationId:o.id});assert.equal(o.state,'succeeded');assert.equal(writes,1);
    assert.equal(o.grantRevision,1,'original effect authority revision is retained through refreshed readback');
    const before=reads;assert.deepEqual(await service.readExecutionRequest(principal,'p','native','pause','uncertain'),o);assert.equal(reads,before);
    assert.equal(await service.readExecutionRequest(principal,'p','native','pause','not-sent'),null);
    assert.equal(await f.store.db.prepare('SELECT operation_id FROM leases WHERE project_id=?').get('p'),undefined);
    loseHostAck=true;const acknowledged=await service.pause(principal,'p',{campaignId:'native',requestKey:'lost-host-ack'});
    await assert.rejects(service.dispatch('p',acknowledged.id),/host_commit_ack_lost/);loseHostAck=false;
    assert.equal((await service.readExecutionRequest(principal,'p','native','pause','lost-host-ack'))!.state,'succeeded');
    assert.equal(writes,2,'lost host acknowledgement preserves the committed SDK receipt');
    assert.equal((await f.store.list('p','decision')).length,0);assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
  }finally{await f.close();}
});

for (const provider of ['meta','linkedin'] as const) test(`${provider} adopted reporting binds ownership without rewriting history or inventing material intervals`,async()=>{
  const f=await fixture(provider);try{
    const input:MeasurementInput={identity:{projectId:'p',nativeCampaignId:'native',sdkCampaignId:null,provider,accountId:'123',campaignIds:['100'],materialVersion:null,purpose:'acquisition'},
      window:{from:'2026-10-01T00:00:00Z',until:'2026-10-02T00:00:00Z',timezone:'UTC',currency:'USD',minorUnitsPerMajor:100},
      source:{kind:'synthetic',collector:'fixture',apiVersion:'fixture',collectedAt:'2026-10-02T01:00:00Z',receiptIds:['original-api-read'],snapshotDigests:['a'.repeat(64)],paginationComplete:true,missingReason:null,dataThrough:'2026-10-02T00:00:00Z'},
      rows:[{campaignId:'100',day:'2026-10-01',placement:null,spendMinor:measured(500),impressions:measured(685),clicks:measured(1),outboundClicks:measured(1),landingViews:unknownMeasurement('unavailable'),providerConversions:unknownMeasurement('unqualified'),conversionDefinition:null,providerCpm:unknownMeasurement('unavailable'),providerOutboundCtrPercent:unknownMeasurement('unavailable')}],
      delivery:{configuredStatus:'PAUSED',effectiveStatus:'PAUSED',evidenceRefs:['original-api-read']},outcomes:null,
      maturity:{state:'unknown',reason:'attribution_unknown',evidenceRefs:[],reportingLagEndsAt:null,attributionEndsAt:null,rereadAt:null,coverageVerified:false}};
    assert.deepEqual(await bindAdoptedMeasurementIdentity(f.store,input),input);
    const original=await saveMeasurementRevision(f.store,input),adoption=await f.service.adopt(f.principal,'p','native','measurement-adoption');
    assert.deepEqual(await bindAdoptedMeasurementIdentity(f.store,input),input,'old collection is not relabeled');
    const fresh={...input,source:{...input.source,collectedAt:new Date(Date.parse(adoption.adoptedAt)+1000).toISOString()}};
    const bound=await bindAdoptedMeasurementIdentity(f.store,fresh);
    assert.equal(fresh.identity.sdkCampaignId,null);assert.equal(bound.identity.sdkCampaignId,adoption.sdkCampaignId);
    assert.equal(bound.identity.materialVersion,null);assert.deepEqual(bound.source.receiptIds,['original-api-read',adoption.id,adoption.historyImportId,original.id]);
    const saved=await saveMeasurementRevision(f.store,bound);
    assert.equal((await saveMeasurementRevision(f.store,await bindAdoptedMeasurementIdentity(f.store,fresh))).id,saved.id);
    const revised=await saveMeasurementRevision(f.store,await bindAdoptedMeasurementIdentity(f.store,{...fresh,source:{...fresh.source,collectedAt:new Date(Date.parse(fresh.source.collectedAt)+1000).toISOString()}}));
    assert.equal(revised.previousEvidenceId,saved.id);assert.equal(revised.metrics.weightedCpm.value,1000*5/685);
    assert.deepEqual(await readMeasurementEvidence(f.store,'p',original.id),original);
    assert.equal(revised.maturity.state,'unknown');assert.equal(revised.metrics.costPerQualifiedMinor.value,null);
    for(const patch of [{accountId:'456'},{campaignIds:['other']},{sdkCampaignId:'other'},{purpose:'recruitment' as const},{materialVersion:'1'}])
      await assert.rejects(bindAdoptedMeasurementIdentity(f.store,{...fresh,identity:{...fresh.identity,...patch}}),/measurement_adoption_/);
    await f.store.put('p','campaignExecutionOwner','native',{receiptId:adoption.id,executor:'legacy'});
    await assert.rejects(bindAdoptedMeasurementIdentity(f.store,fresh),/measurement_execution_owner_invalid/);
    for(const kind of ['decision','operation','advertisingBudgetReservation'])assert.equal((await f.store.list('p',kind)).length,0);
  }finally{await f.close();}
});

for (const name of ['meta','linkedin'] as const) test(`${name} daily-only open-ended adoption preserves absent caps and schedule without authority`, async () => {
  const f=await fixture(name);try {
    f.candidate.material.budget=null; f.candidate.material.endAt=null;
    f.candidate.material.advertisingBudget={daily:{currency:'USD',minor:500}};
    await f.service.adopt(f.principal,'p','native','daily-original');
    const c=await f.store.get<Campaign>('p','campaign','native');
    assert.equal(c.material.budget,null);assert.equal(c.material.endAt,null);
    assert.deepEqual(c.material.advertisingBudget,{daily:{currency:'USD',minor:500}});
    assert.deepEqual(c.preparedMaterial,c.material);assert.equal(c.state,'paused');
    for(const kind of ['decision','packet','operation','advertisingBudgetReservation'])assert.equal((await f.store.list('p',kind)).length,0);
  } finally {await f.close();}
});

test('adoption persists one stopped SDK owner, original provider IDs and history without grants, approvals, events or writes', async () => {
  const f = await fixture(); try {
    assert.equal((await f.store.list('p','asset')).length,0);
    assert.equal((await f.store.db.prepare('SELECT * FROM blobs WHERE project_id=?').all('p')).length,0);
    const [a,b] = await Promise.all([f.service.adopt(f.principal,'p','native','adopt'), f.service.adopt(f.principal,'p','native','adopt')]);
    assert.deepEqual(await f.store.get('p','asset',f.nativeMedia[0]!.asset.id),f.nativeMedia[0]!.asset);
    assert.equal(a.mediaAssetsDigest,digest(f.nativeMedia.map(x=>x.asset)));
    const blob=await f.store.db.prepare('SELECT bytes FROM blobs WHERE project_id=? AND digest=?').get('p',f.nativeMedia[0]!.asset.digest);
    assert.deepEqual(Buffer.from(blob!.bytes as Uint8Array),f.nativeMedia[0]!.bytes);
    assert.deepEqual(a,b); assert.equal(a.executionOwner,'sdk'); assert.equal(a.spendingAuthorityGranted,false);
    const c = await f.store.get<Campaign>('p','campaign','native');
    assert.deepEqual(c.material,f.candidate.material); assert.deepEqual(c.preparedMaterial,c.material);
    for (const [key,value] of Object.entries(f.candidate.providerIds)) assert.equal(c.receipt!.ids[key],value);
    assert.equal(c.state,'paused'); assert.equal((await f.store.list('p','campaignExecutionOwner')).length,1);
    assert.equal((await f.store.list('p','providerExecutionOwner')).length,3);
    assert.deepEqual(await f.store.get('p','grant',f.grant.id),f.grant);
    for (const kind of ['decision','packet','operation','event','advertisingBudgetReservation']) assert.equal((await f.store.list('p',kind)).length,0);
    const before = f.reads(); assert.deepEqual(await f.service.adopt(f.principal,'p','native','adopt'),a); assert.equal(f.reads(),before);
    assert.deepEqual(await f.service.readRequest(f.principal,'p','adopt'),a);
    assert.deepEqual((await f.historical.read(f.principal,'p',f.history.id)).receipt,f.history);
    const reopened = await testStore(f.path); try {
      const other = new CampaignExecutionAdoptions(reopened,f.source,createStoreSessionAuthority(reopened),{meta:f.provider,linkedin:f.provider},'fixture');
      assert.deepEqual(await other.readRequest(f.principal,'p','adopt'),a);
    } finally { await reopened.close(); }
    assert.equal((await f.store.db.prepare('SELECT * FROM outbox WHERE type=?').all('campaign.execution_adopted')).length,1);
  } finally { await f.close(); }
});

for (const scenario of ['retirement','unsettled','settlement','media','history','grant','writer','revoked','provider','bytes','owned'] as const)
  test(`adoption rejects ${scenario} without transferring execution or losing history`, async () => {
    const f = await fixture(); try {
      if (scenario==='retirement') f.candidate.retirement.state='quiescing' as any;
      if (scenario==='unsettled') f.candidate.unsettledOperationIds=['still-running'];
      if (scenario==='settlement') f.candidate.settlements=[];
      if (scenario==='media') f.candidate.media[0]!.providerImageId='different-image';
      if (scenario==='history') f.candidate.providerIds.campaign='999';
      if (scenario==='grant') await f.store.put('p','grant',f.grant.id,{...f.grant,revokedAt:new Date().toISOString()});
      if (scenario==='writer') f.fail();
      if (scenario==='revoked') f.deny();
      if (scenario==='provider') f.provider.inspectExistingCampaign=async()=>{throw Error('provider-read-incomplete');};
      if (scenario==='bytes') f.nativeMedia[0]!.bytes=Buffer.from('changed');
      if (scenario==='owned') await f.store.put('p','providerExecutionOwner',digest(['meta','123','campaign','100']),{sdkCampaignId:'other'});
      await assert.rejects(f.service.adopt(f.principal,'p','native','adopt'));
      assert.equal((await f.store.list('p','campaign')).length,0); assert.equal((await f.store.list('p','executionAdoption')).length,0);
      assert.equal((await f.store.list('p','executionAdoptionRequest')).length,0);
      assert.equal((await f.store.list('p','asset')).length,0);
      assert.equal((await f.store.db.prepare('SELECT * FROM blobs WHERE project_id=?').all('p')).length,0);
      assert.deepEqual((await f.historical.read(f.principal,'p',f.history.id)).receipt,f.history);
    } finally { await f.close(); }
  });

test('current access revoked during provider reads prevents final transfer', async () => {
  const f=await fixture(); try {
    const inspect=f.provider.inspectExistingCampaign!;
    f.provider.inspectExistingCampaign=async(...args)=>{const result=await inspect(...args); f.deny();return result;};
    await assert.rejects(f.service.adopt(f.principal,'p','native','adopt'),/current-native-access-revoked/);
    assert.equal((await f.store.list('p','campaignExecutionOwner')).length,0);
  } finally { await f.close(); }
});

test('existing SDK receipts and uncertain operation IDs cannot acquire a second owner', async () => {
  for (const unknown of [false,true]) {
    const f=await fixture(); try {
      const receipt: Receipt = { ids:{campaign:'100'},payloadDigest:'old',intent:'paused',delivery:'unverified',providerRequestId:null,observedAt:new Date().toISOString(),evidence:'fixture' };
      await f.store.put('p','campaign','other',{id:'other',projectId:'p',grantId:f.grant.id,receipt:unknown?null:receipt});
      if(unknown)await f.store.put('p','operation','uncertain',{campaignId:'other',state:'unknown',receipt});
      await assert.rejects(f.service.adopt(f.principal,'p','native','adopt'),/provider_object_already_owned/);
      assert.equal((await f.store.list('p','campaignExecutionOwner')).length,0);
    } finally {await f.close();}
  }
});

test('a lost adoption acknowledgment is recovered by its immutable request receipt without another provider inspection', async () => {
  const f=await fixture(); try {
    f.source.withRetiredExecution=async(_p,_c,commit)=>{await commit();throw Error('lost-commit-acknowledgment');};
    // Store sessions deliberately wrap the entire call in a transaction. An
    // external host holds its own guard through the SDK commit instead.
    const sessions={...f.sessions,withLiveSessions:async<T>(expected:Parameters<typeof f.sessions.withLiveSessions>[0],local:()=>Promise<T>)=>{await inspectLiveSessions(f.sessions,expected);const result=await local();await inspectLiveSessions(f.sessions,expected);return result;}};
    const service=new CampaignExecutionAdoptions(f.store,f.source,sessions,{meta:f.provider,linkedin:f.provider},'fixture');
    await assert.rejects(service.adopt(f.principal,'p','native','lost'),/lost-commit-acknowledgment/);
    const before=f.reads(), saved=await service.readRequest(f.principal,'p','lost');
    assert.ok(saved); assert.equal(f.reads(),before);
    assert.deepEqual(await service.adopt(f.principal,'p','native','lost'),saved);
    assert.equal((await f.store.list('p','campaignExecutionOwner')).length,1);
    assert.deepEqual((await f.store.get<Campaign>('p','campaign','native')).adoptionOrigin,
      {nativeCampaignId:'native',historyImportId:f.history.id,sourceRevision:'1',receiptId:saved.id});
  } finally {await f.close();}
});

test('bytes changed during inspection roll back all ownership records and preserve the original history', async () => {
  const f=await fixture(); try {
    const inspect=f.provider.inspectExistingCampaign!;
    f.provider.inspectExistingCampaign=async(...args)=>{const result=await inspect(...args);f.nativeMedia[0]!.bytes=Buffer.from('changed-after-read');return result;};
    await assert.rejects(f.service.adopt(f.principal,'p','native','changed'),/adoption_media_bytes_changed/);
    for(const kind of ['campaign','providerExecutionOwner','campaignExecutionOwner','executionAdoption','executionAdoptionRequest'])assert.equal((await f.store.list('p',kind)).length,0);
  } finally {await f.close();}
});


test('LinkedIn adoption owns its campaign and creative, never the shared group or image', async()=>{
  const f=await fixture('linkedin');try{
    const adopted=await f.service.adopt(f.principal,'p','native','linkedin');
    assert.equal(adopted.providerReceipt.ids.group,'shared-group');
    const owners=await f.store.list<{type:string}>('p','providerExecutionOwner');
    assert.deepEqual(owners.map(o=>o.type).sort(),['campaign','creative']);
    assert.equal((await f.store.get<Campaign>('p','campaign','native')).material.advertisingBudget!.daily!.minor,3000);
  }finally{await f.close();}
});

test('fixture inspections cannot transfer a live installation', async()=>{
  const f=await fixture();try{
    const live=new CampaignExecutionAdoptions(f.store,f.source,f.sessions,{meta:f.provider,linkedin:f.provider});
    await assert.rejects(live.adopt(f.principal,'p','native','fixture-not-live'),/fixture_provider_not_live/);
    assert.equal(f.reads(),0);
  }finally{await f.close();}
});

for (const conflict of ['asset','blob','metadata-during-read','late-commit'] as const) test(`original media ${conflict} prevents atomic adoption`, async()=>{
  const f=await fixture();try{
    const original=f.nativeMedia[0]!;
    if(conflict==='asset')await f.store.put('p','asset',original.asset.id,{...original.asset,rightsReceipt:'different-rights'});
    if(conflict==='blob')await f.store.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run('p',original.asset.digest,Buffer.from('invalid-retained-bytes'));
    if(conflict==='metadata-during-read'){
      const inspect=f.provider.inspectExistingCampaign!;
      f.provider.inspectExistingCampaign=async(...args)=>{const r=await inspect(...args);original.asset.rightsReceipt='changed';return r;};
    }
    if(conflict==='late-commit'){
      const put=f.store.put.bind(f.store);
      f.store.put=async(...args)=>{if(args[1]==='executionAdoption')throw Error('receipt-write-failed');return put(...args);};
    }
    await assert.rejects(f.service.adopt(f.principal,'p','native','media-conflict'));
    for(const kind of ['campaign','campaignExecutionOwner','providerExecutionOwner','executionAdoption'])assert.equal((await f.store.list('p',kind)).length,0);
    assert.equal((await f.store.list('p','asset')).length,conflict==='asset'?1:0);
    assert.equal((await f.store.db.prepare('SELECT * FROM blobs WHERE project_id=?').all('p')).length,conflict==='blob'?1:0);
  }finally{await f.close();}
});

test('identical retained SDK media can be reused without replacing metadata or bytes',async()=>{
  const f=await fixture();try{
    const original=f.nativeMedia[0]!;
    await f.store.put('p','asset',original.asset.id,original.asset);
    await f.store.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run('p',original.asset.digest,original.bytes);
    await f.service.adopt(f.principal,'p','native','existing-identical');
    await f.service.adopt(f.principal,'p','native','existing-identical-replay');
    assert.equal((await f.store.list('p','asset')).length,1);
    assert.equal((await f.store.db.prepare('SELECT * FROM blobs WHERE project_id=?').all('p')).length,1);
    assert.deepEqual(await f.store.get('p','asset',original.asset.id),original.asset);
  }finally{await f.close();}
});


test('adoption retains original source identity/version and upload asset atomically without replacing history',async()=>{
  const f=await fixture('meta',true);try{
    const receipt=await f.service.adopt(f.principal,'p','native','source-and-upload');
    assert.equal(receipt.mediaRecordIds.length,2);
    assert.equal((await f.store.db.prepare('SELECT * FROM blobs WHERE project_id=?').all('p')).length,2);
    const assets=await f.store.list<Asset>('p','asset');assert.equal(assets.length,2);
    assert.equal((await f.store.get<Asset>('p','asset','source-asset')).version,7);
    assert.deepEqual((await f.store.get<Asset>('p','asset','original-asset')).parentAssetIds,['source-asset']);
    assert.deepEqual(await f.service.adopt(f.principal,'p','native','source-and-upload'),receipt);
    assert.equal((await f.historical.read(f.principal,'p',f.history.id)).receipt.id,f.history.id);
  }finally{await f.close();}
});
for(const mode of ['source-bytes','source-metadata','missing-history','parent','conflicting-source','during-read'])test(`adoption refuses invalid original source: ${mode}`,async()=>{
  const f=await fixture('meta',true);try{
    const original=f.nativeMedia[0]!.original!;
    if(mode==='source-bytes')original.bytes=Buffer.from('changed');
    if(mode==='source-metadata')original.asset.width=1;
    if(mode==='missing-history')f.candidate.media[0]!.original!.historyRecordId=f.candidate.media[0]!.historyRecordId;
    if(mode==='parent')f.nativeMedia[0]!.asset.parentAssetIds=['unrelated'];
    if(mode==='conflicting-source')await f.store.put('p','asset',original.asset.id,{...original.asset,version:99});
    if(mode==='during-read'){const read=f.provider.inspectExistingCampaign!;f.provider.inspectExistingCampaign=async(...args)=>{const r=await read(...args);original.asset.rightsReceipt='changed';return r;};}
    await assert.rejects(f.service.adopt(f.principal,'p','native','bad-source'));
    assert.deepEqual(await f.store.list('p','campaign'),[]);assert.deepEqual(await f.store.list('p','campaignExecutionOwner'),[]);
    assert.equal((await f.store.list('p','asset')).length,mode==='conflicting-source'?1:0);
  }finally{await f.close();}
});

test('paused adoption retains unknown Meta policy without fabricating acknowledgement or new authority',async()=>{
  const f=await fixture();try{
    f.candidate.material.settings!.nondiscriminationAccepted=null;
    const receipt=await f.service.adopt(f.principal,'p','native','unknown-policy');
    const campaign=await f.store.get<Campaign>('p','campaign','native');
    assert.equal(campaign.state,'paused');assert.equal(campaign.material.settings!.nondiscriminationAccepted,null);
    assert.equal(receipt.spendingAuthorityGranted,false);assert.deepEqual((await f.store.get<Grant>('p','grant',f.grant.id)).permissions,['pause','report']);
    assert.equal((await f.store.list('p','decision')).length,0);assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
    assert.deepEqual(await f.service.adopt(f.principal,'p','native','unknown-policy'),receipt);
  }finally{await f.close();}
});
