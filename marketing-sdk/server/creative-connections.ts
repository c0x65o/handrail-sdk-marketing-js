import type { CreativeConnectionStatus, CreativeProvider, GenerationGrant } from "../core/index.js";
import { Store, DomainError, digest, id, requireThat, type Principal } from "./store.js";
import { EncryptedCredentialCustody } from "./credential-custody.js";
import type { BillingPort } from "./ports.js";
import { createStoreSessionAuthority, sessionBinding, assertSessionInspection, inspectLiveSessions, type SessionAuthority, type SessionInspection } from "./session-authority.js";
import { privateMutationHeaders, scriptJson, type PrivateMutationHeaders } from "./handoff-http.js";
import { randomBytes } from "node:crypto";

export interface CreativeAccessPolicy {
  revision: string; environment: string; appLabel: string; models: string[];
  maxDurationSeconds: number;
  /** Independent existing grant-maker authority. Empty permits configuration only. */
  grantIds: string[];
}
export interface CreativeConnectionsOptions {
  /** Explicit independent text setup. Omitted preserves image/video behavior. */
  purpose?: "text";
  store: Store; environment: string; custody: EncryptedCredentialCustody; billing?: BillingPort;
  accessPolicy(principal: Principal, project: string, provider: CreativeProvider): Promise<CreativeAccessPolicy | null>;
  sessionAuthority?: SessionAuthority;
}
interface Intent {
  id: string; revision: number; projectId: string; provider: CreativeProvider;
  actor: Principal; session: string; authority: string; configuration: string;
  inspection?: SessionInspection;
  policy: CreativeAccessPolicy; model: string; grantId: string | null; grantDigest: string | null;
  sourceId: string | null; sourceRevision: number | null; secretRef: string;
  createdAt: string; expiresAt: string; reviewExpiresAt: string;
  state: "review" | "configured" | "cancelled" | "revoked";
  reviewDigest: string; startDigest: string; approvedRevision?: number;
}
const purpose = (provider: CreativeProvider) => provider === "openai" ? "image" : "video";
const grantHash = ({ usedJobs: _used, ...g }: GenerationGrant) => digest(g);
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${escape(value)}">`;
const choices = (name: string, label: string, options: { value: string; label: string }[]) =>
  `<fieldset><legend>${escape(label)}</legend>${options.map((option, index) => `<label class="choice"><input type="radio" name="${name}" value="${escape(option.value)}"${index === 0 ? " checked" : ""}><span>${escape(option.label)}</span></label>`).join("")}</fieldset>`;
const rootPath = (project: string, provider: CreativeProvider) => `/api/projects/${encodeURIComponent(project)}/creative/${provider}`;

/** Manual server-rendered secure entry atop the existing custody/session/SQL boundary.
 * No provider transport is present. Never mount behind body-capturing logs or analytics. */
export class CreativeConnections {
  readonly store: Store;
  readonly sessionAuthority: SessionAuthority;
  constructor(readonly options: CreativeConnectionsOptions) {
    requireThat(typeof options.environment === "string" && options.environment.length > 0, "creative_environment_required");
    this.store = options.store;
    this.sessionAuthority = options.sessionAuthority ?? createStoreSessionAuthority(this.store);
    requireThat(options.custody.store === this.store, "creative_custody_store_mismatch");
  }
  private get recordKind() { return this.options.purpose === "text" ? "textCreativeConnection" : "creativeConnection"; }
  private rootPath(project: string, provider: CreativeProvider) { return this.options.purpose === "text" ? `/api/projects/${encodeURIComponent(project)}/text-creative/${provider}` : rootPath(project, provider); }
  private purpose(provider: CreativeProvider) { return this.options.purpose === "text" ? "text" as const : purpose(provider); }
  /** Server-only bridge for separately granted text permission. Setup consent
   * merely permits private retention; this method grants no request or spend. */
  async textBinding(p: Principal, project: string, connectionId: string) {
    requireThat(this.options.purpose === 'text', 'text_setup_required');
    const c = await this.store.get<Intent>(project, this.recordKind, connectionId);
    await this.guard(p, c); requireThat(c.state === 'configured', 'text_credential_setup_required');
    const source = await this.source(c);
    return { id:c.id, revision:String(c.revision), provider:c.provider, model:c.model, environment:c.policy.environment,
      configurationRevision:c.policy.revision, expiresAt:c.expiresAt, custodyRef:source.secretRef,
      credentialRevision:digest([source.id,source.revision,c.sourceRevision]), session:c.inspection! };
  }
  private async auth(p: Principal, project: string) {
    await this.store.authorize(p, project, ["admin", "editor"], true);
    const binding = sessionBinding(p);
    const inspection = await this.sessionAuthority.inspectSession(binding, project);
    assertSessionInspection(inspection, binding, project);
    requireThat(inspection.kind === "human" && ["admin", "editor"].includes(inspection.role), "forbidden", 403);
    await this.store.authorize(p, project, ["admin", "editor"], true);
    return { session: binding.sessionRef, authority: digest(inspection), inspection };
  }
  /** Host guard first, then SDK transaction. Only bounded local policy/SQL here. */
  private async transition<T>(expected: SessionInspection[], local: () => Promise<T>) {
    return this.sessionAuthority.withLiveSessions(expected, () => this.store.transaction(async () => {
      await inspectLiveSessions(this.sessionAuthority, expected);
      const result = await local();
      await inspectLiveSessions(this.sessionAuthority, expected);
      return result;
    }));
  }

  private async setupSessions(current: SessionInspection, project: string, sourceId: string | null) {
    if (!sourceId) return [current];
    const source = await this.store.get<Intent>(project, this.recordKind, sourceId);
    requireThat(source.inspection, "creative_session_provenance_required", 401);
    // Reuse can be approved from a newer session while the original binding is
    // still live. Both session writers must be fenced during the local commit.
    return [current, source.inspection];
  }
  private async context(p: Principal, project: string, provider: CreativeProvider, recovery = false) {
    const before = await this.auth(p, project);
    let policy = await this.options.accessPolicy(p, project, provider);
    const after = await this.auth(p, project);
    requireThat(digest(before) === digest(after), "creative_authority_changed", 403);
    if (!policy && recovery) return { ...after, configuration: digest([this.options.environment, null]), policy: {
      revision: "unavailable", environment: this.options.environment, appLabel: "Creative Connections", models: [], maxDurationSeconds: 0, grantIds: [],
    } as CreativeAccessPolicy };
    requireThat(policy && policy.environment === this.options.environment && typeof policy.revision === "string" && policy.revision.length > 0 && typeof policy.appLabel === "string" && policy.appLabel.length > 0 && Array.isArray(policy.grantIds) && policy.grantIds.every(g => typeof g === "string" && g.length > 0) && Array.isArray(policy.models) && policy.models.length && policy.models.every(m => typeof m === "string" && m.length > 0 && m.length < 200) && Number.isSafeInteger(policy.maxDurationSeconds) && policy.maxDurationSeconds > 0, "creative_policy_unavailable");
    return { ...after, policy: structuredClone(policy), configuration: digest(policy) };
  }
  private async grant(c: Intent) {
    if (this.options.purpose === "text") { requireThat(!c.grantId, "media_grant_cannot_authorize_text"); return null; }
    if (!c.grantId) return null;
    requireThat(c.policy.grantIds.includes(c.grantId), "creative_grant_unavailable");
    const g = await this.store.get<GenerationGrant>(c.projectId, "generationGrant", c.grantId);
    requireThat(g.id === c.grantId && g.projectId === c.projectId && g.provider === c.provider && g.model === c.model && g.kind === this.purpose(c.provider) && !g.revokedAt && Date.parse(g.expiresAt) >= Date.parse(c.expiresAt) && Date.parse(g.expiresAt) > Date.now() && (!c.grantDigest || grantHash(g) === c.grantDigest), "creative_grant_unavailable");
    return g;
  }
  private async source(c: Intent) {
    if (!c.sourceId) return c;
    const s = await this.store.get<Intent>(c.projectId, this.recordKind, c.sourceId);
    requireThat(s.projectId === c.projectId && !s.sourceId && s.state === "configured" && s.revision === c.sourceRevision && s.actor.userId === c.actor.userId && s.provider === c.provider && s.model === c.model && s.configuration === c.configuration && s.policy.environment === c.policy.environment && Date.parse(s.expiresAt) >= Date.parse(c.expiresAt) && Date.parse(s.expiresAt) > Date.now(), "creative_source_unavailable");
    // A reusable source is still subject to its original session and independent grant.
    const current = await this.context(s.actor, s.projectId, s.provider);
    requireThat(current.session === s.session && current.authority === s.authority && current.configuration === s.configuration, "creative_source_unavailable");
    await this.grant(s);
    requireThat(await this.options.custody.inspect(c.projectId, s.secretRef), "creative_source_unavailable");
    requireThat((await this.store.get<Intent>(s.projectId, this.recordKind, s.id)).revision === s.revision, "creative_source_unavailable");
    // Custody and SQL reads yield independently of the host authority. Recheck
    // the SOURCE session too, including the final status/credential-use guard.
    const after = await this.context(s.actor, s.projectId, s.provider);
    requireThat(digest(after) === digest(current), "creative_source_unavailable");
    return s;
  }
  private async guard(p: Principal, c: Intent, allowClosed = false) {
    const ctx = await this.context(p, c.projectId, c.provider);
    requireThat(c.inspection, "creative_session_provenance_required", 401);
    await inspectLiveSessions(this.sessionAuthority, [c.inspection]);
    requireThat(p.userId === c.actor.userId && ctx.session === c.session && ctx.authority === c.authority, "creative_session_changed", 401);
    requireThat(ctx.configuration === c.configuration, "creative_configuration_changed");
    if (!allowClosed) {
      requireThat(!["cancelled", "revoked"].includes(c.state) && Date.parse(c.expiresAt) > Date.now(), "creative_access_expired_or_revoked");
      await this.source(c); await this.grant(c);
    }
    const after = await this.context(p, c.projectId, c.provider);
    requireThat(after.configuration === c.configuration, "creative_configuration_changed");
    if (!allowClosed) {
      await this.grant(c);
      if (c.sourceId) { const source = await this.store.get<Intent>(c.projectId, this.recordKind, c.sourceId); requireThat(source.revision === c.sourceRevision && source.state === "configured", "creative_source_unavailable"); await this.grant(source); }
    }
    const finalAuth = await this.auth(p, c.projectId);
    requireThat(finalAuth.session === ctx.session && finalAuth.authority === ctx.authority && after.session === ctx.session && after.authority === ctx.authority, "creative_authority_changed", 403);
    const latest = await this.store.get<Intent>(c.projectId, this.recordKind, c.id);
    requireThat(latest.revision === c.revision, "revision_conflict");
    if (!allowClosed) requireThat(Date.parse(c.expiresAt) > Date.now(), "creative_access_expired_or_revoked");
  }
  private async save(c: Intent) {
    const previous = c.revision++;
    await this.store.put(c.projectId, this.recordKind, c.id, c, previous);
    await this.store.append(c.projectId, c.id, "creative.connection.changed", { id: c.id, revision: c.revision, state: c.state });
  }
  /** Safe status reads do not decrypt, write records, reserve or contact a provider. */
  async inspect(p: Principal, project: string, connectionId: string): Promise<CreativeConnectionStatus> {
    const auth = await this.auth(p, project);
    const c = await this.store.get<Intent>(project, this.recordKind, connectionId);
    requireThat(c.actor.userId === p.userId && c.policy.environment === this.options.environment, "forbidden", 403);
    let valid = true, billing: CreativeConnectionStatus["billing"] = { state: "unavailable" };
    try {
      await this.guard(p, c);
      const g = await this.grant(c);
      if (g && this.options.billing?.inspect) {
        const b = await this.options.billing.inspect(g);
        // Explicit projection: custom billing adapters cannot leak credentials into status.
        if (b.state === "configured" && typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency) && Number.isSafeInteger(b.maxUnitMinor) && b.maxUnitMinor! > 0 && typeof b.expiresAt === "string" && Date.parse(b.expiresAt) > Date.now())
          billing = { state: "configured", currency: b.currency, maxUnitMinor: b.maxUnitMinor, expiresAt: b.expiresAt };
      }
      const source = await this.source(c);
      valid = c.state === "configured" && await this.options.custody.inspect(project, source.secretRef);
      await this.guard(p, c);
    } catch { valid = false; billing = { state: "unavailable" }; }
    const root = c.sourceId ? await this.store.get<Intent>(project, this.recordKind, c.sourceId) : c;
    const credentialStored = await this.options.custody.inspect(project, root.secretRef);
    const custodyUncertain = c.state === "review" && (await this.store.list<{ id: string }>(project, "creativeCustodyAttempt")).some(a => a.id === c.id);
    let generationAuthority: CreativeConnectionStatus["generationAuthority"] = "missing";
    if (c.grantId) {
      generationAuthority = "unavailable";
      try { const g = await this.store.get<GenerationGrant>(project, "generationGrant", c.grantId);
        generationAuthority = g.revokedAt ? "revoked" : Date.parse(g.expiresAt) <= Date.now() ? "expired" : grantHash(g) === c.grantDigest ? "configured" : "unavailable";
      } catch { /* A removed independent grant is unavailable, never silently replaced. */ }
    }
    const finalAuth = await this.auth(p, project);
    requireThat(digest(auth) === digest(finalAuth), "creative_authority_changed", 403);
    const latest = await this.store.get<Intent>(project, this.recordKind, c.id);
    requireThat(latest.revision === c.revision, "revision_conflict");
    // Retention inspection and grant reads also yield. Do not return earlier
    // availability after a source, policy or independent authority changed.
    try { await this.guard(p, c); } catch { valid = false; billing = { state: "unavailable" }; }
    requireThat(digest(auth) === digest(await this.auth(p, project)), "creative_authority_changed", 403);
    if (!valid && generationAuthority === "configured") generationAuthority = "unavailable";
    const credential = c.state === "revoked" || c.state === "cancelled" ? "revoked" : (Date.parse(c.expiresAt) <= Date.now() || (c.state === "review" && Date.parse(c.reviewExpiresAt) <= Date.now())) ? "expired" : valid ? "configured" : custodyUncertain ? "unavailable" : c.state === "review" ? "missing" : "unavailable";
    return { id: c.id, revision: c.revision, projectId: project, environment: c.policy.environment, provider: c.provider, purpose: this.purpose(c.provider), model: c.model, configurationRevision: c.policy.revision, expiresAt: c.expiresAt, grantId: c.grantId,
      credential, credentialStored, generationAuthority, providerVerification: "unverified", billing, paidOperation: "blocked",
      reasons: [custodyUncertain ? "A credential save is unconfirmed. Retained ciphertext is fenced; cancel this setup and start a fresh review. Do not resubmit the old key request." : credential === "configured" ? "Credential stored locally; provider validity and model entitlement have not been checked." : credential === "missing" ? "Complete the exact access review below, then securely enter an existing key or approve the selected binding." : credential === "expired" ? c.state === "review" ? "This access review expired. Cancel the saved setup and start a fresh exact review." : "Local access expired. Disconnect the old binding and reconnect with a fresh exact review." : credential === "revoked" ? "This local binding is revoked. Reconnect requires fresh exact consent." : "Session, configuration, source binding or independent grant access changed. Review those requirements, then disconnect and reconnect if needed.",
        c.grantId ? `Generation authority is ${generationAuthority}. Paid generation still requires current independent grant, exact job and billing authorization.` : "An authorized permission owner must supply separate purpose-specific request authority before paid use.",
        billing.state === "configured" ? "Billing metadata is configured; no cost has been reserved." : "Bind an existing current billing capability and quote through the billing owner.",
        ...(c.provider === "xai" ? ["xAI video is Studio generation, not X Ads or supported video-ad publishing."] : [])], path: `${this.rootPath(project, c.provider)}/${c.id}` };
  }
  async catalogue(p: Principal, project: string, provider: CreativeProvider) {
    const ctx = await this.context(p, project, provider, true);
    const records = (await this.store.list<Intent>(project, this.recordKind)).filter(c => c.provider === provider && c.actor.userId === p.userId && c.policy.environment === ctx.policy.environment);
    const bindings: CreativeConnectionStatus[] = [];
    for (const c of records) bindings.push(await this.inspect(p, project, c.id));
    const after = await this.context(p, project, provider, true);
    requireThat(digest(ctx) === digest(after), "creative_configuration_changed");
    return { path: this.rootPath(project, provider), bindings, configured: ctx.policy.models.length > 0 };
  }
  private async binding(provider: CreativeProvider, project: string, grantId?: string) {
    requireThat(grantId, "creative_generation_grant_required");
    const all = (await this.store.list<Intent>(project, this.recordKind)).filter(c => c.provider === provider && c.policy.environment === this.options.environment && c.grantId === grantId && c.state === "configured" && Date.parse(c.expiresAt) > Date.now());
    requireThat(all.length === 1, "creative_credential_binding_ambiguous");
    const c = all[0]!; await this.guard(c.actor, c); return c;
  }
  /** Recheck at the executor's last pre-transport boundary, after other awaited
   * authorization hooks. Never returns or decrypts the retained key. */
  async assertCredentialAccess(provider: CreativeProvider, project: string, grantId: string) {
    const c = await this.binding(provider, project, grantId), source = await this.source(c);
    requireThat(await this.options.custody.inspect(project, source.secretRef), "creative_credential_unavailable");
    await this.guard(c.actor, c);
  }
  /** Wire into NativeGeneration.credentials. Exact current grant required; no fallback key.
   * Persistent configuration stays subject to original current human session/policy. */
  async credentials(provider: CreativeProvider, project: string, grantId?: string): Promise<string> {
    const c = await this.binding(provider, project, grantId);
    const source = await this.source(c);
    const value = await this.options.custody.read<{ apiKey: string }>(project, source.secretRef);
    await this.guard(c.actor, c);
    requireThat(typeof value.apiKey === "string" && value.apiKey.length > 0, "creative_credential_unavailable");
    return value.apiKey;
  }
  private async start(p: Principal, project: string, provider: CreativeProvider, form: URLSearchParams) {
    const ctx = await this.context(p, project, provider);
    const model = form.get("model")!, expiresAt = form.get("expiresAt")!;
    const sourceId = form.get("sourceId") || null, grantId = form.get("grantId") || null;
    requireThat(this.options.purpose !== "text" || !grantId, "media_grant_cannot_authorize_text");
    const requestKey = form.get("requestKey"); requireThat(requestKey && /^[a-zA-Z0-9-]{16,100}$/.test(requestKey), "creative_request_key_required");
    requireThat(ctx.policy.models.includes(model) && Date.parse(expiresAt) > Date.now() && Date.parse(expiresAt) <= Date.now() + ctx.policy.maxDurationSeconds * 1000, "creative_scope_denied");
    const key = digest([p.userId, ctx.session, ctx.policy.environment, provider, requestKey, ...(this.options.purpose === "text" ? ["text"] : [])]);
    const startDigest = digest([ctx.configuration, model, sourceId, grantId, expiresAt]);
    const expectedSessions = await this.setupSessions(ctx.inspection, project, sourceId);
    return this.transition(expectedSessions, async () => {
      const rows = await this.store.list<Intent>(project, this.recordKind);
      const old = rows.find(c => c.id === key);
      if (old) { requireThat(old.startDigest === startDigest, "request_key_payload_conflict"); await this.guard(p, old, true); return old; }
      requireThat(!rows.some(c => c.actor.userId === p.userId && c.provider === provider && c.policy.environment === ctx.policy.environment && ["review", "configured"].includes(c.state) && Date.parse(c.expiresAt) > Date.now() && c.model === model && c.grantId === grantId && !(c.state === "configured" && sourceId && !grantId)), "creative_existing_intent_requires_disconnect");
      const now = new Date().toISOString();
      const c: Intent = { id: key, revision: 1, projectId: project, provider, actor: { ...p }, session: ctx.session, authority: ctx.authority, inspection: ctx.inspection, configuration: ctx.configuration, policy: ctx.policy, model, grantId, grantDigest: null, sourceId, sourceRevision: null, secretRef: `creative:${id()}`, createdAt: now, expiresAt, reviewExpiresAt: new Date(Math.min(Date.parse(expiresAt), Date.now() + 600000)).toISOString(), state: "review", reviewDigest: "", startDigest };
      if (sourceId) { const s = await this.store.get<Intent>(project, this.recordKind, sourceId); c.sourceRevision = s.revision; await this.source(c); }
      const g = await this.grant(c); if (g) c.grantDigest = grantHash(g);
      c.reviewDigest = digest([key, ctx, model, sourceId, c.sourceRevision, c.grantDigest, expiresAt, c.reviewExpiresAt]);
      const after = await this.context(p, project, provider); requireThat(digest(ctx) === digest(after), "creative_configuration_changed");
      await this.source(c); await this.grant(c);
      requireThat(Date.parse(c.expiresAt) > Date.now(), "creative_access_expired_or_revoked");
      await this.store.put(project, this.recordKind, key, c);
      await this.guard(p, c);
      return c;
    });
  }
  private async change(p: Principal, project: string, provider: CreativeProvider, cid: string, form: URLSearchParams) {
    const c = await this.store.get<Intent>(project, this.recordKind, cid);
    requireThat(c.provider === provider, "creative_provider_mismatch");
    const action = form.get("action"), expected = Number(form.get("revision"));
    requireThat(["approve", "cancel", "disconnect"].includes(action ?? ""), "creative_action_invalid");
    const ctx = await this.context(p, project, provider, action !== "approve");
    if (action === "approve") {
      const expectedSessions = await this.setupSessions(ctx.inspection, project, c.sourceId);
      const validate = async () => {
        await this.guard(p, c);
        requireThat(form.get("consent") === "approved" && form.get("reviewDigest") === c.reviewDigest, "creative_exact_consent_required");
        if (c.state === "configured" && c.approvedRevision === expected) return;
        requireThat(c.state === "review" && c.revision === expected && Date.parse(c.reviewExpiresAt) > Date.now(), "creative_review_expired_or_changed");
      };
      await validate();
      if (c.state === "configured") return c; // Readback never replaces a retained key.
      if (!c.sourceId) {
        let key = form.get("apiKey");
        requireThat(typeof key === "string" && key.length >= 8 && key.length <= 4096 && !/[\s\x00-\x1f]/.test(key), "creative_key_invalid");
        // Reserve ONE custody attempt before crossing an asynchronous custody boundary.
        // A crash/uncertain acknowledgement leaves the original intent fenced. No
        // overwrite, promotion on retry, ciphertext deletion or automatic replay.
        await this.transition(expectedSessions, async () => {
          await validate();
          const attempts = await this.store.list<{ id: string }>(project, "creativeCustodyAttempt");
          requireThat(!attempts.some(a => a.id === cid), "creative_custody_uncertain");
          await this.store.put(project, "creativeCustodyAttempt", cid, { id: cid, revision: expected });
        });
        try { await this.options.custody.retain(project, c.secretRef, { apiKey: key }); }
        finally { key = null; form.delete("apiKey"); }
      } else requireThat(!form.get("apiKey"), "creative_unexpected_key");
      await validate();
      return this.transition(expectedSessions, async () => {
        await validate();
        c.state = "configured"; c.approvedRevision = expected;
        await this.save(c); return c;
      });
    }
    // A current human owner may revoke local use after replacing a setup session.
    return this.transition([ctx.inspection], async () => {
      requireThat(p.userId === c.actor.userId && ctx.policy.environment === c.policy.environment, "forbidden", 403);
      const latest = await this.store.get<Intent>(project, this.recordKind, cid);
      requireThat(latest.revision === c.revision, "revision_conflict");
      if ((action === "cancel" && c.state === "cancelled") || (action === "disconnect" && c.state === "revoked")) return c;
      requireThat(c.revision === expected && form.get("consent") === "approved" && form.get("reviewDigest") === digest([c.id, c.revision, action, ctx.session, ctx.configuration]), "creative_exact_consent_required");
      requireThat(action === "disconnect" ? c.state === "configured" : c.state === "review", "creative_action_invalid");
      const after = await this.context(p, project, provider, true);
      requireThat(digest(ctx) === digest(after), "creative_authority_changed");
      c.state = action === "cancel" ? "cancelled" : "revoked";
      await this.save(c); return c;
    });
  }
  routes(config: { origin: string; authenticate?(request: Request): Promise<Principal>; returnPath?: string; mutationHeaders?: PrivateMutationHeaders }) {
    const origin = new URL(config.origin);
    requireThat(origin.origin === config.origin && (origin.protocol === "https:" || (origin.protocol === "http:" && origin.hostname === "127.0.0.1")), "creative_origin_invalid");
    const returnPath = config.returnPath ?? "/";
    requireThat(returnPath.startsWith("/") && !returnPath.startsWith("//") && !/[\\\x00-\x20\x7f]/.test(returnPath) && new URL(returnPath, origin).origin === origin.origin, "creative_return_invalid");
    const reasons: Record<string, string> = {
      creative_custody_uncertain: "A previous credential save has an uncertain outcome. Its encrypted data remains retained and fenced. Cancel this setup and start a fresh exact review; do not retry this key submission.",
      creative_existing_intent_requires_disconnect: "A saved intent for this model and generation authority exists. Resume it or explicitly disconnect it before reconnecting.",
      creative_source_unavailable: "The chosen credential source changed, expired or no longer covers this model or duration. Choose a current binding and an earlier expiry, or enter an existing key after a fresh review.",
      creative_grant_unavailable: "The independent grant does not cover this provider, model or duration, or it was changed or revoked. Choose configuration only or ask the grant-maker for current authority.",
      creative_scope_denied: "Choose an allowed model and a future expiry within the displayed policy duration.",
      creative_key_invalid: "The key must contain 8 to 4096 characters without whitespace. Enter the existing key again on the private page.",
      creative_review_expired_or_changed: "This exact review expired or changed. Cancel the saved intent and start a fresh review.",
      creative_policy_unavailable: "A current creative configuration policy is unavailable. Ask the project administrator to restore the existing permission and environment binding.",
    };

    const notices: Record<string, string> = {
      creative_custody_uncertain: "save-uncertain", creative_existing_intent_requires_disconnect: "saved-setup", creative_source_unavailable: "binding-changed",
      creative_grant_unavailable: "grant-changed", creative_scope_denied: "scope-changed",
      creative_key_invalid: "key-format", creative_review_expired_or_changed: "review-expired",
      creative_policy_unavailable: "policy-unavailable",
    };
    return async (request: Request): Promise<Response | null> => {
      const url = new URL(request.url), match = new RegExp(`^/api/projects/([^/]+)/${this.options.purpose === "text" ? "text-creative" : "creative"}/(openai|xai)(?:/([a-f0-9]{64}))?$`).exec(url.pathname);
      if (!match) return null;
      let submissionHeaders: Record<string, string> = {};
      const nonce = randomBytes(24).toString("base64");
      const headers = { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`, "x-content-type-options": "nosniff", "content-type": "text/html; charset=utf-8" };
      const page = (body: string, status = 200) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creative Connections</title><style>body{font:17px/1.5 system-ui;color:#172234;background:#f3f6fa;margin:0}main{max-width:720px;margin:auto;padding:clamp(8px,2vw,24px);overflow-wrap:anywhere}label,select,input,button{display:block;box-sizing:border-box;max-width:100%;font:inherit}label{margin:20px 0}select,input:not([type=checkbox]):not([type=radio]){width:100%;padding:10px}input[type=checkbox],input[type=radio]{display:inline}h1{font-size:clamp(1.4rem,5vw,2rem)}h2{font-size:clamp(1.2rem,4vw,1.5rem)}fieldset{min-width:0;margin:20px 0;border:1px solid #ccd6e0;padding:12px}.choice{display:flex;align-items:flex-start;gap:8px}.choice input{flex:none;margin-top:6px}.choice span{min-width:0}button,a{min-height:44px}button{padding:10px 18px;background:#183f73;color:white;border:0;border-radius:5px;white-space:normal}section{background:white;padding:clamp(8px,2vw,18px);margin:18px 0;border:1px solid #ccd6e0}a{color:#183f73}*:focus-visible{outline:3px solid #b65400;outline-offset:3px}</style><script nonce="${nonce}">${privateFormScript(submissionHeaders)}</script><main><p id="submission-status" role="status"></p><noscript>Enable JavaScript to submit this private setup securely with the host’s required headers.</noscript><a href="${escape(returnPath)}">Back to Connections · save and close</a>${body}</main></html>`, { status, headers });
      const attention = (reason?: string, status = 200) => page(`<h1 tabindex="-1" autofocus>Secure setup needs attention</h1><p>${escape(reason ?? "Your session, access or saved setup may have changed. Return to Connections and reload the original saved intent.")}</p><p>A failed response does not prove that saving failed. Keys are never echoed; do not paste a key into support messages.</p><p><a href="${escape(url.pathname)}">Return to saved setup</a></p>`, status);
      try {
        const notice = url.searchParams.get("notice");
        const safeNotice = request.method === "GET" && [...url.searchParams].length === 1 && notice && [...Object.values(notices), "access-changed"].includes(notice);
        requireThat(url.origin === config.origin && (!url.search || safeNotice) && [null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site")), "creative_origin_denied", 403);
        requireThat(request.method === "GET" || request.method === "POST", "method_not_allowed", 405);
        const p = await (config.authenticate ?? ((r: Request) => this.sessionAuthority.authenticateRequest(r)))(request), project = decodeURIComponent(match[1]!), provider = match[2] as CreativeProvider, cid = match[3];
        if (safeNotice) {
          await this.auth(p, project);
          const code = Object.keys(notices).find(key => notices[key] === notice);
          return attention(code ? reasons[code] : undefined);
        }
        const ctx = await this.context(p, project, provider, request.method === "GET" || !!cid);
        if (request.method === "GET") {
          submissionHeaders = await privateMutationHeaders(config.mutationHeaders, request);
          requireThat(digest(ctx) === digest(await this.context(p, project, provider, true)), "creative_authority_changed");
        }
        if (request.method === "POST") {
          requireThat(request.headers.get("origin") === config.origin && request.headers.get("content-type")?.split(";")[0] === "application/x-www-form-urlencoded", "creative_origin_denied", 403);
          const reader = request.body?.getReader(); let body = "", length = 0;
          if (reader) { const decoder = new TextDecoder(); try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; requireThat(length <= 16384, "body_too_large", 413); body += decoder.decode(part.value, { stream: true }); } body += decoder.decode(); } finally { await reader.cancel(); } }
          const form = new URLSearchParams(body);
          const allowed = cid ? ["action", "revision", "consent", "reviewDigest", "apiKey"] : ["model", "expiresAt", "sourceId", "grantId", "requestKey"];
          requireThat([...form.keys()].every(k => allowed.includes(k) && form.getAll(k).length === 1), "creative_form_invalid");
          const c = cid ? await this.change(p, project, provider, cid, form) : await this.start(p, project, provider, form);
          const location = `${this.rootPath(project, provider)}/${c.id}`;
          if (request.headers.get("x-marketing-private-form") === "1") return Response.json({ location }, { headers: { ...headers, "content-type": "application/json" } });
          return new Response(null, { status: 303, headers: { ...headers, location } });
        }
        const projectRow = await this.store.db.prepare("SELECT name FROM projects WHERE id=?").get(project);
        const title = `<h1 tabindex="-1" autofocus>${this.options.purpose === "text" ? (provider === "openai" ? "OpenAI text" : "xAI text") : provider === "openai" ? "OpenAI images" : "xAI video"} Connections</h1><p>${escape(ctx.policy.appLabel)} · Project: ${escape(projectRow?.name)} · Environment: ${escape(ctx.policy.environment)}</p>`;
        if (!cid) {
          const { bindings } = await this.catalogue(p, project, provider);
          if (!ctx.policy.models.length) return page(`${title}<h2>Configuration policy unavailable</h2><p>The project administrator must restore the existing permission policy before new setup. You can still inspect and disconnect your own saved bindings in this environment.</p>${bindings.map(b => `<section><h2>${escape(b.model)} · ${b.credential}</h2><a href="${b.path}">Manage saved binding</a></section>`).join("")}`);
          const grants = (await this.store.list<GenerationGrant>(project, "generationGrant")).filter(g => this.options.purpose !== "text" && ctx.policy.grantIds.includes(g.id) && g.provider === provider && !g.revokedAt && Date.parse(g.expiresAt) > Date.now());
          // Availability of this session's binding differs from eligibility to
          // approve reuse of a still-live source in another session. Inspect the
          // source's retained authority; the current caller is checked separately.
          const sources: CreativeConnectionStatus[] = [];
          for (const root of await this.store.list<Intent>(project, this.recordKind)) {
            if (root.sourceId || root.actor.userId !== p.userId || root.provider !== provider || root.configuration !== ctx.configuration) continue;
            try {
              const status = await this.inspect(root.actor, project, root.id);
              if (status.credential === "configured") sources.push(status);
            } catch { /* Lost source authority is never offered as reusable. */ }
          }
          const expiryChoices = [...new Set([... [Math.min(900, ctx.policy.maxDurationSeconds), Math.min(3600, ctx.policy.maxDurationSeconds), ctx.policy.maxDurationSeconds].map(s => new Date(Date.now() + s * 1000).toISOString()), ...sources.map(s => s.expiresAt), ...grants.map(g => g.expiresAt)])].filter(e => Date.parse(e) > Date.now() && Date.parse(e) <= Date.now() + ctx.policy.maxDurationSeconds * 1000);
          const after = await this.context(p, project, provider); requireThat(digest(ctx) === digest(after), "creative_configuration_changed");
          return page(`${title}<h2>Requirements</h2><p>Use an existing provider key you are authorized to store, or choose an existing credential binding. Ciphertext persists, but use is limited to the original live session and the chosen expiry. After logout, disconnect the unavailable binding and review fresh secure entry. Model entitlement is unverified. No provider request or paid generation runs during setup.</p>${provider === "xai" ? "<p>xAI video is for Studio generation. It is not X Ads or supported video-ad publishing.</p>" : ""}<p>Separate purpose-specific request permission and billing authority are required for later paid use. Text setup does not borrow image or video grants. Agent installation is optional.</p>${bindings.map(b => `<section><h2>${escape(b.model)} · ${b.credential}</h2><p>Paid operation blocked · Provider unverified</p><a href="${b.path}">Resume or manage saved setup</a></section>`).join("")}<form method="post">${hidden("requestKey", id())}${choices("model", "Model", ctx.policy.models.map(model => ({ value: model, label: model })))}${choices("sourceId", "Credential source", [{ value: "", label: "Enter an existing key" }, ...sources.map(b => ({ value: b.id, label: `${b.model} · ${b.id.slice(0, 8)} · expires ${b.expiresAt}` }))])}${choices("grantId", this.options.purpose === "text" ? "Text setup only · request permission and billing reviewed in Studio" : "Independent generation authority", [{ value: "", label: this.options.purpose === "text" ? "Configure credential only · no text request authorized" : "Configure only · no generation grant" }, ...grants.map(g => ({ value: g.id, label: `${g.model} · ${g.id} · ${g.ceiling.minor} ${g.ceiling.currency}` }))])}${choices("expiresAt", "Local access ends no later than", expiryChoices.map(expiry => ({ value: expiry, label: expiry.replace("T", " ").replace(/\.\d{3}Z$/, " UTC") })))}<button>Review exact local access</button></form>`);
        }
        const c = await this.store.get<Intent>(project, this.recordKind, cid);
        requireThat(c.provider === provider && c.actor.userId === p.userId && c.policy.environment === ctx.policy.environment, "forbidden", 403);
        const status = await this.inspect(p, project, cid);
        const summary = `<section><h2>Exact access</h2><p>Project: ${escape(projectRow?.name)} (${escape(project)})<br>Environment: ${escape(c.policy.environment)}<br>Provider: ${provider} · Purpose: ${this.purpose(provider)}<br>Model: ${escape(c.model)}<br>Configuration revision: ${escape(c.policy.revision)} · Intent revision: ${c.revision}<br>Access expires: ${escape(c.expiresAt)}<br>${this.options.purpose === "text" ? "Text request permission: reviewed separately in Studio" : `Generation authority: ${escape(c.grantId ?? "None — paid use blocked")}`}<br>Credential source: ${c.sourceId ? escape(c.sourceId.slice(0, 8)) : "Existing key via private secure entry"}</p></section>`;
        let controls = "";
        if (c.state === "review") {
          try { await this.guard(p, c);
            requireThat(!(await this.store.list<{ id: string }>(project, "creativeCustodyAttempt")).some(a => a.id === c.id), "creative_custody_uncertain");
            requireThat(Date.parse(c.reviewExpiresAt) > Date.now(), "creative_review_expired_or_changed");
            controls += `<form method="post" autocomplete="off">${hidden("action", "approve")}${hidden("revision", c.revision)}${hidden("reviewDigest", c.reviewDigest)}<h2>Private secure entry and approval</h2><p>This private page uses only the SDK’s isolated submission script and no Marketing telemetry. The existing vault retains encrypted data under its retention policy. Expiry and local disconnect block use; they do not erase retained data. Your original session and project policy must remain current. Reuse also requires both the source session and the approving session. After either session ends, sign in, disconnect the unavailable binding and start a fresh review with secure key entry. Retained ciphertext is not unattended execution authority. Saving a key does not prove provider validity, model entitlement or paid readiness.</p>${!c.sourceId ? '<label>Existing provider API key<input name="apiKey" type="password" autocomplete="off" required minlength="8" maxlength="4096" spellcheck="false"></label>' : ""}<label><input type="checkbox" name="consent" value="approved" required> I approve this exact session-limited local access, including its project, environment, model, authority, revision and expiry.</label><button>Approve and save credential configuration</button></form>`;
          } catch { controls += "<p>This review, authority or credential save changed. Any retained credential remains fenced. Cancel this intent and start a fresh review.</p>"; }
        }
        if (["review", "configured"].includes(c.state)) {
          const action = c.state === "review" ? "cancel" : "disconnect";
          controls += `<section><h2>${action === "cancel" ? "Cancel setup" : "Disconnect local access"}</h2><p>This invalidates this local binding. Encrypted data and history remain under the existing retention policy. It does not revoke the provider account's key, cancel an already submitted job or release a billing reservation. Dependent bindings cannot bypass revocation.</p><form method="post">${hidden("action", action)}${hidden("revision", c.revision)}${hidden("reviewDigest", digest([c.id, c.revision, action, ctx.session, ctx.configuration]))}<label><input type="checkbox" name="consent" value="approved" required> Confirm ${action} for this exact binding and revision.</label><button>${action === "cancel" ? "Cancel saved setup" : "Disconnect this binding"}</button></form></section>`;
        }
        const after = await this.context(p, project, provider, true); requireThat(digest(ctx) === digest(after), "creative_configuration_changed");
        requireThat((await this.store.get<Intent>(project, this.recordKind, cid)).revision === c.revision, "revision_conflict");
        return page(`${title}${summary}<h2>Status: ${status.credential}</h2><p>Credential retained in custody: ${status.credentialStored ? "yes" : "no"} · ${this.options.purpose === "text" ? "Text request permission requires separate Studio review" : `Generation authority ${status.generationAuthority}`}</p><p>Provider unverified · Billing ${status.billing.state} · Paid operation blocked</p><ul>${status.reasons.map(r => `<li>${escape(r)}</li>`).join("")}</ul>${controls}<p><a href="${this.rootPath(project, provider)}">Reconnect or choose another binding</a></p><p><a href="${url.pathname}">Refresh harmless status</a></p>`);
      } catch (e) {

        const reason = e instanceof DomainError ? reasons[e.code] : null;
        if (request.method === "POST" && request.headers.get("x-marketing-private-form") === "1")
          return Response.json({ location: `${url.pathname}?notice=${e instanceof DomainError ? notices[e.code] ?? "access-changed" : "access-changed"}` }, { status: e instanceof DomainError ? e.status : 503, headers: { ...headers, "content-type": "application/json" } });
        // Native form navigation must finish on GET even on validation failure:
        // reload/back must not offer to resubmit a credential-bearing POST.
        // Fetch/API requests have no browser document history and retain error status.
        if (request.method === "POST" && request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("origin") === config.origin)
          return new Response(null, { status: 303, headers: { ...headers, location: `${url.pathname}?notice=${e instanceof DomainError ? notices[e.code] ?? "access-changed" : "access-changed"}` } });
        return attention(reason ?? undefined, e instanceof DomainError ? e.status : 503);
      }
    };
  }
}

/** Only the dedicated private document reads the password field. No core command,
 * React state, storage, telemetry or navigational POST ever receives its value. */
function privateFormScript(headers: Record<string, string>) {
  return `(()=>{'use strict';const headers=${scriptJson(headers)};let busy=false;
const clear=()=>document.querySelectorAll('input[type=password]').forEach(i=>{i.value='';});
addEventListener('pagehide',clear);addEventListener('pageshow',clear);
addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const form=e.target;if(!(form instanceof HTMLFormElement)||!form.reportValidity())return;
busy=true;let body=new URLSearchParams(new FormData(form));clear();const message=document.getElementById('submission-status');message.textContent='Saving exact setup…';
try{const pending=fetch(location.pathname,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{...headers,'content-type':'application/x-www-form-urlencoded','x-marketing-private-form':'1'},body});body=null;
const response=await pending;const result=await response.json();const target=new URL(result.location,location.origin);if(target.origin!==location.origin||!target.pathname.startsWith('/api/projects/'))throw 0;location.replace(target.href);
}catch{body=null;message.textContent='Saving could not be confirmed. The key has been cleared. Reload the saved setup to check its outcome before continuing.';const link=document.createElement('a');link.href=location.pathname;link.textContent=' Reload saved setup';message.append(link);}finally{busy=false;}});})();`;
}
