import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeProvider,type VaultPort} from '../server/providers.js';
import type {Store} from '../server/store.js';
import type {Grant} from '../core/index.js';
function fixture(){
 const g:Grant={id:'g',projectId:'p',revision:1,provider:'meta',accountId:'act_123',pageId:'42',label:'Fixture',currency:'USD',timezone:'America/Chicago',permissions:['pause','report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'};
 const image:any={account_id:'123',hash:'a'.repeat(32),name:'handrail-historical-text-hash.jpg',original_width:1024,original_height:1280,status:'ACTIVE'};
 const pages:any[]=[{data:[image]}];const calls:string[]=[];let afterFetch=()=>{};
 const vault:VaultPort={use:async()=>{throw Error('no writes');},useReadOnly:async(_g,guard,fn)=>{await guard();return fn({accessToken:'synthetic-private-token',expiresAt:Date.parse(g.expiresAt),scopes:['ads_read']});}};
 const provider=new NativeProvider('meta',vault,null as unknown as Store,async(input,init)=>{
  const u=new URL(String(input));calls.push(u.pathname);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  const body=u.pathname==='/v26.0/act_123'?{id:'act_123',currency:'USD',timezone_name:'America/Chicago'}:pages.shift();
  const r=Response.json(body);afterFetch();return r;
 });
 return {g,image,pages,calls,after:(fn:()=>void)=>{afterFetch=fn;},read:(guard=async()=>{})=>provider.inspectExistingMetaImage(g,image.hash,guard)};
}
test('Meta image metadata read binds exact account/hash without claiming binary proof or spending authority',async()=>{
 const f=fixture(),r=await f.read();assert.equal(r.image.hash,f.image.hash);assert.equal(r.image.width,1024);assert.equal(r.image.name,f.image.name);
 assert.equal(r.originalUploadBytesVerified,false);assert.equal(r.providerImageReadbackVerified,true);assert.equal(r.executionTransferred,false);assert.equal(r.spendingAuthorityGranted,false);
 assert.equal(r.providerSnapshotDigest.length,64);assert.deepEqual(f.calls,['/v26.0/act_123','/v26.0/act_123/adimages']);assert.doesNotMatch(JSON.stringify(r),/synthetic-private-token/);
});
for(const [label,mutate] of Object.entries({wrongAccount:(f:ReturnType<typeof fixture>)=>{f.image.account_id='999';},missingWidth:(f:ReturnType<typeof fixture>)=>{delete f.image.original_width;},missing:(f:ReturnType<typeof fixture>)=>{f.pages[0].data=[];},duplicate:(f:ReturnType<typeof fixture>)=>{f.pages[0].data.push(f.image);}}))test(`Meta image read rejects ${label}`,async()=>{const f=fixture();mutate(f);await assert.rejects(f.read());});
test('Meta image read accounts for pagination and rechecks revocation during reads',async()=>{
 const f=fixture();f.pages[0]={data:[],paging:{next:'https://graph.facebook.com/v26.0/act_123/adimages?after=next',cursors:{after:'next'}}};f.pages.push({data:[f.image]});assert.equal((await f.read()).image.hash,f.image.hash);assert.equal(f.calls.length,3);
 const g=fixture();let revoked=false;g.after(()=>{revoked=true;});await assert.rejects(g.read(async()=>{if(revoked)throw Error('revoked');}),/revoked/);
 const h=fixture();h.after(()=>{h.g.accountId='act_999';});await assert.rejects(h.read(),/existing_campaign_scope_changed/);
});
