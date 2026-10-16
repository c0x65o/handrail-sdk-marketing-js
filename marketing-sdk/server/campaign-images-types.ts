/** Host bindings for the SDK's checkpointed campaign image workflow. Custody,
 * product prompts and accounting stay with the embedding application. No grant,
 * authority, scheduler or background identity is created by this interface. */
export interface CampaignImageSpec {
  key:string;label:string;aspectRatio:string;width:number;height:number;composition?:string;
}
export interface CampaignImage {
  key:string;label:string;aspectRatio:string;width:number;height:number;filename:string;
  mediaType:string;bytes:Buffer;prompt:string;model:string;quality:string;provenance:string;
  composition_mode?:string;printed_copy?:string;providerRequestId?:string|null;
}
export interface CampaignImageInput {
  provider?:string;projectId?:string;orgId?:string|null;actor?:Record<string,unknown>;
  campaignName?:string;positioning?:string;offer?:string;visualDirection:string;
  overlay?:Record<string,unknown>;existingImages?:CampaignImage[];
  beforeImageGenerated?:(spec:CampaignImageSpec)=>Promise<unknown>;
  onImageGenerated?:(image:CampaignImage)=>Promise<unknown>;
  onlyPlacement?:string|null;model?:string;quality?:string;
  referenceImage?:{bytes:Buffer;mediaType:string}|null;compositionMode?:string|null;
  imageCopy?:string;creativeContext?:Record<string,any>;placementCopies?:Record<string,string>;
  specs?:Pick<CampaignImageSpec,'key'>[]|null;
}
export interface CampaignImageContract {
  imageSpecs:CampaignImageSpec[];imageOutputFormat:'jpeg'|'webp'|'png';imageExtension:string;imageMimeType:string;
}
export interface CampaignImagePorts {
  credentialsProvider:()=>Promise<{apiKey:string;orgId?:string|null;projectId?:string|null}>;
  marketingPlatformContract:(provider:string)=>CampaignImageContract;
  marketingImageSettings:(input:{model?:string;quality?:string;edit:boolean;env:NodeJS.ProcessEnv})=>{model:string;quality:string};
  buildPrompt:(input:any)=>string;
  completeAdPrompt:(input:any)=>string;
  completeAdSize:(spec:CampaignImageSpec)=>string;
  /** Must reject if the original attempt's usage/unknown evidence is not durable. */
  usageRecorder:(input:{result:{usage:Record<string,unknown>|null;_request_id:string|null};
    projectId?:string;orgId:string|null;actor:Record<string,unknown>;model:string;spec:CampaignImageSpec;
    quality:string;operation:'edit'|'generate';outcome:'response'|'rejected'|'unknown';providerRequestId:string|null})=>Promise<unknown>;
  clientFactory?:(credentials:{apiKey:string;orgId?:string|null;projectId?:string|null})=>{
    images:{generate:(request:any,options:any)=>Promise<any>;edit:(request:any,options:any)=>Promise<any>}};
  imageResizer?:(bytes:Buffer,spec:CampaignImageSpec,contract:CampaignImageContract,options?:{completeAd?:boolean})=>Promise<Buffer>;
  env?:NodeJS.ProcessEnv;
}
