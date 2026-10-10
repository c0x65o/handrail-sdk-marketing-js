import { randomBytes } from 'node:crypto';
import { CreativeConnections, createTextPlanningAccess, createSyntheticTextPlanning, createCredentialCipher, EncryptedCredentialCustody, digest, sessionBinding, requireThat, type TextPlanningAccess, type TextPlanningBilling, type Store, type SessionAuthority, type Principal } from '@handrail/marketing/server';
import type { TextPlanningConnection, CampaignOption } from '@handrail/marketing';
export const textOption:CampaignOption={title:'A local campaign approach',audienceHypothesis:'Nearby people who want a workshop tour',offer:'A guided tour',rationale:'Test a clear invitation',unknowns:['Demand is not verified'],provider:'meta',format:'single_image',destination:'https://example.test',variants:[{headline:'Visit the workshop',body:'Book a guided tour.',cta:'Learn more'}]};
/** Provider/billing boundary fixtures only; all SDK operation and reservation
 * transitions use the actual Store and external SQL host session authority. */
export async function textPlanningFixture(store:Store,sessions:SessionAuthority,p:Principal,transport?:typeof fetch, secureSetup=false) {
  const key=randomBytes(32);const custody=new EncryptedCredentialCustody(store,createCredentialCipher('synthetic',()=>key));
  if(!secureSetup)await custody.retain('p','text-fixture-secret',{apiKey:'synthetic-text-key-no-provider-access'});
  const connection:TextPlanningConnection={id:'text-connection',label:'Workshop text connection with a deliberately long descriptive model label',provider:'openai',model:'synthetic-structured-model',environment:'test',revision:'1',permissionRevision:'1',credentialRevision:'1',configurationRevision:'1',expiresAt:new Date(Date.now()+1800000).toISOString(),state:'available',reason:'Existing host text-purpose permission; one reviewed request still required.'};
  if(!secureSetup)await store.put('p','fixtureTextAccess',connection.id,connection);
  const read=()=>store.get<TextPlanningConnection>('p','fixtureTextAccess',connection.id);
  const access:TextPlanningAccess={
    async list(_p,project){return project==='p'?[await read()]:[];},
    async inspect(actor,project,connectionId){requireThat(project==='p'&&actor.userId===p.userId&&connectionId===connection.id,'text_permission_denied',403);return {connection:await read(),purpose:'campaign_planning',session:await sessions.inspectSession(sessionBinding(actor),project),custodyRef:'text-fixture-secret'};},
    withCurrent:(_expected,local)=>store.transaction(local),
  };
  const pricing={revision:'price-1',missing:false}, calls={dispatch:0,admit:0,settle:0};
  const billing:TextPlanningBilling={
    async quote(i){requireThat(!pricing.missing,'text_billing_missing');return {operationId:i.operationId,receipt:'quote-'+digest(i),requestDigest:i.requestDigest,connectionDigest:i.connectionDigest,projectId:i.projectId,environment:i.environment,provider:i.provider,model:i.model,pricingRevision:pricing.revision,currency:'USD',ceilingMinor:25,expiresAt:new Date(Date.now()+300000).toISOString(),inputTokenUpperBound:100000,meteringBasis:'Synthetic trusted meter bound including prompt, schema and framing; no real pricing claim',maxOutputTokens:i.maxOutputTokens,maxAttempts:1};},
    async inspect(q){requireThat(!pricing.missing&&q.pricingRevision===pricing.revision,'planning_price_changed');},
    async admit(s,r,q){calls.admit++;await s.put('p','fixtureBillingAdmission',r.id,{requestDigest:r.inputDigest,quote:q});},
    async measure(r,q){return r.usage.inputTokens===null||r.usage.outputTokens===null?null:{requestId:r.id,attemptId:r.textReceipt!.attemptId!,requestDigest:q.requestDigest,quoteReceipt:q.receipt,connectionDigest:q.connectionDigest,projectId:r.projectId,environment:q.environment,pricingRevision:q.pricingRevision,currency:q.currency,measuredMinor:3,usage:r.usage,receipt:'synthetic-final-charge-'+r.id};},
    async settle(s,f){calls.settle++;await s.put('p','fixtureBillingSettlement',f.requestId,f);},
  };
  const raw={id:'response-fixture-1',object:'response',created_at:Math.floor(Date.now()/1000),model:connection.model,status:'completed',error:null,incomplete_details:null,output:[{id:'message-fixture-1',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',annotations:[],logprobs:[],text:JSON.stringify({options:[textOption,{...textOption,title:'Second approach'}]})}]}],usage:{input_tokens:350,output_tokens:200,total_tokens:550}};
  const fetcher:typeof fetch=async(url,init)=>{calls.dispatch++;requireThat(['https://api.openai.com/v1/responses','https://api.x.ai/v1/responses'].includes(String(url)),'unexpected_provider_endpoint');requireThat(init?.redirect==='error'&&init.signal&&JSON.parse(String(init.body)).stream===true,'physical_request_not_bounded');return transport?transport(url,init):new Response('data: '+JSON.stringify({type:'response.created',sequence_number:0,response:{...raw,status:'in_progress',output:[],usage:null}})+'\n\n'+'data: '+JSON.stringify({type:'response.completed',sequence_number:1,response:raw})+'\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'diagnostic-fixture'}});};
  const setup=new CreativeConnections({store,environment:'test',custody,sessionAuthority:sessions,purpose:'text',accessPolicy:async(_p,_project,provider)=>provider==='openai'?{revision:'text-policy-1',environment:'test',appLabel:'Workshop',models:[connection.model],maxDurationSeconds:1800,grantIds:[]}:null});
  const permission={enabled:true};
  const setupAccess=createTextPlanningAccess(setup,{async inspect(actor,project,b){if(!permission.enabled)return null;return {purpose:'campaign_planning',projectId:project,actorId:actor.userId,sessionDigest:digest(sessionBinding(actor)),connectionId:b.id,provider:b.provider,model:b.model,environment:b.environment,revision:'existing-text-permission-1',expiresAt:b.expiresAt};},withCurrent:(_expected,local)=>store.transaction(local)});
  const options={store,sessions,custody,access:secureSetup?setupAccess:access,billing,environment:'test',timeoutMs:1000,...(secureSetup?{connections:setup}:{})};
  return {permission,setup,options,capability:createSyntheticTextPlanning(options,fetcher),calls,connection,read,save:(c:TextPlanningConnection)=>store.put('p','fixtureTextAccess',c.id,c),pricing,billing,raw,fetcher};
}
