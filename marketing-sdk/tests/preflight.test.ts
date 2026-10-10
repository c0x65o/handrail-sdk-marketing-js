import test from "node:test";
import assert from "node:assert/strict";
import type { Campaign, Grant, CampaignCheck } from "../core/index.js";
import { MarketingServer, digest } from "../server/index.js";
import { nativePreflightFixture } from "./preflight-fixture.js";
import { testStore } from "./datastore.js";

test("public Connections and Studio produce separate exact native proof with zero ad writes, durable replay, and actual paused preparation", async () => {
  const f = await nativePreflightFixture(); try {
    const g = await f.store.get<Grant>("p","grant",f.c.grantId), grantDigest = digest(g);
    assert.equal(g.capabilityEvidence,undefined);
    const before = f.http.trace.length;
    const checked = await f.call("checkCampaign",f.check);
    assert.equal(checked.state,"ready",JSON.stringify(checked));
    assert.ok(f.http.trace.length > before); assert.ok(f.http.trace.every(r=>r.method==="GET"));
    assert.equal((await f.store.list("p","operation")).length,0);
    assert.equal((await f.store.list("p","advertisingBudgetReservation")).length,0);
    assert.equal(digest(await f.store.get("p","grant",g.id)),grantDigest);
    const reads=f.http.trace.length;
    assert.deepEqual(await f.call("checkCampaign",f.check),checked);
    assert.equal(f.http.trace.length,reads);
    const restarted=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,"fixture",undefined,undefined,{connections:f.connections,tracking:f.source.options});
    assert.deepEqual(await restarted.call(f.principal,"p","checkCampaign",f.check),checked);
    assert.equal((await f.call("campaignCheck",{campaignId:f.c.id}))?.state,"ready");
    await f.store.db.acquireExecutor();
    const op=await f.call("prepare",{campaignId:f.c.id,requestKey:"prepare"});
    const result=await f.server.dispatch("p",op.id);
    assert.equal(result.state,"succeeded",JSON.stringify(result));
    assert.equal(f.http.trace.filter(r=>r.method==="POST").length,5);
    const paused=await f.store.get<Campaign>("p","campaign",f.c.id);assert.equal(paused.state,"paused");assert.equal(paused.receipt?.intent,"paused");
    assert.equal(paused.receipt?.evidence,"provider");assert.ok(paused.receipt?.ids.readbackDigest);
    const refresh=await f.call("checkCampaign",{...f.check,requestKey:"refresh"});assert.equal(refresh.state,"ready");
    assert.equal((await f.store.list("p","operation")).length,1);assert.equal(f.http.trace.filter(r=>r.method==="POST").length,5);
    await assert.rejects(f.call("prepare",{campaignId:f.c.id,requestKey:"new-hierarchy"}),/existing_operation_requires_reconciliation/);
  } finally { await f.close(); }
});

for(const change of ["copy","bytes","destination","budget","purpose","grant","session","config","credentials","tracking"] as const)
test(`delayed prerequisite reads reject independent ${change} changes`,async()=>{
  const f=await nativePreflightFixture(),other=await testStore(f.path);try{
    let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);let once=false;
    f.http.boundary=async()=>{if(!once){once=true;enter();await held;}};
    const running=f.call("checkCampaign",f.check);const observed=running.catch(e=>e);await entered;
    if(["copy","destination","budget","purpose"].includes(change)) {const c=await other.get<Campaign>("p","campaign",f.c.id);
      if(change==="copy")c.material.headline="Changed while reading";
      if(change==="destination")c.material.destination="https://example.com/changed";
      if(change==="budget")c.material.budget.minor++;
      if(change==="purpose")c.material.purpose="recruitment";
      await other.put("p","campaign",c.id,c);
    }else if(change==="bytes") {await other.db.prepare("UPDATE blobs SET bytes=? WHERE project_id=? AND digest=?").run(Buffer.from("changed"),"p",f.asset.digest);}
    else if(change==="grant"){const g=await other.get<Grant>("p","grant",f.c.grantId);g.permissions=["report"];await other.put("p","grant",g.id,g);}
    else if(change==="session")await other.db.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=?").run(Date.now(),f.principal.sessionTokenHash);
    else if(change==="config")f.custody.apps.meta!.clientSecret="SYNTHETIC_CHANGED_SECRET";
    else if(change==="credentials"){await f.custody.useReadOnly(await other.get<Grant>("p","grant",f.c.grantId),async()=>{},async credentials=>f.custody.retainConnectionCredentials("p",(await other.get<Grant>("p","grant",f.c.grantId)).secretRef,{...credentials,accessToken:"SYNTHETIC_CHANGED_TOKEN"}));}
    else await f.source.saveSource({...f.source.source,revision:"2"});
    release();const result=await observed;assert.ok(result instanceof Error || (result as CampaignCheck).state!=="ready");
    assert.ok(f.http.trace.every(r=>r.method==="GET"));
    const rows=await other.list<{view:CampaignCheck}>("p","campaignCheck");assert.equal(rows.length,1);assert.notEqual(rows[0]?.view.state,"ready");
  }finally{await other.close();await f.close();}
});

for(const negative of ["currency","timezone","account","status","billing","page","missing","duplicate","partial","role"] as const)
test(`native prerequisite fails closed on ${negative} provider facts`,async()=>{
  const f=await nativePreflightFixture();try{
    f.http.override=(u)=>{
      if(["currency","timezone","account","status","billing","missing"].includes(negative)&&u.pathname.endsWith("/act_2041")){
        const a:any={id:"act_2041",currency:"USD",timezone_name:"America/Chicago",account_status:1,disable_reason:0,funding_source_details:{id:"fixture"}};
        if(negative==="currency")a.currency="EUR";if(negative==="timezone")a.timezone_name="UTC";if(negative==="account")a.id="act_999";
        if(negative==="status")a.account_status=2;if(negative==="billing")delete a.funding_source_details;if(negative==="missing")delete a.disable_reason;
        return Response.json(a);
      }
      if(negative==="page"&&u.pathname.endsWith("/555"))return Response.json({id:"999"});
      if((negative==="duplicate"||negative==="partial")&&u.pathname.endsWith("/promote_pages"))return Response.json({data:[{id:"555",name:"Page"},...(negative==="duplicate"?[{id:"555",name:"Conflicting Page"}]:[])],...(negative==="partial"?{paging:{next:"https://never-follow.invalid",cursors:{after:"same"}}}:{})});
      if(negative==="role"&&u.pathname.endsWith("/me/adaccounts"))return Response.json({data:[{id:"act_2041",currency:"USD",timezone_name:"America/Chicago",account_status:1,user_tasks:["ANALYZE"]}]});
      return undefined;
    };
    const result=await f.call("checkCampaign",f.check);assert.notEqual(result.state,"ready",JSON.stringify(result));assert.ok(f.http.trace.every(r=>r.method==="GET"));
  }finally{await f.close();}
});

test("concurrent checks retain history without replacing newer current evidence; forged inputs cannot supply proof",async()=>{
 const f=await nativePreflightFixture();try{
  let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);let once=false;
  f.http.boundary=async()=>{if(!once){once=true;enter();await held;}};
  const older=f.call("checkCampaign",f.check);await entered;
  const newer=await f.call("checkCampaign",{...f.check,requestKey:"newer"});assert.equal(newer.state,"ready");
  release();assert.equal((await older).state,"stale");assert.equal((await f.call("campaignCheck",{campaignId:f.c.id}))?.id,newer.id);
  await assert.rejects(f.call("checkCampaign",{...f.check,ready:true} as any),/unexpected_field/);
  await assert.rejects(f.server.call(f.principal,"other","checkCampaign",f.check),/forbidden|authentication_required/);
  assert.equal((await f.store.list("p","campaignCheck")).length,2);
 }finally{await f.close();}
});

test("expiry and adapter-contract changes invalidate exact proof without renewing the original attempt",async t=>{
 const f=await nativePreflightFixture();try{
  const checked=await f.call("checkCampaign",f.check);assert.equal(checked.state,"ready");
  t.mock.timers.enable({apis:["Date"],now:Date.parse(checked.expiresAt!)+1});
  assert.equal((await f.call("campaignCheck",{campaignId:f.c.id}))?.state,"stale");
  assert.deepEqual(await f.call("checkCampaign",f.check),checked);
  await f.store.db.acquireExecutor();const op=await f.call("prepare",{campaignId:f.c.id,requestKey:"expired"});assert.equal((await f.server.dispatch("p",op.id)).state,"blocked");
  assert.ok(f.http.trace.every(r=>r.method==="GET"));t.mock.timers.reset();
  const row=await f.store.get<any>("p","campaignCheck",checked.id);row.contract="different-adapter";await f.store.put("p","campaignCheck",row.id,row);
  assert.equal((await f.call("campaignCheck",{campaignId:f.c.id}))?.state,"stale");
 }finally{t.mock.timers.reset();await f.close();}
});

test("partial native preparation remains unknown across read-only eligibility refresh and cannot create a second hierarchy",async()=>{
 const f=await nativePreflightFixture();try{
  assert.equal((await f.call("checkCampaign",f.check)).state,"ready");await f.store.db.acquireExecutor();
  let once=true;f.http.boundary=async(u,init)=>{if(once&&init?.method==="POST"&&u.pathname.endsWith("/adsets")){once=false;throw new Error("synthetic response lost");}};
  const op=await f.call("prepare",{campaignId:f.c.id,requestKey:"partial"});const result=await f.server.dispatch("p",op.id);assert.equal(result.state,"unknown");assert.ok(result.receipt?.ids.campaign);
  const original=await f.store.get("p","operation",op.id),writes=f.http.trace.filter(r=>r.method==="POST").length;
  assert.equal((await f.call("checkCampaign",{...f.check,requestKey:"after-partial"})).state,"ready");
  assert.deepEqual(await f.store.get("p","operation",op.id),original);assert.equal(f.http.trace.filter(r=>r.method==="POST").length,writes);
  await assert.rejects(f.call("prepare",{campaignId:f.c.id,requestKey:"another"}),/existing_operation_requires_reconciliation/);
 }finally{await f.close();}
});

for(const tuple of ["daily","strict","video","language"] as const)test(`good account reads do not qualify ${tuple} campaign tuple`,async()=>{
 const f=await nativePreflightFixture();try{
  assert.equal((await f.call("checkCampaign",f.check)).state,"ready");
  // Corrupt retained current input directly to exercise the final fail-closed boundary;
  // only the original public promotion is used as success evidence.
  const c=await f.store.get<Campaign>("p","campaign",f.c.id);
  if(tuple==="daily") c.material.advertisingBudget={daily:{currency:"USD",minor:100}} as any;
  if(tuple==="strict")(c.material.settings as any).delivery="strict";
  if(tuple==="video")(c.material.settings as any).format="video";
  if(tuple==="language")(c.material.settings as any).targeting.languages=[{id:"6",label:"French"}];
  await f.store.put("p","campaign",c.id,c);
  assert.equal((await f.call("campaignCheck",{campaignId:c.id}))?.state,"stale");
  assert.notEqual((await f.call("checkCampaign",{...f.check,requestKey:tuple})).state,"ready");
 }finally{await f.close();}
});

test("independent SQL process mutation fences in-flight prerequisite completion",async()=>{
 const {fork}=await import("node:child_process"),{once}=await import("node:events");
 const f=await nativePreflightFixture();try{
  let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);let seen=false;
  f.http.boundary=async()=>{if(!seen){seen=true;enter();await held;}};
  const checking=f.call("checkCampaign",f.check);await entered;
  const child=fork(new URL("./preflight-race-child.js",import.meta.url),[f.path,f.c.id],{stdio:["ignore","ignore","inherit","ipc"]});
  const exit=once(child,"exit");assert.deepEqual((await once(child,"message"))[0],{changed:true});assert.equal((await exit)[0],0);release();
  assert.notEqual((await checking).state,"ready");assert.ok(f.http.trace.every(r=>r.method==="GET"));
 }finally{await f.close();}
});

for(const change of ["role","logout","configuration"] as const)test(`external session ${change} is rechecked after delayed native reads using independent SQL`,async()=>{
 const f=await nativePreflightFixture(true),other=await testStore(f.hostPath);try{
  let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);let seen=false;
  f.http.boundary=async()=>{if(!seen){seen=true;enter();await held;}};
  const checking=f.call("checkCampaign",f.check).catch(e=>e);await entered;
  await other.transaction(async()=>{
    if(change==="role")await other.db.prepare("UPDATE fixture_host_memberships SET role=? WHERE subject=? AND project_id=?").run("analyst","alice","p");
    else if(change==="logout")await other.db.prepare("UPDATE fixture_host_sessions SET revoked=1 WHERE id=?").run(f.principal.externalSessionRef);
    else await other.db.prepare("UPDATE fixture_host_users SET revision=revision+1 WHERE subject=?").run("alice");
  });
  release();const result=await checking;assert.ok(result instanceof Error || result.state!=="ready");
  assert.ok(f.http.trace.every(r=>r.method==="GET"));assert.notEqual((await f.store.list<{view:CampaignCheck}>("p","campaignCheck"))[0]?.view.state,"ready");
 }finally{await other.close();await f.close();}
});

test("missing and conflicting scopes and empty billing signals cannot produce green",async()=>{
 const f=await nativePreflightFixture();try{
  for(const bad of ["missing_scope","scope_conflict","empty_billing","duplicate_account"]){
   f.http.override=u=>{
    if(bad.includes("scope")&&u.pathname.endsWith('/me/permissions'))return Response.json({data:[{permission:'ads_read',status:'granted'},...(bad==='scope_conflict'?[{permission:'ads_read',status:'declined'},{permission:'ads_management',status:'granted'},{permission:'pages_read_engagement',status:'granted'}]:[])]});
    if(bad==='empty_billing'&&u.pathname.endsWith('/act_2041'))return Response.json({id:'act_2041',currency:'USD',timezone_name:'America/Chicago',account_status:1,disable_reason:0,funding_source_details:{}});
    if(bad==='duplicate_account'&&u.pathname.endsWith('/me/adaccounts')){const row={id:'act_2041',currency:'USD',timezone_name:'America/Chicago',account_status:1,user_tasks:['MANAGE']};return Response.json({data:[row,{...row,account_status:2}]});}
    return undefined;
   };
   assert.notEqual((await f.call('checkCampaign',{...f.check,requestKey:bad})).state,'ready');
  }
  assert.ok(f.http.trace.every(r=>r.method==='GET'));
 }finally{await f.close();}
});

test("replayed or forged prerequisite action/campaign/project cannot become current green evidence",async()=>{
 const f=await nativePreflightFixture();try{
  await assert.rejects(f.call("checkCampaign",{...f.check,action:"activate"} as any),/unexpected_field/);
  const ready=await f.call("checkCampaign",f.check);assert.equal(ready.state,"ready");
  const original=await f.store.get<any>("p","campaignCheck",ready.id);
  for(const [field,value] of [["action","activate"],["campaignId","other-campaign"],["projectId","other"]]){
    await f.store.put("p","campaignCheck",ready.id,{...original,[field!]:value});
    assert.equal((await f.call("campaignCheck",{campaignId:f.c.id}))?.state,"stale");
    await assert.rejects(f.server.providers.meta.prepare(f.c,await f.store.get("p","grant",f.c.grantId),await f.store.list("p","asset"),"forged",()=>{},()=>{}),/campaign_prerequisites_stale/);
  }
  assert.ok(f.http.trace.every(r=>r.method==='GET'));
 }finally{await f.close();}
});

test("a separate restarted process returns the original acknowledged check with no provider configured",async()=>{
 const {fork}=await import("node:child_process"),{once}=await import("node:events");
 const f=await nativePreflightFixture();try{
  const original=await f.call("checkCampaign",f.check);assert.equal(original.state,"ready");
  const child=fork(new URL("./preflight-race-child.js",import.meta.url),[f.path,f.c.id,"replay",JSON.stringify(f.principal),JSON.stringify(f.check)],{stdio:["ignore","ignore","inherit","ipc"]});
  const exit=once(child,"exit");assert.deepEqual((await once(child,"message"))[0],{result:original});assert.equal((await exit)[0],0);
  assert.equal((await f.store.list("p","campaignCheck")).length,1);
 }finally{await f.close();}
});

test("credentials inside the native refresh margin cannot receive ready proof or trigger refresh",async()=>{
 const f=await nativePreflightFixture();try{
  const g=await f.store.get<Grant>("p","grant",f.c.grantId);
  await f.custody.useReadOnly(g,async()=>{},credentials=>f.custody.retainConnectionCredentials("p",g.secretRef,{...credentials,expiresAt:Date.now()+45000}));
  const result=await f.call("checkCampaign",f.check);assert.notEqual(result.state,"ready");assert.equal(f.http.trace.length,0);
 }finally{await f.close();}
});
