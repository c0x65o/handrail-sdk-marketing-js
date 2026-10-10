import { CampaignStudio } from '../server/index.js';
import { emptyBrief } from '../core/index.js';
import { testStore } from './datastore.js';
import { externalSessionFixture } from './external-session-fixture.js';
import { textPlanningFixture } from './text-planning-fixture.js';
const [dir,phase]=process.argv.slice(2);if(!dir||!phase)throw new Error('phase required');
const store=await testStore(dir+'/sdk'),hostStore=await testStore(dir+'/host');await store.db.acquireExecutor();await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Crash proof');
const host=await externalSessionFixture(store,hostStore),session=await host.login(),p=await host.principal(session.token);
const observer=await testStore(dir+'/sdk');
let requestId='';const hold=()=>new Promise<never>(()=>{});const heartbeat=setInterval(()=>{},1000);
const fixture=await textPlanningFixture(store,host.authority,p,phase==='after-send'?async()=>{process.send?.({requestId,phase});return hold();}:phase==='identity'?async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"response.created","sequence_number":0,"response":{"id":"early-crash-response"}}\n\n'));void(async()=>{for(;;){const r=await observer.get<any>('p','planningRequest',requestId);if(r.providerResponseId){process.send?.({requestId,phase});break;}await new Promise(r=>setTimeout(r,5));}})();}}),{headers:{'content-type':'text/event-stream'}}):undefined);
if(phase==='before-final-commit'){const put=store.put.bind(store);store.put=async(...args)=>{if(args[1]==='planningRequest'&&(args[3] as any).state==='succeeded'){process.send?.({requestId,phase});await hold();}return put(...args);};}
if(phase==='before-dispatch')fixture.options.custody.read=async()=>{process.send?.({requestId,phase});return hold();};
const studio=new CampaignStudio(store,{sessions:host.authority,textPlanning:fixture.capability}),d=await studio.saveBrief(p,'p',{requestKey:'b',brief:emptyBrief()});
const q=await studio.reviewTextPlan(p,'p',{draftId:d.id,expectedRevision:1,connectionId:fixture.connection.id,maxOutputTokens:4096,requestKey:'q'}),r=await studio.approveTextPlan(p,'p',{reviewId:q.id,reviewDigest:q.reviewDigest,requestKey:'a'});requestId=r.id;
await studio.dispatchPlanning('p',r.id);if(phase==='final-commit')process.send?.({requestId,phase});await hold();clearInterval(heartbeat);
