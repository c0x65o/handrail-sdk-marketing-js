import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CreativeConnections, EncryptedCredentialCustody, createConnections, createCredentialCipher } from '../server/index.js';
import { externalSessionFixture } from './external-session-fixture.js';
import { testStore } from './datastore.js';

async function fixture(provider: 'openai' | 'xai' = 'openai') {
 const dir=await mkdtemp(join(tmpdir(),'external-creative-')), hostPath=join(dir,'host.sqlite');
 const store=await testStore(join(dir,'sdk.sqlite')), hostStore=await testStore(hostPath), authStore=await testStore(hostPath), writer=await testStore(hostPath);
 await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Synthetic external project');
 const host=await externalSessionFixture(store,hostStore,authStore), login=await host.login();
 const custody=new EncryptedCredentialCustody(store,createCredentialCipher('synthetic',()=>Buffer.alloc(32,7)));
 const guardedSessions: string[][] = [];
 let revision='1', environment='fixture', guards=0, policyHook: (()=>Promise<void>) | undefined;
 const live=host.authority.withLiveSessions.bind(host.authority);
 host.authority.withLiveSessions=async (expected,local)=>live(expected,async()=>{guardedSessions.push(expected.map(e=>e.binding.sessionRef));guards++;try{return await local();}finally{guards--;}});
 const creative=new CreativeConnections({store,custody,environment:'fixture',sessionAuthority:host.authority,accessPolicy:async()=>{await policyHook?.();return {revision,environment,appLabel:'Synthetic',models:['model'],maxDurationSeconds:3600,grantIds:[]};},billing:{authorize:async()=>{throw Error('Forbidden billing');}}});
 const service=createConnections({store,creative,sessionAuthority:host.authority});
 const routes=service.routes({origin:'https://sdk.example',authenticate:host.authenticate,mutationHeaders:()=>({'x-preview-request':'1'})});
 const req=async(path:string,body?:Record<string,string>,token=login.token)=>routes(host.request(token,path,{method:body?'POST':'GET',headers:{origin:'https://sdk.example','content-type':'application/x-www-form-urlencoded','x-preview-request':'1'},...(body?{body:new URLSearchParams(body)}:{})})).then(r=>{assert.ok(r);return r;});
 const base=`/api/projects/p/creative/${provider}`;
 const start=async(extra={},token=login.token)=>{const response=await req(base,{requestKey:randomUUID(),model:'model',expiresAt:new Date(Date.now()+900000).toISOString(),...extra},token);assert.equal(response.status,303);return response.headers.get('location')!;};
 const fields=async(path:string,action='approve',token=login.token)=>{const page=await (await req(path,undefined,token)).text();const form=[...page.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(m=>m[1]!.includes(`value="${action}"`))?.[1];assert.ok(form);return {...Object.fromEntries([...form.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m=>[m[1]!,m[2]!])),consent:'approved'};};
 const mutate=async(action:string)=>writer.transaction(async()=>{
  if(action==='logout') await writer.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(login.sessionRef);
  else if(action==='expiry') await writer.db.prepare('UPDATE fixture_host_sessions SET expires_at=0 WHERE id=?').run(login.sessionRef);
  else if(action==='disable') await writer.db.prepare("UPDATE fixture_host_users SET disabled=1,revision=revision+1 WHERE subject='alice'").run();
  else if(action==='project') await writer.db.prepare("DELETE FROM fixture_host_memberships WHERE subject='alice' AND project_id='p'").run();
  else if(action==='role') await writer.db.prepare("UPDATE fixture_host_memberships SET role='analyst' WHERE subject='alice'").run();
  else {revision='changed';environment='changed';await writer.db.prepare("UPDATE fixture_host_users SET revision=revision+1 WHERE subject='alice'").run();}
 });
 return {store,hostStore,hostPath,writer,host,login,guardedSessions,custody,creative,service,req,start,fields,mutate,guards:()=>guards,policyHook:(h:typeof policyHook)=>{policyHook=h;},close:async()=>{await writer.close();await authStore.close();await hostStore.close();await store.close();await rm(dir,{recursive:true,force:true});}};
}
for(const provider of ['openai','xai'] as const) test(`external creative ${provider}: actual public composition, zero sessions/grants, headers and exact reuse`,async()=>{
 const f=await fixture(provider);try{
  const principal=await f.host.principal(f.login.token),catalogue=await f.service.call(principal,'p','connections',{});
  assert.equal(catalogue.assistance.available,false);assert.ok(catalogue.providers.find(p=>p.provider.provider===provider)?.configured);
  const path=await f.start(),html=await (await f.req(path)).text();assert.match(html,/x-preview-request/);assert.match(html,/redirect:'error'/);assert.match((await f.req(path)).headers.get('content-security-policy')!,/form-action 'none'/);
  const input=await f.fields(path);assert.equal((await f.req(path,{...input,apiKey:'SYNTHETIC_ONLY_KEY'})).status,303);
  const before=await f.store.list('p','vault');assert.equal((await f.req(path,{...input,apiKey:'SYNTHETIC_REPLAY'})).status,303);assert.deepEqual(await f.store.list('p','vault'),before);
  const source=await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!);
  const reused=await f.start({sourceId:source.id,expiresAt:source.expiresAt});assert.equal((await f.req(reused,await f.fields(reused))).status,303);
  assert.equal((await f.creative.inspect(principal,'p',reused.split('/').at(-1)!)).credential,'configured');
  assert.equal((await f.req(path,await f.fields(path,'disconnect'))).status,303);
  assert.equal((await f.creative.inspect(principal,'p',reused.split('/').at(-1)!)).credential,'unavailable');assert.deepEqual(await f.store.list('p','vault'),before);
  for(const kind of ['grant','generationGrant','generationCostReservation','generationJob'])assert.equal((await f.store.list('p',kind)).length,0);
  for(const db of [f.store,f.hostStore]) assert.equal(Number((await db.db.prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n),0);
  assert.ok((await f.store.db.prepare('SELECT password_hash FROM users').all()).every(r=>r.password_hash===""));
 }finally{await f.close();}
});
for(const action of ['logout','expiry','disable','project','role','environment']) for(const stage of ['entry','custody','reuse','status']) test(`external creative independent SQL ${action} at ${stage}`,async()=>{
 const f=await fixture();try{
  const path=await f.start(),input=await f.fields(path),principal=await f.host.principal(f.login.token);
  if(stage==='entry'){await f.mutate(action);assert.ok((await f.req(path,{...input,apiKey:'SYNTHETIC_ONLY_KEY'})).status>=400);}
  else if(stage==='custody'){
   const retain=f.custody.retain.bind(f.custody);f.custody.retain=async(...args)=>{assert.equal(f.guards(),0,'No host lock over key service');await retain(...args);await f.mutate(action);};
   assert.ok((await f.req(path,{...input,apiKey:'SYNTHETIC_ONLY_KEY'})).status>=400);
   assert.equal((await f.store.list('p','vault')).length,1);assert.equal((await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!)).state,'review');
   if(action==='environment')assert.ok((await f.req(path,{...input,apiKey:'SYNTHETIC_RETRY'})).status>=400);
  }else{
   assert.equal((await f.req(path,{...input,apiKey:'SYNTHETIC_ONLY_KEY'})).status,303);
   if(stage==='reuse'){
    const source=await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!);const reused=await f.start({sourceId:source.id,expiresAt:source.expiresAt});const consent=await f.fields(reused);
    await f.mutate(action);assert.ok((await f.req(reused,consent)).status>=400);
   }else {await f.mutate(action);if(action==='environment') assert.equal((await f.creative.inspect(principal,'p',path.split('/').at(-1)!)).credential,'unavailable');else await assert.rejects(f.creative.inspect(principal,'p',path.split('/').at(-1)!));}
   assert.equal((await f.store.list('p','vault')).length,1);
  }
  assert.equal((await f.store.list('p','generationGrant')).length,0);
 }finally{await f.close();}
});
for(const winner of ['commit','revocation']) for(const action of ['logout','disable','role','project','configuration','expiry']) test(`external creative final metadata vs independent process ${action}: ${winner} first`,{timeout:15000},async()=>{
 const f=await fixture();const child=fork(new URL('./session-race-child.js',import.meta.url),[f.hostPath],{stdio:['ignore','ignore','pipe','ipc']});let release:(()=>void)|undefined;
 try{
  assert.notEqual((await once(child,'message'))[0].pid,process.pid);
  const path=await f.start(),input={...await f.fields(path),apiKey:'SYNTHETIC_ONLY_KEY'};
  let revoked=false;const committed=new Promise<void>(r=>child.on('message',(m:any)=>{if(m.event==='committed'){revoked=true;r();}}));
  if(winner==='commit'){
   let signal!:()=>void;const entered=new Promise<void>(r=>signal=r),gate=new Promise<void>(r=>release=r),put=f.store.put.bind(f.store);
   f.store.put=async(...args)=>{if(args[1]==='creativeConnection'&&(args[3] as any).state==='configured'){signal();await gate;}return put(...args);};
   const saving=f.req(path,input);await entered;const attempted=once(child,'message');child.send({session:f.login.sessionRef,action,hold:false});await attempted;await delay(100);assert.equal(revoked,false);release!();assert.equal((await saving).status,303);await committed;
  }else{
   const retain=f.custody.retain.bind(f.custody);f.custody.retain=async(...args)=>{assert.equal(f.guards(),0);await retain(...args);child.send({session:f.login.sessionRef,action,hold:false});await committed;};
   assert.ok((await f.req(path,input)).status>=400);
  }
  assert.equal((await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!)).state,winner==='commit'?'configured':'review');
  assert.equal((await f.store.list('p','vault')).length,1);
 }finally{release?.();child.kill('SIGKILL');await f.close();}
});

test('external creative policy await and private header bootstrap recheck current rights',async()=>{
 const f=await fixture();try{
  const path=await f.start();let onceOnly=true;
  f.policyHook(async()=>{if(onceOnly){onceOnly=false;await f.mutate('logout');}});
  assert.equal((await f.req(path)).status,401);
  assert.equal((await f.store.list('p','vault')).length,0);
 }finally{await f.close();}
});
test('creative composition rejects a different external authority and unsafe private header configuration',async()=>{
 const f=await fixture();try{
  assert.throws(()=>createConnections({store:f.store,creative:f.creative}),/connections_session_authority_mismatch/);
  const routes=f.service.routes({origin:'https://sdk.example',authenticate:f.host.authenticate,mutationHeaders:()=>({authorization:'forbidden'})});
  assert.equal((await routes(f.host.request(f.login.token,'/api/projects/p/creative/openai')))!.status,409);
 }finally{await f.close();}
});


test('external creative binding reuse guards both original and current sessions',async()=>{
 const f=await fixture();try{
  const path=await f.start();assert.equal((await f.req(path,{...await f.fields(path),apiKey:'SYNTHETIC_ONLY_KEY'})).status,303);
  const source=await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!);
  const next=await f.host.login();
  assert.ok((await (await f.req('/api/projects/p/creative/openai',undefined,next.token)).text()).includes(`value="${source.id}"`),'New session must be offered an eligible live source for explicit reuse');
  const reused=await f.start({sourceId:source.id,expiresAt:source.expiresAt},next.token);
  assert.equal((await f.req(reused,await f.fields(reused,'approve',next.token),next.token)).status,303);
  assert.ok(f.guardedSessions.filter(refs=>refs.includes(f.login.sessionRef)&&refs.includes(next.sessionRef)).length>=2);
  await f.mutate('logout');
  assert.equal((await f.creative.inspect(await f.host.principal(next.token),'p',reused.split('/').at(-1)!)).credential,'unavailable');
  assert.equal((await f.store.list('p','vault')).length,1);
 }finally{await f.close();}
});


test('external mappings cannot authenticate with an empty local password or session reference',async()=>{
 const f=await fixture();try{
  const p=await f.host.principal(f.login.token);
  for(const password of ['',f.login.sessionRef,'absent','SYNTHETIC']) assert.equal(await f.store.login(p.userId,password,'external-login-negative'),null);
  assert.equal(Number((await f.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get())!.n),0);
  assert.equal((await f.store.db.prepare('SELECT password_hash FROM users WHERE id=?').get(p.userId))!.password_hash,'');
 }finally{await f.close();}
});

test('source logout during the final awaited custody inspection cannot return configured reuse',async()=>{
 const f=await fixture();try{
  const path=await f.start();assert.equal((await f.req(path,{...await f.fields(path),apiKey:'SYNTHETIC_ONLY_KEY'})).status,303);
  const source=await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!);
  const next=await f.host.login(), principal=await f.host.principal(next.token);
  const reused=await f.start({sourceId:source.id,expiresAt:source.expiresAt},next.token);
  assert.equal((await f.req(reused,await f.fields(reused,'approve',next.token),next.token)).status,303);
  const inspect=f.custody.inspect.bind(f.custody);let reads=0;
  f.custody.inspect=async(...args)=>{const result=await inspect(...args);if(++reads===6)await f.mutate('logout');return result;};
  assert.equal((await f.creative.inspect(principal,'p',reused.split('/').at(-1)!)).credential,'unavailable');
  assert.ok(reads>=6);assert.equal((await f.store.list('p','vault')).length,1);
 }finally{await f.close();}
});


test('natural session expiry inside creative final metadata transaction rolls back but retains ciphertext',async t=>{
 const f=await fixture();try{
  const path=await f.start(),input={...await f.fields(path),apiKey:'SYNTHETIC_ONLY_KEY'},now=Date.now(),put=f.store.put.bind(f.store);
  t.mock.timers.enable({apis:['Date'],now});
  f.store.put=async(...args)=>{await put(...args);if(args[1]==='creativeConnection'&&(args[3] as any).state==='configured')t.mock.timers.setTime(now+7200000);};
  assert.ok((await f.req(path,input)).status>=400);
  assert.equal((await f.store.get<any>('p','creativeConnection',path.split('/').at(-1)!)).state,'review');
  assert.equal((await f.store.list('p','vault')).length,1);
 }finally{t.mock.timers.reset();await f.close();}
});
