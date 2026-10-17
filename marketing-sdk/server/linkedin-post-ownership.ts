import {requireThat,digest} from './store.js';

/** A post edit affects every creative referencing it. Campaign authority may
 * edit only a dark post whose complete account inventory has one exact owner. */
export async function inspectLinkedInPostOwnership(client:any,accountId:string,campaignId:string,creativeId:string,
  postId:string,organizationId:string,guard:()=>void|Promise<void>) {
  requireThat(/^urn:li:(share|ugcPost):[0-9]+$/.test(postId),'linkedin_post_identity_unverified');
  const seen=new Set<string>(),tokens=new Set<string>(),references:Array<{id:string;campaign:string;post:string}>=[];
  let pageToken:string|null=null;
  do {
    await guard();
    const page:any=await client.listCreatives(accountId,{pageSize:100,pageToken});
    await guard();
    requireThat(Array.isArray(page?.elements)&&page.metadata&&typeof page.metadata==='object'&&!Array.isArray(page.metadata),
      'linkedin_post_ownership_inventory_incomplete');
    for(const row of page.elements){
      const id=String(row?.id??'').replace(/^urn:li:sponsoredCreative:/,'');
      requireThat(/^[0-9]+$/.test(id)&&!seen.has(id)&&row.account===`urn:li:sponsoredAccount:${accountId}`&&
        /^urn:li:sponsoredCampaign:[0-9]+$/.test(row.campaign??''),'linkedin_post_ownership_identity_invalid');
      seen.add(id);
      // A missing reference is not proof that a creative uses a different post.
      const full=row.content?.reference?row:await client.getCreative(accountId,id);
      await guard();
      requireThat(String(full.id).replace(/^urn:li:sponsoredCreative:/,'')===id&&full.campaign===row.campaign,'linkedin_post_ownership_identity_invalid');
      const ref=full.content?.reference??full.inlineContent?.post?.id;
      requireThat(/^urn:li:(share|ugcPost):[0-9]+$/.test(ref??''),'linkedin_post_ownership_inventory_incomplete');
      references.push({id,campaign:row.campaign,post:ref});
    }
    const next:unknown=page.metadata.nextPageToken;
    requireThat(next==null||typeof next==='string'&&next.length>0&&!tokens.has(next),
      'linkedin_post_ownership_inventory_incomplete');
    pageToken=typeof next==='string'?next:null;if(pageToken)tokens.add(pageToken);
  }while(pageToken);
  const owners=references.filter(row=>row.post===postId);
  requireThat(owners.length===1&&owners[0]!.id===creativeId&&owners[0]!.campaign===`urn:li:sponsoredCampaign:${campaignId}`,
    'linkedin_post_shared_or_unowned');
  const post=await client.request(`posts/${encodeURIComponent(postId)}`,{query:{viewContext:'AUTHOR'}});
  await guard();
  requireThat(post.id===postId&&post.author===`urn:li:organization:${organizationId}`&&
    post.adContext?.dscAdAccount===`urn:li:sponsoredAccount:${accountId}`&&post.distribution?.feedDistribution==='NONE',
    'linkedin_post_owner_unverified');
  return {postId,inventoryDigest:digest(references.sort((a,b)=>a.id.localeCompare(b.id))),observedAt:new Date().toISOString()};
}
