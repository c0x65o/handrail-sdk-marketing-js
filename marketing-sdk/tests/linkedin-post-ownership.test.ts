import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectLinkedInPostOwnership} from '../server/linkedin-post-ownership.js';

function fixture(){
 const postId='urn:li:share:9';
 const row={id:'urn:li:sponsoredCreative:3',account:'urn:li:sponsoredAccount:1',campaign:'urn:li:sponsoredCampaign:2',content:{reference:postId}};
 const post={id:postId,author:'urn:li:organization:4',adContext:{dscAdAccount:'urn:li:sponsoredAccount:1'},distribution:{feedDistribution:'NONE'}};
 let pages:any[]=[{elements:[row],metadata:{}}],reads=0;
 const client={listCreatives:async(account:string,options:any)=>{assert.equal(account,'1');assert.equal(options.pageSize,100);return pages[reads++]},
  request:async(path:string,options:any)=>{assert.equal(path,'posts/urn%3Ali%3Ashare%3A9');assert.equal(options.query.viewContext,'AUTHOR');return post;},
  getCreative:async()=>({...row,inlineContent:{post}})};
 return {row,post,client,pages,check:(guard=()=>{})=>inspectLinkedInPostOwnership(client,'1','2','3',postId,'4',guard),setPages:(value:any[])=>{pages=value;reads=0;}};
}
test('post ownership reads all account pages and retains exact identity and inventory digest',async()=>{
 const f=fixture();f.setPages([{elements:[],metadata:{nextPageToken:'second'}},{elements:[f.row],metadata:{}}]);
 const proof=await f.check();assert.equal(proof.postId,f.post.id);assert.match(proof.inventoryDigest,/^[a-f0-9]{64}$/);assert.ok(Date.parse(proof.observedAt));
});
for(const [name,mutate,code] of [
 ['shared post',(f:any)=>f.pages[0].elements.push({...f.row,id:'urn:li:sponsoredCreative:8',campaign:'urn:li:sponsoredCampaign:7'}),'linkedin_post_shared_or_unowned'],
 ['missing owner',(f:any)=>f.pages[0].elements.splice(0),'linkedin_post_shared_or_unowned'],
 ['different campaign',(f:any)=>f.row.campaign='urn:li:sponsoredCampaign:7','linkedin_post_shared_or_unowned'],
 ['different account',(f:any)=>f.row.account='urn:li:sponsoredAccount:7','linkedin_post_ownership_identity_invalid'],
 ['duplicate creative',(f:any)=>f.pages[0].elements.push({...f.row}),'linkedin_post_ownership_identity_invalid'],
 ['missing metadata',(f:any)=>delete f.pages[0].metadata,'linkedin_post_ownership_inventory_incomplete'],
 ['bad cursor',(f:any)=>f.pages[0].metadata.nextPageToken=1,'linkedin_post_ownership_inventory_incomplete'],
 ['missing reference',(f:any)=>delete f.row.content,'linkedin_post_ownership_inventory_incomplete'],
 ['post account changed',(f:any)=>f.post.adContext.dscAdAccount='urn:li:sponsoredAccount:7','linkedin_post_owner_unverified'],
 ['post author changed',(f:any)=>f.post.author='urn:li:organization:7','linkedin_post_owner_unverified'],
 ['organic distribution',(f:any)=>f.post.distribution.feedDistribution='MAIN_FEED','linkedin_post_owner_unverified'],
 ['post identity changed',(f:any)=>f.post.id='urn:li:share:7','linkedin_post_owner_unverified'],
] as const)test(`post ownership rejects ${name}`,async()=>{const f=fixture();mutate(f);if(name==='missing reference')f.client.getCreative=async()=>({...f.row,inlineContent:{post:{...f.post,id:undefined}}} as any);await assert.rejects(f.check(),{code});});
test('post ownership rejects cursor cycles and guard revocation without a provider write',async()=>{
 const f=fixture();f.setPages([{elements:[],metadata:{nextPageToken:'again'}},{elements:[],metadata:{nextPageToken:'again'}}]);
 await assert.rejects(f.check(),{code:'linkedin_post_ownership_inventory_incomplete'});
 const g=fixture();let n=0;await assert.rejects(g.check(()=>{if(++n===2)throw Error('scope_revoked')}),/scope_revoked/);
});
