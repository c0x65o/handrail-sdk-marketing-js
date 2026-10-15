import test from "node:test";
import assert from "node:assert/strict";
import { inspectMetaToken } from "../server/meta-token-inspection.js";

const credentials={accessToken:"private-inspected-token",appId:"123",appSecret:"private-app-secret"};
function fixture() {
  const data:any={is_valid:true,app_id:"123",type:"SYSTEM_USER",scopes:["ads_read","ads_management"],
    expires_at:0,data_access_expires_at:0};
  let checks=0, requests=0, revoked=false;
  const read=()=>inspectMetaToken(credentials,async()=>{checks++;if(revoked)throw Error("actual-authority-revoked");},async(input,init)=>{
    requests++;const url=new URL(String(input));assert.equal(url.origin,"https://graph.facebook.com");
    assert.equal(url.pathname,"/v26.0/debug_token");assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer 123|private-app-secret");
    assert.equal(url.searchParams.get("input_token"),credentials.accessToken);
    if(data.revoke)revoked=true;
    if(data.transportError)return Response.json({error:{message:JSON.stringify(credentials)}},{status:403});
    return Response.json({data});
  });
  return {data,read,checks:()=>checks,requests:()=>requests};
}
test("Meta token inspection keeps explicit no-scheduled-expiry separate from host grants",async()=>{
  const f=fixture(),r=await f.read();assert.equal(r.earliestExpiresAt,null);assert.equal(r.lifetime,"no_scheduled_expiry");
  assert.equal(f.requests(),1);assert.ok(f.checks()>=4);
  for(const secret of [credentials.accessToken,credentials.appSecret])assert.equal(JSON.stringify(r).includes(secret),false);
});
test("Meta token inspection preserves both expiry clocks and uses the earlier actual expiry",async()=>{
  const f=fixture(),now=Math.floor(Date.now()/1000);f.data.expires_at=now+1000;f.data.data_access_expires_at=now+500;
  const r=await f.read();assert.equal(r.lifetime,"scheduled_expiry");assert.equal(r.earliestExpiresAt,new Date((now+500)*1000).toISOString());
});
for(const [label,change,code] of [
  ["inactive",(d:any)=>{d.is_valid=false;},"meta_token_inactive"],
  ["app",(d:any)=>{d.app_id="999";},"meta_token_app_mismatch"],
  ["type",(d:any)=>{d.type="PAGE";},"meta_token_type_unverified"],
  ["scopes",(d:any)=>{d.scopes=["ads_read","ads_read"];},"meta_token_scopes_unverified"],
  ["missing expiry",(d:any)=>{delete d.expires_at;},"meta_token_expiry_unverified"],
  ["missing data expiry",(d:any)=>{delete d.data_access_expires_at;},"meta_token_expiry_unverified"],
  ["string expiry",(d:any)=>{d.expires_at="0";},"meta_token_expiry_unverified"],
  ["expired",(d:any)=>{d.expires_at=1;},"meta_token_expired"],
  ["data expired",(d:any)=>{d.data_access_expires_at=1;},"meta_token_expired"],
  ["revoked",(d:any)=>{d.revoke=true;},"actual-authority-revoked"],
  ["transport",(d:any)=>{d.transportError=true;},"meta_token_inspection_unavailable"],
] as const)test(`Meta token inspection rejects ${label} without exposing credentials`,async()=>{
  const f=fixture();change(f.data);await assert.rejects(f.read(),error=>{
    assert.match(String(error),new RegExp(code));for(const s of [credentials.accessToken,credentials.appSecret])assert.equal(String(error).includes(s),false);return true;
  });assert.equal(f.requests(),1);
});
