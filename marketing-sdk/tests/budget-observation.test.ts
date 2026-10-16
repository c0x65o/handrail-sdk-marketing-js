import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readBudgetSpendObservation,type BudgetAccountingWindow} from '../server/budget-observation.js';
import {buildMeasurementEvidence,measured,unknownMeasurement,saveMeasurementEvidence,observedMeasurementSpend} from '../server/measurement.js';
import type {MeasurementInput,MeasurementEvidence} from '../core/measurement.js';
import {testStore} from './datastore.js';
const at='2026-11-01T18:00:00.000Z',options={asOf:at,maxAgeMs:60000};
const accounting:BudgetAccountingWindow={projectId:'p',from:'2026-11-01T00:00:00.000Z',until:'2026-12-01T00:00:00.000Z',timezone:'UTC',currency:'USD',minorUnitsPerMajor:100};
function data(provider:'meta'|'linkedin'):MeasurementInput{
 const meta=provider==='meta',id=meta?'meta-c':'linkedin-c',days=meta?['2026-10-31','2026-11-01']:['2026-11-01'];
 return {identity:{projectId:'p',nativeCampaignId:id,sdkCampaignId:id,provider,accountId:meta?'123':'456',campaignIds:[id],materialVersion:null,purpose:'acquisition'},
 window:{from:meta?'2026-10-31T05:00:00.000Z':accounting.from,until:meta?'2026-11-02T06:00:00.000Z':'2026-11-02T00:00:00.000Z',timezone:meta?'America/Chicago':'UTC',currency:'USD',minorUnitsPerMajor:100},
 source:{kind:'provider_api',collector:'synthetic-bound-test',apiVersion:'fixture',collectedAt:at,receiptIds:['synthetic-provider-response'],snapshotDigests:['a'.repeat(64)],paginationComplete:true,missingReason:null,dataThrough:null},
 rows:days.map((day,index)=>({campaignId:id,day,placement:null,spendMinor:measured(index?500:100),impressions:measured(1000),clicks:measured(1),outboundClicks:measured(1),landingViews:unknownMeasurement('not_requested'),providerConversions:unknownMeasurement('unqualified'),conversionDefinition:null,providerCpm:unknownMeasurement('not_requested'),providerOutboundCtrPercent:unknownMeasurement('not_requested')})),
 delivery:{configuredStatus:'PAUSED',effectiveStatus:'PAUSED',evidenceRefs:['synthetic-provider-response']},outcomes:null,
 maturity:{state:'unknown',reason:'unqualified',evidenceRefs:[],reportingLagEndsAt:null,attributionEndsAt:null,rereadAt:null,coverageVerified:false}};
}
const scope=(d:MeasurementInput)=>({projectId:d.identity.projectId,nativeCampaignId:d.identity.nativeCampaignId!,provider:d.identity.provider,accountId:d.identity.accountId,campaignIds:d.identity.campaignIds,window:d.window});
const reader=(rows:MeasurementEvidence[])=>({list:async<T>(project:string,kind:string)=>{assert.equal(project,'p');assert.equal(kind,'measurementEvidence');return structuredClone(rows) as T[];}});

test('budget observation includes timezone boundary days while actual measurement totals remain incompatible',async()=>{
 const a=data('meta'),b=data('linkedin'),rows=[buildMeasurementEvidence(a),buildMeasurementEvidence(b)],before=structuredClone(rows);
 const result=await readBudgetSpendObservation(reader(rows),[scope(a),scope(b)],accounting,options);
 assert.equal(result.basis,'observed_provider_calendar_upper_bound');assert.equal(result.observedSpendUpperBoundMinor.value,700);
 assert.equal(result.observationComplete,true);assert.equal(result.reportingLagUnbounded,true);
 assert.deepEqual(result.evidenceIds,rows.map(r=>r.id));assert.deepEqual(result.components.map(c=>c.providerWindow),[a.window,b.window]);
 assert.equal(result.components[0]!.observedSpendMinor.value,600);assert.equal(result.oldestCollectedAt,at);
 assert.equal(observedMeasurementSpend(rows,options).spendMinor.value,null);
 assert.deepEqual(rows,before);
});

test('incomplete, stale, expired, mismatched, overlapping and synthetic observations never become budget capacity',async()=>{
 for(const patch of [(d:MeasurementInput)=>{d.rows.pop();},(d:MeasurementInput)=>{d.source.paginationComplete=false;},
  (d:MeasurementInput)=>{d.source.missingReason='expired_credentials';},(d:MeasurementInput)=>{d.source.kind='synthetic';},
  (d:MeasurementInput)=>{d.source.collectedAt='2026-11-01T17:00:00.000Z';},
  (d:MeasurementInput)=>{d.rows[0]!.spendMinor=unknownMeasurement('missing_spend');},
  (d:MeasurementInput)=>{d.window.currency='EUR';},(d:MeasurementInput)=>{d.window.minorUnitsPerMajor=1000;},
  (d:MeasurementInput)=>{d.window.from='2026-11-01T05:00:00.000Z';d.rows.shift();}]){
  const d=data('meta');patch(d);const result=await readBudgetSpendObservation(reader([buildMeasurementEvidence(d)]),[scope(d)],accounting,options);
  assert.equal(result.observedSpendUpperBoundMinor.value,null);assert.equal(result.observationComplete,false);assert.ok(result.reasons.length);
 }
 const d=data('meta'),s=scope(d),rows=[buildMeasurementEvidence(d)];
 assert.equal((await readBudgetSpendObservation(reader(rows),[s,s],accounting,options)).observedSpendUpperBoundMinor.value,null);
 assert.equal((await readBudgetSpendObservation(reader(rows),[s,{...s,nativeCampaignId:'absent'}],accounting,options)).observedSpendUpperBoundMinor.value,null);
 assert.equal((await readBudgetSpendObservation(reader(rows),[],accounting,options)).observedSpendUpperBoundMinor.value,null);
 let reads=0;const foreign={list:async<T>()=>{reads++;return [] as T[];}};
 await assert.rejects(readBudgetSpendObservation(foreign,[{...s,projectId:'other'}],accounting,options),/project_mismatch/);assert.equal(reads,0);
});

test('newer partial corrections supersede complete budget evidence and never write a projection',async()=>{
 const d=data('meta'),complete=buildMeasurementEvidence(d),rows=[complete];
 const r=reader(rows),s=scope(d);assert.equal((await readBudgetSpendObservation(r,[s],accounting,options)).observedSpendUpperBoundMinor.value,600);
 d.source.collectedAt='2026-11-01T18:00:01.000Z';d.source.paginationComplete=false;
 const partial=buildMeasurementEvidence(d,complete.id);rows.push(partial);
 const corrected=await readBudgetSpendObservation(r,[s],accounting,{...options,asOf:d.source.collectedAt});
 assert.equal(corrected.observedSpendUpperBoundMinor.value,null);assert.deepEqual(corrected.evidenceIds,[partial.id]);assert.equal(rows.length,2);
});

test('durable budget read retains parent revision identity and explicit observed zero across PostgreSQL restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-evidence-')),path=join(dir,'db');let store=await testStore(path);
 try{
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','synthetic');
  const d=data('meta');d.rows.forEach(row=>row.spendMinor=measured(0));const parent=await saveMeasurementEvidence(store,d);
  await store.close();store=await testStore(path);
  const result=await readBudgetSpendObservation(store,[scope(d)],accounting,options);
  assert.equal(result.observedSpendUpperBoundMinor.value,0);assert.equal(result.observationComplete,true);assert.deepEqual(result.evidenceIds,[parent.id]);
  assert.equal((await store.list('p','measurementEvidence')).length,1);
 }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});
