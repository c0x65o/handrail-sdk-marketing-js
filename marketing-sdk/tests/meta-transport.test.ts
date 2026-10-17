import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {MetaMarketingClient,MetaMarketingError,withMarketingCredentialCoverage,projectMarketingCredentialEvidence} from '../server/index.js';
import {safeMarketingEvidence} from '../support/owner-marketing/evidence-projection.js';

test('language catalogue follows guarded cursors on the trusted endpoint and rejects ambiguous labels',async()=>{
  const urls:URL[]=[];let guards=0;
  const client=new MetaMarketingClient({accessToken:'private-token',fetchImpl:async(input,init)=>{
    const url=new URL(String(input));urls.push(url);assert.equal(init?.method,'GET');
    assert.equal(url.pathname,'/v26.0/search');assert.equal(url.searchParams.get('type'),'adlocale');
    assert.equal(url.searchParams.has('q'),false);
    return Response.json(urls.length===1?{data:[{key:6,name:'English (US)'}],paging:{next:'https://attacker.invalid/',cursors:{after:'second'}}}:{data:[{key:1000,name:'English (All)'}]});
  }});
  const result=await client.listTargetingLanguages({assertCurrent:()=>{guards++;}});
  assert.deepEqual(result.options,[{kind:'languages',id:'6',label:'English (US)'},{kind:'languages',id:'1000',label:'English (All)'}]);
  assert.equal(result.source,'provider');assert.ok(Number.isFinite(Date.parse(result.observedAt)));
  assert.equal(guards,4);assert.ok(urls.every(u=>u.origin==='https://graph.facebook.com'));assert.equal(urls[1]!.searchParams.get('after'),'second');
  await assert.rejects(()=>client.listTargetingLanguages({assertCurrent:()=>{throw Error('revoked');}}),/revoked/);assert.equal(urls.length,2);
  for(const data of [[{key:6,name:''}],[{key:'unknown',name:'Unresolved'}],[{key:6,name:'English'},{key:6,name:'Other'}]]){
    client.fetchImpl=async()=>Response.json({data});
    await assert.rejects(()=>client.listTargetingLanguages(),{code:'provider_targeting_catalogue_invalid'});
  }
});

test('bounded Meta reads cancel oversized bodies and retain HTTP throttle evidence without a raw body',async()=>{
  let cancelled=false,calls=0;
  const client=new MetaMarketingClient({accessToken:'private-token',fetchImpl:async(_url,init)=>{
    calls++;assert.equal(init?.redirect,'error');
    return new Response(new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(40)));},cancel(){cancelled=true;}}));
  }});
  await assert.rejects(()=>client.request('123',{maxResponseBytes:32}),{code:'provider_response_limit'});
  assert.equal(cancelled,true);
  await assert.rejects(()=>client.request('123',{maxResponseBytes:-1}),{code:'invalid_configuration'});
  assert.equal(calls,1);
  client.fetchImpl=async()=>new Response('not json private-token',{status:429,headers:{'retry-after':'9'}});
  await assert.rejects(()=>client.request('123',{maxResponseBytes:100}),e=>{
    assert.ok(e instanceof MetaMarketingError);assert.equal(e.code,'rate_limited');assert.equal(e.httpStatus,429);assert.equal(e.retryAfterMs,9000);
    assert.ok(!e.message.includes('private-token'));return true;
  });
});

test('custom audience eligibility reads guard every page and never use provider continuation URLs',async()=>{
  const urls:URL[]=[];let checks=0;
  const client=new MetaMarketingClient({accessToken:'private-token',fetchImpl:async(input)=>{
    const url=new URL(String(input));urls.push(url);
    return Response.json({data:[{id:String(urls.length)}],...(urls.length===1?{paging:{next:'https://attacker.invalid/',cursors:{after:'second'}}}:{})});
  }});
  const result=await client.listCustomAudiences('123',{eligibilityMetadata:true,assertCurrent:async()=>{checks++;}});
  assert.equal(result.data.length,2);assert.equal(checks,4);
  assert.ok(urls.every(u=>u.origin==='https://graph.facebook.com'));
  assert.match(urls[0]!.searchParams.get('fields')!,/data_source/);
  assert.equal(urls[1]!.searchParams.get('after'),'second');
  const before=urls.length;
  await assert.rejects(()=>client.listCustomAudiences('123',{assertCurrent:async()=>{throw new Error('authority changed');}}),/authority changed/);
  assert.equal(urls.length,before);
});

test('SDK transport and host projections share isolated lifecycle credentials including Meta proof',async()=>{
  const reads=await Promise.all(['one','two'].map(async suffix=>{
    const token=`token-${suffix}-private`,secret=`app-${suffix}-private`;
    const proof=crypto.createHmac('sha256',secret).update(token).digest('hex');
    const client=new MetaMarketingClient({accessToken:token,appSecret:secret,fetchImpl:async()=>Response.json({text:proof})});
    return withMarketingCredentialCoverage(client,async()=>{
      await client.request('123');
      await new Promise(resolve=>setTimeout(resolve,5));
      return projectMarketingCredentialEvidence({proof,token,secret,prose:'20% of qualifying value',url:`https://example.test/${encodeURIComponent(proof)}`},safeMarketingEvidence);
    },safeMarketingEvidence);
  }));
  for(const r of reads){assert.equal(r.proof,'[redacted]');assert.equal(r.token,'[redacted]');assert.equal(r.secret,'[redacted]');assert.equal(r.prose,'20% of qualifying value');assert.ok(!r.url.includes('example.test'));}
  assert.equal(projectMarketingCredentialEvidence('token-one-private',safeMarketingEvidence),'token-one-private');
});
