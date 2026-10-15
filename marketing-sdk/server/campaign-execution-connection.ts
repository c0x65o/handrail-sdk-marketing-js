import {materialCurrency, capabilityBlockers, type Campaign, type Grant, type Operation} from '../core/index.js';
import {Store, digest, id, requireThat, type Principal} from './store.js';
import {sessionExpiryBound,sessionBinding, assertSessionInspection, type SessionAuthority, type SessionInspection} from './session-authority.js';
import {keys, text, instant, material} from './validation.js';

export interface CampaignExecutionConnectionInput {
  campaignId: string; expectedRevision: number; expectedGrantRevision: number; requestKey: string;
}
/** Trusted host input, never a command/HTTP payload. Credentials remain in Vault.
 * This grant permits preparation, reporting and pause only. Activation still
 * requires separately current authority, exact approval and spending checks. */
export interface CampaignExecutionConnectionCandidate {
  grant: Grant; authorityDigest: string; receiptReferences: string[];
}
export interface CampaignExecutionConnectionScope {
  campaign: Campaign; planningGrant: Grant; candidate: CampaignExecutionConnectionCandidate;
}
export interface CampaignExecutionConnectionAuthority {
  /** Hold current native identity, permission, budget and custody guards through
   * local commit. Verify the exact scope before and after local. Do not perform
   * provider I/O here. The callback must accept the SDK's exact grant/revision
   * transition while rejecting material changes or revoked native authority.
   * A host login, old policy snapshot or imported approval is insufficient. */
  withBinding<T>(principal: Principal, scope: CampaignExecutionConnectionScope, local: () => Promise<T>): Promise<T>;
}
export interface CampaignExecutionConnectionReceipt {
  id: string; projectId: string; campaignId: string; actorId: string;
  previousRevision: number; revision: number; planningGrantId: string; planningGrantRevision: number;
  grantId: string; grantRevision: number; grantDigest: string; materialDigest: string;
  authorityDigest: string; receiptReferences: string[]; boundAt: string;
  providerEffectsPerformed: false; activationAuthorized: false;
}
export interface CampaignExecutionConnectionResult { receipt: CampaignExecutionConnectionReceipt; campaign: Campaign; }
interface SavedBinding { id: string; payloadDigest: string; result: CampaignExecutionConnectionResult; }

/** Local, atomic binding of one Studio campaign to its own host-qualified grant.
 * Never changes an account, upgrades a shared planning grant, adopts existing
 * ads, recreates a campaign, approves material, or contacts a provider. */
export class CampaignExecutionConnections {
  constructor(readonly store: Store, readonly sessions: SessionAuthority,
    readonly authority: CampaignExecutionConnectionAuthority) {}
  private async inspection(p: Principal, project: string) {
    const binding=sessionBinding(p), session=await this.sessions.inspectSession(binding,project);
    assertSessionInspection(session,binding,project);
    requireThat(['admin','editor'].includes(session.role),'forbidden',403);
    return session;
  }
  private async guarded<T>(p: Principal, project: string, session: SessionInspection, local:()=>Promise<T>) {
    return this.sessions.withLiveSessions([session],()=>this.store.transaction(async()=>{
      await this.store.authorize(p,project,['admin','editor']);
      requireThat(digest(await this.inspection(p,project))===digest(session),'session_authority_changed',401);
      const result=await local();
      requireThat(digest(await this.inspection(p,project))===digest(session),'session_authority_changed',401);
      return result;
    }));
  }
  private async saved(project: string, requestId: string) {
    const rows=await this.store.db.prepare('SELECT body FROM records WHERE project_id=? AND kind=? AND id=?')
      .get(project,'campaignExecutionConnectionRequest',requestId);
    return rows?JSON.parse(String(rows.body)) as SavedBinding:null;
  }
  /** Inspect an uncertain commit before opening credentials or retrying. The
   * result is the original receipt/snapshot, not a claim of current authority. */
  async readRequest(p: Principal, project: string, requestKey: string): Promise<CampaignExecutionConnectionResult|null> {
    text(requestKey,160);const session=await this.inspection(p,project);
    return this.guarded(p,project,session,async()=>
      (await this.saved(project,digest([p.userId,requestKey])))?.result??null);
  }
  async bind(p: Principal, project: string, input: CampaignExecutionConnectionInput,
    candidate: CampaignExecutionConnectionCandidate): Promise<CampaignExecutionConnectionResult> {
    keys(input,['campaignId','expectedRevision','expectedGrantRevision','requestKey']);
    text(input.campaignId);text(input.requestKey,160);
    requireThat(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>0&&
      Number.isSafeInteger(input.expectedGrantRevision)&&input.expectedGrantRevision>0,'invalid_revision',422);
    keys(candidate,['grant','authorityDigest','receiptReferences']);text(candidate.authorityDigest,500);
    requireThat(Array.isArray(candidate.receiptReferences)&&candidate.receiptReferences.length>0&&candidate.receiptReferences.length<=100,'authority_receipt_required');
    candidate.receiptReferences.forEach(ref=>text(ref,500));
    const trusted=structuredClone(candidate),g=trusted.grant;
    keys(g,['id','projectId','revision','provider','accountId','label','currency','timezone','permissions','expiresAt','revokedAt',
      'secretRef','campaignId','pageId','instagramUserId','organizationId','targetingOptions','capabilityEvidence','selectionOptions']);
    for(const value of [g.id,g.projectId,g.accountId,g.label,g.currency,g.timezone,g.secretRef])text(value,500);
    instant(g.expiresAt);
    requireThat(g.projectId===project&&g.campaignId===input.campaignId&&g.revision===1&&g.revokedAt===null&&['meta','linkedin'].includes(g.provider)&&
      Array.isArray(g.permissions)&&digest([...g.permissions].sort())===digest(['pause','prepare','report']),
      'invalid_campaign_execution_grant');
    const requestId=digest([p.userId,input.requestKey]),payloadDigest=digest({input,candidate:trusted});
    const session=await this.inspection(p,project);
    const replay=await this.guarded(p,project,session,()=>this.saved(project,requestId));
    if(replay){requireThat(replay.payloadDigest===payloadDigest,'request_key_payload_conflict');return replay.result;}
    const c=await this.store.get<Campaign>(project,'campaign',input.campaignId);
    const planning=await this.store.get<Grant>(project,'grant',c.grantId);
    const scope={campaign:structuredClone(c),planningGrant:structuredClone(planning),candidate:structuredClone(trusted)};
    const scopeDigest=digest(scope);
    return this.authority.withBinding(p,scope,()=>this.guarded(p,project,session,async()=>{
      requireThat(digest(scope)===scopeDigest,'binding_scope_changed');
      const existing=await this.saved(project,requestId);
      if(existing){requireThat(existing.payloadDigest===payloadDigest,'request_key_payload_conflict');return existing.result;}
      requireThat(digest(await this.store.get(project,'campaign',c.id))===digest(c)&&c.revision===input.expectedRevision,'revision_conflict');
      requireThat(c.id===input.campaignId&&c.projectId===project&&c.state==='draft'&&!c.receipt&&!c.preparedMaterial&&
        c.draftOrigin&&!c.adoptionOrigin,'unpublished_studio_campaign_required');
      const lifecycle=await this.store.list<{id:string;lifecycle:string}>(project,'campaignLifecycle');
      requireThat(!lifecycle.some(row=>row.id===c.id&&row.lifecycle!=='active'),'campaign_archived');
      requireThat(digest(await this.store.get(project,'grant',planning.id))===digest(planning)&&planning.revision===input.expectedGrantRevision&&
        planning.projectId===project&&!planning.campaignId&&!planning.revokedAt&&Date.parse(planning.expiresAt)>Date.now()&&planning.permissions.length===0,
        'planning_grant_changed');
      requireThat(g.id!==planning.id&&g.secretRef!==planning.secretRef&&Date.parse(g.expiresAt)>Date.now()&&Date.parse(g.expiresAt)<=sessionExpiryBound(session),
        'invalid_campaign_execution_grant');
      requireThat(['provider','accountId','currency','timezone','pageId','instagramUserId','organizationId'].every(key=>
        (g[key as keyof Grant]??null)===(planning[key as keyof Grant]??null))&&c.draftOrigin.accountId===g.accountId,
        'account_change_requires_new_campaign');
      requireThat(!(await this.store.list<Operation>(project,'operation')).some(o=>o.campaignId===c.id),
        'existing_operation_requires_reconciliation');
      requireThat(!(await this.store.db.prepare('SELECT 1 AS present FROM records WHERE project_id=? AND kind=? AND id=?').get(project,'grant',g.id)),
        'execution_grant_already_exists');
      material(c.material,g.provider);
      requireThat(materialCurrency(c.material)===g.currency&&c.material.timezone===g.timezone,'account_currency_or_timezone_mismatch');
      const blockers=capabilityBlockers(c.material,g);requireThat(!blockers.length,blockers[0]??'unsupported_capability');
      const next={...c,revision:c.revision+1,grantId:g.id};
      requireThat(!(await this.store.db.prepare('SELECT 1 AS present FROM records WHERE project_id=? AND kind=? AND id=?').get(project,'campaignVersion',`${c.id}:${next.revision}`)),
        'campaign_version_already_exists');
      const receipt:CampaignExecutionConnectionReceipt={id:id(),projectId:project,campaignId:c.id,actorId:p.userId,
        previousRevision:c.revision,revision:next.revision,planningGrantId:planning.id,planningGrantRevision:planning.revision,
        grantId:g.id,grantRevision:g.revision,grantDigest:digest(g),materialDigest:digest(c.material),
        authorityDigest:trusted.authorityDigest,receiptReferences:[...trusted.receiptReferences],boundAt:new Date().toISOString(),
        providerEffectsPerformed:false,activationAuthorized:false};
      const result={receipt,campaign:next};
      await this.store.put(project,'grant',g.id,g);
      await this.store.put(project,'campaign',c.id,next,c.revision);
      await this.store.put(project,'campaignVersion',`${c.id}:${next.revision}`,next);
      await this.store.put(project,'campaignExecutionConnection',receipt.id,receipt);
      await this.store.put(project,'campaignExecutionConnectionRequest',requestId,{id:requestId,payloadDigest,result} satisfies SavedBinding);
      await this.store.append(project,c.id,'campaign.execution_connection_bound',{receiptId:receipt.id,revision:next.revision,grantId:g.id});
      return result;
    }));
  }
}
