import test from "node:test";
import assert from "node:assert/strict";
import { existingMetaChildren, existingMetaAdoptionChildren } from "../server/existing-meta-children.js";
import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { digest } from "../server/store.js";

const ids = {campaign: "100", adset: "101", ad: "103", creative: "102"};
function fixture() {
  const adset: any = {id:"101", account_id:"123", campaign_id:"100", status:"PAUSED", effective_status:"CAMPAIGN_PAUSED"};
  const ad: any = {id:"103", account_id:"123", campaign_id:"100", adset_id:"101", creative:{id:"102"}, status:"PAUSED", effective_status:"ADSET_PAUSED"};
  const pages: Record<string, any[]> = {adsets:[{data:[adset]}], ads:[{data:[ad]}]};
  const requests: URL[] = [];
  const client = new MetaMarketingClient({accessToken:"synthetic-test-token", fetchImpl:async(input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.origin,"https://graph.facebook.com"); assert.equal(init?.method,"GET");
    assert.equal(init?.redirect,"error");
    assert.equal(url.searchParams.has("filtering"),false);
    const edge=url.pathname.split("/").at(-1)!;
    assert.equal(url.pathname,`/v26.0/100/${edge}`);
    assert.ok(["adsets","ads"].includes(edge));
    assert.ok(url.searchParams.get("fields")?.includes("account_id"));
    const page=pages[edge]!.shift();
    if(page instanceof Error) throw page;
    if(page instanceof Response) return page;
    assert.ok(page,"unexpected extra page"); return Response.json(page);
  }});
  return {adset,ad,pages,requests,read:()=>existingMetaChildren(client,"act_123",ids),adopt:()=>existingMetaAdoptionChildren(client,"act_123",ids)};
}

test("Meta adoption retains configured-paused WITH_ISSUES without claiming effective pause",async()=>{
  const f=fixture();f.ad.effective_status="WITH_ISSUES";
  const actual=await f.adopt();
  assert.equal(actual.ads[0]!.status,"PAUSED");assert.equal(actual.ads[0]!.effectiveStatus,"WITH_ISSUES");
  assert.equal(actual.adsets[0]!.effectiveStatus,"CAMPAIGN_PAUSED");
});
for(const [name,change] of Object.entries({
  configuredActive:(f:ReturnType<typeof fixture>)=>{f.ad.status="ACTIVE";},
  effectiveActive:(f:ReturnType<typeof fixture>)=>{f.ad.effective_status="ACTIVE";},
  unknown:(f:ReturnType<typeof fixture>)=>{delete f.ad.effective_status;},
  parentIssue:(f:ReturnType<typeof fixture>)=>{f.adset.effective_status="WITH_ISSUES";},
  parentActive:(f:ReturnType<typeof fixture>)=>{f.adset.status="ACTIVE";},
  extraChild:(f:ReturnType<typeof fixture>)=>{f.pages.ads![0].data.push({...f.ad,id:"999"});},
}))test(`Meta held adoption rejects ${name}`,async()=>{
  const f=fixture();f.ad.effective_status="WITH_ISSUES";change(f);await assert.rejects(f.adopt());
});

test("Meta adoption inventories both unfiltered campaign edges and returns stable explicit identity/state evidence", async()=>{
  const f=fixture(), result=await f.read();
  assert.equal(f.requests.length,2);assert.equal(result.adsets[0]!.id,"101");
  assert.equal(result.ads[0]!.creativeId,"102");
  const g=fixture();g.ad.name="cosmetic";g.adset.updated_time="later";
  assert.equal(digest(result),digest(await g.read()));
});

test("Meta adoption follows cursors to the terminal page without trusting paging.next URLs",async()=>{
  const f=fixture();
  for(const edge of ["adsets","ads"]) f.pages[edge]!.unshift({data:[],paging:{next:"https://untrusted.invalid/leak",cursors:{after:"next"}}});
  await f.read();assert.equal(f.requests.length,4);
  assert.deepEqual(f.requests.map(u=>u.searchParams.get("after")),[null,"next",null,"next"]);
});

for(const edge of ["adsets","ads"]) {
  for(const [label,change] of Object.entries({
    extra:(f:ReturnType<typeof fixture>)=>{f.pages[edge]![0].data.push({...f.pages[edge]![0].data[0],id:"999"});},
    duplicate:(f:ReturnType<typeof fixture>)=>{f.pages[edge]![0].data.push(f.pages[edge]![0].data[0]);},
    missing:(f:ReturnType<typeof fixture>)=>{f.pages[edge]![0].data=[];},
    account:(f:ReturnType<typeof fixture>)=>{f.pages[edge]![0].data[0].account_id="999";},
    parent:(f:ReturnType<typeof fixture>)=>{f.pages[edge]![0].data[0].campaign_id="999";},
  })) test(`Meta ${edge} rejects ${label} child inventory`,async()=>{
    const f=fixture();change(f);await assert.rejects(f.read(),/existing_campaign_children_mismatch/);
  });
  for(const [label,change] of Object.entries({
    active:(row:any)=>{row.status="ACTIVE";},
    effectiveActive:(row:any)=>{row.effective_status="ACTIVE";},
    effectiveUnknown:(row:any)=>{delete row.effective_status;},
    issues:(row:any)=>{row.effective_status="WITH_ISSUES";},
  })) test(`Meta ${edge} rejects ${label} state as paused proof`,async()=>{
    const f=fixture();change(f.pages[edge]![0].data[0]);await assert.rejects(f.read(),/existing_campaign_children_not_paused/);
  });
  for(const mode of ["extra", "cycle", "missingCursor", "malformed", "failure"])
    test(`Meta ${edge} does not accept partial pagination: ${mode}`,async()=>{
      const f=fixture(),first=f.pages[edge]![0];
      first.paging={next:"https://untrusted.invalid/next",cursors:{after:"next"}};
      if(mode==="missingCursor")delete first.paging.cursors;
      else if(mode==="extra")f.pages[edge]!.push({data:[{...first.data[0],id:"999"}]});
      else if(mode==="cycle")f.pages[edge]!.push({data:[],paging:first.paging});
      else if(mode==="malformed")f.pages[edge]!.push({paging:{}});
      else f.pages[edge]!.push(new Response(JSON.stringify({error:{message:"synthetic expired token",code:190}}),{status:401}));
      await assert.rejects(f.read());
      assert.ok(f.requests.length<=3);
    });
}
for(const key of ["adset_id","creative"])test(`Meta ad must retain the exact ${key} association`,async()=>{
  const f=fixture();f.ad[key]=key==="creative"?{id:"999"}:"999";
  await assert.rejects(f.read(),/existing_campaign_children_mismatch/);
});
