import type { CreativeConnections } from "./creative-connections.js";
import type {
  AccountChoice, Campaign, ConnectionCatalogue, ConnectionCommands,
  ConnectionTransition, ConnectionView, ConnectionAccessReview, Grant, IdentityChoice, Permission, Provider, SafeEvidence, Setup,
} from "../core/index.js";
import { Store, type Principal, digest, byteDigest, id, requireThat, DomainError } from "./store.js";
import { HostAgent } from "./agent.js";
import { ConnectionDiscovery, connectionScopes, needsPublishingIdentity, type DiscoveredAccount, type DiscoveredIdentity } from "./connection-discovery.js";
import { keys, text } from "./validation.js";

export interface ConnectionAccessPolicy {
  revision: string; appLabel: string; allowedOperations: Permission[]; allowedOAuthScopes: string[];
  allowOffline: boolean; maxDurationSeconds: number; discoveryRetentionSeconds: number;
}
export interface ConnectionsOptions {
  store: Store; custody?: HostAgent; creative?: CreativeConnections;
  /** Current policy, never a browser approval or verification callback. Absence fails closed. */
  accessPolicy?: (principal: Principal, project: string, provider: Provider) => Promise<ConnectionAccessPolicy | null>;
  /** External hosts return a current opaque session reference, null after logout. SDK sessions need no adapter. */
  sessions?: { current(principal: Principal, project: string): Promise<string | null> };
  /** Synthetic HTTP tests must explicitly label all resulting evidence. */
  evidence?: "fixture" | "provider";
}
interface PrivateConnection {
  id: string; projectId: string; revision: number; view: ConnectionView;
  actorId: string; session: string; configuration: string; expiresAt: string; retainUntil: string; causationRef: string;
  scopes: string[]; offline: boolean; providerDecision: ConnectionAccessReview | null; bindingDecision: ConnectionAccessReview | null;
  account: DiscoveredAccount | null; identities: DiscoveredIdentity[];
  accounts: { choice: AccountChoice; native: DiscoveredAccount }[];
  identityChoices: { choice: IdentityChoice; native: DiscoveredIdentity }[];
  cursor: { ref: string; native: string; kind: "accounts" | "identities" } | null;
  revocation?: { actor: string; session: string; grantRevision: number; campaignsDigest: string };
  grantRevision?: number; secretRef: string; callbackId: string | null;
  effect: { id: string; kind: "accounts" | "identities" | "verify"; startedAt: string } | null;
}
interface Callback {
  id: string; connectionId: string; actorId: string; session: string; configuration: string; revision: number;
  expiresAt: string; status: "prepared" | "exchanging" | "received" | "unknown" | "denied";
  receiptRef: string; stateHash: string; sealed: { encrypted: string; keyId: string }; tokenExpiresAt?: string;
}
const transitions = ["connectionId", "expectedRevision", "requestKey"];
export const connectionCommandFields: Record<keyof ConnectionCommands, string[]> = {
  connections: [], connection: ["connectionId", "startRequestKey"],
  startConnection: ["provider", "intent", "requestKey", "expiresAt", "offlineAccess"],
  reviewConnectionProviderAccess: transitions, decideConnectionProviderAccess: [...transitions, "decisionRef", "digest", "decision"],
  beginConnectionHandoff: transitions, discoverConnectionAccounts: [...transitions, "cursor"], selectConnectionAccount: [...transitions, "choiceRef"],
  connectionIdentities: [...transitions, "cursor"], selectConnectionIdentity: [...transitions, "choiceRefs"],
  reviewConnectionAccess: transitions, decideConnectionAccess: [...transitions, "decisionRef", "digest", "decision"],
  resumeConnection: transitions, reconcileConnection: transitions, cancelConnection: transitions, reassignConnection: transitions,
  reviewConnectionRevocation: transitions, decideConnectionRevocation: [...transitions, "decisionRef", "digest", "decision"],
};
const providers: ConnectionCatalogue["providers"] = [
  { provider: { kind: "advertising", provider: "meta" }, label: "Meta", description: "Facebook and Instagram single-image feed ads", limitations: ["Meta daily native preparation and activation are denied.", "Campaign-specific eligibility still needs verification."], requirements: [], configured: false, callbackUri: null },
  { provider: { kind: "advertising", provider: "google" }, label: "Google Ads", description: "Search text ads", limitations: ["No image or video ad publication.", "Account reads do not qualify writes; exact-plan validation is required."], requirements: [], configured: false, callbackUri: null },
  { provider: { kind: "advertising", provider: "linkedin" }, label: "LinkedIn", description: "Single-image LinkedIn feed ads", limitations: ["No video, PDF, document or lead-generation ads.", "Reporting and daily budget policy use UTC.", "Reporting connects independently. Publishing needs configured Advertising API scopes, campaign account rights and verified Page access."], requirements: [], configured: false, callbackUri: null },
  { provider: { kind: "creative", provider: "openai" }, label: "OpenAI · Images", description: "Image generation with separate generation and billing authority", limitations: ["No image editing or reference-image support.", "A configured key is not paid-call authority."], requirements: [], configured: false, callbackUri: null },
  { provider: { kind: "creative", provider: "xai" }, label: "xAI · Video", description: "Video generation for Studio; this is not X advertising", limitations: ["Video advertising is unavailable in this SDK.", "Separate generation budget and quote required."], requirements: [], configured: false, callbackUri: null },
];
const emptyEvidence = (basis: SafeEvidence["basis"] = "provider"): SafeEvidence => ({ status: "not_checked", basis, observedAt: null, expiresAt: null, receiptRef: null, reason: null });
const stamp = (basis: SafeEvidence["basis"], expiresAt: string, receiptRef: string): SafeEvidence => ({ status: "verified", basis, observedAt: new Date().toISOString(), expiresAt, receiptRef, reason: null });
const isAd = (c: PrivateConnection): Provider => { requireThat(c.view.provider.kind === "advertising", "creative_secure_onboarding_contract_missing"); return c.view.provider.provider; };
const operations = (c: PrivateConnection): Permission[] => { requireThat(c.view.intent.kind === "advertising", "invalid_connection_intent"); return c.view.intent.operations; };
const active = (c: PrivateConnection) => !["verified", "cancelled", "needs_reauthorization"].includes(c.view.phase) && !(c.view.providerAuthorized.status === "verified" && Date.parse(c.view.providerAuthorized.expiresAt ?? "") <= Date.now());
const routePart = (s: string) => encodeURIComponent(s);

export function createConnections(options: ConnectionsOptions) { return new MarketingConnectionsService(options); }
/** Durable pre-grant journey; owns no scheduler, session engine, credential store or campaign executor. */
export class MarketingConnectionsService {
  readonly store: Store; readonly discovery: ConnectionDiscovery; readonly evidence: "fixture" | "provider";
  constructor(readonly options: ConnectionsOptions) {
    requireThat(!options.creative || options.creative.store === options.store, "connections_store_mismatch");
    this.store = options.store; this.evidence = options.evidence ?? "provider";
    requireThat(!options.custody || options.custody.store === options.store, "connections_store_mismatch");
    this.discovery = new ConnectionDiscovery(options.custody?.fetcher);
  }
  private async auth(p: Principal, project: string, write = false, human = false) {
    await this.store.authorize(p, project, write ? ["admin", "editor"] : undefined, human);
    let session = p.sessionTokenHash ?? null;
    if (!session && this.options.sessions && p.externalSessionRef) {
      let current: string | null;
      try { current = await this.options.sessions.current(p, project); } catch { throw new DomainError("host_session_validation_unavailable", 401); }
      session = current === p.externalSessionRef ? current : null;
    }
    const member = await this.store.authorize(p, project, write ? ["admin", "editor"] : undefined, human);
    return { member, session };
  }
  private configuration(provider: Provider, policy: ConnectionAccessPolicy | null, requested: Permission[]) {
    const configured = this.options.custody?.apps[provider];
    // Publishing entitlement is irrelevant to a separately approved reporting or
    // pause-only connection. OAuth client identity/secrets and policy still bind.
    const app = provider === "linkedin" && configured && !needsPublishingIdentity(requested)
      ? { clientId: configured.clientId, clientSecret: configured.clientSecret } : configured;
    return digest({ provider, policy, origin: this.options.custody?.origin, app });
  }
  private async policy(p: Principal, project: string, provider: Provider) {
    let policy: ConnectionAccessPolicy | null;
    try { policy = await this.options.accessPolicy?.(p, project, provider) ?? null; } catch { throw new DomainError("connection_access_policy_unavailable"); }
    await this.auth(p, project);
    return policy;
  }
  private linkedinPublishingConfigured(scopes: string[]) {
    const app = this.options.custody?.apps.linkedin, capability = app?.linkedinAdvertising;
    return !!(app?.clientId && capability && capability.clientId === app.clientId &&
      typeof capability.appId === "string" && capability.appId.trim() && typeof capability.revision === "string" && capability.revision.trim() &&
      ["development", "standard"].includes(capability.tier) && Array.isArray(capability.supportedScopes) && scopes.every(s => capability.supportedScopes.includes(s)));
  }
  private async guard(p: Principal, c: PrivateConnection, human = false) {
    const policy = await this.policy(p, c.projectId, isAd(c));
    const a = await this.auth(p, c.projectId, true, human);
    requireThat(a.session && a.session === c.session && c.actorId === p.userId, "connection_session_changed", 401);
    requireThat(c.configuration === this.configuration(isAd(c), policy, operations(c)), "connection_configuration_changed");
    if (isAd(c) === "linkedin" && needsPublishingIdentity(operations(c))) requireThat(this.linkedinPublishingConfigured(c.scopes), "linkedin_app_capability_missing");
    requireThat(Date.parse(c.expiresAt) > Date.now() && Date.parse(c.retainUntil) > Date.now(), "connection_access_expired");
    if (c.view.providerAuthorized.status === "verified") requireThat(c.view.providerAuthorized.expiresAt && Date.parse(c.view.providerAuthorized.expiresAt) > Date.now(), "provider_access_expired_or_denied");
    const current = await this.store.get<PrivateConnection>(c.projectId, "connection", c.id);
    requireThat(current.revision === c.revision && current.actorId === c.actorId && current.session === c.session && !["cancelled", "cancelling", "needs_reauthorization"].includes(current.view.phase), "connection_changed");
    if (c.view.grantId) {
      const g = await this.store.get<Grant>(c.projectId, "grant", c.view.grantId);
      requireThat(!g.revokedAt && Date.parse(g.expiresAt) > Date.now() && g.revision === c.grantRevision, "grant_expired_or_revoked");
    }
  }
  private async save(c: PrivateConnection, phase: ConnectionView["phase"], reason: string) {
    const previous = c.revision; c.revision++;
    c.view = { ...c.view, revision: c.revision, phase, checkpoint: reason, updatedAt: new Date().toISOString() };
    await this.store.put(c.projectId, "connection", c.id, c, previous);
    await this.store.append(c.projectId, c.id, "connection.changed", { id: c.id, revision: c.revision, phase, reason, requestRef: c.causationRef });
    return c;
  }
  private safe(c: PrivateConnection, owner: boolean): ConnectionView {
    const v: ConnectionView = structuredClone(c.view);
    const now = Date.now();
    for (const e of [v.providerAuthorized, v.consented, v.accountVerified, v.capabilityVerified]) if (e.status === "verified" && e.expiresAt && Date.parse(e.expiresAt) <= now) e.status = "expired";
    if (Date.parse(c.expiresAt) <= now && v.phase !== "cancelled") { v.phase = "needs_reauthorization"; v.checkpoint = "Project access expired. Review fresh access to reconnect."; }
    if (!c.view.grantId && Date.parse(c.retainUntil) <= now && v.phase !== "cancelled") { v.phase = "needs_reauthorization"; v.checkpoint = "Discovery access expired. Start a fresh exact access review."; }
    if (v.providerAuthorized.status === "expired" && !["cancelled", "cancelling"].includes(v.phase)) { v.phase = "needs_reauthorization"; v.handoffPath = null; v.accessReview = null; v.checkpoint = "Provider access expired. Review fresh provider authorization to reconnect."; }
    if (v.phase === "waiting_human" && c.providerDecision && Date.parse(c.providerDecision.expiresAt) <= now) {
      v.phase = "reviewing_provider_access"; v.handoffPath = null; v.checkpoint = "The provider access decision and secure handoff expired. Review and approve fresh provider access before continuing.";
    }
    if (v.accessReview && Date.parse(v.accessReview.expiresAt) <= now) v.accessReview = null;
    v.currentActor = ["discovering", "verifying", "reconciling"].includes(v.phase) ? "sdk" : v.phase === "blocked" ? "host_admin" : "human";
    v.actions = [];
    const action = (a: ConnectionView["actions"][number]["action"], label: string) => v.actions.push({ action: a, label, actor: "human", available: owner, reason: owner ? null : "The original session must resume, or an editor must explicitly take over." });
    if (["requirements", "reviewing_provider_access"].includes(v.phase)) action("review_provider", "Review provider authorization");
    if (v.phase === "waiting_human" && v.providerAuthorized.status !== "verified") action("handoff", "Continue securely with provider");
    if (["choosing_account", "failed_retryable"].includes(v.phase) && v.providerAuthorized.status === "verified") action("discover", "Refresh accounts");
    if (v.phase === "choosing_identity") action("identities", "Find publishing identities");
    if (v.phase === "reviewing_access") action("review_access", "Review project access");
    if (v.phase === "verifying" || v.phase === "verified" || v.phase === "failed_retryable" && c.bindingDecision) action("verify", "Verify account access");
    if (["waiting_human", "outcome_unknown", "reconciling", "discovering", "cancelling"].includes(v.phase)) action("reconcile", "Check outcome");
    if (v.phase === "verified") action("revoke", "Review local access revocation");
    if (v.phase === "needs_reauthorization") action("reconnect", "Start a fresh access review");
    if (!["verified", "cancelled", "needs_reauthorization"].includes(v.phase)) action("cancel", "Cancel setup");
    if (v.phase === "blocked") v.actions.push({ action: "requirements", label: "View administrator setup", actor: "host_admin", available: true, reason: null });
    v.readiness = (c.view.intent.kind === "advertising" ? c.view.intent.operations : [c.view.intent.operation]).map(a => ({ action: a, materialDigest: null,
      ready: this.evidence === "provider" && a === "report" && v.accountVerified.status === "verified" && v.consented.status === "verified" && v.providerAuthorized.status === "verified" && v.configured.status === "verified",
      blockers: this.evidence === "fixture" ? ["Synthetic fixture evidence; no live readiness"] : a === "report" && v.accountVerified.status === "verified" && v.consented.status === "verified" && v.providerAuthorized.status === "verified" && v.configured.status === "verified" ? [] : ["Campaign-specific verification and exact action authority required"], evidence: [v.accountVerified] }));
    if (!owner) { v.account = null; v.identities = []; v.accessReview = null; v.handoffPath = null; v.discovery = { accounts: [], identities: [], cursor: null, complete: false, expiresAt: null }; }
    return v;
  }
  private async view(p: Principal, c: PrivateConnection) {
    const a = await this.auth(p, c.projectId);
    const canEdit = ["admin", "editor"].includes(a.member.role);
    const v = this.safe(c, canEdit && c.actorId === p.userId && !!a.session && a.session === c.session);
    if (canEdit && a.member.kind === "human" && a.session && c.view.grantId) {
      const revoke = v.actions.find(x => x.action === "revoke"); if (revoke) { revoke.available = true; revoke.reason = null; }
      if (c.revocation?.actor === p.userId && c.revocation.session === a.session && c.view.accessReview && Date.parse(c.view.accessReview.expiresAt) > Date.now()) v.accessReview = c.view.accessReview;
    }
    if (v.accessReview?.purpose === "revoke_project_access" && (c.revocation?.actor !== p.userId || c.revocation.session !== a.session)) v.accessReview = null;
    if (c.view.provider.kind === "advertising") {
      const currentPolicy = await this.policy(p, c.projectId, c.view.provider.provider);
      if (this.configuration(c.view.provider.provider, currentPolicy, operations(c)) !== c.configuration) {
        v.configured = { ...v.configured, status: "unavailable", reason: "Host configuration or access policy changed. Cancel pending setup and review fresh access." };
        v.readiness.forEach(r => { r.ready = false; r.blockers = ["Configuration changed"]; });
        v.handoffPath = null; if (v.accessReview?.purpose !== "revoke_project_access") v.accessReview = null;
      }
    }
    // Re-read binding after policy/session adapters have yielded. A separate
    // grant administrator may revoke or revise it without touching this record.
    if (c.view.grantId) {
      const g = await this.store.get<Grant>(c.projectId, "grant", c.view.grantId);
      if (g.revokedAt || Date.parse(g.expiresAt) <= Date.now() || g.revision !== c.grantRevision) {
        v.phase = "needs_reauthorization";
        v.checkpoint = g.revokedAt ? "Access revoked. Existing campaign history is retained; active ads may still run." : "Project access expired or changed. Review fresh access before continuing.";
        v.consented.status = g.revokedAt ? "revoked" : Date.parse(g.expiresAt) <= Date.now() ? "expired" : "unavailable";
        v.readiness.forEach(r => { r.ready = false; r.blockers = ["Project access expired, changed or revoked"]; });
        v.accessReview = null; v.handoffPath = null;
        v.actions = [{ action: "reconnect", label: "Review a new connection", actor: "human", available: canEdit, reason: null }];
      }
    }
    const finalAuth = await this.auth(p, c.projectId);
    requireThat(finalAuth.session === a.session, "connection_session_changed", 401);
    requireThat(digest(finalAuth.member) === digest(a.member), "connection_authority_changed", 403);
    const latest = await this.store.get<PrivateConnection>(c.projectId, "connection", c.id);
    requireThat(latest.revision === c.revision, "revision_conflict");
    return v;
  }
  private async catalogue(p: Principal, project: string): Promise<ConnectionCatalogue> {
    const { member, session } = await this.auth(p, project), canStart = ["admin", "editor"].includes(member.role);
    const row = await this.store.db.prepare("SELECT name FROM projects WHERE id=?").get(project);
    const cards = structuredClone(providers);
    for (const card of cards) {
      const req = (code: string, explanation: string) => card.requirements.push({ code, explanation, actor: "host_admin" });
      if (card.provider.kind === "creative") {
        if (this.options.creative) {
          try { const creative = await this.options.creative.catalogue(p, project, card.provider.provider);
            card.secureSetupPath = creative.path; card.creativeBindings = creative.bindings; card.configured = creative.configured;
            if (!creative.configured) req("creative_policy_unavailable", "Restore the current creative configuration policy to start new setup. Private setup still permits inspecting and disconnecting your own saved bindings.");
          } catch { req("creative_policy_or_session_unavailable", "An authorized human editor needs a current session and a creative configuration policy for this environment. Ask the administrator to check the existing permission/session adapter."); }
        } else req("creative_secure_onboarding_contract_missing", "Bind the public CreativeConnections adapter to existing encrypted custody, current sessions and creative permission policy. No Agent SDK or host provider form is required.");
        continue;
      }
      const custody = this.options.custody, provider = card.provider.provider;
      if (!custody?.apps[provider]) req("oauth_application_not_configured", `An administrator must bind the ${card.label} OAuth application's client ID and secret through existing protected configuration.`);
      const policy = await this.policy(p, project, provider);
      if (!policy) req("connection_access_policy_missing", "Map current grant-makers, allowed operations, OAuth scopes, explicit maximum duration and discovery retention in the public accessPolicy adapter.");
      if (!session) req("host_session_validation_unavailable", "Bind a current host session reference and logout validation, or use the SDK's authenticated session principal.");
      if (!custody) req("credential_key_unavailable", "Bind the existing HostAgent and CredentialCipher to the same Store. No credentials enter Marketing views.");
      else {
        try { const origin = new URL(custody.origin); requireThat(origin.origin === custody.origin && (origin.protocol === "https:" || this.evidence === "fixture" && origin.hostname === "127.0.0.1"), "callback_origin_mismatch");
          card.callbackUri = `${custody.origin}/api/oauth/${routePart(project)}/${provider}/callback`;
          const sealed = custody.cipher.encryptPayload("custody-check"); requireThat(custody.cipher.decryptPayloadAsString(sealed.encrypted, sealed.keyId) === "custody-check", "credential_key_unavailable");
        } catch { req("credential_or_callback_configuration_invalid", "Check the active cipher key and canonical HTTPS origin; register the exact callback route shown by your administrator."); }
      }
      card.configured = card.requirements.length === 0;
      if (provider === "linkedin" && !this.linkedinPublishingConfigured(connectionScopes("linkedin", ["setup", "prepare"]))) card.limitations.push("Publishing app configuration is missing or unqualified. An administrator must bind the Advertising API app identity, tier and enabled-scope allowlist; reporting remains a separate option.");
    }
    const all = await this.store.list<PrivateConnection>(project, "connection");
    const connections: ConnectionView[] = []; for (const c of all) connections.push(await this.view(p, c));
    const connected = new Set(all.map(c => c.view.grantId));
    const setups = await this.store.list<Setup>(project, "setup");
    const historical = (await this.store.list<Grant>(project, "grant")).filter(g => !connected.has(g.id)).map(({ secretRef: _secret, ...grant }) => ({ grant, setup: setups.filter(s => s.grantId === grant.id).at(-1) ?? null }));
    const finalAuth = await this.auth(p, project);
    requireThat(finalAuth.session === session && digest(finalAuth.member) === digest(member), "connection_authority_changed", 403);
    return { project: { id: project, name: String(row!.name) }, canStart, canApprove: canStart && member.kind === "human", evidence: this.evidence,
      assistance: { available: false, reason: "No qualified pre-grant Agent contract is installed. Guided manual setup uses the same retained connection states." }, providers: cards, connections, historical };
  }
  private requestId(p: Principal, key: string) { text(key, 160); return `connection:${digest([p.userId, key])}`; }
  private async request(p: Principal, project: string, command: string, input: { requestKey: string }, create: () => Promise<PrivateConnection>) {
    const key = this.requestId(p, input.requestKey), hash = digest([p.userId, command, input]);
    const old = await this.store.db.prepare("SELECT * FROM requests WHERE project_id=? AND request_key=?").get(project, key);
    if (old) { requireThat(old.digest === hash && old.kind === "connection", "request_key_payload_conflict"); return { c: await this.store.get<PrivateConnection>(project, "connection", String(old.record_id)), replay: true }; }
    const c = await create();
    await this.store.db.prepare("INSERT INTO requests VALUES(?,?,?,?,?)").run(project, key, hash, "connection", c.id);
    return { c, replay: false };
  }
  private validateStart(input: ConnectionCommands["startConnection"]["input"]) {
    keys(input.provider, ["kind", "provider"]); keys(input.intent, input.intent.kind === "advertising" ? ["kind", "operations"] : ["kind", "operation"]);
    requireThat(providers.some(c => digest(c.provider) === digest(input.provider)) && input.provider.kind === input.intent.kind, "invalid_connection_provider", 422);
    requireThat(typeof input.offlineAccess === "boolean" && typeof input.expiresAt === "string" && Date.parse(input.expiresAt) > Date.now(), "explicit_connection_expiry_required", 422);
    requireThat(!input.offlineAccess || input.provider.provider === "google", "offline_provider_flow_unqualified", 422);
    if (input.intent.kind === "advertising") requireThat(Array.isArray(input.intent.operations) && input.intent.operations.length > 0 && new Set(input.intent.operations).size === input.intent.operations.length && input.intent.operations.every(p => ["setup", "report", "prepare", "activate", "pause"].includes(p)) && input.intent.operations.includes("setup"), "invalid_connection_intent", 422);
    else requireThat(input.intent.operation === (input.provider.provider === "openai" ? "image" : "video"), "invalid_connection_intent", 422);
  }
  private async start(p: Principal, project: string, input: ConnectionCommands["startConnection"]["input"]) {
    this.validateStart(input);
    const catalogue = await this.catalogue(p, project), card = catalogue.providers.find(c => digest(c.provider) === digest(input.provider))!;
    const policy = input.provider.kind === "advertising" ? await this.policy(p, project, input.provider.provider) : null;
    return this.store.transaction(async () => {
      const a = await this.auth(p, project, true); requireThat(a.session, "host_session_validation_unavailable");
      const result = await this.request(p, project, "startConnection", input, async () => {
        // Expiry/new keys cannot erase an unresolved external effect. Reconcile the
        // original receipt first, including after a new browser session.
        for (const pending of await this.store.list<PrivateConnection>(project, "connection")) {
          if (pending.actorId !== p.userId || digest(pending.view.provider) !== digest(input.provider) || ["cancelled", "needs_reauthorization", "verified"].includes(pending.view.phase)) continue;
          const callback = pending.callbackId ? await this.store.get<Callback>(project, "connectionCallback", pending.callbackId) : null;
          requireThat(!pending.effect && !["exchanging", "unknown"].includes(callback?.status ?? ""), "unresolved_connection_exists");
        }
        const existing = (await this.store.list<PrivateConnection>(project, "connection")).find(c => c.actorId === p.userId && digest(c.view.provider) === digest(input.provider) && active(c) && Date.parse(c.expiresAt) > Date.now() && Date.parse(c.retainUntil) > Date.now());
        if (existing) { requireThat(digest(existing.view.intent) === digest(input.intent) && existing.expiresAt === input.expiresAt && existing.offline === input.offlineAccess, "unresolved_connection_exists"); return existing; }
        const scopes = input.provider.kind === "advertising" && input.intent.kind === "advertising" ? connectionScopes(input.provider.provider, input.intent.operations) : [];
        if (input.provider.provider === "linkedin" && input.intent.kind === "advertising" && needsPublishingIdentity(input.intent.operations) && !this.linkedinPublishingConfigured(scopes)) {
          card.configured = false;
          card.requirements.push({ code: "linkedin_app_capability_missing", actor: "host_admin", explanation: "LinkedIn publishing needs an administrator to bind the current OAuth client to its Advertising API app identity, tier, configuration revision and explicit supported-scope allowlist. Check enabled scopes in protected server configuration, then cancel this setup and review fresh access. Reporting setup remains available separately. Configuration does not prove member consent or Page access." });
        }
        if (card.configured) {
          requireThat(policy && input.intent.kind === "advertising" && policy.revision && policy.appLabel && Array.isArray(policy.allowedOperations) && Array.isArray(policy.allowedOAuthScopes) && Number.isFinite(policy.maxDurationSeconds) && policy.maxDurationSeconds > 0 && Number.isFinite(policy.discoveryRetentionSeconds) && policy.discoveryRetentionSeconds >= 60, "connection_access_policy_missing");
          requireThat(Date.parse(input.expiresAt) <= Date.now() + policy.maxDurationSeconds * 1000 && input.intent.operations.every(o => policy.allowedOperations.includes(o)) && scopes.every(s => policy.allowedOAuthScopes.includes(s)) && (!input.offlineAccess || policy.allowOffline), "connection_policy_denied", 403);
        }
        const cid = id(), until = new Date(Math.min(Date.parse(input.expiresAt), Date.now() + (policy?.discoveryRetentionSeconds ?? 600) * 1000)).toISOString();
        const view: ConnectionView = { id: cid, projectId: project, revision: 1, provider: input.provider, intent: input.intent,
          phase: card.configured ? "requirements" : "blocked", account: null, identities: [], accessReview: null, grantId: null,
          checkpoint: card.configured ? "Requirements checked. Review exact provider authorization before discovery." : card.requirements.map(r => r.explanation).join(" "),
          currentActor: card.configured ? "human" : "host_admin", requested: true,
          configured: { ...emptyEvidence("configuration"), status: card.configured ? "verified" : "unavailable" },
          providerAuthorized: emptyEvidence(this.evidence), consented: emptyEvidence("human_decision"), accountVerified: emptyEvidence(this.evidence), capabilityVerified: emptyEvidence(this.evidence),
          readiness: [], actions: [], updatedAt: new Date().toISOString(), discovery: { accounts: [], identities: [], cursor: null, complete: false, expiresAt: null }, handoffPath: null };
        const c: PrivateConnection = { id: cid, projectId: project, revision: 1, view, actorId: p.userId, session: a.session!,
          configuration: input.provider.kind === "advertising" ? this.configuration(input.provider.provider, policy, input.intent.kind === "advertising" ? input.intent.operations : []) : "creative-contract-missing",
          expiresAt: input.expiresAt, retainUntil: until, causationRef: this.requestId(p, input.requestKey), scopes, offline: input.offlineAccess, providerDecision: null, bindingDecision: null,
          account: null, identities: [], accounts: [], identityChoices: [], cursor: null, secretRef: `connection:${cid}`, callbackId: null, effect: null };
        await this.store.put(project, "connection", c.id, c); await this.store.append(project, c.id, "connection.changed", { id: c.id, revision: 1, phase: view.phase }); return c;
      });
      return this.view(p, result.c);
    });
  }
  private review(c: PrivateConnection, purpose: ConnectionAccessReview["purpose"], summary: string) {
    const r = { decisionRef: id(), expiresAt: new Date(Math.min(Date.now() + 300000, Date.parse(c.expiresAt), Date.parse(c.retainUntil))).toISOString(), purpose, summary,
      oauthScopes: purpose === "provider_authorization" ? c.scopes : [], providerAccountRange: purpose === "provider_authorization" ? isAd(c) === "linkedin" ? "Sponsored accounts accessible to the consenting LinkedIn member. Publishing also checks that same member’s approved roles on the selected account-associated Page. Provider scopes are broader than this later project binding." : "Accounts accessible to the signed-in provider identity, including its manager hierarchy; accounts cannot be enumerated until authorization." : c.view.account?.label ?? "Selected project access",
      offlineAccess: purpose === "provider_authorization" && c.offline, providerLifetime: "Provider authorization can persist after local expiry or cancellation. Revoke at the provider separately; this wizard does not revoke it.", projectAccessExpiresAt: c.expiresAt };
    return { ...r, digest: digest([r, c.projectId, c.actorId, c.session, c.configuration, c.account, c.identities, c.view.intent, c.view.grantId, c.revision]) };
  }
  private decision(c: PrivateConnection, input: any, purpose: ConnectionAccessReview["purpose"]) {
    const r = c.view.accessReview;
    requireThat(r && r.purpose === purpose && r.decisionRef === input.decisionRef && r.digest === input.digest && Date.parse(r.expiresAt) > Date.now() && ["approved", "rejected"].includes(input.decision), "connection_decision_stale"); return r;
  }
  private async mutate(p: Principal, project: string, command: keyof ConnectionCommands, input: ConnectionTransition & Record<string, any>) {
    const outcome = await this.store.transaction(async () => {
      await this.auth(p, project, true, command.startsWith("decide") || command === "reassignConnection");
      return this.request(p, project, command, input, async () => {
        const c = await this.store.get<PrivateConnection>(project, "connection", input.connectionId);
        requireThat(Number.isInteger(input.expectedRevision) && c.revision === input.expectedRevision, "revision_conflict");
        c.causationRef = this.requestId(p, input.requestKey);
        if (command === "reassignConnection") {
          const oldCallback = c.callbackId ? await this.store.get<Callback>(project, "connectionCallback", c.callbackId) : null;
          requireThat(!c.view.grantId && !c.effect && !["exchanging", "unknown"].includes(oldCallback?.status ?? "") && c.view.phase !== "cancelling", "connection_outcome_requires_original_actor");
          const a = await this.auth(p, project, true, true); requireThat(a.session, "host_session_validation_unavailable");
          c.actorId = p.userId; c.session = a.session; c.account = null; c.identities = []; c.accounts = []; c.identityChoices = []; c.cursor = null;
          c.providerDecision = null; c.bindingDecision = null; c.callbackId = null; c.secretRef = `connection:${id()}`;
          c.view = { ...c.view, account: null, identities: [], accessReview: null, handoffPath: null, providerAuthorized: emptyEvidence(this.evidence), consented: emptyEvidence("human_decision"), accountVerified: emptyEvidence(this.evidence), discovery: { accounts: [], identities: [], cursor: null, complete: false, expiresAt: null } };
          const policy = await this.policy(p, project, isAd(c));
          requireThat(policy && operations(c).every(o => policy.allowedOperations.includes(o)) && c.scopes.every(s => policy.allowedOAuthScopes.includes(s)) && (!c.offline || policy.allowOffline) && Date.parse(c.expiresAt) <= Date.now() + policy.maxDurationSeconds * 1000, "connection_policy_denied", 403);
          c.configuration = this.configuration(isAd(c), policy, operations(c));
          return this.save(c, "requirements", "Explicit takeover. Rediscover using your own session and freshly approved provider access.");
        }
        // Cancellation never needs expired access or configuration to be repaired first.
        if (command === "cancelConnection") {
          const a = await this.auth(p, project, true, true); requireThat(c.actorId === p.userId && a.session === c.session, "connection_session_changed", 401);
          requireThat(!c.view.grantId, "review_local_revocation_required");
          const cb = c.callbackId ? await this.store.get<Callback>(project, "connectionCallback", c.callbackId) : null;
          c.view.accessReview = null; c.view.handoffPath = null;
          return this.save(c, c.effect || cb?.status === "exchanging" || cb?.status === "unknown" ? "cancelling" : "cancelled", "Local setup cancelled. Provider authorization may persist; cancellation does not revoke provider access.");
        }
        if (command === "reconcileConnection") {
          const a = await this.auth(p, project, true); requireThat(c.actorId === p.userId && a.session === c.session, "connection_session_changed", 401);
          if (c.view.phase === "cancelling") { c.effect = null; return this.save(c, "cancelled", "Local cancellation is final; no project grant was created. Any provider authorization must be reviewed at the provider."); }
          if (c.callbackId) {
            const cb = await this.store.get<Callback>(project, "connectionCallback", c.callbackId);
            if (cb.status === "received" && !c.view.grantId && c.view.providerAuthorized.status !== "verified") { await this.guard(p, c); return this.acceptCallback(c, cb); }
            if (cb.status === "unknown" || cb.status === "exchanging" && Date.parse(cb.expiresAt) < Date.now()) return this.save(c, "needs_reauthorization", "Original callback receipt checked: credential recovery is unavailable. The code may have been consumed and will never be replayed. Provider access may remain; review it at the provider, then start a fresh, explicitly approved connection. No local grant was created.");
            if (cb.status === "exchanging") return this.save(c, "outcome_unknown", "Provider exchange is unresolved. Wait for its original receipt; the code will never be replayed.");
          }
          await this.guard(p, c);
          if (c.effect && Date.parse(c.effect.startedAt) + 60000 < Date.now()) { c.effect = null; return this.save(c, "failed_retryable", "Interrupted read. Retry safe verification or discovery; no provider write is retried."); }
          return c;
        }
        if (command === "reviewConnectionRevocation" || command === "decideConnectionRevocation") {
          const auth = await this.auth(p, project, true, true); requireThat(auth.session, "host_session_validation_unavailable");
          requireThat(c.view.grantId, "connection_grant_required");
          const g = await this.store.get<Grant>(project, "grant", c.view.grantId);
          requireThat(!g.revokedAt, "grant_expired_or_revoked");
          const campaigns = (await this.store.list<Campaign>(project, "campaign")).filter(x => x.grantId === g.id);
          const campaignsDigest = digest(campaigns.map(x => [x.id, x.revision, x.state]));
          if (command === "reviewConnectionRevocation") {
            c.effect = null; // Revision change fences any pending read; revocation must not wait for it.
            const review = this.review(c, "revoke_project_access", `Revoke local grant ${g.id} revision ${g.revision} for ${g.label}; ${campaigns.length} campaign(s) depend on it. Block new SDK actions immediately. Active ads may keep running and SDK pause access will be lost. This does not revoke shared provider OAuth or pause ads. Manage active ads at the provider.`);
            review.expiresAt = new Date(Date.now() + 300000).toISOString();
            review.digest = digest([review, p.userId, auth.session, g.revision, campaignsDigest]);
            c.revocation = { actor: p.userId, session: auth.session, grantRevision: g.revision, campaignsDigest };
            c.view.accessReview = review;
            return this.save(c, "verified", "Review exact local access revocation.");
          }
          requireThat(c.revocation?.actor === p.userId && c.revocation.session === auth.session && c.revocation.grantRevision === g.revision && c.revocation.campaignsDigest === campaignsDigest, "connection_decision_stale");
          this.decision(c, input, "revoke_project_access"); c.view.accessReview = null; delete c.revocation;
          if (input.decision === "rejected") return this.save(c, "verified", "Local access revocation declined.");
          await this.store.put(project, "grant", g.id, { ...g, revision: g.revision + 1, revokedAt: new Date().toISOString() }, g.revision);
          c.effect = null; c.view.consented.status = "revoked";
          return this.save(c, "needs_reauthorization", "Local access revoked. History retained; provider authorization and active ads are unchanged.");
        }
        await this.guard(p, c, command.startsWith("decide"));
        requireThat(!c.effect, "connection_effect_in_progress");
        const provider = isAd(c);
        if (command === "reviewConnectionProviderAccess") {
          requireThat(["requirements", "reviewing_provider_access"].includes(c.view.phase) || c.view.phase === "waiting_human" && c.providerDecision && Date.parse(c.providerDecision.expiresAt) <= Date.now(), "connection_transition_denied");
          if (c.callbackId) { const old = await this.store.get<Callback>(project, "connectionCallback", c.callbackId); requireThat(old.status === "prepared", "original_callback_outcome_required"); }
          c.callbackId = null; c.providerDecision = null; c.view.handoffPath = null;
          const policy = await this.policy(p, project, provider); requireThat(policy, "connection_access_policy_missing");
          c.view.accessReview = this.review(c, "provider_authorization", `Authorize ${policy.appLabel}${provider === "linkedin" ? ` (OAuth client ${this.options.custody!.apps.linkedin!.clientId}${needsPublishingIdentity(operations(c)) ? `; Advertising API app ${this.options.custody!.apps.linkedin!.linkedinAdvertising!.appId}, ${this.options.custody!.apps.linkedin!.linkedinAdvertising!.tier} tier` : ""})` : ""} to discover ${provider} advertising accounts using exactly ${c.scopes.join(", ")}. ${provider === "google" ? "Google adwords is a broad advertising-management scope even for reporting-only project access." : provider === "linkedin" ? (c.scopes.includes("rw_ads") ? "rw_ads reads and manages advertising accounts and campaigns. r_organization_admin verifies approved Page roles; w_organization_social creates sponsored posts; r_organization_social reads them back. These permissions cover eligible accounts and Pages of the signed-in member, not only the later selected account. r_ads_reporting is included only when reporting is requested. This SDK supports only the account-associated organization as campaign associated entity and post author." : "r_ads reads advertising accounts and roles; r_ads_reporting reads reports when requested. No organization API access or publishing permission is requested.") : c.scopes.includes("ads_management") ? "This provider authorization includes advertising management access." : "Only advertising read access is requested."} ${c.offline ? "Refresh/offline access is requested." : "No offline refresh access is requested."} Local discovery use ends ${c.retainUntil}. This may grant persistent provider access before any project connection exists. It does not authorize spending.`);
          await this.guard(p, c);
          return this.save(c, "reviewing_provider_access", "Review provider authorization. Authentication alone does not authorize discovery.");
        }
        if (command === "decideConnectionProviderAccess") {
          requireThat(c.view.phase === "reviewing_provider_access", "connection_transition_denied"); const r = this.decision(c, input, "provider_authorization"); c.view.accessReview = null;
          if (input.decision === "rejected") return this.save(c, "cancelled", "Provider authorization declined. No OAuth handoff was issued.");
          c.providerDecision = r; return this.save(c, "waiting_human", "Provider access approved by the current human. Continue to provider consent.");
        }
        if (command === "beginConnectionHandoff") {
          requireThat(c.view.phase === "waiting_human" && c.providerDecision && Date.parse(c.providerDecision.expiresAt) > Date.now(), "provider_access_decision_required");
          requireThat(!c.callbackId, "original_handoff_required");
          c.view.handoffPath = `/api/projects/${routePart(project)}/connections/${routePart(c.id)}/handoff`;
          return this.save(c, "waiting_human", "Use the secure same-origin route. Provider login, consent and challenges stay on the provider's origin.");
        }
        if (command === "selectConnectionAccount") {
          requireThat(["choosing_account", "choosing_identity", "reviewing_access", "failed_retryable"].includes(c.view.phase) && !c.view.grantId && Date.parse(c.view.discovery.expiresAt ?? "") > Date.now(), "discovery_snapshot_expired");
          const choice = c.accounts.find(a => a.choice.choiceRef === input.choiceRef); requireThat(choice, "invalid_account_choice");
          c.account = choice.native; c.view.account = choice.choice; c.identities = []; c.identityChoices = []; c.view.identities = []; c.bindingDecision = null;
          c.view.consented = emptyEvidence("human_decision"); c.view.accountVerified = emptyEvidence(this.evidence); c.view.accessReview = null;
          c.cursor = null; c.view.discovery.identities = []; c.view.discovery.cursor = null;
          return this.save(c, provider !== "google" && needsPublishingIdentity(operations(c)) || c.account.managerId ? "choosing_identity" : "reviewing_access", "Account selected. Any previous identity and project-access decision have been invalidated.");
        }
        if (command === "selectConnectionIdentity") {
          requireThat(c.view.phase === "choosing_identity" && Array.isArray(input.choiceRefs) && input.choiceRefs.length > 0 && input.choiceRefs.length <= 2 && new Set(input.choiceRefs).size === input.choiceRefs.length && Date.parse(c.view.discovery.expiresAt ?? "") > Date.now(), "invalid_identity_choice");
          const chosen = c.identityChoices.filter(i => input.choiceRefs.includes(i.choice.choiceRef)); requireThat(chosen.length === input.choiceRefs.length, "invalid_identity_choice");
          const values = chosen.map(i => i.native);
          if (provider === "meta") requireThat(values.filter(i => i.kind === "meta_page").length === 1 && values.every(i => i.kind === "meta_page" || i.kind === "instagram" && i.pageId === values.find(p => p.kind === "meta_page")?.id), "provider_identity_mismatch");
          else requireThat(values.length === 1 && values[0]!.kind === (provider === "google" ? "google_manager" : "linkedin_organization"), "provider_identity_mismatch");
          c.identities = values; c.view.identities = chosen.map(i => i.choice); c.bindingDecision = null; c.view.accessReview = null;
          return this.save(c, "reviewing_access", "Publishing or manager context selected. Review project access.");
        }
        if (command === "reviewConnectionAccess") {
          requireThat(c.view.phase === "reviewing_access" && c.account && c.view.providerAuthorized.status === "verified", "connection_transition_denied");
          c.view.accessReview = this.review(c, "project_binding", `Connect ${c.account.label} (${c.account.currency}, ${c.account.timezone}) to project ${project}, with ${c.view.identities.map(i => i.label).join(", ") || "no publishing identity (reporting only)"}, for ${operations(c).join(", ")} until ${c.expiresAt}. Authorized project members may use this scoped connection. This retains encrypted provider credentials; campaign-specific checks and separate spending approvals remain required.`);
          return this.save(c, "reviewing_access", "Approve this exact project, account, identity, duration and operations.");
        }
        if (command === "decideConnectionAccess") {
          requireThat(c.view.phase === "reviewing_access", "connection_transition_denied"); const r = this.decision(c, input, "project_binding"); c.view.accessReview = null;
          if (input.decision === "rejected") return this.save(c, "cancelled", "Project access declined. Provider authorization may remain and is not revoked here.");
          c.bindingDecision = r; c.view.consented = stamp("human_decision", c.expiresAt, r.decisionRef);
          return this.save(c, "verifying", "Project access approved. Fresh native verification must finish before any Grant exists.");
        }
        requireThat(["discoverConnectionAccounts", "connectionIdentities", "resumeConnection"].includes(command), "unknown_command", 404);
        requireThat(c.view.providerAuthorized.status === "verified", "provider_consent_required");
        if (command === "resumeConnection") requireThat(c.account && c.bindingDecision && (c.view.grantId || Date.parse(c.bindingDecision.expiresAt) > Date.now()), "project_access_decision_required");
        if (command === "connectionIdentities") requireThat(c.account && !c.view.grantId && (provider !== "linkedin" || needsPublishingIdentity(operations(c))), "account_choice_required");
        if (command === "discoverConnectionAccounts") requireThat(!c.view.grantId && !["outcome_unknown", "cancelling", "cancelled"].includes(c.view.phase), "connection_transition_denied");
        if (input.cursor) requireThat(c.cursor?.ref === input.cursor && c.cursor?.kind === (command === "connectionIdentities" ? "identities" : "accounts") && Date.parse(c.view.discovery.expiresAt ?? "") > Date.now(), "invalid_discovery_cursor");
        c.effect = { id: id(), kind: command === "resumeConnection" ? "verify" : command === "connectionIdentities" ? "identities" : "accounts", startedAt: new Date().toISOString() };
        return this.save(c, c.effect.kind === "verify" ? "verifying" : "discovering", "Checking current provider access. Choices are not readiness evidence.");
      });
    });
    if (outcome.replay) return this.view(p, outcome.c);
    if (outcome.c.effect && ["discoverConnectionAccounts", "connectionIdentities", "resumeConnection"].includes(command)) return this.effect(p, outcome.c, input);
    return this.view(p, outcome.c);
  }
  private async effect(p: Principal, c: PrivateConnection, input: Record<string, any>): Promise<ConnectionView> {
    const kind = c.effect!.kind, provider = isAd(c), guard = () => this.guard(p, c, kind === "verify" && !c.view.grantId);
    try {
      const result = await this.options.custody!.useConnection(c.projectId, c.secretRef, c.scopes, guard, async credentials => {
        if (provider === "linkedin") {
          const granted = await this.discovery.linkedinScopes(credentials, c.scopes, guard);
          requireThat(granted.every(s => c.scopes.includes(s)), "provider_scope_missing");
        }
        if (kind === "accounts") return this.discovery.accounts(provider, credentials, input.cursor ? c.cursor!.native : undefined, guard);
        if (kind === "identities") return this.discovery.identities(provider, credentials, c.account!, input.cursor ? c.cursor!.native : undefined, guard);
        return this.discovery.verify(provider, credentials, c.account!, c.identities, operations(c), guard);
      });
      await guard();
      await this.store.transaction(async () => {
        await guard(); c.effect = null;
        if (kind === "verify") {
          if (!c.view.grantId) {
            requireThat(c.bindingDecision && Date.parse(c.bindingDecision.expiresAt) > Date.now(), "project_access_decision_stale");
            const account = result as DiscoveredAccount;
            const g: Grant = { id: `connection:${c.id}`, projectId: c.projectId, revision: 1, provider, accountId: account.id, label: account.label,
              currency: account.currency, timezone: account.timezone, permissions: operations(c), expiresAt: c.expiresAt, revokedAt: null, secretRef: c.secretRef,
              ...(c.identities.find(i => i.kind === "meta_page") ? { pageId: c.identities.find(i => i.kind === "meta_page")!.id } : {}),
              ...(c.identities.find(i => i.kind === "instagram") ? { instagramUserId: c.identities.find(i => i.kind === "instagram")!.id } : {}),
              ...(c.identities.find(i => i.kind === "linkedin_organization") ? { organizationId: c.identities.find(i => i.kind === "linkedin_organization")!.id } : {}),
              selectionOptions: c.identities.filter(i => i.kind !== "google_manager").map(i => ({ id: i.id, label: i.label, kind: i.kind === "meta_page" ? "page" : i.kind === "instagram" ? "instagram" : "organization" })) };
            // Serialized transaction + connection CAS establish one deterministic grant.
            requireThat(!(await this.store.list<Grant>(c.projectId, "grant")).some(x => x.id === g.id), "connection_grant_already_exists");
            await this.store.put(c.projectId, "grant", g.id, g); c.view.grantId = g.id; c.grantRevision = g.revision;
            const setup: Setup = { id: `connection:${c.id}`, projectId: c.projectId, revision: 1, grantId: g.id, state: "ready", reason: "campaign_specific_verification_required", checkpoint: "account_verified", verifiedAt: new Date().toISOString(), capabilities: ["setup", "report"].filter(p => g.permissions.includes(p as Permission)) as Permission[], accountId: g.accountId, handoffUrl: null };
            await this.store.put(c.projectId, "setup", setup.id, setup);
            if (account.managerId) await this.options.custody!.useConnection(c.projectId, c.secretRef, c.scopes, guard, async credentials => {
              await this.options.custody!.retainConnectionCredentials(c.projectId, c.secretRef, { ...credentials, loginCustomerId: account.managerId });
            });
          }
          c.retainUntil = c.expiresAt;
          c.view.accountVerified = stamp(this.evidence, new Date(Math.min(Date.parse(c.expiresAt), Date.now() + 300000)).toISOString(), id());
          c.view.capabilityVerified = { ...emptyEvidence(this.evidence), status: "unavailable", reason: "Campaign-specific material and action checks remain required." };
          await this.save(c, "verified", provider === "linkedin" && !needsPublishingIdentity(operations(c)) ? "Reporting connected. Publishing needs a separate access review and Page access verification." : "Account and selected publishing context verified for the approved connection. Campaign-specific preparation, activation and budget checks remain required.");
        } else {
          const page = result as { rows: DiscoveredAccount[] | DiscoveredIdentity[]; next: string | null };
          const expiresAt = new Date(Math.min(Date.parse(c.retainUntil), Date.now() + 300000)).toISOString();
          if (kind === "accounts") {
            const rows = (page.rows as DiscoveredAccount[]).map(native => ({ native, choice: { choiceRef: id(), label: native.label, businessLabel: native.businessLabel, accountSuffix: native.id.slice(-4), displayId: native.id, currency: native.currency, timezone: native.timezone, timezoneSource: native.timezoneSource, roleSummary: native.roleSummary, limitations: native.limitations } }));
            c.accounts = input.cursor ? [...c.accounts, ...rows] : rows;
            c.account = null; c.identities = []; c.bindingDecision = null; c.view.account = null; c.view.identities = []; c.view.accessReview = null; c.view.consented = emptyEvidence("human_decision");
            c.view.discovery.accounts = c.accounts.map(a => a.choice); c.view.discovery.identities = [];
          } else {
            const rows = (page.rows as DiscoveredIdentity[]).map(native => ({ native, choice: { choiceRef: id(), kind: native.kind, label: native.label, accountSuffix: native.id.slice(-4), displayId: native.id } }));
            c.identityChoices = input.cursor ? [...c.identityChoices, ...rows] : rows; c.view.discovery.identities = c.identityChoices.map(i => i.choice);
          }
          c.cursor = page.next ? { ref: id(), native: page.next, kind } : null;
          c.view.discovery = { ...c.view.discovery, cursor: c.cursor?.ref ?? null, complete: !page.next, expiresAt };
          await this.save(c, kind === "accounts" ? "choosing_account" : "choosing_identity", page.rows.length ? "Choose explicitly from the authenticated provider results." : page.next ? "No choices on this page; more pages remain." : "No eligible choices returned. Check provider account or publishing access, then refresh.");
        }
      });
      return this.view(p, c);
    } catch (error) {
      // Never retain transport messages, URLs, credentials or response bodies.
      await this.auth(p, c.projectId, true);
      const current = await this.store.get<PrivateConnection>(c.projectId, "connection", c.id);
      if (current.revision !== c.revision) return this.view(p, current);
      await this.guard(p, current);
      const code = error instanceof DomainError && ["provider_access_expired_or_denied", "provider_account_context_changed", "provider_identity_mismatch", "provider_account_role_missing", "project_access_decision_stale", "provider_scope_missing", "provider_page_role_missing", "provider_member_mismatch", "provider_member_or_role_changed", "provider_discovery_incomplete"].includes(error.code) ? error.code : "provider_read_unavailable";
      await this.store.transaction(async () => { await this.guard(p, current); current.effect = null; await this.save(current, "failed_retryable", code); });
      return this.view(p, current);
    }
  }
  private async acceptCallback(c: PrivateConnection, cb: Callback) {
    requireThat(cb.status === "received" && cb.actorId === c.actorId && cb.session === c.session && cb.configuration === c.configuration && cb.tokenExpiresAt && Date.parse(cb.tokenExpiresAt) > Date.now(), "callback_outcome_unavailable");
    c.view.providerAuthorized = stamp(this.evidence, cb.tokenExpiresAt, cb.receiptRef); c.view.handoffPath = null;
    return this.save(c, "choosing_account", "Provider consent received. Discover accounts; no project Grant exists yet.");
  }
  private async handoff(p: Principal, project: string, connectionId: string) {
    return this.store.transaction(async () => {
      const c = await this.store.get<PrivateConnection>(project, "connection", connectionId); await this.guard(p, c, true);
      requireThat(c.view.phase === "waiting_human" && c.view.handoffPath && c.providerDecision && Date.parse(c.providerDecision.expiresAt) > Date.now(), "provider_access_decision_required");
      if (c.callbackId) {
        const old = await this.store.get<Callback>(project, "connectionCallback", c.callbackId);
        requireThat(old.status === "prepared" && Date.parse(old.expiresAt) > Date.now(), "original_callback_outcome_required");
        return this.options.custody!.connectionAuthorizationUrl(old.sealed);
      }
      const auth = this.options.custody!.connectionAuthorization(isAd(c), project, c.scopes, c.offline);
      const cb: Callback = { id: auth.stateHash, connectionId, actorId: c.actorId, session: c.session, configuration: c.configuration, revision: 1,
        expiresAt: c.providerDecision.expiresAt, status: "prepared", receiptRef: id(), stateHash: auth.stateHash, sealed: auth.encrypted };
      await this.store.put(project, "connectionCallback", cb.id, cb); c.callbackId = cb.id;
      await this.save(c, "waiting_human", "Waiting for provider consent. Reload returns to this saved handoff.");
      return this.options.custody!.connectionAuthorizationUrl(cb.sealed);
    });
  }
  private async callback(p: Principal, project: string, provider: Provider, state: string, code: string | null) {
    requireThat(/^[A-Za-z0-9_-]{43}$/.test(state), "oauth_state_invalid");
    const key = byteDigest(Buffer.from(state));
    const reserved = await this.store.transaction(async () => {
      const cb = await this.store.get<Callback>(project, "connectionCallback", key);
      const c = await this.store.get<PrivateConnection>(project, "connection", cb.connectionId);
      await this.guard(p, c, true);
      requireThat(isAd(c) === provider && cb.actorId === p.userId && cb.session === c.session && cb.configuration === c.configuration && c.callbackId === cb.id, "oauth_state_invalid");
      if (cb.status !== "prepared") return { c, cb, run: false };
      requireThat(Date.parse(cb.expiresAt) > Date.now() && c.view.phase === "waiting_human", "oauth_state_invalid");
      cb.status = code ? "exchanging" : "denied"; cb.revision++;
      await this.store.put(project, "connectionCallback", key, cb, cb.revision - 1);
      c.causationRef = `callback:${cb.receiptRef}`;
      await this.save(c, code ? "reconciling" : "cancelled", code ? "Receiving provider authorization. Repeated callbacks never exchange again." : "Provider consent declined. No project Grant created.");
      return { c, cb, run: !!code };
    });
    if (!reserved.run) return;
    const { c, cb } = reserved;
    try {
      const credentials = await this.options.custody!.exchangeConnection(provider, project, code!, cb.sealed, c.scopes, c.offline, () => this.guard(p, c, true));
      // Restricted encrypted receipt is durable BEFORE acknowledgement or public success.
      await this.store.transaction(async () => {
        const original = await this.store.get<Callback>(project, "connectionCallback", key);
        requireThat(original.status === "exchanging", "original_callback_outcome_required");
        await this.options.custody!.retainConnectionCredentials(project, c.secretRef, credentials);
        original.status = "received"; original.tokenExpiresAt = new Date(credentials.expiresAt).toISOString(); original.revision++;
        await this.store.put(project, "connectionCallback", key, original, original.revision - 1);
      });
      await this.guard(p, c, true);
      await this.store.transaction(async () => { await this.guard(p, c, true); await this.acceptCallback(c, await this.store.get<Callback>(project, "connectionCallback", key)); });
    } catch {
      // Unknown is a durable effect outcome, not proof that OAuth had no effect.
      await this.store.transaction(async () => {
        const original = await this.store.get<Callback>(project, "connectionCallback", key);
        if (original.status === "exchanging") { original.status = "unknown"; original.revision++; await this.store.put(project, "connectionCallback", key, original, original.revision - 1); }
        const current = await this.store.get<PrivateConnection>(project, "connection", c.id);
        if (current.revision === c.revision) await this.save(current, "outcome_unknown", "Provider authorization outcome requires reconciliation. The consumed code will never be replayed.");
      });
    }
  }
  /** Fetch-compatible SDK routes. Host adapts Request/Response and existing authentication only.
   * Call before legacy OAuth routes. Redact callback query strings in upstream access logs. */
  routes(config: { authenticate(request: Request): Promise<Principal>; origin: string; returnPath?: string }) {
    requireThat(!this.options.custody || config.origin === this.options.custody.origin, "callback_origin_mismatch");
    requireThat(config.returnPath === undefined || /^\/[a-zA-Z0-9/_-]*$/.test(config.returnPath) && !config.returnPath.startsWith("//"), "invalid_connection_return_path");
    const creativeRoutes = this.options.creative?.routes(config);
    return async (request: Request): Promise<Response | null> => {
      const creative = await creativeRoutes?.(request); if (creative) return creative;
      const url = new URL(request.url);
      const handoff = /^\/api\/projects\/([^/]+)\/connections\/([^/]+)\/handoff$/.exec(url.pathname);
      const callback = /^\/api\/oauth\/([^/]+)\/(meta|google|linkedin)\/callback$/.exec(url.pathname);
      if (!handoff && !callback) return null;
      const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" };
      // Always scrub callback code/state, including denied, expired and foreign-session returns.
      const safeReturn = config.origin + (config.returnPath ?? "/");
      try {
        requireThat(request.method === "GET" && url.origin === config.origin, "invalid_connection_route", 403);
        const p = await config.authenticate(request);
        if (handoff) {
          requireThat([null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site")), "cross_origin_handoff_denied", 403);
          const location = await this.handoff(p, decodeURIComponent(handoff[1]!), decodeURIComponent(handoff[2]!));
          return new Response(null, { status: 303, headers: { ...headers, location } });
        }
        if (!this.options.custody) return null;
        const project = decodeURIComponent(callback![1]!);
        await this.store.authorize(p, project);
        const state = url.searchParams.get("state") ?? "";
        // Compatibility: an original grant-only state belongs to the legacy handler.
        const stateHash = byteDigest(Buffer.from(state));
        try { await this.store.get(project, "connectionCallback", stateHash); }
        catch (e) { if (e instanceof DomainError && e.code === "not_found") {
          try { await this.store.get(project, "oauth", stateHash); return null; } catch { /* unknown callback is scrubbed below */ }
        } }
        await this.callback(p, project, callback![2] as Provider, state, url.searchParams.get("code"));
        return new Response(null, { status: 303, headers: { ...headers, location: safeReturn } });
      } catch {
        return callback ? new Response(null, { status: 303, headers: { ...headers, location: safeReturn } }) : new Response("Secure continuation unavailable. Return to Connections and check the saved outcome.", { status: 409, headers });
      }
    };
  }
  async call<K extends keyof ConnectionCommands>(p: Principal, project: string, command: K, input: ConnectionCommands[K]["input"]): Promise<ConnectionCommands[K]["output"]> {
    requireThat(Object.hasOwn(connectionCommandFields, command), "unknown_command", 404); keys(input, connectionCommandFields[command]);
    await this.auth(p, project);
    let result: ConnectionCatalogue | ConnectionView;
    if (command === "connections") result = await this.catalogue(p, project);
    else if (command === "startConnection") result = await this.start(p, project, input as ConnectionCommands["startConnection"]["input"]);
    else if (command === "connection") {
      const v = input as ConnectionCommands["connection"]["input"]; requireThat(!!v.connectionId !== !!v.startRequestKey, "connection_reference_required", 422);
      let cid = v.connectionId;
      if (v.startRequestKey) { const receipt = await this.store.db.prepare("SELECT record_id FROM requests WHERE project_id=? AND request_key=? AND kind='connection'").get(project, this.requestId(p, v.startRequestKey)); requireThat(receipt, "not_found", 404); cid = String(receipt.record_id); }
      result = await this.view(p, await this.store.get<PrivateConnection>(project, "connection", cid!));
    } else result = await this.mutate(p, project, command, input as ConnectionTransition & Record<string, any>);
    return result as ConnectionCommands[K]["output"];
  }
}
