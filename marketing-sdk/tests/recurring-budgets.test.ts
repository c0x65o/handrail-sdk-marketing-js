import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AdvertisingBudgets,type AdvertisingBudgetPolicy,type AdvertisingBudgetReservation} from '../server/budgets.js';
import {advertisingBudgetPeriod,recurringExposureBound,type RecurringBudgetExposure} from '../server/recurring-budgets.js';
import {testStore} from './datastore.js';
import {fixtureSettings} from './capability-fixtures.js';
import type {Campaign,Operation,Receipt} from '../core/index.js';
const initial=Date.parse('2026-10-31T12:00:00Z');
function policy(projectId='p'):AdvertisingBudgetPolicy{return {
  id:'recurring',projectId,projectIds:[projectId],scope:'project',currency:'USD',timezone:'UTC',
  from:'2026-10-01T00:00:00.000Z',until:'2026-11-01T00:00:00.000Z',
  recurrence:{unit:'monthly',authorityRef:'synthetic-current-native-monthly-policy'},
  dailyCeilingMinor:3000,periodCeilingMinor:30000,campaignDailyCeilingMinor:1000,campaignLifetimeCeilingMinor:10000,maxObservationAgeMs:60000,
};}
function campaign(id='c',projectId='p'):Campaign{return {
  id,projectId,revision:1,grantId:'g',creativeSetId:'cs',state:'paused',receipt:null,
  material:{name:'Existing daily campaign',headline:'Test',body:'Fixture',destination:'https://example.com',destinationDigest:'a'.repeat(64),assetIds:[],
    purpose:'acquisition',audience:{provider:'meta',locations:['US'],expansion:false},settings:fixtureSettings('meta','act_123','42'),
    budget:null,advertisingBudget:{daily:{currency:'USD',minor:500}},
    startAt:'2026-01-01T00:00:00Z',endAt:null,timezone:'America/Chicago'},
};}
function operation(c:Campaign,id='activate'):Operation{return {
  id,projectId:c.projectId,campaignId:c.id,kind:'activate',packetId:'packet',payloadDigest:'a',campaignRevision:1,grantRevision:1,
  accountId:'act_123',state:'running',reason:null,receipt:null,createdAt:new Date(initial).toISOString(),
};}
async function arrangement(){
  const dir=mkdtempSync(join(tmpdir(),'recurring-budget-')),path=join(dir,'db'),store=await testStore(path);
  let now=initial;const ledger=new AdvertisingBudgets(store,()=>now,'provider'),p=policy();
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','synthetic');
  await ledger.configure(p);
  const observe=async(todayMinor:number|null=0,periodMinor:number|null=0)=>ledger.observe('p',{
    policyId:p.id,...advertisingBudgetPeriod(p,now),day:new Date(now).toISOString().slice(0,10),currency:'USD',timezone:'UTC',
    observedAt:new Date(now).toISOString(),todayMinor,periodMinor,source:'provider',receipt:`synthetic-budget-upper-bound:${now}:${todayMinor}:${periodMinor}`,
  });
  return {store,path,ledger,p,observe,setTime:(value:number)=>{now=value;},get time(){return now;},
    close:async()=>{await store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('recurring accounting requires explicit aligned host authority, and preserves daily-only open material',async()=>{
  const t=await arrangement();try{
    for(const change of [{recurrence:{unit:'monthly' as const,authorityRef:''}},{timezone:'America/Chicago'},
      {from:'2026-10-02T00:00:00.000Z'},{until:'2026-12-01T00:00:00.000Z'}])
      await assert.rejects(t.ledger.configure({...t.p,...change}));
    const c=campaign(),original=structuredClone(c),op=operation(c);
    await t.observe();await t.ledger.reserve(c,op);await t.ledger.assert(c,op);
    const [r]=await t.store.list<AdvertisingBudgetReservation>('p','advertisingBudgetReservation');
    assert.equal(r!.dailyMinor,875);assert.equal(r!.periodMinor,875);
    assert.equal(r!.recurringExposure!.lifetimeMinor,null);assert.equal(r!.recurringExposure!.endsAt,null);
    assert.equal(r!.recurringExposure!.providerTimezone,'America/Chicago');assert.deepEqual(c,original);
    await assert.rejects(t.ledger.configure({...t.p,periodCeilingMinor:100000}),/unsettled_reservations/);
    await assert.rejects(t.ledger.reserve(c,operation(c,'competing')),/requires_reconciliation/);
    c.material.advertisingBudget!.daily!.minor=600;
    await assert.rejects(t.ledger.assert(c,op),/campaign_budget_ceiling_exceeded|basis_changed/);
  }finally{await t.close();}
});

test('unsettled commitments survive restart and month rollover; current spend, source and currency remain mandatory',async()=>{
  const t=await arrangement();let second:Awaited<ReturnType<typeof testStore>>|undefined;
  try{
    await t.observe();const c=campaign(),op=operation(c);await t.ledger.reserve(c,op);
    second=await testStore(t.path);const restarted=new AdvertisingBudgets(second,()=>t.time,'provider');
    t.setTime(Date.parse('2026-11-01T12:00:00Z'));
    await assert.rejects(restarted.assert(c,op),/current_observed_spend_required/);
    await t.observe(0,null);await assert.rejects(restarted.assert(c,op),/current_observed_spend_required/);
    t.setTime(t.time+1);await t.observe();await restarted.assert(c,op);
    const rows=await second.list<AdvertisingBudgetReservation>('p','advertisingBudgetReservation');
    assert.equal(rows.length,1);assert.equal(rows[0]!.state,'held');assert.equal(rows[0]!.recurringExposure!.pausedAt,null);
    // November spans 31 Chicago dates; the October hold is still charged.
    const current=advertisingBudgetPeriod(t.p,t.time);
    assert.equal(recurringExposureBound(rows[0]!.recurringExposure!,current.from,current.until),27125);
    const other=campaign('other');await assert.rejects(restarted.reserve(other,operation(other,'next')),/advertising_budget_exceeded/);
    const obs={policyId:t.p.id,...advertisingBudgetPeriod(t.p,t.time),day:'2026-11-01',currency:'USD',timezone:'UTC',
      observedAt:new Date(t.time+1).toISOString(),todayMinor:0,periodMinor:0,source:'fixture' as const,receipt:'synthetic-fixture'};
    t.setTime(t.time+1);await restarted.observe('p',obs);
    await assert.rejects(restarted.assert(c,op),/current_observed_spend_required/);
    await assert.rejects(restarted.observe('p',{...obs,currency:'EUR'}),/spend_basis_mismatch/);
    t.setTime(t.time+1);
    await restarted.observe('p',{...obs,source:'provider',observedAt:new Date(t.time).toISOString(),oldestSourceCollectedAt:new Date(t.time-60001).toISOString(),receipt:'old-provider-read-reobserved-now'});
    await assert.rejects(restarted.assert(c,op),/current_observed_spend_required/);
    await assert.rejects(restarted.observe('p',{...obs,oldestSourceCollectedAt:new Date(t.time+1000).toISOString()}),/spend_collection_after_observation/);
  }finally{await second?.close();await t.close();}
});

test('verified pause retains incurred capacity and immutable effect references, then ends future exposure',async()=>{
  const t=await arrangement();try{
    await t.observe();const c=campaign(),op=operation(c);await t.ledger.reserve(c,op);await t.ledger.settle(c,op,'enabled');
    const pause={...op,id:'pause',kind:'pause' as const};
    const receipt:Receipt={delivery:'unverified',providerRequestId:null,evidence:'provider',ids:{campaign:'original-provider-campaign'},intent:'paused',payloadDigest:op.payloadDigest,observedAt:new Date(t.time).toISOString()};
    await assert.rejects(t.ledger.settle(c,pause,'paused'),/verified_pause_receipt_required/);
    await assert.rejects(t.ledger.settle(c,pause,'paused',receipt),/not_found/);
    await t.store.put('p','operation',pause.id,pause);
    await assert.rejects(t.ledger.settle(c,pause,'paused',{...receipt,payloadDigest:'wrong'}),/verified_pause_receipt_required/);
    await assert.rejects(t.ledger.settle(c,pause,'paused',{...receipt,evidence:'fixture'}),/verified_pause_receipt_required/);
    t.setTime(t.time+1000);await t.ledger.settle(c,pause,'paused',receipt);
    const [r]=await t.store.list<AdvertisingBudgetReservation>('p','advertisingBudgetReservation');
    await assert.rejects(t.ledger.reserve(c,op),/requires_reconciliation/);
    assert.equal(r!.state,'paused');assert.equal(r!.recurringExposure!.pauseOperationId,'pause');assert.ok(r!.recurringExposure!.pauseReceiptDigest);
    assert.equal(recurringExposureBound(r!.recurringExposure!,t.p.from,t.p.until),875);
    assert.equal(recurringExposureBound(r!.recurringExposure!,'2026-11-01T00:00:00.000Z','2026-12-01T00:00:00.000Z'),0);
    t.setTime(t.time+1);await t.ledger.settle(c,pause,'paused',receipt);
    assert.deepEqual(await t.store.get('p','advertisingBudgetReservation',r!.id),r);
    // A current spend observation cannot clear incurred reservations.
    await t.observe(2500,2500);await assert.rejects(t.ledger.reserve(c,operation(c,'resume')),/advertising_budget_exceeded/);
    t.setTime(Date.parse('2026-11-01T12:00:00Z'));await t.observe();
    await t.ledger.reserve(c,operation(c,'resume'));
    const rows=await t.store.list<AdvertisingBudgetReservation>('p','advertisingBudgetReservation');
    assert.equal(rows.length,2);assert.deepEqual(rows.find(row=>row.id===r!.id),r);
    assert.equal(rows.find(row=>row.operationId==='resume')!.state,'held');
  }finally{await t.close();}
});

test('future scheduled and next-period exposure cannot overbook recurring authority',async()=>{
  const t=await arrangement();try{
    await t.observe();const first=campaign();await t.ledger.reserve(first,operation(first));
    const future=campaign('future');future.material.startAt='2027-01-01T00:00:00Z';
    await assert.rejects(t.ledger.reserve(future,operation(future,'future')),/advertising_budget_exceeded/);
    assert.equal((await t.store.list('p','advertisingBudgetReservation')).length,1);
  }finally{await t.close();}
});

test('calendar bounds respect DST, weekly Monday boundaries, lifetime caps and non-overlap',()=>{
  const p=policy();p.recurrence!.unit='weekly';
  assert.deepEqual(advertisingBudgetPeriod(p,Date.parse('2026-11-01T23:59:59Z')),{from:'2026-10-26T00:00:00.000Z',until:'2026-11-02T00:00:00.000Z'});
  const e:RecurringBudgetExposure={startsAt:'2026-01-01T00:00:00Z',endsAt:null,providerTimezone:'America/Chicago',providerDailyMinor:875,lifetimeMinor:null,pausedAt:null,pauseOperationId:null,pauseReceiptDigest:null};
  assert.equal(recurringExposureBound(e,'2026-11-01T00:00:00Z','2026-11-02T00:00:00Z'),1750);
  assert.equal(recurringExposureBound(e,'2026-11-01T05:00:00Z','2026-11-02T06:00:00Z'),875);
  assert.equal(recurringExposureBound(e,'2026-03-08T06:00:00Z','2026-03-09T05:00:00Z'),875);
  assert.equal(recurringExposureBound({...e,lifetimeMinor:900},'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z'),900);
  assert.equal(recurringExposureBound({...e,pausedAt:'2026-10-31T00:00:00Z'},'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z'),0);
});

test('independent SQL connections serialize recurring admissions and preserve losing rollback',async()=>{
  const t=await arrangement();const second=await testStore(t.path);try{
    await t.observe();const other=new AdvertisingBudgets(second,()=>t.time,'provider');
    const a=campaign('a'),b=campaign('b');
    const results=await Promise.allSettled([t.ledger.reserve(a,operation(a,'a')),other.reserve(b,operation(b,'b'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/advertising_budget_exceeded/);
    assert.equal((await t.store.list('p','advertisingBudgetReservation')).length,1);
  }finally{await second.close();await t.close();}
});
