import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinkedInCommentaryLookup as createImageProxyLookup} from '../support/owner-marketing/linkedin-commentary-links.js';
import {resolveLinkedInCommentaryUrl,compareLinkedInCommentaryUrls} from '../support/owner-marketing/linkedin-commentary-links.js';
import {salespersonCopy} from './fixtures/linkedin-commentary.js';
import {mockCommentaryUrls,shortUrl,interstitial} from './fixtures/linkedin-commentary-urls.js';
const careers='https://handrail-daas.com/careers';
const shortCopy=salespersonCopy.replace(careers,shortUrl);

test('shortened URL equivalence uses fresh proof and retains exact original prose',async t=>{
 const http=mockCommentaryUrls(t);const compared=await compareLinkedInCommentaryUrls(salespersonCopy,shortCopy);
 assert.equal(compared.equivalent,true);assert.equal(compared.evidence[0]!.final_url,careers);
 assert.deepEqual(http.calls,[shortUrl,careers]);
});
for(const destination of ['https://example.com/careers',careers+'/',careers+'?x=1',careers+'#apply',careers.replace('/careers','/apply')])test(`different destination fails: ${destination}`,async t=>{
  mockCommentaryUrls(t,{destination});
  const result=await compareLinkedInCommentaryUrls(salespersonCopy,shortCopy);
  assert.equal(result.equivalent,false);assert.equal(result.evidence[0]!.status,'resolved');
});
test('customer percentages and reserved punctuation remain exact; encoded path and ordered query are preserved',async t=>{
  const url='https://example.com/a%20b?rate=20%25&x=1&x=2';
  mockCommentaryUrls(t,{destination:url,redirect:true});
  const expected=`Manufacturers: track 95% (orders [ready], floor_2, A|B and #batch). Review ${url}. Written terms govern.`;
  assert.equal((await compareLinkedInCommentaryUrls(expected,expected.replace(url,shortUrl))).equivalent,true);
  for(const changed of [expected.replace('95%','100%'),expected.replace('Written terms govern.',''),expected.replace('A|B','A B')]) {
    assert.equal((await compareLinkedInCommentaryUrls(expected,changed.replace(url,shortUrl))).equivalent,false);
  }
});
for(const changed of [shortCopy.replace('Earn 20%','Earn 30%'),shortCopy.replace('Written terms govern. ',''),shortCopy.replace(shortUrl,'https://lnkd.in.evil.test/a'),shortCopy.replace(shortUrl,shortUrl+'/extra'),shortCopy.replace(shortUrl,shortUrl+'?x=1'),shortCopy.replace(shortUrl,shortUrl+'?')])test('altered prose or unsupported URL cannot borrow a proof',async t=>{
  const http=mockCommentaryUrls(t);assert.equal((await compareLinkedInCommentaryUrls(salespersonCopy,changed)).equivalent,false);assert.equal(http.calls.length,0);
});
for(const destination of ['http://example.com/a','file:///etc/passwd','https://127.0.0.1/','https://[::1]/','https://169.254.169.254/','https://10.0.0.1/','https://user:password@example.com/','https://example.com:8443/','https://localhost/'])test(`unsafe redirect fails closed: ${destination}`,async t=>{
  const http=mockCommentaryUrls(t,{destination,redirect:true});
  assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).status,'unresolved');
  assert.ok(http.calls.length<=2);
});
test('existing socket lookup rejects private/mixed DNS answers and pins exact public answers',async()=>{
  for(const address of ['127.0.0.1','::ffff:127.0.0.1','fe80::1','10.0.0.1']) {
    await assert.rejects(new Promise<void>((resolve,reject)=>createImageProxyLookup(async()=>[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}])('host',{},error=>error?reject(error):resolve())));
  }
  const records=[{address:'8.8.8.8',family:4}];
  assert.deepEqual(await new Promise((resolve,reject)=>createImageProxyLookup(async()=>records)('host',{all:true},(error,value)=>error?reject(error):resolve(value))),records);
});
for(const body of ['<a href="https://handrail-daas.com/careers">Continue</a>',interstitial(careers)+interstitial(careers),interstitial(careers)+'<base href="https://example.com">',interstitial(careers)+'<meta http-equiv="refresh" content="0;url=https://example.com">'])test('ambiguous/unrecognized interstitial fails closed',async t=>{
  mockCommentaryUrls(t,{body});assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).status,'unresolved');
});
test('redirect loops, hop count, body limit, HTTP failures, DNS failure and deadline are bounded',async t=>{
  const http=mockCommentaryUrls(t,{redirect:true,destination:shortUrl});
  assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).reason,'redirect_loop');
  http.set({routes:Object.fromEntries([shortUrl,'https://example.com/1','https://example.com/2','https://example.com/3'].map((u,i)=>[u,{status:302,location:`https://example.com/${i+1}`}]))});
  assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).reason,'redirect_limit');
  http.set({routes:null,redirect:false,body:'x'.repeat(32769)});
  assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).reason,'response_limit');
  http.set({routes:{[shortUrl]:{status:403}}});assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).reason,'http_status');
  http.set({error:'ENOTFOUND'});assert.equal((await resolveLinkedInCommentaryUrl(shortUrl)).reason,'ENOTFOUND');
  http.set({error:null,waitForAbort:true});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10);
  assert.equal((await resolveLinkedInCommentaryUrl(shortUrl,{signal:controller.signal})).reason,'timeout');clearTimeout(timer);
});
test('saved success cannot authorize changed mapping; revocation stops later hops',async t=>{
 const http=mockCommentaryUrls(t);
 assert.equal((await compareLinkedInCommentaryUrls(salespersonCopy,shortCopy)).equivalent,true);
 http.set({destination:careers+'?changed=1'});
 assert.equal((await compareLinkedInCommentaryUrls(salespersonCopy,shortCopy)).equivalent,false);
 http.set({destination:careers});let active=true;
 http.set({onRead:()=>{active=false;}});
 await assert.rejects(compareLinkedInCommentaryUrls(salespersonCopy,shortCopy,{guard:()=>{if(!active)throw Error('revoked');}}),/revoked/);
});

test('an approved intermediate hop is insufficient; final redirects and exact query encoding still matter',async t=>{
  const http=mockCommentaryUrls(t,{routes:{[shortUrl]:{status:302,location:careers},[careers]:{status:302,location:'/unapproved'}}});
  assert.equal((await compareLinkedInCommentaryUrls(salespersonCopy,shortCopy)).equivalent,false);
  const expected='https://example.com/a%2Fb?x=1&x=2';
  http.set({routes:null,destination:'https://example.com/a/b?x=1&x=2'});
  assert.equal((await compareLinkedInCommentaryUrls(`Review ${expected}.`,`Review ${shortUrl}.`)).equivalent,false);
  http.set({destination:'https://example.com/a%2Fb?x=2&x=1'});
  assert.equal((await compareLinkedInCommentaryUrls(`Review ${expected}.`,`Review ${shortUrl}.`)).equivalent,false);
});
test('each URL occurrence must resolve and surrounding punctuation remains exact',async t=>{
  mockCommentaryUrls(t);
  const expected=`First (${careers}), then ${careers}.`;
  assert.equal((await compareLinkedInCommentaryUrls(expected,expected.replaceAll(careers,shortUrl))).equivalent,true);
  assert.equal((await compareLinkedInCommentaryUrls(expected,expected.replaceAll(careers,shortUrl).replace('),',')'))).equivalent,false);
});
