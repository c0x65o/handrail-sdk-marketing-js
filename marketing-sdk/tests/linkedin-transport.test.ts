import test from 'node:test';
import assert from 'node:assert/strict';
import {LinkedInMarketingClient,linkedInFailureEvidence} from '../server/index.js';
const client=(fetchImpl:typeof fetch)=>new LinkedInMarketingClient({accessToken:'private-token',clientId:'app',clientSecret:'private-secret',fetchImpl});

test('LinkedIn update requires matching readback and retains accepted-but-unknown outcome',async()=>{
  let writes=0;
  const c=client(async(_url,init)=>{
    assert.equal(init?.redirect,'error');
    if(init?.method==='POST'){writes++;return Response.json({});}
    return Response.json({id:'10',status:'ACTIVE'});
  });
  await assert.rejects(c.updateCampaignStatus('1','10','PAUSED'),(e:any)=>{
    assert.equal(e.providerOutcome,'unknown');assert.equal(e.code,'provider_outcome_unknown');
    assert.equal(e.providerRequest.method,'GET');return true;
  });
  assert.equal(writes,1);
  c.beforeWrite=async()=>{throw new Error('authority changed');};
  await assert.rejects(c.updateCampaignStatus('1','10','PAUSED'),/authority changed/);
  assert.equal(writes,1);
});

test('LinkedIn diagnostics encode structured Rest.li atoms and guard creative expansion',async()=>{
  const requests:string[]=[];
  const c=client(async(input)=>{requests.push(String(input));return Response.json({content:{reference:'urn:li:share:99'}});});
  await c.requestWithMeta('adSupplyForecasts',{query:{targeting:{include:['urn:li:staffCountRange:(2,10)']}}});
  assert.ok(requests[0]!.includes('urn%3Ali%3AstaffCountRange%3A%282%2C10%29'));
  await assert.rejects(c.requestWithMeta('adSupplyForecasts',{query:{query:'long'},maxUrlBytes:1}),{code:'request_bound_exceeded'});
  assert.equal(requests.length,1);
  await assert.rejects(c.getCreative('1','10',{assertCreative:async()=>{throw new Error('wrong campaign');}}),/wrong campaign/);
  assert.equal(requests.length,2);assert.ok(!requests.some(r=>r.includes('/posts/')));
});

test('LinkedIn diagnostics redact credentials before bounded text projection',async()=>{
  const secret='private-token';
  const evidence=linkedInFailureEvidence({message:'x'.repeat(495)+secret,providerCode:'VALIDATION'}, {lifecycle_credentials:[secret]});
  assert.ok(!JSON.stringify(evidence).includes('priva'));
  const c=client(async()=>Response.json({message:'Invalid request',serviceErrorCode:42,errorDetails:{inputErrors:[{field:'dailyBudget.amount',code:'TOO_LOW',minValue:5,message:'https://example.test/?access%255Ftoken=private-token'}]}},{status:400}));
  await assert.rejects(c.requestWithMeta('adCampaigns',{method:'POST',body:{}}),(e:any)=>{
    assert.equal(e.providerOutcome,'rejected');assert.equal(e.providerDiagnostic.service_error_code,42);
    assert.equal(e.providerDiagnostic.details[0].limits.minValue,5);
    assert.ok(!JSON.stringify(e).includes('private-token'));return true;
  });
});
