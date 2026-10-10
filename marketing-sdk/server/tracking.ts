import { TRACKING_OUTCOMES, type TrackingCommands, type TrackingOwner, type TrackingSource, type TrackingBinding, type TrackingTest, type TrackingView, type TrackingDiagnostic, type TrackingOutcome, type CampaignDraft, type Campaign, type Commands, type FirstPartyEvent, type MarketingPurpose, type Money } from '../core/index.js';
import { Store, digest, id, requireThat, type Principal } from './store.js';
import { keys, text, instant } from './validation.js';
import { assertSessionInspection, inspectLiveSessions, sessionBinding, type SessionAuthority, type SessionInspection } from './session-authority.js';

/** Existing site ownership catalogue. inspect/withLiveSources use current local
 * host facts and the host's coordinated revocation guard, never network I/O.
 * All source/configuration/ownership writers must share that guard. */
export interface TrackingSources {
  catalogue(session: SessionInspection): Promise<TrackingSource[]>;
  inspect(projectId: string, sourceId: string): Promise<TrackingSource>;
  /** Current per-session source permission, using bounded local host facts.
   * All permission writers participate in the session/source revocation guards. */
  inspectAccess(session: SessionInspection, source: TrackingSource): Promise<boolean>;
  /** Complete project source universe, including sources with no events. Local
   * authoritative facts only. Missing support leaves completeness unknown.
   * withLiveSources must also serialize project source additions/removals. */
  inspectUniverse?(projectId: string): Promise<TrackingSource[]>;
  withLiveSources<T>(expected: readonly TrackingSource[], local: () => Promise<T>): Promise<T>;
}
export interface CollectorInspection {
  id: string; revision: string; expiresAt: number; source: TrackingSource;
  permissions: readonly ('completion' | 'coverage')[];
}
/** Facts resolved from an existing retained collector completion, not from the
 * HTTP caller's asserted flags. Opaque person/order references only; no PII. */
export interface CollectorCompletion {
  sourceReceipt: string; eventId: string; domain: string; environment: TrackingSource['environment'];
  destinationId: string; outcome: TrackingOutcome; occurredAt: string; personId: string;
  consent: { basis: 'consent' | 'contract' | 'legitimate_interest'; receipt: string };
  completionReceipt: string; testId: string | null; qa: boolean;
  clickId: string | null; revenue: Money | null; refundTreatment: 'gross_before_refunds' | null;
}
export interface CollectorCheckpoint {
  id: string; campaignId: string; from: string; until: string; purpose: MarketingPurpose;
  sourceRevision: string; provenance: string; complete: true;
}
/** Separate from human setup authority. authenticateRequest resolves source scope
 * using existing host auth. verifyCompletion/checkpoint look up retained facts;
 * a receipt string alone is never proof. No SDK credential store is installed. */
export interface TrackingCollector {
  authenticateRequest(request: Request): Promise<CollectorInspection>;
  /** Server-only current producer authority; no human role can substitute for it.
   * Resolve outside guards. withLiveCollector rechecks exact current authority. */
  inspectCollector?(id: string): Promise<CollectorInspection | null>;
  verifyCompletion(context: CollectorInspection, sourceReceipt: string): Promise<CollectorCompletion>;
  verifyCheckpoint(context: CollectorInspection, checkpoint: string): Promise<CollectorCheckpoint>;
  withLiveCollector<T>(expected: CollectorInspection, local: () => Promise<T>): Promise<T>;
}
export interface TrackingOptions { sources?: TrackingSources; collector?: TrackingCollector }
export interface ValidatedCoverage {
  id: string; version: 1; campaignId: string; sourceId: string; sourceRevision: string;
  bindingId: string; bindingRevision: number; materialDigest: string; from: string; until: string;
  purpose: MarketingPurpose; checkpoint: string; provenance: string; receivedAt: string;
  collectorId: string; collectorRevision: string;
  /** Absent on legacy evidence, which remains readable but cannot prove totals. */
  sourceUniverseDigest?: string;
}
interface TestRecord { test: TrackingTest; binding: TrackingBinding; session: SessionInspection }
export const trackingCommandFields: Record<keyof TrackingCommands, string[]> = {
  tracking: ['owner'], bindTracking: ['owner','expectedRevision','expectedBindingRevision','sourceId','sourceRevision','destinationId','outcome','refundTreatment','requestKey'],
  startTrackingTest: ['owner','expectedBindingRevision','requestKey'], observeTrackingTest: ['owner','testId'], cancelTrackingTest: ['owner','testId'],
};
export class MarketingTracking {
  constructor(readonly store: Store, readonly sessions: SessionAuthority, readonly options: TrackingOptions,
    private readonly ingest: (project: string, input: Commands['event']['input']) => Promise<FirstPartyEvent>, readonly mode: 'fixture' | 'live', readonly now = () => Date.now()) {}
  private async inspection(p: Principal, project: string) {
    const binding = sessionBinding(p), s = await this.sessions.inspectSession(binding, project);
    assertSessionInspection(s,binding,project); return s;
  }
  private async guarded<T>(p: Principal, s: SessionInspection, write: boolean, local: () => Promise<T>, sources?: TrackingSource[]) {
    requireThat(!sources?.length || this.options.sources,'tracking_source_integration_required');
    requireThat(!write || s.kind === 'human' && ['admin','editor'].includes(s.role),'forbidden',403);
    const commit = () => this.store.transaction(async () => {
      const check = async () => {
        await inspectLiveSessions(this.sessions,[s]);
        for (const source of sources ?? []) {
          requireThat(this.options.sources?.inspectAccess && await this.options.sources.inspectAccess(s,source),'tracking_source_not_authorized',403);
          const current=await this.options.sources!.inspect(s.projectId,source.id);
          this.validateSource(current,s.projectId); requireThat(digest(current)===digest(source),'tracking_source_changed');
        }
      };
      await check(); await this.store.authorize(p,s.projectId,write?['admin','editor']:undefined,write);
      const result = await local(); await check(); return result;
    });
    // Consistent acquisition order: human session -> source -> SDK Store.
    return this.sessions.withLiveSessions([s], () => sources && this.options.sources ? this.options.sources.withLiveSources(sources,commit) : commit());
  }
  private validateSource(s: TrackingSource, project: string) {
    requireThat(s && s.projectId === project && s.active,'tracking_source_revoked',403);
    for(const v of [s.id,s.revision,s.label,s.domain]) text(v,500);
    requireThat(['test','production'].includes(s.environment) && ['available','missing','unavailable'].includes(s.collector),'invalid_tracking_source',422);
    requireThat(s.outcomes.length <= 7 && s.outcomes.every(o => Object.hasOwn(TRACKING_OUTCOMES,o)) && s.destinations.length <= 50 && s.instructions.length <= 20,'invalid_tracking_source',422);
    for(const instruction of s.instructions) text(instruction,2000);
    for(const d of s.destinations) {
      for(const v of [d.id,d.label]) text(v,500);
      for(const raw of [d.url,d.testUrl].filter((u):u is string=>u!==null)) {
        text(raw,2048); const u = new URL(raw);
        requireThat(!u.username && !u.password && !u.hash && u.hostname === s.domain &&
          (u.protocol === 'https:' || this.mode === 'fixture' && u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)),'invalid_tracking_destination',422);
      }
    }
  }
  private async withSource<T>(s: TrackingSource, local: () => Promise<T>) {
    requireThat(this.options.sources,'tracking_source_integration_required');
    return this.options.sources.withLiveSources([s], async () => {
      const check = async () => { const current=await this.options.sources!.inspect(s.projectId,s.id); this.validateSource(current,s.projectId); requireThat(digest(current)===digest(s),'tracking_source_changed'); };
      await check(); const result = await local(); await check(); return result;
    });
  }
  private ownerKey(owner: TrackingOwner) { keys(owner,['kind','id']); text(owner.id,160); requireThat(['draft','campaign'].includes(owner.kind),'invalid_tracking_owner',422); return digest(owner); }
  private async owner(project: string, owner: TrackingOwner) {
    this.ownerKey(owner);
    const record=await this.store.get<CampaignDraft | Campaign>(project,owner.kind==='draft'?'campaignDraft':'campaign',owner.id);
    const accountId=record.material.settings?.accountId;
    const grant=accountId?(await this.store.list<import('../core/index.js').Grant>(project,'grant')).find(g=>g.accountId===accountId && g.provider===record.material.settings?.provider && !g.revokedAt && Date.parse(g.expiresAt)>this.now()):null;
    return { revision:record.revision, material:record.material, purpose:record.material.purpose??'acquisition', digest:digest(record.material), accountDigest:grant?digest(grant):null };
  }
  private async binding(project: string, owner: TrackingOwner) { return (await this.store.list<TrackingBinding>(project,'trackingBinding')).find(b=>b.id===this.ownerKey(owner))??null; }
  private async exact(project: string, binding: TrackingBinding) {
    const owner=await this.owner(project,binding.owner), current=await this.binding(project,binding.owner);
    requireThat(current?.revision===binding.revision && owner.revision===binding.ownerRevision && owner.digest===binding.materialDigest && owner.accountDigest===binding.accountDigest,'tracking_material_or_binding_changed');
  }
  /** Current launch configuration only; QA status is deliberately irrelevant. */
  async campaignConfiguration(p: Principal, project: string, campaignId: string) {
    const session = await this.inspection(p, project);
    const binding = await this.binding(project, { kind: "campaign", id: campaignId });
    requireThat(binding && binding.outcome === "inquiry" && binding.purpose === "acquisition" && !binding.providerMapping, "first_party_inquiry_required");
    await this.exact(project, binding);
    requireThat(this.options.sources?.inspectAccess && await this.options.sources.inspectAccess(session, binding.source), "tracking_source_not_authorized", 403);
    const source = await this.options.sources.inspect(project, binding.source.id);
    this.validateSource(source, project);
    requireThat(digest(source) === digest(binding.source), "tracking_source_changed");
    await inspectLiveSessions(this.sessions, [session]);
    return binding;
  }
  /** Acquire after session authority and before the SDK Store lock. */
  async withCampaignConfiguration<T>(binding: TrackingBinding, local: () => Promise<T>) {
    return this.withSource(binding.source, local);
  }
  private async universe(project: string) {
    const sources = await this.options.sources?.inspectUniverse?.(project);
    requireThat(sources && sources.length <= 100, 'source_universe_unavailable');
    requireThat(new Set(sources.map(s => s.id)).size === sources.length, 'invalid_source_universe');
    for (const source of sources) { requireThat(source.projectId === project, 'invalid_source_universe'); if (source.active) this.validateSource(source, project); }
    return { sources, hash: digest([...sources].sort((a,b) => a.id.localeCompare(b.id))) };
  }
  /** Retained results remain readable without live collector authority. Only
   * current, single-source evidence may label the totals complete. Remote producer
   * resolution happens before the short collector/source/session/Store guards. */
  async withCoverage<T>(project: string, binding: TrackingBinding | null, local: (authority: {sourceUniverseDigest:string;collectorId:string;collectorRevision:string} | null) => Promise<T>, withSession: (commit: () => Promise<T>) => Promise<T>): Promise<T> {
    let c: CollectorInspection | null = null, universe: Awaited<ReturnType<MarketingTracking['universe']>> | null = null;
    if (binding && this.options.collector?.inspectCollector && this.options.sources?.inspectUniverse) {
      try {
        const row = (await this.store.list<ValidatedCoverage>(project,'validatedCoverage')).filter(r => r.bindingId === binding.id && r.bindingRevision === binding.revision).at(-1);
        if (row) c = await this.options.collector.inspectCollector(row.collectorId);
        universe = await this.universe(project);
        if (!c || !row || c.id !== row.collectorId || c.revision !== row.collectorRevision || !c.permissions?.includes('coverage') || c.expiresAt <= this.now() || digest(c.source) !== digest(binding.source) || !c.source.active) c = null;
      } catch { c = null; }
    }
    if (!c || !universe || !binding) return withSession(() => this.store.transaction(() => local(null)));
    const expected = universe;
    const context = c;
    return withSession(() => this.collectorGuard(context, async () => {
      const current = await this.universe(project);
      requireThat(current.hash === expected.hash, 'source_universe_changed');
      const relevant = current.sources.filter(s => s.active && s.outcomes.some(o => TRACKING_OUTCOMES[o].purpose === binding.purpose));
      let exact = true;
      try { await this.exact(project,binding); } catch { exact = false; }
      const result = await local(exact && relevant.length === 1 && digest(relevant[0]) === digest(binding.source) ? {sourceUniverseDigest:current.hash,collectorId:context.id,collectorRevision:context.revision} : null);
      requireThat((await this.universe(project)).hash === current.hash, 'source_universe_changed');
      return result;
    }));
  }
  /** Revalidate a prepared Studio handoff without repeating catalogue/network
   * resolution inside the final local transition. */
  async withCurrentView<T>(p: Principal, project: string, view: TrackingView, local: () => Promise<T>): Promise<T> {
    const session = await this.inspection(p, project);
    const check = async () => {
      for (const source of view.sources) requireThat(digest(await this.options.sources!.inspect(project,source.id)) === digest(source), 'tracking_source_changed');
      requireThat((await this.owner(project,view.owner)).revision === view.ownerRevision, 'tracking_material_or_binding_changed');
      requireThat(digest(await this.binding(project,view.owner)) === digest(view.binding), 'tracking_material_or_binding_changed');
      if (view.readiness === 'passed') {
        const test = view.tests.filter(t => t.bindingRevision === view.binding?.revision).at(-1)!;
        const current = await this.store.get<TestRecord>(project,'trackingTest',test.id);
        requireThat(digest(current.test) === digest(test) && !current.test.cancelledAt && Date.parse(test.expiresAt) > this.now(), 'tracking_test_closed');
        requireThat(digest(current.session) === digest(session), 'original_setup_session_required');
        await inspectLiveSessions(this.sessions,[current.session]);
        await this.exact(project,current.binding);
      }
    };
    return this.guarded(p,session,false,async () => { await check(); const result = await local(); await check(); return result; },view.sources);
  }
  private async once<T>(project: string, s: SessionInspection, command: string, input: { requestKey: string }, action: () => Promise<T>) {
    text(input.requestKey,160); const key=digest([s.binding,command,input.requestKey]);
    const previous=(await this.store.list<{id:string;hash:string;result:T}>(project,'trackingRequest')).find(r=>r.id===key), hash=digest(input);
    if(previous) { requireThat(previous.hash===hash,'request_key_payload_conflict'); return previous.result; }
    const result=await action(); await this.store.put(project,'trackingRequest',key,{id:key,hash,result}); return result;
  }
  /** Exact configuration follows promotion in the same transaction as the new
   * campaign. Tests and production coverage retain their original owners. */
  async withPromotion<T>(p: Principal, project: string, draftId: string, local: (retain: (campaign: Campaign) => Promise<void>) => Promise<T>): Promise<T> {
    const view = await this.tracking(p, project, { owner: { kind: 'draft', id: draftId } });
    return this.withCurrentView(p, project, view, async () => {
      const s = await this.inspection(p, project);
      requireThat(s.kind === 'human' && ['admin','editor'].includes(s.role), 'forbidden', 403);
      if (view.binding) await this.exact(project, view.binding);
      return local(async campaign => {
        const old = view.binding;
        if (!old) return;
        requireThat(view.sources.some(source => digest(source) === digest(old.source)), 'tracking_source_changed');
        requireThat(campaign.projectId === project && campaign.draftOrigin?.draftId === draftId && campaign.draftOrigin.revision === old.ownerRevision, 'tracking_material_or_binding_changed');
        const owner: TrackingOwner = { kind: 'campaign', id: campaign.id };
        const facts = await this.owner(project, owner);
        requireThat(facts.material.destination === old.destination && facts.purpose === old.purpose && facts.accountDigest === old.accountDigest, 'tracking_material_or_binding_changed');
        requireThat(!await this.binding(project, owner), 'tracking_binding_already_exists');
        const binding: TrackingBinding = { ...old, id: this.ownerKey(owner), owner, revision: 1,
          ownerRevision: facts.revision, materialDigest: facts.digest, createdAt: new Date(this.now()).toISOString(),
          promotedFrom: { owner: old.owner, bindingId: old.id, bindingRevision: old.revision, ownerRevision: old.ownerRevision } };
        await this.store.put(project, 'trackingBinding', binding.id, binding);
        await this.store.put(project, 'trackingBindingHistory', `${binding.id}:1`, binding);
      });
    });
  }
  async call<K extends keyof TrackingCommands>(p: Principal, project: string, command: K, input: TrackingCommands[K]['input']): Promise<TrackingCommands[K]['output']> {
    keys(input,trackingCommandFields[command]); this.ownerKey(input.owner);
    const fn=this[command] as (p:Principal,project:string,input:TrackingCommands[K]['input'])=>Promise<TrackingCommands[K]['output']>;
    return fn.call(this,p,project,input);
  }
  async tracking(p: Principal, project: string, i: TrackingCommands['tracking']['input']): Promise<TrackingView> {
    const s=await this.inspection(p,project);
    await this.guarded(p,s,false,()=>this.owner(project,i.owner));
    const sources = this.options.sources ? await this.options.sources.catalogue(s) : [];
    requireThat(sources.length<=100,'tracking_catalogue_limit'); for(const source of sources)this.validateSource(source,project);
    const local=()=>this.guarded(p,s,false,async()=>{
      for(const source of sources)requireThat(digest(await this.options.sources!.inspect(project,source.id))===digest(source),'tracking_source_changed');
      const owner=await this.owner(project,i.owner), binding=await this.binding(project,i.owner);
      const records=(await this.store.list<TestRecord>(project,'trackingTest')).filter(t=>t.binding.id===this.ownerKey(i.owner));
      const tests=records.map(r=>r.test), diagnostics=(await this.store.list<TrackingDiagnostic>(project,'trackingDiagnostic')).filter(d=>tests.some(t=>t.id===d.testId));
      let readiness:TrackingView['readiness']=sources.length?'not_tested':'missing_integration', reason=sources.length?'Choose a source and save its configuration.':'Ask the site administrator to expose an authorized source through the existing collector integration.';
      if(binding) {
        const source=sources.find(x=>x.id===binding.source.id);
        const current=source && digest(source)===digest(binding.source) && owner.revision===binding.ownerRevision && owner.digest===binding.materialDigest && owner.accountDigest===binding.accountDigest;
        const last=records.filter(t=>t.test.bindingRevision===binding.revision).at(-1);
        readiness=!current?'stale':!last?'not_tested':last.test.cancelledAt?'cancelled':Date.parse(last.test.expiresAt)<=this.now()?'expired':'pending';
        reason={stale:'Source, destination, material or account changed. Review and save the current configuration, then test again.',not_tested:'Configuration saved. Complete a no-send interaction at the allowed destination.',cancelled:'Test cancelled. Late evidence remains excluded from business totals.',expired:'Test timed out. Browser observation alone does not prove completion.',pending:'Waiting for an authenticated completion receipt.'}[readiness];
        if(current && last && !last.test.cancelledAt && Date.parse(last.test.expiresAt)>this.now() && diagnostics.some(d=>d.testId===last.test.id && d.eligibleAtReceipt)) {
          // The original setup session and exact material must still be current.
          // Expired tests cannot qualify readiness, including retained successes.
          try { requireThat(digest(last.session)===digest(s),'original_setup_session_required'); await inspectLiveSessions(this.sessions,[last.session]); readiness='passed'; reason='First-party test passed for this exact configuration. Provider delivery and production coverage remain separate.'; } catch { readiness='stale'; reason='The original setup session or permissions changed. Start a new test with current authority.'; }
        }
      }
      return {owner:i.owner,ownerRevision:owner.revision,purpose:owner.purpose,destination:owner.material.destination??null,sources,binding,tests,diagnostics,readiness,reason,canEdit:s.kind==='human'&&['admin','editor'].includes(s.role)};
    },sources);
    return local();
  }
  async bindTracking(p: Principal, project: string, i: TrackingCommands['bindTracking']['input']) {
    const s=await this.inspection(p,project); requireThat(this.options.sources,'tracking_source_integration_required');
    await this.guarded(p,s,true,()=>this.owner(project,i.owner));
    const source=(await this.options.sources.catalogue(s)).find(x=>x.id===i.sourceId); requireThat(source,'tracking_source_not_authorized',403);this.validateSource(source,project);
    requireThat(source.revision===i.sourceRevision,'tracking_source_changed');
    return this.guarded(p,s,true,()=>this.once(project,s,'bind',i,async()=>{
      const owner=await this.owner(project,i.owner), old=await this.binding(project,i.owner), destination=source.destinations.find(d=>d.id===i.destinationId);
      requireThat(owner.revision===i.expectedRevision && (old?.revision??0)===i.expectedBindingRevision,'revision_conflict');
      requireThat(destination && destination.url===owner.material.destination,'tracking_destination_mismatch');
      requireThat(Object.hasOwn(TRACKING_OUTCOMES,i.outcome) && source.outcomes.includes(i.outcome) && TRACKING_OUTCOMES[i.outcome].purpose===owner.purpose,'tracking_outcome_mismatch');
      requireThat(i.refundTreatment === (i.outcome==='purchase'?'gross_before_refunds':null),'refund_treatment_required',422);
      const settings=owner.material.settings;
      requireThat(!settings?.conversion || owner.accountDigest,'current_provider_account_required');
      const expectedEvent:Partial<Record<TrackingOutcome,string>>={inquiry:'Lead',purchase:'Purchase',mou:'ApplicantRequestMOU'};
      requireThat(!settings?.conversion || expectedEvent[i.outcome] && settings.conversion.event===expectedEvent[i.outcome],'provider_event_outcome_mismatch');
      const binding:TrackingBinding={...(old?.promotedFrom?{promotedFrom:old.promotedFrom}:{}),id:this.ownerKey(i.owner),projectId:project,revision:(old?.revision??0)+1,owner:i.owner,ownerRevision:owner.revision,materialDigest:owner.digest,accountDigest:owner.accountDigest,source,destinationId:destination.id,destination:destination.url,outcome:i.outcome,purpose:owner.purpose,refundTreatment:i.refundTreatment,providerMapping:settings?.conversion && settings.provider && settings.accountId && settings.conversion.event?{provider:settings.provider,accountId:settings.accountId,event:settings.conversion.event,configuration:digest(settings.conversion)}:null,createdAt:new Date(this.now()).toISOString()};
      await this.store.put(project,'trackingBinding',binding.id,binding,old?.revision);await this.store.put(project,'trackingBindingHistory',`${binding.id}:${binding.revision}`,binding);return binding;
    }),[source]);
  }
  async startTrackingTest(p: Principal, project: string, i: TrackingCommands['startTrackingTest']['input']) {
    const s=await this.inspection(p,project), binding=await this.guarded(p,s,true,()=>this.binding(project,i.owner)); requireThat(binding,'tracking_binding_required');
    return this.guarded(p,s,true,()=>this.once(project,s,'test',i,async()=>{
      await this.exact(project,binding); requireThat(binding.revision===i.expectedBindingRevision,'revision_conflict');
      requireThat(binding.source.collector==='available' && this.options.collector,'authenticated_collector_required');
      const destination=binding.source.destinations.find(d=>d.id===binding.destinationId);requireThat(destination?.testUrl,'no_send_test_destination_required');
      const prior=(await this.store.list<TestRecord>(project,'trackingTest')).find(r=>r.binding.id===binding.id && r.test.bindingRevision===binding.revision && !r.test.cancelledAt && Date.parse(r.test.expiresAt)>this.now());
      if(prior) {requireThat(digest(prior.session)===digest(s),'test_in_progress_in_another_session');return prior.test;}
      const testId=id(), url=new URL(destination.testUrl);url.searchParams.set('marketing_test',testId);url.searchParams.set('marketing_outcome',binding.outcome);
      const test:TrackingTest={id:testId,revision:1,bindingId:binding.id,bindingRevision:binding.revision,createdAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now()+300000).toISOString(),cancelledAt:null,observedAt:null,destinationUrl:url.href};
      await this.store.put(project,'trackingTest',testId,{test,binding,session:s});return test;
    }),[binding.source]);
  }
  private async mutateTest(p:Principal,project:string,i:TrackingCommands['cancelTrackingTest']['input'],cancel:boolean) {
    const s=await this.inspection(p,project);
    return this.guarded(p,s,true,async()=>{
      const r=await this.store.get<TestRecord>(project,'trackingTest',i.testId);requireThat(r.binding.id===this.ownerKey(i.owner),'tracking_test_mismatch');
      if(cancel)r.test.cancelledAt??=new Date(this.now()).toISOString();else {await this.exact(project,r.binding);requireThat(!r.test.cancelledAt && Date.parse(r.test.expiresAt)>this.now(),'tracking_test_closed');r.test.observedAt??=new Date(this.now()).toISOString();}
      r.test.revision++;await this.store.put(project,'trackingTest',r.test.id,r);return r.test;
    });
  }
  observeTrackingTest(p:Principal,project:string,i:TrackingCommands['observeTrackingTest']['input']) {return this.mutateTest(p,project,i,false);}
  cancelTrackingTest(p:Principal,project:string,i:TrackingCommands['cancelTrackingTest']['input']) {return this.mutateTest(p,project,i,true);}
  private async collectorContext(request: Request, permission: 'completion' | 'coverage') {
    requireThat(this.options.collector && this.options.sources,'authenticated_collector_unavailable',503);
    const context=await this.options.collector.authenticateRequest(request);
    requireThat(context && context.expiresAt>this.now(),'collector_authority_expired',401);
    requireThat(context.permissions?.includes(permission),'collector_permission_required',403);
    text(context.id,500);text(context.revision,500);this.validateSource(context.source,context.source.projectId);return context;
  }
  private async collectorGuard<T>(c:CollectorInspection,local:()=>Promise<T>) {
    return this.options.collector!.withLiveCollector(c,()=>this.withSource(c.source,()=>this.store.transaction(async()=>{
      requireThat(c.expiresAt>this.now(),'collector_authority_expired',401);const result=await local();requireThat(c.expiresAt>this.now(),'collector_authority_expired',401);return result;
    })));
  }
  /** Public server-only endpoint. Browser setup commands cannot reach this method. */
  async acceptReceipt(request: Request, input: { sourceReceipt: string; testId: string | null }) {
    keys(input,['sourceReceipt','testId']);text(input.sourceReceipt,200);if(input.testId!==null)text(input.testId,160);
    const c=await this.collectorContext(request,'completion'), fact=await this.options.collector!.verifyCompletion(c,input.sourceReceipt), project=c.source.projectId;
    requireThat(Buffer.byteLength(JSON.stringify(fact))<=8192,'collector_evidence_limit',413);
    keys(fact,['sourceReceipt','eventId','domain','environment','destinationId','outcome','occurredAt','personId','consent','completionReceipt','testId','qa','clickId','revenue','refundTreatment']);
    requireThat(fact.sourceReceipt===input.sourceReceipt && fact.testId===input.testId && typeof fact.qa==='boolean','collector_receipt_mismatch',422);
    requireThat(fact.domain===c.source.domain && fact.environment===c.source.environment && c.source.destinations.some(d=>d.id===fact.destinationId) && c.source.outcomes.includes(fact.outcome),'collector_scope_mismatch',403);
    for(const value of [fact.eventId,fact.personId,fact.completionReceipt,fact.consent.receipt])text(value,200);
    keys(fact.consent,['basis','receipt']);requireThat(['consent','contract','legitimate_interest'].includes(fact.consent.basis),'verified_consent_required',422);
    if(fact.clickId!==null)text(fact.clickId,200);if(fact.revenue)keys(fact.revenue,['minor','currency']);
    instant(fact.occurredAt);requireThat(Date.parse(fact.occurredAt)<=this.now(),'future_event',422);
    requireThat(fact.outcome==='purchase'?fact.revenue && fact.refundTreatment==='gross_before_refunds':fact.revenue===null && fact.refundTreatment===null,'purchase_receipt_required',422);
    // Resolve potential setup authority before acquiring any collector/Store lock.
    // Already revoked sessions can retain QA history, but cannot qualify readiness.
    const prepared = input.testId ? await this.store.get<TestRecord>(project,'trackingTest',input.testId) : null;
    let setup = prepared?.session ?? null;
    if (setup) { try { await inspectLiveSessions(this.sessions,[setup]); } catch { setup = null; } }
    const commit = () => this.collectorGuard(c,async()=>{
      if (setup) await inspectLiveSessions(this.sessions,[setup]);
      const record=input.testId?await this.store.get<TestRecord>(project,'trackingTest',input.testId):null;
      if(record)requireThat(record.binding.source.id===c.source.id && record.binding.source.environment===fact.environment && record.binding.source.domain===fact.domain && record.binding.destinationId===fact.destinationId && record.binding.outcome===fact.outcome,'tracking_receipt_mismatch',422);
      // Test classification is derived from the verified source record, forever.
      const qa=!!record || fact.qa || c.source.environment==='test';
      const identity=digest([c.source.id,fact.sourceReceipt]), previous=(await this.store.list<{id:string;digest:string;event:FirstPartyEvent;diagnostic:TrackingDiagnostic|null}>(project,'trackingReceipt')).find(r=>r.id===identity);
      const hash=digest(fact);if(previous) {requireThat(previous.digest===hash,'source_event_payload_conflict');return {eventRef:previous.event.id,deduplicated:true,diagnostic:previous.diagnostic};}
      let eligible=false;
      if(setup && record && !record.test.cancelledAt && Date.parse(record.test.expiresAt)>this.now() && Date.parse(fact.occurredAt)>=Date.parse(record.test.createdAt)) {
        try {await this.exact(project,record.binding);await inspectLiveSessions(this.sessions,[record.session]);eligible=!!this.options.sources?.inspectAccess && await this.options.sources.inspectAccess(record.session,c.source) && digest(record.binding.source)===digest(c.source);} catch {eligible=false;}
      }
      const event=await this.ingest(project,{id:fact.eventId,kind:TRACKING_OUTCOMES[fact.outcome].kind,sourceId:c.source.id,purpose:TRACKING_OUTCOMES[fact.outcome].purpose,personId:fact.personId,occurredAt:fact.occurredAt,consentReceipt:fact.consent.receipt,sourceReceipt:fact.sourceReceipt,clickId:fact.clickId,revenue:fact.revenue,test:qa,productionMetricsExcluded:qa});
      const diagnostic:TrackingDiagnostic|null=record?{id:identity,testId:record.test.id,eventRef:event.id,occurredAt:event.occurredAt,receivedAt:new Date(this.now()).toISOString(),consentBasis:fact.consent.basis,qaExcluded:true,eligibleAtReceipt:eligible,localReceipt:'accepted',providerDelivery:'unavailable',matching:'unavailable',attribution:{campaignId:event.campaignId,rule:'last-paid-click-7d-v1',source:'first-party',windowDays:7}}:null;
      await this.store.put(project,'trackingReceipt',identity,{id:identity,digest:hash,event,diagnostic,completionEvidenceDigest:digest(fact.completionReceipt),collectorId:c.id,collectorRevision:c.revision,receivedAt:new Date(this.now()).toISOString()});
      if(diagnostic)await this.store.put(project,'trackingDiagnostic',identity,diagnostic);
      if (setup) await inspectLiveSessions(this.sessions,[setup]);
      return {eventRef:event.id,deduplicated:false,diagnostic};
    });
    return setup ? this.sessions.withLiveSessions([setup],commit) : commit();
  }
  async attestCoverage(request: Request, input: { checkpoint: string }): Promise<ValidatedCoverage> {
    keys(input,['checkpoint']);text(input.checkpoint,200);const c=await this.collectorContext(request,'coverage'), fact=await this.options.collector!.verifyCheckpoint(c,input.checkpoint);
    keys(fact,['id','campaignId','from','until','purpose','sourceRevision','provenance','complete']);
    instant(fact.from);instant(fact.until);text(fact.provenance,500);
    requireThat(fact.id===input.checkpoint && fact.complete===true && fact.sourceRevision===c.source.revision && c.source.environment==='production' && Date.parse(fact.from)<Date.parse(fact.until) && Date.parse(fact.until)<=this.now(),'invalid_completeness_checkpoint',422);
    requireThat(Object.values(TRACKING_OUTCOMES).filter(o=>o.purpose===fact.purpose).every(o=>c.source.outcomes.some(key=>TRACKING_OUTCOMES[key].kind===o.kind)),'purpose_collection_capabilities_incomplete');
    return this.collectorGuard(c,async()=>{
      const universe = await this.universe(c.source.projectId);
      const relevant = universe.sources.filter(s => s.active && s.outcomes.some(o => TRACKING_OUTCOMES[o].purpose === fact.purpose));
      requireThat(relevant.length === 1 && digest(relevant[0]) === digest(c.source), 'multi_source_completeness_unsupported');
      const binding=await this.binding(c.source.projectId,{kind:'campaign',id:fact.campaignId});requireThat(binding && binding.source.id===c.source.id && digest(binding.source)===digest(c.source) && binding.purpose===fact.purpose,'coverage_binding_mismatch');await this.exact(c.source.projectId,binding);
      const record:ValidatedCoverage={id:digest([c.source.id,fact.id]),version:1,campaignId:fact.campaignId,sourceId:c.source.id,sourceRevision:c.source.revision,bindingId:binding.id,bindingRevision:binding.revision,materialDigest:binding.materialDigest,from:fact.from,until:fact.until,purpose:fact.purpose,checkpoint:fact.id,provenance:fact.provenance,receivedAt:new Date(this.now()).toISOString(),collectorId:c.id,collectorRevision:c.revision};
      record.sourceUniverseDigest = universe.hash;
      const previous=(await this.store.list<ValidatedCoverage>(c.source.projectId,'validatedCoverage')).find(r=>r.id===record.id);
      if(previous){requireThat(digest({...previous,receivedAt:null})===digest({...record,receivedAt:null}),'checkpoint_payload_conflict');return previous;}
      await this.store.put(c.source.projectId,'validatedCoverage',record.id,record);return record;
    });
  }
}

/** Mount separately from browser commands. Bounded JSON carries references, never trusted flags; host auth is resolved
 * independently by the server-only acceptance methods. */
export async function handleTrackingCollector(tracking: MarketingTracking, request: Request, operation: 'receipt' | 'coverage'): Promise<Response> {
  requireThat(request.method==='POST','method_not_allowed',405);requireThat(request.headers.get('content-type')==='application/json','json_required',415);
  const reader=request.body?.getReader();requireThat(reader,'body_required',422);const chunks:Uint8Array[]=[];let size=0,expired=false;
  const timer=setTimeout(()=>{expired=true;void reader.cancel();},5000);
  try {for(;;){const r=await reader.read();requireThat(!expired,'collector_body_timeout',408);if(r.done)break;size+=r.value.length;requireThat(size<=2048,'collector_body_limit',413);chunks.push(r.value);}}finally{clearTimeout(timer);await reader.cancel();reader.releaseLock();}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{requireThat(false,'invalid_json',422);}
  const result=operation==='receipt'?await tracking.acceptReceipt(request,input):await tracking.attestCoverage(request,input);
  return Response.json(result,{headers:{'cache-control':'private, no-store'}});
}
