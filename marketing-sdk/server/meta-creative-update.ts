import type {Asset,Campaign,Grant,MetaCreativeTransition} from '../core/index.js';
import {MetaMarketingClient,accountPath} from '../support/owner-marketing/meta-client.js';
import {existingMetaAdoptionChildren} from './existing-meta-children.js';
import {exactTargeting} from './capabilities.js';
import {prepareMetaImageUpload} from './meta-image.js';
import {digest,requireThat} from './store.js';

export interface MetaCreativeUpdateIntent {
  version:1;
  phase:'planned'|'image_attempted'|'image_observed'|'creative_attempted'|'creative_observed'|'adset_attempted'|'association_attempted'|'observed';
  previousReceiptDigest:string;
  previousMaterialDigest:string;
  materialDigest:string;
  payloadDigest:string;
  previousAssetDigest:string;
  assetDigest:string;
  marker:string;
  image?:string;
  imageUploadDigest?:string;
  creative?:string;
}
export const META_CREATIVE_UPDATE_KEY='metaCreativeUpdate';
export function metaCreativeBody(plan:any,image:string,name:string){
  return {name,...(plan.creative.url_tags!==undefined?{url_tags:plan.creative.url_tags}:{}),
    ...(plan.creative.degrees_of_freedom_spec?{degrees_of_freedom_spec:plan.creative.degrees_of_freedom_spec}:{}),
    object_story_spec:{page_id:plan.creative.pageId,
      ...(plan.creative.instagramUserId?{instagram_user_id:plan.creative.instagramUserId}:{}),
      link_data:{image_hash:image,link:plan.creative.link,message:plan.creative.message,name:plan.creative.name,
        ...(plan.creative.description!==undefined?{description:plan.creative.description}:{}),
        call_to_action:{type:'LEARN_MORE',value:{link:plan.creative.link}}}}};
}
const childIds=(ids:Record<string,string>)=>({campaign:ids.campaign!,adset:ids.adset!,ad:ids.ad!,creative:ids.creative!});
export function readMetaCreativeUpdateIntent(c:Campaign,plan:any,oldPlan:any,ids:Record<string,string>):MetaCreativeUpdateIntent|null{
  if(!ids[META_CREATIVE_UPDATE_KEY])return null;
  let value:MetaCreativeUpdateIntent;
  try{value=JSON.parse(ids[META_CREATIVE_UPDATE_KEY]!);}catch{return null;}
  if(!value||value.version!==1||!['planned','image_attempted','image_observed','creative_attempted','creative_observed','adset_attempted','association_attempted','observed'].includes(value.phase)||
    value.previousReceiptDigest!==digest(c.receipt)||value.previousMaterialDigest!==digest(c.preparedMaterial)||
    value.materialDigest!==digest(c.material)||value.payloadDigest!==digest(plan)||
    value.previousAssetDigest!==oldPlan.imageDigest||value.assetDigest!==plan.imageDigest||
    value.marker!==`Handrail update ${digest([c.projectId,c.id,c.revision,digest(plan)])}`||
    value.creative!==undefined&&(typeof value.creative!=='string'||!/^\d+$/.test(value.creative))||
    value.image!==undefined&&(typeof value.image!=='string'||!value.image)||
    value.imageUploadDigest!==undefined&&(typeof value.imageUploadDigest!=='string'||!(/^[a-f0-9]{64}$/).test(value.imageUploadDigest)))return null;
  return value;
}
export function metaCreativeTargetIds(c:Campaign,intent:MetaCreativeUpdateIntent):Record<string,string>{
  requireThat(c.receipt&&intent.creative&&intent.image,'meta_creative_update_identity_incomplete');
  const {readbackDigest:_old,...ids}=c.receipt!.ids;
  delete ids[META_CREATIVE_UPDATE_KEY];
  return {...ids,creative:intent.creative!,image:intent.image!,
    ...(intent.imageUploadDigest?{imageUploadDigest:intent.imageUploadDigest}:{})};
}
export function metaCreativeTransition(c:Campaign,g:Grant,intent:MetaCreativeUpdateIntent,ids:Record<string,string>,inventory:unknown):MetaCreativeTransition{
  requireThat(c.receipt&&['campaign','adset','ad'].every(key=>ids[key]===c.receipt!.ids[key])&&
    intent.previousReceiptDigest===digest(c.receipt)&&intent.materialDigest===digest(c.material)&&
    ids.creative===intent.creative&&ids.image===intent.image&&Boolean(ids.readbackDigest),'meta_creative_update_identity_changed');
  return {version:1,provider:'meta',projectId:c.projectId,campaignId:c.id,accountId:g.accountId,
    from:{receiptDigest:intent.previousReceiptDigest,ids:structuredClone(c.receipt!.ids),
      materialDigest:intent.previousMaterialDigest,assetDigest:intent.previousAssetDigest},
    to:{ids:structuredClone(ids),materialDigest:intent.materialDigest,assetDigest:intent.assetDigest,payloadDigest:intent.payloadDigest},
    inventoryDigest:digest(inventory),observedAt:new Date().toISOString()};
}

/** Create only new creative/media artifacts; retain and reassociate the original
 * ad. Each attempted step is durable before the write. This function has no
 * replay or creation retry path. Recovery independently reads the original ad. */
export async function updateMetaOriginalAdCreative(input:{
 client:MetaMarketingClient;c:Campaign;g:Grant;assets:Asset[];plan:any;oldPlan:any;
 guard:()=>Promise<void>;readGuard:()=>Promise<void>;
 snapshot:(ids:Record<string,string>)=>Promise<{material:any;paused:boolean;enabled:boolean}>;
 verify:(ids:Record<string,string>,snapshot:any,plan:any)=>Promise<unknown>;
 bytes:(asset:Asset)=>Promise<Buffer>;
 retain:(ids:Record<string,string>)=>void|Promise<void>;
 adsetFields:Record<string,unknown>;
}){
 const {client,c,g,assets,plan,oldPlan,guard,readGuard,snapshot,verify,bytes,retain,adsetFields}=input;
 const original=structuredClone(c.receipt!.ids);
 const intent:MetaCreativeUpdateIntent={version:1,phase:'planned',previousReceiptDigest:digest(c.receipt),
   previousMaterialDigest:digest(c.preparedMaterial),materialDigest:digest(c.material),payloadDigest:digest(plan),
   previousAssetDigest:oldPlan.imageDigest,assetDigest:plan.imageDigest,
   marker:`Handrail update ${digest([c.projectId,c.id,c.revision,digest(plan)])}`,
   ...(oldPlan.imageDigest===plan.imageDigest?{image:original.image,
     ...(original.imageUploadDigest?{imageUploadDigest:original.imageUploadDigest}:{})}:{})};
 let adsetUpdated=false;
 const retainIntent=async()=>{await retain({...original,[META_CREATIVE_UPDATE_KEY]:JSON.stringify(intent)});};
 const current=async()=>{
   await readGuard();
   const observed=await snapshot(original);
   requireThat(observed.paused,'existing_campaign_not_paused');
   await verify(original,observed,adsetUpdated?{...plan,creative:oldPlan.creative,imageDigest:oldPlan.imageDigest}:oldPlan);
   if(!adsetUpdated)requireThat(digest(observed.material)===original.readbackDigest,'external_material_changed');
   await existingMetaAdoptionChildren(client,g.accountId,childIds(original),readGuard);
   await guard();
 };
 await current();await retainIntent();
 if(oldPlan.imageDigest!==plan.imageDigest){
   const asset=assets[0]!;
   const upload=await prepareMetaImageUpload({bytes:await bytes(asset),mime:asset.mime,
     filename:`${intent.marker}.${asset.mime==='image/png'?'png':'jpg'}`});
   intent.imageUploadDigest=upload.uploadDigest;intent.phase='image_attempted';await retainIntent();await current();
   const result=await client.uploadImage(g.accountId,{bytesBase64:upload.bytes.toString('base64'),filename:upload.filename});
   const image=(Object.values(result.images??{})[0] as {hash?:unknown}|undefined)?.hash;
   requireThat(typeof image==='string'&&image.length>0,'image_upload_unknown');
   intent.image=image as string;intent.phase='image_observed';await retainIntent();
 }
 requireThat(intent.image,'meta_creative_update_image_unknown');
 intent.phase='creative_attempted';await retainIntent();await current();
 const created=await client.request(`${accountPath(g.accountId)}/adcreatives`,{method:'POST',body:metaCreativeBody(plan,intent.image!,intent.marker)});
 requireThat(typeof created.id==='string'&&/^\d+$/.test(created.id),'meta_creative_update_creation_unknown');
 intent.creative=created.id;intent.phase='creative_observed';await retainIntent();
 // Verify the newly created artifact before associating it with the original ad.
 await readGuard();
 const creative=await client.getObject(intent.creative!,'id,account_id,name,object_story_spec,asset_feed_spec,url_tags,degrees_of_freedom_spec');
 const expected=metaCreativeBody(plan,intent.image!,intent.marker);
 requireThat(creative.id===intent.creative&&String(creative.account_id)===g.accountId.replace(/^act_/, '')&&
   creative.name===intent.marker&&creative.asset_feed_spec==null&&exactTargeting(creative.object_story_spec,expected.object_story_spec)&&
   (plan.readbackVersion!=='5'||exactTargeting(creative.url_tags,plan.creative.url_tags)&&
     exactTargeting(creative.degrees_of_freedom_spec,plan.creative.degrees_of_freedom_spec)),'meta_creative_update_artifact_mismatch');
 await readGuard();
 if(Object.keys(adsetFields).length){
   intent.phase='adset_attempted';await retainIntent();await current();
   await client.request(original.adset!,{method:'POST',body:adsetFields});adsetUpdated=true;
 }
 intent.phase='association_attempted';await retainIntent();await current();
 await client.request(original.ad!,{method:'POST',body:{creative:{creative_id:intent.creative}}});
 const ids=metaCreativeTargetIds(c,intent);await readGuard();
 const after=await snapshot(ids);requireThat(after.paused,'existing_campaign_not_paused');
 await verify(ids,after,plan);
 const inventory=await existingMetaAdoptionChildren(client,g.accountId,childIds(ids),readGuard);
 await readGuard();ids.readbackDigest=digest(after.material);ids.inventoryDigest=digest(inventory);intent.phase='observed';
 await retain({...ids,[META_CREATIVE_UPDATE_KEY]:JSON.stringify(intent)});
 return {ids,transition:metaCreativeTransition(c,g,intent,ids,inventory)};
}
