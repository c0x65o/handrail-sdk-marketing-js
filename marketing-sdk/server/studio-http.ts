import type { CampaignStudio } from './studio.js';
import type { Principal } from './store.js';
import { DomainError, requireThat } from './store.js';
/** Campaign aliases read the same retained bytes through current session and
 * project authorization. Mount at the public client's /assets/:id route. */
export async function handleCampaignMedia(studio:CampaignStudio, principal:Principal, project:string, assetId:string, request:Request):Promise<Response> {
  requireThat(request.method==='GET','method_not_allowed',405);
  const {asset,bytes}=await studio.campaignMedia(principal,project,assetId);
  const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','content-type':asset.mime,'accept-ranges':'bytes'};
  const raw=request.headers.get('range');
  if(raw!==null){
    const invalid=()=>Response.json({error:'invalid_range'},{status:416,headers:{...headers,'content-type':'application/json','content-range':`bytes */${bytes.length}`}});
    const range=raw.length<=100?/^bytes=(\d*)-(\d*)$/.exec(raw):null;
    if(!range||(!range[1]&&!range[2]))return invalid();
    const first=Number(range[1]),last=range[2]?Number(range[2]):bytes.length-1;
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last))return invalid();
    // A suffix is bounded by the retained object. Multi-ranges and unsafe
    // integers fail explicitly; never round an oversized value into authority.
    const start=range[1]?first:Math.max(0,bytes.length-last);
    const end=range[1]?Math.min(last,bytes.length-1):bytes.length-1;
    if((!range[1]&&last===0)||start>end||start>=bytes.length)return invalid();
    return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':String(end-start+1)}});
  }
  return new Response(new Uint8Array(bytes),{headers:{...headers,'content-length':String(bytes.length)}});
}
/** Mount AFTER the host's authentication, Origin/CSRF and shared request-rate gate.
 * SDK owns binary streaming and byte validation. Does not install a second limiter. */
export async function handleStudioMedia(studio:CampaignStudio, principal:Principal, project:string, assetOrDraftId:string, request:Request):Promise<Response> {
  const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
  if(request.method==='GET') {const {asset,bytes}=await studio.media(principal,project,assetOrDraftId);return new Response(new Uint8Array(bytes),{headers:{...headers,'content-type':asset.mime,'content-length':String(bytes.length)}});}
  requireThat(request.method==='POST','method_not_allowed',405);
  requireThat(request.headers.get('content-type')==='application/octet-stream','binary_required',415);
  const intent=request.headers.get('x-studio-intent');requireThat(intent&&intent.length<12000,'import_intent_required',422);
  let input: {draftId:string;expectedRevision:number;requestKey:string;rights:string};
  try{input=JSON.parse(decodeURIComponent(intent));}catch{throw new DomainError('invalid_import_intent',422);}
  requireThat(input&&typeof input==='object','invalid_import_intent',422);
  requireThat(input.draftId===assetOrDraftId,'draft_mismatch',422);
  const reader=request.body?.getReader();requireThat(reader,'binary_required',422);const chunks:Uint8Array[]=[];let length=0;
  let expired=false;const timeout=setTimeout(()=>{expired=true;void reader.cancel('import_timeout');},15000);
  try{for(;;){const chunk=await reader.read();requireThat(!expired,'import_timeout',408);if(chunk.done)break;length+=chunk.value.byteLength;requireThat(length<=10*1024*1024,'raster_size_limit',413);chunks.push(chunk.value);}}finally{clearTimeout(timeout);await reader.cancel();reader.releaseLock();}
  return Response.json(await studio.importRaster(principal,project,input,Buffer.concat(chunks)),{headers});
}
