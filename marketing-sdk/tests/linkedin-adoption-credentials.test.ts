import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkedInMeasurementClient } from '../server/measurement-collectors.js';

const now=Date.parse('2026-10-15T00:00:00Z'),epoch=now/1000;
for (const active of [undefined,false] as const) test(`token denial distinguishes missing active evidence from explicit inactivity (${active})`,async()=>{
  let reads=0;
  const client=new LinkedInMeasurementClient({accessToken:'fixture-access',clientId:'fixture-client',clientSecret:'fixture-secret',fetchImpl:async(input:any)=>{
    assert.equal(new URL(String(input)).pathname,'/oauth/v2/introspectToken');reads++;
    return Response.json(active===undefined?{}:{active});
  }});
  await assert.rejects(client.verifyConnection({adAccountId:'123'}),{code:'verification_failed',verificationReason:active===false?'token_inactive':'token_active_unverified'});
  assert.equal(reads,1);
});
for(const [label,refresh,inspection,expected] of [
  ['introspection expires first',3600,epoch+120,epoch+120],
  ['refresh expires first',120,epoch+3600,epoch+120],
  ['introspection has no expiry',3600,undefined,epoch+3600],
  ['direct token uses introspection',null,epoch+120,epoch+120],
  ['unknown remains unknown',null,undefined,null],
] as const)test(`existing LinkedIn connection: ${label}`,async()=>{
  const methods:string[]=[];
  const client=new LinkedInMeasurementClient({clientId:'fixture-client',clientSecret:'fixture-secret',
    ...(refresh===null?{accessToken:'fixture-access'}:{refreshToken:'fixture-refresh'}),now:()=>now,tokenRefreshSkewMs:0,
    fetchImpl:async(input:any,init:any)=>{
      const url=new URL(String(input));methods.push(`${init.method} ${url.pathname}`);
      assert.equal(init.redirect,'error');
      if(url.pathname==='/oauth/v2/accessToken')return Response.json({access_token:'fixture-access',expires_in:refresh});
      if(url.pathname==='/oauth/v2/introspectToken')return Response.json({active:true,client_id:'fixture-client',auth_type:'3L',scope:'rw_ads r_ads_reporting',...(inspection===undefined?{}:{expires_at:inspection})});
      assert.equal(url.pathname,'/rest/adAccounts/123');assert.equal(init.method,'GET');
      return Response.json({id:123,currency:'USD',reference:'urn:li:organization:456',status:'ACTIVE',servingStatuses:['RUNNABLE']});
    }});
  const verified=await client.verifyConnection({adAccountId:'123',organizationId:'456'});
  assert.equal(verified.assets.token.expiresAt,expected);
  assert.equal(verified.assets.token.introspectionActive,true);
  assert.equal(verified.permissions.adsManagement,true);
  assert.equal(verified.account.id,'123');
  assert.equal(methods.filter(x=>x.startsWith('POST')).length,refresh===null?1:2);
  assert.equal(methods.at(-1),'GET /rest/adAccounts/123');
});
