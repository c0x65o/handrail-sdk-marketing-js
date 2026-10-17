import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {capturePublicDestination,destinationSnapshot,destinationContentDigest,type DestinationRedirect} from '../server/destination.js';
import {byteDigest} from '../server/store.js';

test('destination capture retains original case and query plus the checked same-origin redirect chain',async t=>{
  const calls:string[]=[],lookups:string[]=[];
  t.mock.method(dns,'lookup',async(host:string)=>{lookups.push(host);return [{address:'8.8.8.8',family:4}];});
  t.mock.method(https,'request',(url:URL,options:any,respond:any)=>{
    calls.push(url.href);assert.deepEqual(options.headers,{accept:'text/html','user-agent':'Handrail-Marketing-Snapshot/1'});
    options.lookup(url.hostname,{all:true},(error:any,addresses:any)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
    const req=new EventEmitter() as any;req.setTimeout=()=>{};req.destroy=(error:Error)=>req.emit('error',error);
    req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter() as any;res.resume=()=>{};
      res.statusCode=calls.length===1?308:200;res.headers=calls.length===1?{location:'/careers?utm_campaign=original'}:{'content-type':'text/html; charset=utf-8'};
      respond(res);if(res.statusCode===200){res.emit('data',Buffer.from('<p>Careers</p>'));res.emit('end');}
    });return req;
  });
  const url='https://example.com/Careers?utm_campaign=original',redirects:DestinationRedirect[]=[];
  const bytes=await capturePublicDestination(url,hop=>redirects.push(hop));
  assert.deepEqual(calls,[url,'https://example.com/careers?utm_campaign=original']);assert.deepEqual(lookups,['example.com','example.com']);
  assert.deepEqual(redirects,[{from:url,to:calls[1],status:308}]);
  const snapshot=destinationSnapshot(url,bytes,'public_https','2026-10-17T00:00:00Z',redirects);
  assert.equal(snapshot.version,3);assert.equal(snapshot.url,url);assert.equal(destinationContentDigest(snapshot,snapshot.digest,url),byteDigest(bytes));
  assert.notEqual(snapshot.digest,destinationSnapshot(url,bytes,'public_https',snapshot.observedAt).digest);
  const changed=structuredClone(snapshot);changed.redirects![0]!.status=301;
  assert.throws(()=>destinationContentDigest(changed,snapshot.digest,url),/destination_snapshot_mismatch/);
  redirects[0]!.to='https://example.com/changed';assert.notEqual(snapshot.redirects![0]!.to,redirects[0]!.to);
});

for(const scenario of ['cross-origin','http','credentials','private-next-hop','loop','too-many','missing-location','non-html','oversize'] as const){
 test(`destination rejects ${scenario} without an unchecked request`,async t=>{
  let resolutions=0,requests=0;
  t.mock.method(dns,'lookup',async()=>[{address:scenario==='private-next-hop'&&++resolutions>1?'127.0.0.1':'8.8.8.8',family:4}]);
  t.mock.method(https,'request',(_url:URL,_options:any,respond:any)=>{
   requests++;const req=new EventEmitter() as any;req.setTimeout=()=>{};req.destroy=(error:Error)=>req.emit('error',error);
   req.end=()=>queueMicrotask(()=>{
    const res=new EventEmitter() as any;res.resume=()=>{};
    const locations={ 'cross-origin':'https://other.example/landing',http:'http://example.com/landing',credentials:'https://secret@example.com/landing','private-next-hop':'/landing',loop:'/start','too-many':`/hop${requests}`,'missing-location':undefined,'non-html':undefined,oversize:undefined };
    res.statusCode=['non-html','oversize'].includes(scenario)?200:308;
    res.headers=res.statusCode===200?{'content-type':scenario==='non-html'?'application/json':'text/html'}:{location:locations[scenario]};
    respond(res);if(res.statusCode===200){res.emit('data',Buffer.alloc(scenario==='oversize'?2*1024*1024+1:1));res.emit('end');}
   });return req;
  });
  const expected={ 'cross-origin':'destination_redirect_scope',http:'invalid_destination_url',credentials:'invalid_destination_url','private-next-hop':'private_destination_denied',loop:'destination_redirect_loop','too-many':'destination_redirect_limit','missing-location':'destination_redirect_location_missing','non-html':'destination_requires_html_response',oversize:'destination_snapshot_too_large' };
  await assert.rejects(capturePublicDestination('https://example.com/start'),{code:expected[scenario]});
  assert.equal(requests,scenario==='too-many'?6:1);
 });
}
