import { createHash } from "node:crypto";
import assert from "node:assert/strict";
/** Deterministic external HTTP boundary, not a ProviderPort or persisted proof. */
export function metaPreflightHttp(connectionFetch: typeof fetch, account = "act_2041", page = "555") {
  const objects = new Map<string, any>();
  const trace: { sequence: number; at: number; path: string; method: string; query: Record<string,string>; body?: unknown }[] = [];
  let next = 100, loseActivation = false;
  const fixture: { trace: typeof trace; objects: typeof objects; loseActivation(): void; boundary: null | ((url: URL, init?: RequestInit) => Promise<void>); override: null | ((url: URL, init?: RequestInit) => Response | undefined); fetch: typeof fetch } = {
    trace, objects,
    loseActivation() { loseActivation = true; },
    boundary: null as null | ((url: URL, init?: RequestInit) => Promise<void>),
    override: null as null | ((url: URL, init?: RequestInit) => Response | undefined),
    fetch: (async (raw, init) => {
      const url = new URL(String(raw)), method = init?.method ?? "GET", last = url.pathname.split("/").at(-1)!;
      assert.equal(url.origin, "https://graph.facebook.com"); assert.ok(url.pathname.startsWith("/v26.0/")); assert.equal(init?.redirect, "error");
      const entry: typeof trace[number] = { sequence: trace.length + 1, at: performance.timeOrigin + performance.now(), path: url.pathname, method, query: Object.fromEntries([...url.searchParams].filter(([k]) => !["access_token", "appsecret_proof"].includes(k))) };
      trace.push(entry);
      await fixture.boundary?.(url, init);
      const override = fixture.override?.(url, init); if (override) return override;
      if (method === "GET") {
        if (last === "search") {
          assert.equal(url.searchParams.get("type"), "adgeolocation");
          assert.equal(url.searchParams.get("location_types"), '["country"]');
          const q = url.searchParams.get("q")!.toLowerCase();
          return Response.json({ data: [{ key: "US", name: "United States", type: "country" }, { key: "CA", name: "Canada", type: "country" }, { key: "GB", name: "United Kingdom", type: "country" }]
            .filter(c => c.key.toLowerCase() === q || c.name.toLowerCase().includes(q)) });
        }
        if (last === account) return Response.json({id:account,currency:"USD",timezone_name:"America/Chicago",account_status:1,disable_reason:0,funding_source_details:{id:"SYNTHETIC_BILLING_SIGNAL"}});
        if (last === page) return Response.json({id:page,name:"Synthetic Page",instagram_business_account:{id:"556",username:"synthetic"}});
        if (last === "adimages") return Response.json({data:[{hash:"synthetic-image-hash",status:"ACTIVE"}]});
        if (last === "insights") {
          assert.equal(url.searchParams.get("level"),"campaign");
          return Response.json({data:[{impressions:"1000",clicks:"25",spend:"17.50",actions:[{action_type:"lead",value:"999"}]}]});
        }
        if (objects.has(last)) return Response.json(objects.get(last));
        return connectionFetch(raw, init);
      }
      assert.equal(method,"POST");
      if (last === "adimages") { assert.ok(init?.body instanceof FormData);
        const file=init.body.get("filename"); assert.ok(file instanceof Blob);
        entry.body={ field:"filename", byteLength:file.size, digest:createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex"), filename:file instanceof File?file.name:null };
        return Response.json({images:{"fixture.png":{hash:"synthetic-image-hash"}}}); }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : Object.fromEntries([...url.searchParams].map(([k,v]) => {try{return [k,JSON.parse(v)];}catch{return [k,v];}}));
      delete body.access_token; delete body.appsecret_proof; entry.body = structuredClone(body);
      if (objects.has(last)) {
        assert.ok(["ACTIVE","PAUSED"].includes(body.status)); objects.set(last,{...objects.get(last),...body});
        if (body.status === "ACTIVE" && loseActivation && objects.get(last).objective) {loseActivation=false;throw new Error("synthetic_lost_activation_ack");}
        return Response.json({success:true});
      }
      assert.ok(["campaigns","adsets","adcreatives","ads"].includes(last));
      if(last==="campaigns") {assert.equal(body.status,"PAUSED");assert.equal(body.objective,"OUTCOME_TRAFFIC");assert.equal(body.is_adset_budget_sharing_enabled,false);}
      if(last==="adsets") {assert.equal(body.status,"PAUSED");assert.equal(body.optimization_goal,"LINK_CLICKS");assert.ok(Number(body.lifetime_budget)>0);assert.equal(body.daily_budget,undefined);}
      if(last==="ads") assert.equal(body.status,"PAUSED");
      const id=String(next++);
      if(body.creative)body.creative={id:String(body.creative.creative_id)};
      if(body.campaign_id)body.campaign_id=String(body.campaign_id);
      if(body.adset_id)body.adset_id=String(body.adset_id);
      objects.set(id,{...body,id,account_id:account.replace(/^act_/,"")});return Response.json({id});
    }) as typeof fetch,
  };
  return fixture;
}
