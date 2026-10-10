import type { TextPlanningCommands, TextPlanningConnection, TextPlanningReview, PlanningRequest, PlanningUsage, StudioDraft, CampaignOption } from '../core/index.js';
import { Store, digest, id, requireThat, type Principal } from './store.js';
import { sessionBinding, assertSessionInspection, inspectLiveSessions, type SessionAuthority, type SessionInspection } from './session-authority.js';
import { EncryptedCredentialCustody } from './credential-custody.js';
import { BoundTextPlanningBilling, type TextPlanningBilling } from './billing.js';
import { CAMPAIGN_OPTIONS_SCHEMA, PLANNING_PROMPT, PLANNING_VERSION, unknownUsage, validatePlanningOutput, type PlanningResponsesBody } from './planning.js';
import { text, keys } from './validation.js';
import { CreativeConnections } from './creative-connections.js';

/** Existing host permission, separate from credential/setup consent. All fields
 * must be factual current authority, not browser input or a saved media grant. */
export interface TextPurposePermission {
  purpose:'campaign_planning'; projectId:string; actorId:string; sessionDigest:string;
  connectionId:string; provider:'openai'|'xai'; model:string; environment:string;
  revision:string; expiresAt:string;
}
export function createTextPlanningAccess(connections:CreativeConnections, permissions:{
  inspect(p:Principal,project:string,binding:Awaited<ReturnType<CreativeConnections['textBinding']>>):Promise<TextPurposePermission|null>;
  withCurrent<T>(expected:TextPlanningConnection,local:()=>Promise<T>):Promise<T>;
}):TextPlanningAccess {
  requireThat(connections.options.purpose==='text','text_setup_required');
  const inspect:TextPlanningAccess['inspect']=async(p,project,connectionId)=>{
    const b=await connections.textBinding(p,project,connectionId),g=await permissions.inspect(p,project,b);
    requireThat(g&&g.purpose==='campaign_planning'&&g.projectId===project&&g.actorId===p.userId&&g.sessionDigest===digest(sessionBinding(p))&&g.connectionId===b.id&&g.provider===b.provider&&g.model===b.model&&g.environment===b.environment&&g.revision&&current(g.expiresAt),'text_purpose_permission_required',403);
    const c:TextPlanningConnection={id:b.id,label:`${b.provider==='openai'?'OpenAI':'xAI'} text · ${b.model}`,provider:b.provider,model:b.model,environment:b.environment,revision:b.revision,permissionRevision:g.revision,credentialRevision:b.credentialRevision,configurationRevision:b.configurationRevision,expiresAt:new Date(Math.min(Date.parse(b.expiresAt),Date.parse(g.expiresAt))).toISOString(),state:'available',reason:'Text credential permission configured. Exact request and billing review still required.'};
    return {connection:c,purpose:'campaign_planning',session:b.session,custodyRef:b.custodyRef};
  };
  return {inspect,async list(p,project){
    const list:TextPlanningConnection[]=[];
    for(const provider of ['openai','xai'] as const){const catalogue=await connections.catalogue(p,project,provider);for(const b of catalogue.bindings){
      try{list.push((await inspect(p,project,b.id)).connection);}catch{list.push({id:b.id,label:`${provider==='openai'?'OpenAI':'xAI'} text · ${b.model}`,provider,model:b.model,environment:b.environment,revision:String(b.revision),permissionRevision:'unavailable',credentialRevision:'unavailable',configurationRevision:b.configurationRevision,expiresAt:b.expiresAt,state:'unavailable',reason:'Complete secure setup and obtain separate text-purpose permission from the existing permission owner.'});}
    }}return list;
  },withCurrent:(expected,local)=>permissions.withCurrent(expected.connection,local)};
}

export interface TextPlanningAccess {
  /** Existing permission model, LOCAL metadata only. Must enumerate only the
   * current human's text-purpose choices; media/ad grants are not text access. */
  list(principal: Principal, project: string): Promise<TextPlanningConnection[]>;
  inspect(principal: Principal, project: string, connectionId: string): Promise<{
    connection: TextPlanningConnection; purpose: 'campaign_planning';
    session: SessionInspection; custodyRef: string;
  }>;
  /** Session guard is already held. Serialize permission/config/credential
   * writers, then call local, retaining the guard through commit acknowledgment.
   * No network or recursive session lock. Missing guard means unavailable. */
  withCurrent<T>(expected: Awaited<ReturnType<TextPlanningAccess['inspect']>>, local: () => Promise<T>): Promise<T>;
}
export interface NativeTextPlanningOptions {
  store: Store; sessions: SessionAuthority; custody: EncryptedCredentialCustody;
  access: TextPlanningAccess; billing: TextPlanningBilling; environment: string;
  timeoutMs?: number;
  connections?: CreativeConnections;
}
interface ReviewRecord { review: TextPlanningReview; actor: Principal; session: SessionInspection; access: Awaited<ReturnType<TextPlanningAccess['inspect']>> & { custodyDigest: string }; body: PlanningResponsesBody & { stream: true }; }
const capabilities = new WeakSet<object>();
const endpoints = { openai: 'https://api.openai.com/v1/responses', xai: 'https://api.x.ai/v1/responses' };
const finite = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const current = (v: string) => Number.isFinite(Date.parse(v)) && Date.parse(v) > Date.now();

/** No custom provider transport in the production factory. The synthetic factory
 * is permanently marked and cannot be promoted by a browser field or TS cast. */
export function createNativeTextPlanning(options: NativeTextPlanningOptions): NativeTextPlanning {
  return new NativeTextPlanning(options, fetch, 'provider', factoryKey);
}
export function createSyntheticTextPlanning(options: NativeTextPlanningOptions, transport: typeof fetch): NativeTextPlanning {
  return new NativeTextPlanning(options, transport, 'synthetic', factoryKey);
}
const factoryKey = Symbol('native-text-planning');
export function assertTextPlanningCapability(value: NativeTextPlanning, store: Store, sessions: SessionAuthority) {
  requireThat(capabilities.has(value) && value.options.store === store && value.options.sessions === sessions, 'text_planning_composition_mismatch');
}

export class NativeTextPlanning {
  readonly billing: BoundTextPlanningBilling;
  readonly timeoutMs: number;
  constructor(readonly options: NativeTextPlanningOptions, private readonly transport: typeof fetch, readonly evidence: 'provider'|'synthetic', key: symbol) {
    requireThat(evidence !== 'provider' || options.store.db.dialect !== 'sqlite', 'text_provider_executor_lease_required');
    requireThat(key === factoryKey && options.custody?.store === options.store && typeof options.environment==='string' && options.environment.length > 0, 'native_text_factory_required');
    requireThat(['list','inspect','withCurrent'].every(k=>typeof options.access?.[k as keyof TextPlanningAccess]==='function')&&
      ['quote','inspect','admit','measure','settle'].every(k=>typeof options.billing?.[k as keyof TextPlanningBilling]==='function')&&
      typeof options.sessions?.withLiveSessions==='function','text_host_permission_custody_and_billing_hooks_required');
    this.timeoutMs = options.timeoutMs ?? 60000;
    requireThat(finite(this.timeoutMs, 120000) && this.timeoutMs >= 10, 'planning_timeout_invalid');
    this.billing = new BoundTextPlanningBilling(options.store, options.billing);
    requireThat(!options.connections||(options.connections.options.purpose==='text'&&options.connections.store===options.store&&options.connections.sessionAuthority===options.sessions),'text_setup_composition_mismatch');
    capabilities.add(this); Object.freeze(this);
  }
  get store() { return this.options.store; }
  private async session(p: Principal, project: string, write = true) {
    const binding = sessionBinding(p), s = await this.options.sessions.inspectSession(binding, project);
    assertSessionInspection(s, binding, project);
    requireThat(s.kind === 'human' && (!write || ['admin','editor'].includes(s.role)), 'interactive_human_required', 403);
    // This capability requires the host's existing authority, never SDK login.
    requireThat(binding.issuer !== 'marketing:store', 'external_host_session_required', 403);
    await this.store.authorize(p, project, write?['admin','editor']:undefined, true);
    return s;
  }
  private async access(p: Principal, project: string, connectionId: string) {
    const s = await this.session(p, project), a = await this.options.access.inspect(p, project, connectionId), c = a.connection;
    requireThat(a.purpose === 'campaign_planning' && digest(a.session) === digest(s) &&
      c.id === connectionId && c.environment === this.options.environment && c.state === 'available' && current(c.expiresAt) &&
      ['openai','xai'].includes(c.provider) && [c.label,c.model,c.revision,c.permissionRevision,c.credentialRevision,c.configurationRevision,a.custodyRef].every(x => typeof x === 'string' && x.length > 0 && x.length <= 500), 'text_permission_or_connection_unavailable', 403);
    requireThat(await this.options.custody.inspect(project, a.custodyRef), 'text_credential_setup_required');
    // Bind the actual retained encrypted envelope as well as host revisions.
    // Replacing the value at the same custody reference must stale old reviews.
    const custodyDigest=digest(await this.store.get(project,'vault',a.custodyRef));
    await inspectLiveSessions(this.options.sessions, [s]); return {...a,custodyDigest};
  }
  private async guard<T>(record: ReviewRecord, action: () => Promise<T>, checkQuote = true) {
    const { actor, session, access, review } = record, project = session.projectId;
    const before = await this.access(actor, project, review.connection.id);
    requireThat(digest(record.body)===review.requestDigest&&digest(CAMPAIGN_OPTIONS_SCHEMA)===review.schemaDigest&&record.body.input[0]?.content===PLANNING_PROMPT,'planning_request_contract_changed');
    requireThat(digest(before) === digest(access), 'text_authority_changed', 403);
    return this.options.sessions.withLiveSessions([session], () => this.options.access.withCurrent(access, () => this.store.transaction(async () => {
      await inspectLiveSessions(this.options.sessions, [session]);
      requireThat(digest(await this.access(actor, project, review.connection.id)) === digest(access), 'text_authority_changed', 403);
      if (checkQuote) { requireThat(current(review.quote.expiresAt), 'planning_quote_expired'); await this.options.billing.inspect(review.quote); }
      const value = await action();
      await inspectLiveSessions(this.options.sessions, [session]);
      requireThat(digest(await this.access(actor, project, review.connection.id)) === digest(access), 'text_authority_changed', 403);
      if (checkQuote) { requireThat(current(review.quote.expiresAt), 'planning_quote_expired'); await this.options.billing.inspect(review.quote); }
      return value;
    })));
  }
  private async draft(project: string, draftId: string, revision: number) {
    const d = await this.store.get<StudioDraft>(project, 'campaignDraft', draftId);
    requireThat(d.revision === revision && d.studio?.lifecycle === 'active', 'planning_draft_changed'); return d;
  }
  private async noExposure(project: string, draftId: string, excluding?: string) {
    const requests = await this.store.list<PlanningRequest>(project, 'planningRequest');
    requireThat(!requests.some(r => r.draftId === draftId && r.id !== excluding &&
      (['queued','running','unknown'].includes(r.state) || (r.textReceipt && r.textReceipt.settlement !== 'settled'))), 'planning_unresolved_exposure_check_original');
  }
  async connections(p: Principal, project: string) {
    await this.session(p, project);
    const list = await this.options.access.list(p, project), connections: TextPlanningConnection[] = [];
    requireThat(Array.isArray(list) && list.length <= 100, 'text_catalogue_invalid');
    for (const c of list) {
      text(c.id, 500); let reason = 'Text permission, credential or configuration changed. Ask your project administrator to restore this text-purpose connection.';
      try { const a = await this.access(p, project, c.id); connections.push(this.safeConnection(a.connection)); continue; } catch { /* Missing permission never becomes ready. */ }
      connections.push(this.safeConnection({ ...c, state: 'unavailable', reason }));
    }
    const setup=[];
    if(this.options.connections)for(const provider of ['openai','xai'] as const){const c=await this.options.connections.catalogue(p,project,provider);setup.push({provider,path:c.path,configured:c.configured});}
    await this.session(p, project);
    return { connections, setup, reason: connections.length ? 'Text use is session-limited. Review a current exact quote before one request.' : 'Complete private text setup below, or ask your project administrator to connect text-purpose custody, model permission and billing. Image/video access does not authorize text.' };
  }
  private safeConnection(c: TextPlanningConnection): TextPlanningConnection {
    return { id:c.id,label:c.label,provider:c.provider,model:c.model,environment:c.environment,revision:c.revision,permissionRevision:c.permissionRevision,credentialRevision:c.credentialRevision,configurationRevision:c.configurationRevision,expiresAt:c.expiresAt,state:c.state,reason:c.reason };
  }
  async reviews(p: Principal, project: string, draftId: string) {
    await this.session(p, project, false);
    return (await this.store.list<ReviewRecord>(project,'textPlanningReview')).filter(r => r.actor.userId === p.userId && digest(r.session.binding) === digest(sessionBinding(p)) && r.review.draftId === draftId).map(r => r.review);
  }
  async review(p: Principal, project: string, i: TextPlanningCommands['reviewTextPlan']['input']) {
    text(i.requestKey,160); requireThat(finite(i.maxOutputTokens,32768) && i.maxOutputTokens >= 256,'planning_output_allowance_invalid');
    const a = await this.access(p,project,i.connectionId), d = await this.draft(project,i.draftId,i.expectedRevision);
    const reviewId = digest(['text-review',project,sessionBinding(p),i.requestKey]);
    const inputHash = digest(i);
    const old = (await this.store.list<ReviewRecord & { inputHash:string }>(project,'textPlanningReview')).find(r=>r.review.id===reviewId);
    if (old) { requireThat(old.inputHash===inputHash,'request_key_payload_conflict'); return this.guard(old,async()=>old.review); }
    const body: ReviewRecord['body'] = { model:a.connection.model,input:[{role:'system',content:PLANNING_PROMPT},{role:'user',content:JSON.stringify(d.studio.brief)}],max_output_tokens:i.maxOutputTokens,store:false,background:false,stream:true,text:{format:{type:'json_schema',name:PLANNING_VERSION.replaceAll('-','_'),strict:true,schema:CAMPAIGN_OPTIONS_SCHEMA}} };
    const requestDigest = digest(body), connectionDigest = digest(a), signal = AbortSignal.timeout(this.timeoutMs);
    requireThat(Buffer.byteLength(JSON.stringify(body))<=256*1024,'planning_request_size_limit');
    // Host quote/meter resolution is outside both SQL and revocation guards.
    const quote = await bounded(this.options.billing.quote({operationId:reviewId,projectId:project,environment:this.options.environment,provider:a.connection.provider,model:a.connection.model,connectionDigest,requestDigest,body:structuredClone(body),maxOutputTokens:i.maxOutputTokens},signal),signal);
    keys(quote,['receipt','operationId','requestDigest','connectionDigest','projectId','environment','provider','model','pricingRevision','currency','ceilingMinor','expiresAt','inputTokenUpperBound','meteringBasis','maxOutputTokens','maxAttempts']);
    requireThat(quote.operationId===reviewId && quote.projectId===project && quote.environment===this.options.environment && quote.provider===a.connection.provider && quote.model===a.connection.model && quote.connectionDigest===connectionDigest && quote.requestDigest===requestDigest &&
      quote.maxOutputTokens===i.maxOutputTokens && quote.maxAttempts===1 && finite(quote.inputTokenUpperBound,1000000) && quote.inputTokenUpperBound>0 &&
      finite(quote.ceilingMinor,Number.MAX_SAFE_INTEGER) && quote.ceilingMinor>0 && /^[A-Z]{3}$/.test(quote.currency) && current(quote.expiresAt) && Date.parse(quote.expiresAt)<=Math.min(a.session.expiresAt,Date.parse(a.connection.expiresAt)) &&
      [quote.receipt,quote.pricingRevision,quote.meteringBasis].every(x=>typeof x==='string'&&x.length>0&&x.length<=500),'planning_quote_scope_or_bounds_invalid');
    const review: TextPlanningReview = {id:reviewId,draftId:d.id,draftRevision:d.revision,brief:d.studio.brief,connection:this.safeConnection(a.connection),requestDigest,reviewDigest:'',prompt:PLANNING_PROMPT,schemaDigest:digest(CAMPAIGN_OPTIONS_SCHEMA),requestBytes:Buffer.byteLength(JSON.stringify(body)),requestBody:structuredClone(body),quote:structuredClone(quote),evidence:this.evidence,state:'review'};
    review.reviewDigest=digest(review);
    const record = {review,actor:p,session:a.session,access:a,body,inputHash};
    return this.guard(record,async()=>{
      await this.draft(project,d.id,d.revision); await this.noExposure(project,d.id);
      const existing=(await this.store.list<typeof record>(project,'textPlanningReview')).find(r=>r.review.id===reviewId);
      if(existing){requireThat(existing.inputHash===inputHash,'request_key_payload_conflict');return existing.review;}
      await this.store.put(project,'textPlanningReview',reviewId,record);return review;
    });
  }
  private async record(p:Principal,project:string,reviewId:string,reviewDigest?:string) {
    await this.session(p,project);
    const r=await this.store.get<ReviewRecord>(project,'textPlanningReview',reviewId);
    requireThat(r.actor.userId===p.userId && digest(r.session.binding)===digest(sessionBinding(p)) && (!reviewDigest||r.review.reviewDigest===reviewDigest),'planning_review_changed',403);return r;
  }
  async approve(p:Principal,project:string,i:TextPlanningCommands['approveTextPlan']['input']) {
    text(i.requestKey,160);const record=await this.record(p,project,i.reviewId,i.reviewDigest);
    return this.guard(record,async()=>{
      const latest=await this.store.get<ReviewRecord>(project,'textPlanningReview',i.reviewId);
      if(latest.review.state==='accepted')return this.store.get<PlanningRequest>(project,'planningRequest',i.reviewId);
      requireThat(latest.review.state==='review','planning_review_cancelled');
      const v=record.review,d=await this.draft(project,v.draftId,v.draftRevision);await this.noExposure(project,d.id);
      const r:PlanningRequest={id:v.id,projectId:project,draftId:d.id,draftRevision:d.revision,briefDigest:d.studio.briefDigest,inputDigest:v.requestDigest,brief:d.studio.brief,model:v.connection.model,provider:v.connection.provider,promptVersion:PLANNING_VERSION,schemaVersion:PLANNING_VERSION,authorityId:v.connection.id,authorityDigest:digest(record.access),state:'queued',providerResponseId:null,options:[],reason:'Accepted. One bounded request is reserved.',usage:unknownUsage(),outputDigest:null,createdAt:new Date().toISOString(),textReceipt:{evidence:this.evidence,reviewId:v.id,reviewDigest:v.reviewDigest,attemptId:null,dispatchedAt:null,diagnosticRequestId:null,settlement:'reserved',settledMinor:null,currency:v.quote.currency}};
      await this.billing.reserve(r,v.quote);
      await this.store.put(project,'planningRequest',r.id,r);latest.review.state='accepted';await this.store.put(project,'textPlanningReview',v.id,latest);
      await this.store.put(project,'planningActor',r.id,p);return r;
    });
  }
  async cancel(p:Principal,project:string,i:TextPlanningCommands['cancelTextPlan']['input']) {
    const record=await this.record(p,project,i.reviewId,i.reviewDigest);
    // Only an unaccepted quote is cancelled. An admitted operation remains visible.
    return this.guard(record,async()=>{const latest=await this.store.get<ReviewRecord>(project,'textPlanningReview',i.reviewId);requireThat(latest.review.state!=='accepted','planning_already_admitted_check_outcome');latest.review.state='cancelled';await this.store.put(project,'textPlanningReview',i.reviewId,latest);return latest.review;},false);
  }
  async dispatch(project:string,requestId:string,abort?:AbortSignal):Promise<PlanningRequest> {
    await this.store.db.assertExecutionOwner();
    const record=await this.store.get<ReviewRecord>(project,'textPlanningReview',requestId);
    let attempted=false, finalizingKnownResponse=false;
    try {
      const claim=await this.guard(record,async()=>{
        await this.store.db.assertExecutionOwner();const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);
        if(r.state!=='queued')return null;
        await this.draft(project,r.draftId,r.draftRevision);r.state='running';r.reason='Preparing the one admitted request.';await this.store.put(project,'planningRequest',r.id,r);return r;
      });
      if(!claim)return this.store.get<PlanningRequest>(project,'planningRequest',requestId);
      const signal=abort?AbortSignal.any([abort,AbortSignal.timeout(this.timeoutMs)]):AbortSignal.timeout(this.timeoutMs);
      const secret=await bounded(this.options.custody.read<{apiKey:string}>(project,record.access.custodyRef),signal);
      requireThat(typeof secret.apiKey==='string'&&secret.apiKey.length>=8&&secret.apiKey.length<=4096&&!/\s/.test(secret.apiKey),'text_credential_unavailable');
      let pending:Promise<Response>|undefined;
      // Commit the physical-attempt fence first. A crash after this commit and
      // before fetch is intentionally unknown, never a reason to dispatch twice.
      await this.guard(record,async()=>{
        await this.store.db.assertExecutionOwner();signal.throwIfAborted();await this.draft(project,claim.draftId,claim.draftRevision);
        const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);requireThat(r.state==='running'&&!r.textReceipt!.attemptId,'planning_attempt_already_dispatched');
        r.textReceipt!.attemptId=id();r.textReceipt!.dispatchedAt=new Date().toISOString();r.reason='Request dispatched; awaiting provider outcome.';await this.store.put(project,'planningRequest',r.id,r);
      });
      // Physical fetch is started synchronously inside current-authority guards;
      // the network promise is awaited only after those short guards are released.
      await this.guard(record,async()=>{
        await this.store.db.assertExecutionOwner();signal.throwIfAborted();await this.draft(project,claim.draftId,claim.draftRevision);
        pending=this.transport(endpoints[claim.provider],{method:'POST',redirect:'error',signal,headers:{authorization:`Bearer ${secret.apiKey}`,'content-type':'application/json'},body:JSON.stringify(record.body)});
        pending.catch(()=>{});attempted=true;
      });
      const response=await bounded(pending!,signal);
      const diagnostic=response.headers.get('x-request-id');
      if(diagnostic&&/^[\w.-]{1,200}$/.test(diagnostic))await this.retainEvidence(project,requestId,r=>{requireThat(!r.textReceipt!.diagnosticRequestId||r.textReceipt!.diagnosticRequestId===diagnostic,'planning_diagnostic_changed');r.textReceipt!.diagnosticRequestId=diagnostic;});
      if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error('planning_provider_response_unavailable');}
      const raw=await readResponse(response,signal,claim.provider,async providerId=>{await this.retainEvidence(project,requestId,r=>{requireThat(!r.providerResponseId||r.providerResponseId===providerId,'planning_response_identity_changed');r.providerResponseId=providerId;});});
      const usage=parseUsage(raw,claim.provider);
      let values:CampaignOption[]=[],reason:string|null=null;
      try {
        for(const field of ['input_tokens','output_tokens']){const value=raw.usage?.[field];requireThat(value===undefined||value===null||finite(value,Number.MAX_SAFE_INTEGER),'Provider usage is not a valid token count.');}
        requireThat(raw.model===claim.model,'Response model differs from the reviewed model.');
        requireThat(raw.status==='completed','Planning did not complete. Review the brief before a separately quoted attempt.');
        requireThat(!raw.output?.some((o:any)=>o.content?.some((c:any)=>c.type==='refusal')),'The provider declined this request. Review the brief.');
        const output=raw.output?.flatMap((o:any)=>Array.isArray(o.content)?o.content:[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
        requireThat(typeof output==='string'&&Buffer.byteLength(output)<=256*1024,'Output exceeded the supported limit.');
        values=validatePlanningOutput(JSON.parse(output));
        requireThat((usage.inputTokens===null||usage.inputTokens<=record.review.quote.inputTokenUpperBound)&&(usage.outputTokens===null||usage.outputTokens<=record.review.quote.maxOutputTokens),'Provider usage exceeded the reviewed allowance.');
      } catch {
        values=[];
        reason=Array.isArray(raw.output)&&raw.output.some((o:any)=>Array.isArray(o?.content)&&o.content.some((c:any)=>c?.type==='refusal'))
          ? 'The provider declined this request. Review the brief; no suggestion is selectable.'
          : raw.status!=='completed' ? 'The provider returned an incomplete response. No suggestion is selectable.'
          : 'The response did not pass SDK schema, model or allowance validation. No suggestion is selectable.';
        reason+=' A new attempt requires a new quote after settlement.';
      }
      const observed=await this.retainEvidence(project,requestId,r=>{r.usage=usage;r.outputDigest=digest(raw);r.reason=reason;});
      const fact=await bounded(this.options.billing.measure(observed,record.review.quote,signal),signal);
      // Preserve the billing owner's original observation before attempting the
      // atomic ledger transition. A rejected/rolled-back settlement must not
      // erase evidence, change the reservation or authorize a second attempt.
      requireThat(Buffer.byteLength(JSON.stringify(fact))<=16384,'planning_billing_evidence_size_limit');
      await this.store.put(project,'planningEvidence',`${requestId}:billing:${digest(fact)}`,{requestId,attemptId:observed.textReceipt!.attemptId,quoteReceipt:record.review.quote.receipt,requestDigest:observed.inputDigest,fact,payloadDigest:digest(fact)});
      await this.store.transaction(async()=>{
        const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);
        const settled=await this.billing.settle(r,record.review.quote,fact);
        r.textReceipt!.settlement=settled?'settled':'unknown';r.textReceipt!.settledMinor=settled?.measuredMinor??null;
        await this.store.put(project,'planningRequest',r.id,r);
      });
      finalizingKnownResponse=!!observed.providerResponseId;
      return await this.guard(record,async()=>{
        await this.store.db.assertExecutionOwner();await this.draft(project,claim.draftId,claim.draftRevision);
        const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);requireThat(r.providerResponseId,'planning_response_identity_missing');
        r.options=values;r.state=reason?'failed':'succeeded';r.reason=reason??'Validated suggestions need your review. Nothing has been selected.';await this.store.put(project,'planningRequest',r.id,r);return r;
      });
    } catch {
      return this.retainEvidence(project,requestId,r=>{
        if(['succeeded','failed'].includes(r.state))return;
        r.state=finalizingKnownResponse?'failed':'unknown';r.options=[];
        if(r.textReceipt!.settlement!=='settled')r.textReceipt!.settlement='unknown';
        r.reason=finalizingKnownResponse?'The response arrived after the draft or its authority changed. Nothing was applied. Keep your current edits; a new request requires current permission, settled prior cost and a new exact review.':attempted?'Outcome or final authority could not be confirmed. Retained spend stays reserved until the billing owner resolves it. No automatic retry is available.':'Dispatch could not be confirmed. Check the original operation with your administrator; do not start another request.';
      });
    }
  }
  private retainEvidence(project:string,requestId:string,update:(r:PlanningRequest)=>void) {
    return this.store.transaction(async()=>{const r=await this.store.get<PlanningRequest>(project,'planningRequest',requestId);update(r);await this.store.put(project,'planningRequest',r.id,r);return r;});
  }
  async reconcile(p:Principal,project:string,requestId:string) {
    await this.record(p,project,requestId);
    // store:false has no supported recovery promise. This read never requests a
    // provider response, new generation, reservation release or fresh settlement.
    return this.retainEvidence(project,requestId,r=>{
      if(r.state==='running'){
        r.state='unknown';r.reason='No completed response is retained yet. The provider may still be working. Stored response recovery is unavailable for this request; no retry or reservation release was performed.';
      }
    });
  }
  async withSelectable<T>(p:Principal,project:string,r:PlanningRequest,local:()=>Promise<T>) {
    const record=await this.record(p,project,r.id);
    return this.guard(record,async()=>{
      const actual=await this.store.get<PlanningRequest>(project,'planningRequest',r.id);
      requireThat(actual.state==='succeeded'&&actual.textReceipt?.evidence===this.evidence&&digest(actual)===digest(r),'planning_result_changed');
      validatePlanningOutput({options:r.options});return local();
    });
  }
}

function parseUsage(raw:any,provider:'openai'|'xai'):PlanningUsage {
  const u=raw.usage, input=finite(u?.input_tokens,Number.MAX_SAFE_INTEGER)?u.input_tokens:null, output=finite(u?.output_tokens,Number.MAX_SAFE_INTEGER)?u.output_tokens:null;
  const ticks=u?.cost_in_usd_ticks;
  const cost=provider==='xai'&&((typeof ticks==='string'&&/^\d{1,20}$/.test(ticks))||finite(ticks,Number.MAX_SAFE_INTEGER))?{value:String(ticks),unit:'usd_ticks_1e10',currency:'USD'}:null;
  return {inputTokens:input,outputTokens:output,cost,unavailableReason:cost?null:'Measured provider cost requires the billing owner receipt.'};
}

async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();
  let onAbort:()=>void=()=>{};
  try { return await Promise.race([work,new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(new Error('planning_timeout'));signal.addEventListener('abort',onAbort,{once:true});})]); }
  finally { signal.removeEventListener('abort',onAbort); }
}

/** Bounded stream parsing. Identity is awaited before later output events. A
 * non-stream response can expose identity only after bounded JSON parsing. */
async function readResponse(response:Response,signal:AbortSignal,provider:'openai'|'xai',retain:(id:string)=>Promise<void>) {
  const reader=response.body?.getReader();requireThat(reader,'planning_response_body_missing');
  const decoder=new TextDecoder('utf-8',{fatal:true}), streaming=response.headers.get('content-type')?.includes('text/event-stream');
  let buffer='',bytes=0,final:any=null,identity:string|null=null,sequence=-1,created=false,ended=false;
  async function responseIdentity(v:any) {
    requireThat(typeof v?.id==='string'&&/^[\w.-]{1,500}$/.test(v.id),'planning_response_identity_missing');
    requireThat(!identity||identity===v.id,'planning_response_identity_changed');
    if(!identity){await retain(v.id);identity=v.id;}
  }
  async function event(frame:string) {
    requireThat(Buffer.byteLength(frame)<=512*1024,'planning_event_size_limit');
    const lines=frame.split('\n'),data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)return; // SSE comments/keep-alives carry no result or authority.
    requireThat(!ended,'planning_event_after_end');
    if(data==='[DONE]'){requireThat(final,'planning_final_missing');ended=true;return;}
    requireThat(final===null,'planning_event_after_final');
    const v=JSON.parse(data),name=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
    requireThat(v&&typeof v.type==='string'&&(!name||name===v.type),'planning_event_type_invalid');
    // OpenAI defines a sequence number on every event. xAI's public REST
    // contract does not promise one; if present, require it consistently in order.
    if(provider==='openai'||v.sequence_number!==undefined||sequence>=0){
      requireThat(finite(v.sequence_number,Number.MAX_SAFE_INTEGER)&&v.sequence_number>sequence,'planning_event_sequence_invalid');
      sequence=v.sequence_number;
    }
    requireThat(v.type!=='error','planning_stream_error');
    if(v.type==='response.created'){
      requireThat(!created,'planning_duplicate_created');await responseIdentity(v.response);created=true;return;
    }
    requireThat(created&&identity,'planning_created_missing');
    if(v.response_id!==undefined)requireThat(v.response_id===identity,'planning_response_identity_changed');
    if(v.response)await responseIdentity(v.response);
    if(['response.completed','response.incomplete','response.failed'].includes(v.type)){
      requireThat(v.response&&v.response.status===v.type.slice('response.'.length),'planning_final_status_invalid');final=v.response;
    }else{
      requireThat(/^response\.(in_progress|output_item\.(added|done)|content_part\.(added|done)|output_text\.(delta|done|annotation\.added)|refusal\.(delta|done)|reasoning(_summary)?_text\.(delta|done)|reasoning_summary_part\.(added|done))$/.test(v.type),'planning_event_unsupported');
    }
  }
  // Cancellation of the local reader is not provider cancellation. Neither a
  // non-cooperative stream nor its cancel hook may extend the dispatch deadline.
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try {
    for(;;){signal.throwIfAborted();const part=await bounded(reader.read(),signal);signal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;requireThat(bytes<=1024*1024,'planning_response_size_limit');buffer+=decoder.decode(part.value,{stream:true});
      if(streaming){buffer=buffer.replaceAll('\r\n','\n');let end:number;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);await event(frame);}requireThat(Buffer.byteLength(buffer)<=512*1024,'planning_event_size_limit');}
    }
    buffer+=decoder.decode();
    if(streaming){if(buffer.trim())await event(buffer);requireThat(final,'planning_final_missing');}
    else{final=JSON.parse(buffer);await responseIdentity(final);}
    requireThat(final&&typeof final==='object','planning_response_invalid');return final;
  }finally{signal.removeEventListener('abort',cancel);cancel();}
}
