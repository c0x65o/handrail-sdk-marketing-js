import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testStore } from './datastore.js';
import { fixtureSettings } from './capability-fixtures.js';
import { CampaignExecutionAdoptions, type ExecutionAdoptionCandidate, type ExecutionAdoptionSource } from '../server/execution-adoption.js';
import { HistoricalCampaignImports } from '../server/adoption.js';
import { bindAdoptedMeasurementIdentity } from '../server/measurement-adoption.js';
import { measured, unknownMeasurement, saveMeasurementRevision, readMeasurementEvidence } from '../server/measurement.js';
import type { MeasurementInput } from '../core/measurement.js';
import { createStoreSessionAuthority, inspectLiveSessions } from '../server/session-authority.js';
import { byteDigest, digest } from '../server/store.js';
import type { Asset, Campaign, Grant, Material, Receipt } from '../core/index.js';
import type { HistoricalCampaignSnapshot, HistoricalRecord } from '../core/adoption.js';
import type { ProviderPort } from '../server/ports.js';

async function fixture(providerName: "meta" | "linkedin" = "meta") {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-execution-adoption-')), path = join(dir, 'db');
  const store = await testStore(path);
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p', 'Adoption');
  const user = await store.createUser('owner', 'fixture');
  await store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user, 'p', 'admin');
  const principal = await store.authenticate((await store.login('owner', 'fixture', 'fixture'))!);
  const bytes = readFileSync(new URL('../../marketing-sdk/tests/fixtures/test-pattern.png', import.meta.url)), hash = byteDigest(bytes);
  const grant: Grant = { id: 'existing-grant', projectId: 'p', provider: providerName, revision: 1, accountId: providerName === 'meta' ? 'act_123' : '123', pageId: '42', organizationId: '42',
    label: 'Existing fixture authority', currency: 'USD', timezone: 'UTC', permissions: ['pause', 'report'],
    expiresAt: '2099-01-01T00:00:00Z', revokedAt: null, secretRef: 'retained-vault-reference' };
  const asset: Asset = { id: 'original-asset', projectId: 'p', campaignId: 'native', version: 1, kind: 'image', digest: hash,
    mime: 'image/png', width: 320, height: 180, seconds: null, source: 'uploaded', jobId: null, rightsReceipt: 'original-rights', parentAssetIds: [] };
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
  const nativeMedia = [{asset, bytes}];
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
