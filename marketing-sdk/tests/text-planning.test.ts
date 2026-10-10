import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { CampaignStudio, BoundTextPlanningBilling, createSyntheticTextPlanning, digest } from '../server/index.js';
import { emptyBrief } from '../core/index.js';
import { externalSessionFixture } from './external-session-fixture.js';
import { testStore } from './datastore.js';
import { textPlanningFixture } from './text-planning-fixture.js';
async function fixture(transport?:typeof fetch){
 const root=resolve(process.env.MARKETING_TEXT_SQL_ARTIFACTS??'artifacts/planning-5d996985/sql');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-'));
 const store=await testStore(join(dir,'sdk'));const hostStore=await testStore(join(dir,'host'));await store.db.acquireExecutor();for(const p of ['p','other'])await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(p,p);
 const host=await externalSessionFixture(store,hostStore),session=await host.login(),p=await host.principal(session.token);const f=await textPlanningFixture(store,host.authority,p,transport);
 const studio=new CampaignStudio(store,{sessions:host.authority,textPlanning:f.capability});const d=await studio.saveBrief(p,'p',{requestKey:'brief',brief:{...emptyBrief(),name:'Tour',offer:'A tour',destination:'https://example.test'}});
 const input={draftId:d.id,expectedRevision:d.revision,connectionId:f.connection.id,maxOutputTokens:4096,requestKey:'review'};
 const review=()=>studio.reviewTextPlan(p,'p',input);
 const approve=async()=>{const q=await review();return studio.approveTextPlan(p,'p',{reviewId:q.id,reviewDigest:q.reviewDigest,requestKey:'approve'});};
 return {...f,dir,store,hostStore,host,session,p,studio,d,input,review,approve,close:async()=>{await store.close();await hostStore.close();}};
}
test('interactive native-shaped path: exact quote, duplicate admission/dispatch, measured settlement, validated explicit option',async()=>{
 const f=await fixture();try{
  const q=await f.review();assert.equal(q.evidence,'synthetic');assert.equal(q.requestBytes>0,true);assert.equal(f.calls.dispatch,0);
  assert.deepEqual(await f.review(),q);const r=await f.approve();assert.equal(r.state,'queued');assert.equal(f.calls.admit,1);assert.equal((await f.approve()).id,r.id);
  const [a,b]=await Promise.all([f.studio.dispatchPlanning('p',r.id),f.studio.dispatchPlanning('p',r.id)]);assert.equal(f.calls.dispatch,1);
  const done=await f.studio.planningRequest(f.p,'p',{requestId:r.id});assert.equal(done.state,'succeeded',done.reason??'');assert.equal(done.options.length,2);assert.equal(done.textReceipt!.settlement,'settled');assert.equal(done.textReceipt!.settledMinor,3);assert.equal(done.providerResponseId,'response-fixture-1');assert.equal(done.textReceipt!.diagnosticRequestId,'diagnostic-fixture');assert.ok(a&&b);
  assert.equal((await f.studio.studio(f.p,'p',{draftId:f.d.id})).draft.studio.options.length,0);
  const selected=await f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'retain',requestId:r.id,optionIndex:1});assert.equal(selected.studio.options[0]!.value.title,'Second approach');assert.equal(selected.studio.selection,null);assert.deepEqual(await f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:1,requestKey:'retain',requestId:r.id,optionIndex:1}),selected);
  assert.equal(Number((await f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n),0);
 }finally{await f.close();}
});
for(const mutation of ['permission','credential','configuration','model','environment','pricing','logout','disablement','role','brief'] as const)test('exact admission rejects changed '+mutation,async()=>{
 const f=await fixture();try{const q=await f.review();if(mutation==='logout')await f.host.revoke(f.session.sessionRef);else if(mutation==='disablement')await f.host.disable();else if(mutation==='role')await f.host.changeRole('analyst');else if(mutation==='brief')await f.studio.saveBrief(f.p,'p',{id:f.d.id,expectedRevision:1,requestKey:'new',brief:{...f.d.studio.brief,offer:'Changed'}});else if(mutation==='pricing')f.pricing.revision='price-2';else {const c=await f.read();if(mutation==='permission')c.permissionRevision='2';if(mutation==='credential')c.credentialRevision='2';if(mutation==='configuration')c.configurationRevision='2';if(mutation==='model')c.model='different';if(mutation==='environment')c.environment='other';await f.save(c);}
 await assert.rejects(f.studio.approveTextPlan(f.p,'p',{reviewId:q.id,reviewDigest:q.reviewDigest,requestKey:'a'}));assert.equal(f.calls.dispatch,0);assert.equal(f.calls.admit,0);
 }finally{await f.close();}
});
for(const wrong of ['operationId','currency','model','projectId','environment','requestDigest','connectionDigest','expired','allowance'] as const)test('quote refuses '+wrong,async()=>{
 const f=await fixture();try{const original=f.billing.quote;f.billing.quote=async(i,s)=>{const q=await original(i,s);if(wrong==='expired')q.expiresAt=new Date(0).toISOString();else if(wrong==='allowance')q.maxAttempts=2 as 1;else q[wrong]=wrong==='currency'?'bad':'wrong';return q;};await assert.rejects(f.review());assert.equal(f.calls.dispatch,0);}finally{await f.close();}
});
for(const outcome of ['missing-usage','missing-id','refusal','incomplete','malformed','oversized','semantic-invalid'] as const)test('retains bounded '+outcome+' outcome without retry',async()=>{
 let response:any;const f=await fixture(async()=>new Response(typeof response==='string'?response:JSON.stringify(response),{headers:{'content-type':'application/json'}}));try{
 response=structuredClone(f.raw);if(outcome==='missing-usage')delete response.usage;if(outcome==='missing-id')delete response.id;if(outcome==='refusal')response.output=[{content:[{type:'refusal',refusal:'No'}]}];if(outcome==='incomplete')response.status='incomplete';if(outcome==='malformed')response.output[0].content[0].text='{';if(outcome==='oversized')response=' '.repeat(1024*1024+1);if(outcome==='semantic-invalid')response.output[0].content[0].text=JSON.stringify({options:[{...JSON.parse(response.output[0].content[0].text).options[0],provider:'invented'}]});
 const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(f.calls.dispatch,1);assert.equal(done.state,outcome==='missing-usage'?'succeeded':['missing-id','oversized'].includes(outcome)?'unknown':'failed');
 if(outcome!=='missing-usage')assert.equal(done.options.length,0);
 if(['missing-usage','oversized'].includes(outcome)){assert.equal(done.textReceipt!.settlement,'unknown');await assert.rejects(f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'new-key'}),/unresolved_exposure/);}
 await f.studio.reconcilePlanning(f.p,'p',{requestId:r.id});assert.equal(f.calls.dispatch,1);
 }finally{await f.close();}
});
test('response.created identity retained before delayed output; independent revocation and write do not wait for provider',async()=>{
 let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);
 const f=await fixture(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',sequence_number:0,response:{id:'early-response'}})+'\n\n'));started();void wait.then(()=>c.close());}}),{headers:{'content-type':'text/event-stream'}}));
 try{const r=await f.approve(),pending=f.studio.dispatchPlanning('p',r.id);await seen;
  for(let n=0;n<30;n++){if((await f.store.get<any>('p','planningRequest',r.id)).providerResponseId)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await f.store.get<any>('p','planningRequest',r.id)).providerResponseId,'early-response');
  await f.host.revoke(f.session.sessionRef);await f.store.put('p','unrelated','write',{ok:true});release();const done=await pending;assert.equal(done.state,'unknown');assert.equal(done.providerResponseId,'early-response');assert.equal(done.textReceipt!.settlement,'unknown');
 }finally{release();await f.close();}
});
test('slow quote releases host and SDK guards; changed pricing/session cannot admit stale quote',async()=>{
 const f=await fixture();let release!:()=>void,started!:()=>void;try{const original=f.billing.quote,wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);f.billing.quote=async(i,s)=>{started();await wait;return original(i,s);};const pending=f.review();await seen;await f.store.put('p','unrelated','write',{ok:true});await f.host.revoke(f.session.sessionRef);release();await assert.rejects(pending);assert.equal(f.calls.admit,0);}finally{release?.();await f.close();}
});
test('conflicting settlement cannot change final measured charge; synthetic branding cannot be cast away',async()=>{
 const f=await fixture();try{const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id),q=await f.review();const fact=await f.billing.measure(done,q.quote,new AbortController().signal);const b=new BoundTextPlanningBilling(f.store,f.billing);
 await f.store.transaction(()=>b.settle(done,q.quote,fact));assert.equal(f.calls.settle,1);
 await assert.rejects(f.store.transaction(()=>b.settle(done,q.quote,{...fact!,measuredMinor:4})),/settlement_conflict/);
 assert.throws(()=>Object.assign(f.capability,{evidence:'provider'}));assert.throws(()=>new CampaignStudio(f.store,{sessions:f.host.authority,textPlanning:{...f.capability} as any}),/composition_mismatch/);
 assert.equal(digest(done),digest(await f.store.get('p','planningRequest',r.id)));
 }finally{await f.close();}
});
test('pre-dispatch crash fence and timeout preserve reservation and deny alternate keys',async()=>{
 const f=await fixture(async()=>new Promise(()=>{}));try{const capability=createSyntheticTextPlanning({...f.options,timeoutMs:30},f.fetcher),studio=new CampaignStudio(f.store,{sessions:f.host.authority,textPlanning:capability});const r=await f.approve();const keep=setTimeout(()=>{},1000);const done=await studio.dispatchPlanning('p',r.id);clearTimeout(keep);assert.equal(done.state,'unknown');assert.equal(done.textReceipt!.settlement,'unknown');await studio.dispatchPlanning('p',r.id);assert.equal(f.calls.dispatch,1);await assert.rejects(studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'bypass'}),/unresolved_exposure/);}finally{await f.close();}
});
test('SDK private text setup is separate from media and cannot supply request permission by itself',async()=>{
 const f=await fixture();try{
  const setup=await textPlanningFixture(f.store,f.host.authority,f.p,undefined,true),route=setup.setup.routes({origin:'https://sdk.example',authenticate:r=>f.host.authenticate(r)});
  const path='/api/projects/p/text-creative/openai';
  const get=await route(f.host.request(f.session.token,path));assert.equal(get!.status,200);const html=await get!.text();assert.ok(html.includes('OpenAI text Connections'));assert.ok(!html.includes('synthetic-text-key'));
  const values=(name:string)=>[...html.matchAll(new RegExp('name="'+name+'" value="([^"]+)"','g'))].map(x=>x[1]!);
  const response=await route(f.host.request(f.session.token,path,{method:'POST',headers:{origin:'https://sdk.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({model:setup.connection.model,expiresAt:values('expiresAt')[0]!,requestKey:values('requestKey')[0]!,sourceId:'',grantId:''})}));assert.equal(response!.status,303);
  const location=response!.headers.get('location')!,review=await (await route(f.host.request(f.session.token,location)))!.text();const field=(name:string)=>new RegExp('name="'+name+'" value="([^"]*)"').exec(review)![1]!;
  const saved=await route(f.host.request(f.session.token,location,{method:'POST',headers:{origin:'https://sdk.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'approve',revision:field('revision'),reviewDigest:field('reviewDigest'),consent:'approved',apiKey:'synthetic-text-secure-entry'})}));assert.equal(saved!.status,303);
  const catalogue=await setup.capability.connections(f.p,'p');assert.equal(catalogue.connections.length,1);assert.equal(catalogue.connections[0]!.state,'available');assert.equal((await f.store.list('p','generationGrant')).length,0);assert.equal((await f.store.list('p','planningRequest')).length,0);
  assert.equal((await f.store.list('p','textCreativeConnection')).length,1);assert.equal((await f.store.list('p','creativeConnection')).length,0);
 }finally{await f.close();}
});
for(const phase of ['before-dispatch','after-send','identity','before-final-commit','final-commit'])test('independent process crash retains '+phase+' and executor ownership',async()=>{
 const root=resolve(process.env.MARKETING_TEXT_SQL_ARTIFACTS??'artifacts/planning-5d996985/sql');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'crash-'));
 const reader=await testStore(join(dir,'sdk'));
 const {fork}=await import('node:child_process'),{once}=await import('node:events');const child=fork(new URL('./text-planning-crash-child.js',import.meta.url),[dir,phase],{stdio:['ignore','ignore','inherit','ipc']});
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('child exited before checkpoint');})]);
 try{if(reader.db.dialect!=='sqlite')await assert.rejects(reader.db.acquireExecutor());const r=await reader.get<any>('p','planningRequest',message.requestId);assert.equal(r.state,phase==='final-commit'?'succeeded':'running');assert.equal(!!r.textReceipt.attemptId,phase!=='before-dispatch');assert.equal(r.providerResponseId,phase==='identity'?'early-crash-response':['before-final-commit','final-commit'].includes(phase)?'response-fixture-1':null);assert.equal((await reader.list('p','planningReservation')).length,1);}finally{await reader.close();}
 const exit=once(child,'exit');child.kill('SIGKILL');await exit;const reopened=await testStore(join(dir,'sdk'));try{const r=await reopened.get<any>('p','planningRequest',message.requestId);assert.equal(r.state,phase==='final-commit'?'succeeded':'running');assert.equal(r.textReceipt.settlement,['before-final-commit','final-commit'].includes(phase)?'settled':'reserved');}finally{await reopened.close();}
 }finally{clearTimeout(timer);child.kill('SIGKILL');}
});
test('cancelled exact review, missing billing and independent permission are actionable without dispatch',async()=>{
 const f=await fixture();try{const q=await f.review();await f.studio.cancelTextPlan(f.p,'p',{reviewId:q.id,reviewDigest:q.reviewDigest});await assert.rejects(f.approve(),/cancelled/);f.pricing.missing=true;await assert.rejects(f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'billing'}),/billing_missing/);f.pricing.missing=false;await f.save({...f.connection,state:'unavailable'});const catalogue=await f.studio.textPlanningConnections(f.p,'p',{});assert.equal(catalogue.connections[0]!.state,'unavailable');await assert.rejects(f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'permission'}));assert.equal(f.calls.dispatch,0);
 }finally{await f.close();}
});
for(const field of ['attemptId','requestDigest','quoteReceipt','connectionDigest','projectId','environment','pricingRevision','currency','usage'] as const)test('wrong settlement '+field+' retains unknown cost',async()=>{
 const f=await fixture();try{const original=f.billing.measure;f.billing.measure=async(r,q,s)=>{const fact=(await original(r,q,s))!;if(field==='usage')fact.usage={...fact.usage,outputTokens:null};else fact[field]='wrong';return fact;};const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(done.state,'unknown');assert.equal(done.textReceipt!.settlement,'unknown');assert.equal(f.calls.settle,0);assert.equal(done.providerResponseId,'response-fixture-1');await assert.rejects(f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'new'}),/unresolved_exposure/);}finally{await f.close();}
});
test('independent host connection revokes during delayed quote; SDK and host remain writable',async()=>{
 const f=await fixture(),writer=await testStore(join(f.dir,'host'));let release!:()=>void;try{let started!:()=>void;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r),quote=f.billing.quote;f.billing.quote=async(i,s)=>{started();await wait;return quote(i,s);};const pending=f.review();await seen;await f.hostStore.transaction(async()=>{});await writer.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(f.session.sessionRef);await f.store.put('p','unrelated','write',{ok:true});release();await assert.rejects(pending);assert.equal(f.calls.admit,0);}finally{release?.();await writer.close();await f.close();}
});
test('stale draft result cannot apply; intentional regeneration requires another quote and review',async()=>{
 const f=await fixture();try{const r=await f.approve();await f.studio.dispatchPlanning('p',r.id);const q=await f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'intentional-new'});assert.notEqual(q.id,r.id);assert.equal(f.calls.dispatch,1);assert.notEqual(q.quote.receipt,(await f.review()).quote.receipt);
 await f.studio.saveBrief(f.p,'p',{id:f.d.id,expectedRevision:1,requestKey:'changed',brief:{...f.d.studio.brief,offer:'new'}});await assert.rejects(f.studio.applyPlanningOption(f.p,'p',{draftId:f.d.id,expectedRevision:2,requestKey:'late',requestId:r.id,optionIndex:0}));assert.equal(f.calls.dispatch,1);
 }finally{await f.close();}
});
test('xAI foreground structured response retains measured USD ticks separately from settled billing',async()=>{
 const f=await fixture();try{await f.save({...f.connection,provider:'xai'});Object.assign(f.raw.usage,{cost_in_usd_ticks:'300000000'});const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(done.state,'succeeded');assert.deepEqual(done.usage.cost,{value:'300000000',unit:'usd_ticks_1e10',currency:'USD'});assert.equal(done.textReceipt!.settledMinor,3);assert.equal(done.textReceipt!.settlement,'settled');}finally{await f.close();}
});
for(const tokens of [5000,1000001,Number.MAX_SAFE_INTEGER+1])test(`usage beyond the reviewed allowance never exposes selectable options: ${tokens}`,async()=>{
 const f=await fixture();try{f.raw.usage.output_tokens=tokens;const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(done.state,'failed');assert.deepEqual(done.options,[]);}finally{await f.close();}
});
test('known paid response after an independent draft edit fails safely and permits only a fresh settled review',async()=>{
 let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);let raw:any;
 const f=await fixture(async()=>{started();await wait;return Response.json(raw);});try{raw=f.raw;const r=await f.approve(),pending=f.studio.dispatchPlanning('p',r.id);await seen;const changed=await f.studio.saveBrief(f.p,'p',{id:f.d.id,expectedRevision:1,requestKey:'independent-edit',brief:{...f.d.studio.brief,offer:'Current human edit'}});release();const done=await pending;assert.equal(done.state,'failed');assert.deepEqual(done.options,[]);assert.equal(done.textReceipt!.settlement,'settled');assert.equal((await f.studio.studio(f.p,'p',{draftId:f.d.id})).draft.studio.brief.offer,'Current human edit');const quote=await f.studio.reviewTextPlan(f.p,'p',{...f.input,expectedRevision:changed.revision,requestKey:'fresh-current-review'});assert.notEqual(quote.id,r.id);assert.equal(f.calls.dispatch,1);
 }finally{release();await f.close();}
});

for (const fault of ['terminal-first','duplicate-created','regressing-sequence','missing-sequence','wrong-response-id','wrong-event-name','after-terminal','error-event','wrong-final-status','missing-created-id'] as const) test('independent review: rejects malformed streamed '+fault,async()=>{
 let events:any[]=[];const f=await fixture(async()=>new Response(events.map(v=>typeof v==='string'?v:'data: '+JSON.stringify(v)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}));
 try {
  const created={type:'response.created',sequence_number:0,response:{id:f.raw.id}},completed={type:'response.completed',sequence_number:1,response:f.raw};
  events=[created,completed];
  if(fault==='terminal-first')events=[completed];
  if(fault==='duplicate-created')events=[created,{...created,sequence_number:1},{...completed,sequence_number:2}];
  if(fault==='regressing-sequence')completed.sequence_number=0;
  if(fault==='missing-sequence')delete (completed as any).sequence_number;
  if(fault==='wrong-response-id')events=[created,{type:'response.output_text.delta',sequence_number:1,response_id:'other-response',delta:'untrusted'}, {...completed,sequence_number:2}];
  if(fault==='wrong-event-name')events=[created,'event: response.failed\ndata: '+JSON.stringify(completed)+'\n\n'];
  if(fault==='after-terminal')events.push({type:'response.output_text.delta',sequence_number:2,delta:'late'});
  if(fault==='error-event')events=[created,{type:'error',sequence_number:1,message:'synthetic-secret-never-echo'}, {...completed,sequence_number:2}];
  if(fault==='wrong-final-status')completed.type='response.failed';
  if(fault==='missing-created-id')delete (created.response as any).id;
  const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);
  assert.equal(done.state,'unknown');assert.deepEqual(done.options,[]);assert.equal(done.textReceipt!.settlement,'unknown');assert.equal(f.calls.settle,0);
  assert.ok(!JSON.stringify(done).includes('synthetic-secret-never-echo'));await f.studio.dispatchPlanning('p',r.id);assert.equal(f.calls.dispatch,1);
 }finally{await f.close();}
});

test('independent review: SQL rollback removes billing admission when SDK reservation commit fails',async()=>{
 const f=await fixture();try{const original=f.store.put.bind(f.store);f.store.put=async(...args)=>{if(args[1]==='planningReservation')throw new Error('synthetic-commit-failure');return original(...args);};await assert.rejects(f.approve(),/synthetic-commit-failure/);f.store.put=original;
 assert.equal((await f.store.list('p','fixtureBillingAdmission')).length,0);assert.equal((await f.store.list('p','planningReservation')).length,0);assert.equal((await f.store.list('p','planningRequest')).length,0);
 const r=await f.approve();assert.equal((await f.store.list('p','fixtureBillingAdmission')).length,1);await f.studio.dispatchPlanning('p',r.id);assert.equal(f.calls.dispatch,1);
 }finally{await f.close();}
});

test('independent review: provider cost and identity remain after independent human revocation',async()=>{
 let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);let raw:any;
 const f=await fixture(async()=>{started();await wait;return Response.json(raw);});const writer=await testStore(join(f.dir,'host'));
 try{raw=f.raw;const r=await f.approve(),pending=f.studio.dispatchPlanning('p',r.id);await seen;await f.hostStore.transaction(async()=>{});await writer.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(f.session.sessionRef);release();const done=await pending;assert.equal(done.state,'failed');assert.deepEqual(done.options,[]);assert.equal(done.providerResponseId,raw.id);assert.equal(done.textReceipt!.settlement,'settled');assert.equal((await f.store.list('p','fixtureBillingSettlement')).length,1);
 }finally{release();await writer.close();await f.close();}
});

test('independent review: rejected financial facts survive settlement rollback without releasing exposure',async()=>{
 const f=await fixture();try{const measure=f.billing.measure;f.billing.measure=async(r,q,s)=>({...((await measure(r,q,s))!),measuredMinor:q.ceilingMinor+1});const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(done.textReceipt!.settlement,'unknown');assert.equal(f.calls.settle,0);
 const evidence=await f.store.list<any>('p','planningEvidence');assert.equal(evidence.length,1);assert.equal(evidence[0].fact.measuredMinor,26);assert.equal(evidence[0].payloadDigest,digest(evidence[0].fact));assert.equal(evidence[0].attemptId,done.textReceipt!.attemptId);await assert.rejects(f.studio.reviewTextPlan(f.p,'p',{...f.input,requestKey:'no-bypass'}),/unresolved_exposure/);
 }finally{await f.close();}
});

test('independent review: non-cooperative reader cancellation cannot hang an attempted operation',async()=>{
 const f=await fixture(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"response.created","sequence_number":0,"response":{"id":"cancelled-response"}}\n\n'));},cancel(){return new Promise(()=>{});}}),{headers:{'content-type':'text/event-stream'}}));
 try{const r=await f.approve(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),100);const keep=setTimeout(()=>{},2000);const start=Date.now();try{const done=await f.studio.dispatchPlanning('p',r.id,abort.signal);assert.ok(Date.now()-start<1500);assert.equal(done.state,'unknown');assert.equal(done.providerResponseId,'cancelled-response');assert.equal(done.textReceipt!.settlement,'unknown');assert.deepEqual(done.options,[]);}finally{clearTimeout(timer);clearTimeout(keep);}}
 finally{await f.close();}
});

test('independent review: SQLite cannot enable the provider factory without an executor lease',async t=>{
 const f=await fixture();try{if(f.store.db.dialect!=='sqlite'){t.skip('SQLite-only provider fail-closed boundary');return;}const {createNativeTextPlanning}=await import('../server/index.js');assert.throws(()=>createNativeTextPlanning(f.options),/text_provider_executor_lease_required/);assert.equal(f.calls.dispatch,0);}finally{await f.close();}
});

test('independent review: independent PostgreSQL executor takeover fences late completion',async t=>{
 let release!:()=>void,started!:()=>void;let raw:any;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r);const f=await fixture(async()=>{started();await wait;return Response.json(raw);});let successor:Awaited<ReturnType<typeof testStore>>|undefined;
 try{if(f.store.db.dialect!=='postgres'){t.skip('Requires real independent PostgreSQL connections and advisory lease');return;}raw=f.raw;const r=await f.approve(),pending=f.studio.dispatchPlanning('p',r.id);const failed=assert.rejects(pending,/executor_lock_lost/);await seen;await f.hostStore.transaction(async()=>{});successor=await testStore(join(f.dir,'sdk'));await assert.rejects(successor.db.acquireExecutor(),/executor_unavailable/);
 const owner=await successor.db.prepare("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1296782405 AND objid=(hashtext(current_schema())::bigint & 4294967295)::oid AND granted").get();assert.ok(owner);await successor.db.prepare('SELECT pg_terminate_backend(?)').get(owner.pid);await successor.db.acquireExecutor();release();await failed;
 const stored=await successor.get<any>('p','planningRequest',r.id);assert.equal(stored.state,'running');assert.deepEqual(stored.options,[]);assert.equal(stored.textReceipt.settlement,'reserved');assert.ok(stored.textReceipt.attemptId);assert.equal((await successor.list('p','fixtureBillingSettlement')).length,0);
 }finally{release();await successor?.close();await f.close();}
});

test('independent review: slow custody leaves independent session writers free and revocation prevents send',async()=>{
 const f=await fixture(),writer=await testStore(join(f.dir,'host'));let release!:()=>void;try{let started!:()=>void;const wait=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>started=r),read=f.options.custody.read.bind(f.options.custody);f.options.custody.read=async(...args)=>{started();await wait;return read(...args);};const r=await f.approve(),pending=f.studio.dispatchPlanning('p',r.id);await seen;await writer.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(f.session.sessionRef);await f.store.put('p','unrelated','during-custody',{ok:true});release();const done=await pending;assert.equal(f.calls.dispatch,0);assert.equal(done.state,'unknown');assert.equal(done.textReceipt!.attemptId,null);assert.equal(done.textReceipt!.settlement,'unknown');}finally{release?.();await writer.close();await f.close();}
});

test('independent review: settlement acknowledgement failure retains original fact and exact operation identities',async()=>{
 const f=await fixture();try{const settle=f.billing.settle;f.billing.settle=async(s,fact)=>{await settle(s,fact);throw new Error('synthetic-lost-settlement-ack');};const r=await f.approve(),done=await f.studio.dispatchPlanning('p',r.id);assert.equal(done.state,'unknown');assert.equal((await f.store.list('p','fixtureBillingSettlement')).length,0);const evidence=(await f.store.list<any>('p','planningEvidence'))[0];assert.equal(evidence.fact.requestId,r.id);assert.equal(evidence.fact.attemptId,done.textReceipt!.attemptId);assert.equal(evidence.fact.requestDigest,done.inputDigest);assert.equal(evidence.payloadDigest,digest(evidence.fact));await f.studio.dispatchPlanning('p',r.id);assert.equal(f.calls.dispatch,1);}
 finally{await f.close();}
});

test('independent review: agent kind, expired permission and a different human session cannot admit copied review data',async()=>{
 const f=await fixture();try{const q=await f.review(),second=await f.host.login(),other=await f.host.principal(second.token);await assert.rejects(f.studio.approveTextPlan(other,'p',{reviewId:q.id,reviewDigest:q.reviewDigest,requestKey:'copied'}),/planning_review_changed/);await f.save({...f.connection,expiresAt:new Date(0).toISOString()});await assert.rejects(f.approve(),/text_permission_or_connection_unavailable/);await f.save(f.connection);const inspect=f.host.host.inspect;f.host.host.inspect=async(...args)=>{const s=await inspect(...args);return s?{...s,kind:'agent'}:null;};await assert.rejects(f.approve(),/interactive_human_required/);assert.equal(f.calls.admit,0);assert.equal(f.calls.dispatch,0);}
 finally{await f.close();}
});

test('independent review: actual encrypted credential replacement invalidates review even if host metadata is unchanged',async()=>{
 const f=await fixture(),writer=await testStore(join(f.dir,'sdk'));try{const q=await f.review();const {EncryptedCredentialCustody}=await import('../server/index.js');const custody=new EncryptedCredentialCustody(writer,f.options.custody.cipher);await custody.retain('p','text-fixture-secret',{apiKey:'synthetic-rotated-key-no-provider-access'});await assert.rejects(f.studio.approveTextPlan(f.p,'p',{reviewId:q.id,reviewDigest:q.reviewDigest,requestKey:'stale-credential'}),/text_authority_changed/);assert.equal(f.calls.admit,0);assert.equal(f.calls.dispatch,0);}finally{await writer.close();await f.close();}
});
