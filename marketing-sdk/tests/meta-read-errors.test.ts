import test from 'node:test';
import assert from 'node:assert/strict';
import {MetaMarketingClient} from '../support/owner-marketing/meta-client.js';
for(const method of ['GET','POST'])test(`Meta 80004 ${method} keeps HTTP evidence and never retries`,async()=>{
 let calls=0;
 const client=new MetaMarketingClient({accessToken:'fixture-secret',fetchImpl:async()=>{
  calls++;return Response.json({error:{code:80004,error_subcode:2446079,message:'fixture-secret'}},{status:400,headers:{'retry-after':'37'}});
 }});
 await assert.rejects(client.request('act_123',{method}),(e:any)=>{
  assert.equal(e.code,method==='GET'?'rate_limited':'provider_error');assert.equal(e.retryable,method==='GET');
  assert.equal(e.httpStatus,400);assert.equal(e.providerCode,80004);assert.equal(e.providerSubcode,2446079);
  assert.equal(e.retryAfterMs,method==='GET'?37000:null);assert.doesNotMatch(e.message,/fixture-secret/);return true;
 });assert.equal(calls,1);
});
