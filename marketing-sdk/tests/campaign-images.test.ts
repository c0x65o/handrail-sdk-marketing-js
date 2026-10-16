import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import sharp from 'sharp';
import {createCampaignImageGenerator,type CampaignImagePorts,type CampaignImage,type CampaignImageSpec} from '../server/index.js';
const square={key:'square',label:'Square',aspectRatio:'1:1',width:64,height:64};
const portrait={key:'portrait',label:'Portrait',aspectRatio:'4:5',width:64,height:80};
const input={projectId:'fixture-project',campaignName:'Original',visualDirection:'Original approved direction',model:'gpt-image-2',quality:'medium'};
function harness(overrides:Partial<CampaignImagePorts>={}) {
  const calls:any[]=[],usage:any[]=[],saved:CampaignImage[]=[];
  const invoke=(operation:string)=>async(request:any,options:any)=>{
    calls.push({operation,request,options});
    const [width,height]=request.size.split('x').map(Number);
    const bytes=await sharp({create:{width,height,channels:3,background:'#aabbcc'}}).png().toBuffer();
    return {_request_id:`req_${calls.length}`,data:[{b64_json:bytes.toString('base64')}],usage:{input_tokens:7,output_tokens:9,total_tokens:16,private:'not retained'}};
  };
  const ports:CampaignImagePorts={credentialsProvider:async()=>({apiKey:'fixture-secret'}),
    marketingPlatformContract:()=>({imageSpecs:[square,portrait],imageOutputFormat:'webp',imageExtension:'webp',imageMimeType:'image/webp'}),
    marketingImageSettings:i=>({model:i.model??'gpt-image-2',quality:i.quality??'medium'}),
    buildPrompt:i=>i.visualDirection,completeAdPrompt:i=>i.imageCopy,completeAdSize:(s:CampaignImageSpec)=>`${s.width}x${s.height}`,
    usageRecorder:async u=>{usage.push(u);},clientFactory:()=>({images:{generate:invoke('generate'),edit:invoke('edit')}}),env:{},...overrides};
  return {generator:createCampaignImageGenerator(ports),ports,calls,usage,saved,checkpoint:async(i:CampaignImage)=>{saved.push(i);}};
}

test('SDK image workflow renders and checkpoints once, reuses the original pixels, and retains usage before decoding',async()=>{
 const h=harness();const images=await h.generator.generatePlatformSet({...input,onImageGenerated:h.checkpoint});
 assert.equal(h.calls.length,1);assert.equal(h.usage.length,1);assert.equal(images.length,2);
 assert.equal(h.calls[0].options.maxRetries,0);assert.equal(h.usage[0].projectId,input.projectId);
 assert.equal(h.usage[0].result.usage.total_tokens,16);assert.doesNotMatch(JSON.stringify(h.usage),/not retained|fixture-secret|Original approved/);
 assert.equal(images[0].providerRequestId,'req_1');assert.equal(images[1].providerRequestId,'req_1');
 for(const image of images){const m=await sharp(image.bytes).metadata();assert.equal(m.width,image.width);assert.equal(m.height,image.height);}
 await h.generator.generatePlatformSet({...input,existingImages:h.saved});assert.equal(h.calls.length,1);assert.equal(h.usage.length,1);
});

test('complete compositions preserve the original reference and exact placement ratio through edits',async()=>{
 const h=harness();const images=await h.generator.generatePlatformSet({...input,compositionMode:'complete_ad',imageCopy:'Exact words',onImageGenerated:h.checkpoint});
 assert.deepEqual(h.calls.map(c=>c.operation),['generate','edit']);assert.deepEqual(h.calls.map(c=>c.request.size),['64x64','64x80']);
 assert.deepEqual(Buffer.from(await h.calls[1].request.image.arrayBuffer()),images[0].bytes);
 assert.equal(images[1].printed_copy,'Exact words');assert.equal(h.usage[1].operation,'edit');
});

for(const failure of [{status:503,requestID:'req_unknown',code:'server_error'}, {status:429,requestID:'req_rate',code:'rate_limit_exceeded'}, new Error('private network detail')]) {
 test(`provider failure ${'status' in failure?failure.status:'network'} is retained and never automatically retried`,async()=>{
  let calls=0;const h=harness({clientFactory:()=>({images:{generate:async()=>{calls++;throw failure;},edit:async()=>{throw Error('unexpected edit');}}}),
   env:{HANDRAIL_MARKETING_IMAGE_MAX_ATTEMPTS:'99',HANDRAIL_MARKETING_IMAGE_RETRY_BASE_MS:'1'}});
  await assert.rejects(h.generator.generatePlatformSet(input),(e:any)=>e.retryable===false&&!e.message.includes('private'));
  assert.equal(calls,1);assert.equal(h.usage.length,1);assert.equal(h.usage[0].result.usage,null);
  assert.equal(h.usage[0].outcome,'status' in failure&&failure.status===429?'rejected':'unknown');
 });
}

test('a failed usage receipt stops placement work without losing the original request identity or replaying the request',async()=>{
 const h=harness({usageRecorder:async()=>{throw Error('private ledger failure');}});
 await assert.rejects(h.generator.generatePlatformSet({...input,compositionMode:'complete_ad',imageCopy:'words'}),
  (e:any)=>e.code==='image_generation_metering_failed'&&e.providerRequestId==='req_1'&&e.retryable===false&&!e.message.includes('private'));
 assert.equal(h.calls.length,1);
});

test('missing bytes and a wrong complete-ad ratio retain accounting and are not retryable',async()=>{
 for(const wrongRatio of [false,true]){
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
  const h=harness({clientFactory:()=>({images:{generate:async()=>({_request_id:'req_original',data:wrongRatio?[{b64_json:bytes.toString('base64')}]:[]}),edit:async()=>{throw Error('unexpected');}}})});
  await assert.rejects(h.generator.generatePlatformSet({...input,onlyPlacement:'portrait',compositionMode:'complete_ad',imageCopy:'words'}),(e:any)=>e.retryable===false);
  assert.equal(h.usage.length,1);assert.equal(h.usage[0].providerRequestId,'req_original');
 }
});

test('the original workflow guard rejects before a provider call',async()=>{
 const h=harness();await assert.rejects(h.generator.generatePlatformSet({...input,beforeImageGenerated:async()=>{throw Error('original work stopped');}}),/original work stopped/);
 assert.equal(h.calls.length,0);assert.equal(h.usage.length,0);
});

test('real OpenAI client preserves custody organization/project routing with no retries',async()=>{
 let calls=0;const headers:Headers[]=[];
 const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const h=harness({credentialsProvider:async()=>({apiKey:'private-key',orgId:'org-original',projectId:'proj-original'}),
  clientFactory:c=>new OpenAI({apiKey:c.apiKey,organization:c.orgId,project:c.projectId,maxRetries:0,fetch:async(_url,init)=>{
   calls++;headers.push(new Headers(init?.headers));return Response.json({data:[{b64_json:bytes.toString('base64')}],usage:{input_tokens:0,output_tokens:1,total_tokens:1}},{headers:{'x-request-id':'req_http'}});
  }})});
 await h.generator.generatePlatformSet(input);assert.equal(calls,1);
 assert.equal(headers[0]!.get('openai-organization'),'org-original');assert.equal(headers[0]!.get('openai-project'),'proj-original');
 assert.equal(h.usage[0].providerRequestId,'req_http');assert.equal(h.usage[0].result.usage.input_tokens,0);
});

test('an incomplete host binding cannot open credentials or submit paid work',()=>{
 const h=harness();assert.throws(()=>createCampaignImageGenerator({...h.ports,usageRecorder:undefined} as any),/binding is incomplete/);
});
