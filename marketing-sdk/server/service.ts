import type { AudienceContext, AudienceCommands, AudienceChoice, AudienceSelection, AudienceSearch } from "../core/audience.js";
import { countryCode } from "./countries.js";
import { HostAgent } from "./agent.js";
import { NativeProvider } from "./providers.js";
import { prerequisiteBinding, currentPrerequisite, NATIVE_PREREQUISITE_CONTRACT, type PrerequisiteRecord } from "./preflight.js";
import type { CampaignCheckCommands } from "../core/preflight.js";
import { sessionBinding, assertSessionInspection, inspectLiveSessions, type SessionInspection } from "./session-authority.js";
import { MarketingTracking, trackingCommandFields, type TrackingOptions, type ValidatedCoverage } from "./tracking.js";
import type { TrackingCommands } from "../core/tracking.js";
import { CampaignStudio, studioCommandFields, type StudioOptions } from "./studio.js";
import type { StudioCommands } from "../core/studio.js";
import { createConnections, connectionCommandFields, type MarketingConnectionsService } from "./connections.js";
import type { ConnectionCommands } from "../core/connections.js";
import { validateAccountCapability } from "./capabilities.js";
import { capabilityBlockers, providerBudgetBlockers } from "../core/index.js";
import type {
  Asset,
  Campaign,
  CampaignDraft,
  Command,
  Commands,
  Conversation,
  Decision,
  FirstPartyEvent,
  GenerationGrant,
  GenerationJob,
  Grant,
  Metric,
  Metrics,
  Operation,
  Packet,
  Permission,
  Receipt,
  Results,
  Setup,
  Workspace,
} from "../core/index.js";
import type {
  AgentPort,
  GenerationOutput,
  GenerationPort,
  ProviderPort,
} from "./ports.js";
import {
  Store,
  type Principal,
  byteDigest,
  digest,
  id,
  requireThat,
  DomainError,
} from "./store.js";
import { draftMaterial, instant, keys, material, text } from "./validation.js";
import { capturePublicDestination } from "./destination.js";
import { AdvertisingBudgets } from "./budgets.js";
import { providerDayWindow } from "./reporting.js";
import { inspectMedia } from "./generation.js";
interface AudienceDisplay { id: string; scope: string; query: string; code: string; label: string; expiresAt: number; }
interface AudienceCursor { scope: string; query: string; expiresAt: number; after: string; pages: number; seen: string[]; identities: Record<string, string>; }
interface AudienceCache { scope: string; query: string; expiresAt: number; view: AudienceSearch; }
interface CampaignSave { c: Campaign; grant: string; previous: string | null; assets: string; }
const EDIT = ["admin", "editor"] as const;
const HUMAN = ["admin", "approver"] as const;
const valid = (expiry: string, revoked: string | null, now: number) =>
  !revoked && Date.parse(expiry) > now;
const metric = (value: number | null, reason = "not_observed"): Metric => ({
  value,
  reason: value === null ? reason : null,
});
const ratio = (n: number | null, d: number | null): Metric =>
  metric(
    n !== null && d !== null && d > 0 ? n / d : null,
    d === 0 ? "zero_denominator" : "missing_input",
  );
export class MarketingServer {
  /** Real local persistence with explicitly unavailable provider/generation capabilities.
   * Hosts can later construct a server with their authorized native ports. */
  static unconnected(store: Store, options: { studio?: StudioOptions; tracking?: TrackingOptions } = {}) {
    const unavailable = (): never => { throw new DomainError("provider_connection_required"); };
    const provider: ProviderPort = {
      evidence: "provider", verify: unavailable, plan: unavailable, prepare: unavailable,
      activate: unavailable, pause: unavailable, reconcile: unavailable, metrics: unavailable,
    };
    return new MarketingServer(store, { meta: provider, google: provider, linkedin: provider },
      { evidence: "generated", validate: unavailable, submit: unavailable, reconcile: unavailable },
      { inspect: unavailable }, "live", undefined, undefined, options);
  }
  constructor(
    readonly store: Store,
    readonly providers: Record<Grant["provider"], ProviderPort>,
    readonly generation: GenerationPort,
    readonly agent: AgentPort,
    readonly mode: "fixture" | "live",
    readonly now = () => Date.now(),
    readonly readDestination = capturePublicDestination,
    readonly options: { connections?: MarketingConnectionsService; studio?: StudioOptions; tracking?: TrackingOptions } = {},
  ) {
    requireThat(!options.connections || options.connections.store === store, "connections_store_mismatch");
    requireThat(mode === "fixture" || Object.values(providers).every(provider => provider.evidence === "provider"), "fixture_provider_requires_fixture_mode");
  }
  private trackingService?: MarketingTracking;
  get tracking(): MarketingTracking { return this.trackingService ??= new MarketingTracking(this.store, this.studio.sessions, this.options.tracking ?? {}, (project, input) => this.recordEvent(project, input), this.mode, this.now); }
  private studioService?: CampaignStudio;
  get studio(): CampaignStudio { return this.studioService ??= new CampaignStudio(this.store, { ...this.options.studio, tracking: (p, project, owner) => this.tracking.tracking(p, project, { owner }), withTracking: (p, project, view, local) => this.tracking.withCurrentView(p, project, view, local), withPromotion: (p, project, draftId, local) => this.tracking.withPromotion(p, project, draftId, local) }, this.mode, this.now); }
  private defaultConnections?: MarketingConnectionsService;
  get connections() { return this.options.connections ?? (this.defaultConnections ??= createConnections({ store: this.store, evidence: this.mode === "fixture" ? "fixture" : "provider" })); }
  get advertisingBudgets() { return new AdvertisingBudgets(this.store, this.now, this.mode === "fixture" ? "fixture" : "provider"); }
  private async auth(p: Principal, project: string, write = false) {
    return await this.store.authorize(
      p,
      project,
      write ? [...EDIT] : undefined,
    );
  }
  private async grant(
    project: string,
    grantId: string,
    permission?: Permission,
  ): Promise<Grant> {
    const g = await this.store.get<Grant>(project, "grant", grantId);
    requireThat(
      valid(g.expiresAt, g.revokedAt, this.now()),
      "grant_expired_or_revoked",
    );
    requireThat(
      !permission || g.permissions.includes(permission),
      "grant_permission_denied",
      403,
    );
    return g;
  }
  private async assets(c: Campaign, decode = true, observed?: Map<string, Buffer>): Promise<Asset[]> {
    if (this.mode === "live") {
      const snapshot = await this.store.get<{
        url: string;
        source: string;
      }>(c.projectId, "destination", c.material.destinationDigest);
      requireThat(
        snapshot.url === c.material.destination &&
          snapshot.source === "public_https",
        "destination_snapshot_mismatch",
      );
    }
    return await Promise.all(
      c.material.assetIds.map(async (key) => {
        const a = await this.store.get<Asset>(c.projectId, "asset", key);
        requireThat(
          a.campaignId === c.id && a.kind !== "storyboard" && a.rightsReceipt,
          "material_not_ready",
        );
        const b = await this.store.db
          .prepare("SELECT bytes FROM blobs WHERE project_id=? AND digest=?")
          .get(c.projectId, a.digest);
        requireThat(
          b && byteDigest(b.bytes as Uint8Array) === a.digest,
          "asset_bytes_missing_or_changed",
        );
        requireThat(
          this.mode === "fixture" || a.source !== "fixture",
          "fixture_not_live_material",
        );
        if (decode) await inspectMedia(b.bytes as Uint8Array, a.kind, a.mime);
        observed?.set(a.digest, Buffer.from(b.bytes as Uint8Array));
        return a;
      }),
    );
  }
  private async request<T>(
    project: string,
    key: string,
    payload: unknown,
    kind: string,
    create: () =>
      | (T & {
          id: string;
        })
      | Promise<
          T & {
            id: string;
          }
        >,
  ): Promise<T> {
    text(key, 160);
    return await this.store.transaction(async () => {
      const hash = digest(payload);
      const old = await this.store.db
        .prepare("SELECT * FROM requests WHERE project_id=? AND request_key=?")
        .get(project, key);
      if (old) {
        requireThat(
          old.digest === hash && old.kind === kind,
          "request_key_payload_conflict",
        );
        return await this.store.get<T>(project, kind, String(old.record_id));
      }
      const record = await create();
      await this.store.put(project, kind, record.id, record);
      await this.store.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?,?)")
        .run(project, key, hash, kind, record.id);
      await this.store.append(project, record.id, `${kind}.created`, {
        id: record.id,
      });
      return record;
    });
  }
  private async requestResult<T>(project: string, key: string, payload: unknown, kind: string): Promise<T | null> {
    text(key, 160);
    const row = await this.store.db.prepare("SELECT * FROM requests WHERE project_id=? AND request_key=?").get(project, key);
    if (!row) return null;
    requireThat(row.digest === digest(payload) && row.kind === kind, "request_key_payload_conflict");
    return this.store.get<T>(project, kind, String(row.record_id));
  }
  async workspace(p: Principal, project: string): Promise<Workspace> {
    return await this.store.transaction(async () => {
      const member = await this.auth(p, project);
      const row = (await this.store.db
        .prepare("SELECT id,name FROM projects WHERE id=?")
        .get(project))!;
      return {
        nativePrerequisiteProviders: Object.entries(this.providers).filter(([, provider]) => provider instanceof NativeProvider).map(([name]) => name as Grant["provider"]),
        project: {
          id: project,
          name: String(row.name),
        },
        role: member.role,
        principalKind: member.kind,
        mode: this.mode,
        grants: (await this.store.list<Grant>(project, "grant")).map(
          ({ secretRef: _secret, ...g }) => g,
        ),
        generationGrants: (
          await this.store.list<GenerationGrant>(project, "generationGrant")
        ).map(({ billingCapabilityRef: _ref, ...g }) => g),
        campaigns: await this.store.list(project, "campaign"),
        drafts: await this.store.list(project, "campaignDraft"),
        planningWrites: await this.pendingPlanningWrites(p, project),
        planningScope: this.planningScope(p, project),
        setups: await this.store.list(project, "setup"),
        assets: await this.store.list(project, "asset"),
        jobs: await this.store.list(project, "job"),
        packets: await this.store.list(project, "packet"),
        decisions: await this.store.list(project, "decision"),
        operations: await this.store.list(project, "operation"),
      };
    });
  }
  private async pendingPlanningWrites(p: Principal, project: string) {
    const acknowledged = new Set((await this.store.list<{ id: string }>(project, "planningAcknowledgment")).map(w => w.id));
    return (await this.store.list<import("../core/index.js").PlanningWrite>(project, "planningWrite"))
      .filter(w => w.actorId === p.userId && !acknowledged.has(w.id));
  }
  private planningScope(p: Principal, project: string) {
    return digest(["planning-scope", project, p.userId, p.sessionTokenHash ?? p.externalSessionRef ?? null, p.externalIdentity ?? null]);
  }
  /** Opt-in UI write envelope. An unacknowledged result survives new keys,
   * changed forms/targets/revisions and process loss. Existing callers retain
   * their explicit request-key contract. No new table or provider operation. */
  async planningWrite(p: Principal, project: string, input: Commands["planningWrite"]["input"]) {
    requireThat(["saveCampaign", "saveDraft", "promoteDraft"].includes(input.command), "invalid_planning_command", 422);
    if (input.command === "saveDraft") return this.planningWriteLocal(p, project, input);
    const save = input.command === "saveCampaign" ? input.input : { grantId: input.input.grantId, material: input.input.material };
    return this.withCampaignSave(p, project, save, prepared => this.planningWriteLocal(p, project, input, prepared), async () => {
      const { key, payload } = await this.planningWriteIntent(p, project, input);
      return this.requestResult<import("../core/index.js").PlanningWrite>(project, key, payload, "planningWrite");
    });
  }
  private async planningWriteIntent(p: Principal, project: string, input: Commands["planningWrite"]["input"]) {
      await this.auth(p, project, true);
      requireThat(["saveCampaign", "saveDraft", "promoteDraft"].includes(input.command), "invalid_planning_command", 422);
      requireThat(input.scope === this.planningScope(p, project), "planning_session_changed");
      text(input.requestKey);
      const key = `planning:${digest([p.userId, input.requestKey])}`;
      const pending = (await this.pendingPlanningWrites(p, project))[0];
      requireThat(!pending || pending.id === key, "unresolved_planning_write_review_required");
      // Recheck grant and revision even when recovering an immutable receipt.
      let grantDigest: string | undefined;
      if (input.command !== "saveDraft") {
        const g = await this.grant(project, input.input.grantId);
        grantDigest = digest(g);
        if (input.command === "promoteDraft") requireThat(g.revision === input.input.expectedGrantRevision, "grant_changed");
      }
      if (input.command === "promoteDraft") {
        const draft = await this.store.get<CampaignDraft>(project, "campaignDraft", input.input.draftId);
        requireThat(draft.revision === input.input.expectedRevision, "revision_conflict");
      }
      // The scope must be fresh, but is not part of the immutable intent: after
      // signing in again the same actor can inspect/recover its original result.
      const { scope: _scope, ...intent } = input;
      return { key, payload: { actorId: p.userId, grantDigest, ...intent } };
  }
  private async planningWriteLocal(p: Principal, project: string, input: Commands["planningWrite"]["input"], prepared?: CampaignSave) {
    return this.store.transaction(async () => {
      const { key, payload } = await this.planningWriteIntent(p, project, input);
      return this.request<import("../core/index.js").PlanningWrite>(project, key, payload, "planningWrite", async () => {
        const result = input.command === "saveCampaign" ? await this.saveCampaignLocal(p, project, input.input, prepared!)
          : input.command === "promoteDraft" ? await this.promoteDraftLocal(p, project, input.input, prepared!)
          : await this.saveDraft(p, project, input.input);
        await this.auth(p, project, true);
        return { id: key, actorId: p.userId, command: input.command, result, acknowledged: false };
      });
    });
  }
  async acknowledgePlanningWrite(p: Principal, project: string, input: Commands["acknowledgePlanningWrite"]["input"]) {
    return this.store.transaction(async () => {
      await this.auth(p, project, true);
      const w = await this.store.get<import("../core/index.js").PlanningWrite>(project, "planningWrite", input.id);
      requireThat(w.actorId === p.userId, "forbidden", 403);
      const next = { ...w, acknowledged: true };
      await this.store.put(project, "planningAcknowledgment", w.id, { id: w.id, actorId: p.userId });
      return next;
    });
  }
  async captureDestination(
    p: Principal,
    project: string,
    input: Commands["captureDestination"]["input"],
  ) {
    const session = await this.reportSession(p, project);
    await this.reportGuard(p, session, true, async () => {});
    text(input.url, 2000);
    const url = new URL(input.url);
    requireThat(
      url.protocol === "https:" && !url.username && !url.password,
      "https_destination_required",
      422,
    );
    const bytes =
      this.mode === "fixture"
        ? Buffer.from(`Synthetic destination descriptor only: ${input.url}`)
        : await this.readDestination(input.url);
    const snapshot = {
      digest: byteDigest(bytes),
      url: input.url,
      source:
        this.mode === "fixture"
          ? ("fixture" as const)
          : ("public_https" as const),
      observedAt: new Date(this.now()).toISOString(),
    };
    await this.reportGuard(p, session, true, async () => {
      await this.store.db
        .prepare("INSERT OR IGNORE INTO blobs VALUES(?,?,?)")
        .run(project, snapshot.digest, bytes);
      await this.store.put(project, "destination", snapshot.digest, snapshot);
    });
    return snapshot;
  }
  // Preserve trusted server-only legacy principals; browser/external sessions
  // retain the stronger coordinated host guard and exact inspection.
  private async legacyAuthority(p: Principal, project: string) {
    const member = await this.auth(p, project, true);
    return { member: digest(member), session: p.sessionTokenHash || p.externalSessionRef || p.externalIdentity
      ? await this.reportSession(p, project) : null };
  }
  private async assertLegacyAuthority(p: Principal, project: string, expected: Awaited<ReturnType<MarketingServer["legacyAuthority"]>>) {
    if (expected.session) await inspectLiveSessions(this.studio.sessions, [expected.session]);
    requireThat(digest(await this.auth(p, project, true)) === expected.member, "session_authority_changed");
  }
  private async legacyGuard<T>(p: Principal, project: string, expected: Awaited<ReturnType<MarketingServer["legacyAuthority"]>>, local: () => Promise<T>) {
    const commit = () => this.store.transaction(async () => {
      await this.assertLegacyAuthority(p, project, expected);
      const result = await local();
      await this.assertLegacyAuthority(p, project, expected); return result;
    });
    return expected.session ? this.studio.sessions.withLiveSessions([expected.session], commit) : commit();
  }
  /** Local binding only. Remote custody and provider work belongs outside guards. */
  private async legacySetupBinding(project: string, g: Grant) {
    const sealed = await this.store.get(project, "vault", g.secretRef).catch(error => {
      if (error instanceof DomainError && error.code === "not_found") return null;
      throw error;
    });
    return digest({ grant: g, sealed, configuration: this.agent instanceof HostAgent
      ? { origin: this.agent.origin, apps: this.agent.apps } : null });
  }
  async setup(p: Principal, project: string, input: Commands["setup"]["input"]) {
    const session = await this.legacyAuthority(p, project);
    let created = false;
    const s = await this.legacyGuard(p, project, session, async () => {
      const g = await this.grant(project, input.grantId, "setup");
      return this.request<Setup>(project, input.requestKey,
        { type: "setup", grantId: g.id, revision: g.revision }, "setup", async () => {
          requireThat(!(await this.store.list<{grantId:string;state:string}>(project, "legacySetupAttempt")).some(a => a.grantId === g.id && a.state === "running"), "setup_outcome_unknown");
          created = true;
          return { id: id(), projectId: project, revision: 1, grantId: g.id,
            state: "requested", checkpoint: "native_account_verification", accountId: g.accountId,
            reason: null, verifiedAt: null, capabilities: [], handoffUrl: null };
        });
    });
    // The original intent commits before a possibly effectful host inspection.
    if (!created) return s;
    return this.resumeSetup(p, project, { setupId: s.id, expectedRevision: s.revision });
  }
  async resumeSetup(p: Principal, project: string, input: Commands["resumeSetup"]["input"]) {
    const session = await this.legacyAuthority(p, project);
    const admitted = await this.legacyGuard(p, project, session, async () => {
      const s = await this.store.get<Setup>(project, "setup", input.setupId);
      requireThat(s.revision === input.expectedRevision, "revision_conflict");
      const g = await this.grant(project, s.grantId, "setup");
      const key = `${s.id}:${s.revision}`;
      const old = await this.store.get(project, "legacySetupAttempt", key).catch(error => {
        if (error instanceof DomainError && error.code === "not_found") return null;
        throw error;
      });
      if (old) return { s, g, key, binding: "", created: false };
      requireThat(!(await this.store.list<{grantId:string;state:string}>(project, "legacySetupAttempt")).some(a => a.grantId === g.id && a.state === "running"), "setup_outcome_unknown");
      const binding = await this.legacySetupBinding(project, g);
      await this.store.put(project, "legacySetupAttempt", key, {
        id: key, grantId: g.id, state: "running", binding, session, actorId: p.userId,
        setupRevision: s.revision, createdAt: new Date(this.now()).toISOString(),
      });
      // A duplicate or process restart observes uncertainty, never repeats effects.
      await this.store.put(project, "setup", s.id, { ...s, state: "requested",
        checkpoint: "setup_outcome_unknown", reason: "setup_in_progress_or_outcome_unknown" }, s.revision);
      return { s, g, key, binding, created: true };
    });
    if (!admitted.created) return admitted.s;
    const { s, g, key, binding } = admitted;
    const fresh = async () => {
      await this.assertLegacyAuthority(p, project, session);
      await this.auth(p, project, true);
      const current = await this.grant(project, g.id, "setup");
      requireThat(await this.legacySetupBinding(project, current) === binding, "grant_changed");
      const currentSetup = await this.store.get<Setup>(project, "setup", s.id);
      requireThat(currentSetup.revision === s.revision && currentSetup.checkpoint === "setup_outcome_unknown", "revision_conflict");
    };
    let next: Setup, externalPending = false;
    try {
      await fresh();
      externalPending = true;
      const handoff = await this.agent.inspect(s, g);
      externalPending = false;
      await fresh();
      if (handoff.state !== "ready") next = { ...s, ...handoff, revision: s.revision + 1 };
      else {
        externalPending = true;
        const v = await this.providers[g.provider].verify(g);
        externalPending = false;
        await fresh();
        requireThat(v.accountId === g.accountId && v.currency === g.currency && v.timezone === g.timezone, "account_identity_mismatch");
        requireThat(g.permissions.every(x => x === "setup" || v.permissions.includes(x) ||
          (g.provider === "google" && ["prepare", "activate", "pause"].includes(x))), "provider_capability_missing");
        next = { ...s, revision: s.revision + 1, state: "ready",
          reason: g.provider === "google" && !v.permissions.includes("prepare") ? "write_capability_requires_exact_plan_validation" : null,
          handoffUrl: null, checkpoint: "verified", verifiedAt: new Date(this.now()).toISOString(), capabilities: v.permissions };
      }
    } catch (error) {
      if (externalPending) {
        // The callback may have performed an effect before losing acknowledgement.
        // Retain the original fence across all request keys; no automatic replay.
        return this.legacyGuard(p, project, session, async () => {
          await fresh(); return this.store.get<Setup>(project, "setup", s.id);
        });
      }
      next = { ...s, revision: s.revision + 1, state: "blocked",
        reason: error instanceof DomainError ? error.code : "provider_verification_unavailable", handoffUrl: null };
    }
    return this.legacyGuard(p, project, session, async () => {
      await fresh();
      await this.store.put(project, "setup", s.id, next, s.revision);
      await this.store.put(project, "legacySetupAttempt", key, { id: key, grantId: g.id, state: "completed", binding, session, result: next });
      await this.store.append(project, s.id, "setup.changed", { state: next.state });
      return next;
    });
  }
  async saveDraft(p: Principal, project: string, input: Commands["saveDraft"]["input"]): Promise<CampaignDraft> {
    return this.store.transaction(async () => {
      await this.auth(p, project, true);
      keys(input, ["id", "expectedRevision", "requestKey", "material"]);
      draftMaterial(input.material);
      if (input.id !== undefined) text(input.id);
      requireThat(input.id !== undefined
        ? Number.isSafeInteger(input.expectedRevision) && input.expectedRevision! > 0
        : input.expectedRevision === undefined, "invalid_draft_revision", 422);
      // Immutable write receipts make retries return the original result even
      // after later edits. Auth is always rechecked before looking up a receipt.
      const write = await this.request<{ id: string; draft: CampaignDraft }>(
        project, input.requestKey, { command: "saveDraft", actorId: p.userId, ...input },
        "campaignDraftWrite", async () => {
          const old = input.id ? await this.store.get<CampaignDraft>(project, "campaignDraft", input.id) : null;
          if (old) { requireThat(old.revision === input.expectedRevision, "revision_conflict"); requireThat(!old.studio, "use_studio_editor"); }
          const draft: CampaignDraft = {
            id: old?.id || id(), projectId: project, revision: (old?.revision || 0) + 1,
            state: "draft", connection: "unconnected", grantId: null, receipt: null,
            material: input.material,
          };
          await this.store.put(project, "campaignDraft", draft.id, draft, old?.revision);
          await this.store.append(project, draft.id, "draft.changed", { revision: draft.revision, actorId: p.userId });
          return { id: `${draft.id}:${draft.revision}`, draft };
        });
      return write.draft;
    });
  }
  /** Planning-only promotion, serialized by the existing SQL transaction guard.
   * A revision/account has one owner binding, independent of client retry keys.
   * Different actors cannot claim the original actor's promotion receipt. */
  async promoteDraft(p: Principal, project: string, input: Commands["promoteDraft"]["input"]): Promise<Campaign> {
    return this.withCampaignSave(p, project, { grantId: input.grantId, material: input.material },
      prepared => this.promoteDraftLocal(p, project, input, prepared));
  }
  private async promoteDraftLocal(p: Principal, project: string, input: Commands["promoteDraft"]["input"], prepared: CampaignSave): Promise<Campaign> {
    return this.store.transaction(async () => {
      await this.auth(p, project, true);
      keys(input, ["draftId", "expectedRevision", "grantId", "expectedGrantRevision", "material"]);
      text(input.draftId); text(input.grantId);
      requireThat(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0 &&
        Number.isSafeInteger(input.expectedGrantRevision) && input.expectedGrantRevision > 0, "invalid_draft_revision", 422);
      const g = await this.grant(project, input.grantId);
      requireThat(g.revision === input.expectedGrantRevision, "grant_changed");
      const draft = await this.store.get<CampaignDraft>(project, "campaignDraft", input.draftId);
      requireThat(!draft.studio, "use_studio_promotion");
      requireThat(draft.revision === input.expectedRevision, "revision_conflict");
      // Same physical target account through another grant must not duplicate it.
      const binding = `promotion:${digest([project, draft.id, draft.revision, g.provider, g.accountId])}`;
      const write = await this.request<{ id: string; campaign: Campaign; source: CampaignDraft }>(project, binding,
        { command: "promoteDraft", actorId: p.userId, ...input }, "draftPromotion", async () => {
          const campaign = await this.saveCampaignLocal(p, project, { grantId: g.id, material: input.material }, prepared);
          requireThat(digest(await this.grant(project, g.id)) === digest(g), "grant_changed");
          requireThat((await this.store.get<CampaignDraft>(project, "campaignDraft", draft.id)).revision === draft.revision, "revision_conflict");
          campaign.draftOrigin = { draftId: draft.id, revision: draft.revision, actorId: p.userId,
            materialDigest: digest(draft.material), accountId: g.accountId };
          await this.store.put(project, "campaign", campaign.id, campaign, campaign.revision);
          await this.store.put(project, "campaignVersion", `${campaign.id}:${campaign.revision}`, campaign);
          return { id: binding, campaign, source: draft };
        });
      return write.campaign;
    });
  }
  private async withCampaignSave<T>(p: Principal, project: string, input: Commands["saveCampaign"]["input"], local: (prepared: CampaignSave) => Promise<T>, replay?: () => Promise<T | null>) {
    const session = await this.legacyAuthority(p, project);
    const prepared = await this.legacyGuard(p, project, session, async () => {
      const recovered = await replay?.();
      if (recovered) return { recovered };
      const g = await this.grant(project, input.grantId);
      material(input.material, g.provider);
      const blockers = capabilityBlockers(input.material, g);
      requireThat(!blockers.length, blockers[0] || "unsupported_capability", 422);
      requireThat(input.material.budget.currency === g.currency && input.material.timezone === g.timezone, "account_currency_or_timezone_mismatch");
      const old = input.id ? await this.store.get<Campaign>(project, "campaign", input.id) : null;
      const c: Campaign = { id: old?.id ?? id(), projectId: project, revision: (old?.revision ?? 0) + 1,
        grantId: g.id, creativeSetId: old?.creativeSetId ?? id(), ...(old?.draftOrigin ? { draftOrigin: old.draftOrigin } : {}),
        material: structuredClone(input.material), state: "draft", receipt: null };
      return { c, grant: await this.legacySetupBinding(project, g), previous: old ? digest(old) : null, assets: "" };
    });
    if ("recovered" in prepared) return prepared.recovered!;
    // Ownership/byte reads and native decoding finish before final admission.
    const observed = new Map<string, Buffer>();
    prepared.assets = digest(await this.assets(prepared.c, true, observed));
    return this.legacyGuard(p, project, session, async () => {
      const g = await this.grant(project, input.grantId);
      requireThat(await this.legacySetupBinding(project, g) === prepared.grant, "grant_changed");
      const old = input.id ? await this.store.get<Campaign>(project, "campaign", input.id) : null;
      requireThat((old ? digest(old) : null) === prepared.previous, "revision_conflict");
      // Compare the observed bytes in SQL without fetching/decoding media while
      // holding revocation guards. Metadata and byte changes both reject commit.
      const assets = await Promise.all(prepared.c.material.assetIds.map(key => this.store.get<Asset>(project, "asset", key)));
      requireThat(digest(assets) === prepared.assets, "material_changed");
      for (const [hash, bytes] of observed) requireThat(await this.store.db.prepare(
        "SELECT 1 AS present FROM blobs WHERE project_id=? AND digest=? AND bytes=?",
      ).get(project, hash, bytes), "asset_bytes_missing_or_changed");
      if (this.mode === "live") {
        const destination = await this.store.get<{url: string; source: string}>(project, "destination", prepared.c.material.destinationDigest);
        requireThat(destination.url === prepared.c.material.destination && destination.source === "public_https", "destination_snapshot_mismatch");
      }
      return local(prepared);
    });
  }
  async saveCampaign(p: Principal, project: string, input: Commands["saveCampaign"]["input"]) {
    return this.withCampaignSave(p, project, input, prepared => this.saveCampaignLocal(p, project, input, prepared), async () => {
      const g = await this.grant(project, input.grantId);
      material(input.material, g.provider);
      const blockers = capabilityBlockers(input.material, g); requireThat(!blockers.length, blockers[0] || "unsupported_capability", 422);
      if (input.requestKey === undefined) return null;
      const write = await this.requestResult<{campaign: Campaign}>(project, input.requestKey,
        { command: "saveCampaign", actorId: p.userId, grantRevision: g.revision, ...input }, "campaignWrite");
      return write?.campaign ?? null;
    });
  }
  private async saveCampaignLocal(p: Principal, project: string, input: Commands["saveCampaign"]["input"], prepared: CampaignSave) {
    return await this.store.transaction(async () => {
      await this.auth(p, project, true);
      const g = await this.grant(project, input.grantId);
      material(input.material, g.provider);
      const blockers = capabilityBlockers(input.material, g);
      requireThat(!blockers.length, blockers[0] || "unsupported_capability", 422);
      requireThat(
        input.material.budget.currency === g.currency &&
          input.material.timezone === g.timezone,
        "account_currency_or_timezone_mismatch",
      );
      const save = async () => {
        const old = input.id
          ? await this.store.get<Campaign>(project, "campaign", input.id)
          : null;
        if (old) {
          requireThat(
            old.revision === input.expectedRevision,
            "revision_conflict",
          );
          requireThat(
            old.state === "draft" || old.state === "paused",
            "pause_and_reconcile_before_edit",
          );
          requireThat(
            !(await this.store.list<Operation>(project, "operation")).some(
              (o) =>
                o.campaignId === old.id &&
                ["queued", "running", "unknown"].includes(o.state),
            ),
            "execution_pending",
          );
          requireThat(
            old.grantId === g.id,
            "account_change_requires_new_campaign",
          );
        }
        const c = prepared.c;
        requireThat(c.grantId === g.id && digest(c.material) === digest(input.material), "material_changed");
        await this.auth(p, project, true);
        const currentGrant = await this.grant(project, g.id);
        requireThat(digest(currentGrant) === digest(g), "grant_changed");
        await this.store.put(project, "campaign", c.id, c, old?.revision);
        await this.store.put(
          project,
          "campaignVersion",
          `${c.id}:${c.revision}`,
          c,
        );
        await this.store.put(
          project,
          "audience",
          `${c.id}:${c.revision}`,
          c.material.audience,
        );
        await this.store.append(project, c.id, "campaign.changed", {
          revision: c.revision,
        });
        return c;
      };
      if (input.requestKey === undefined) return save();
      const write = await this.request<{ id: string; campaign: Campaign }>(project, input.requestKey,
        { command: "saveCampaign", actorId: p.userId, grantRevision: g.revision, ...input }, "campaignWrite", async () => {
          const campaign = await save();
          return { id: `${campaign.id}:${campaign.revision}`, campaign };
        });
      return write.campaign;
    });
  }
  private async reserve(
    p: Principal,
    project: string,
    campaignId: string,
    kind: Operation["kind"],
    key: string,
    packetId: string | null = null,
  ) {
    await this.auth(p, project, kind !== "activate");
    const c = await this.store.get<Campaign>(project, "campaign", campaignId);
    if (kind === "pause") requireThat(c.receipt, "provider_objects_required");
    else requireThat(!c.material.settings?.conversion, "provider_event_delivery_unqualified_use_tracking_diagnostics");
    const g = await this.grant(project, c.grantId, kind);
    const a = await this.assets(c, false); // Decode during unlocked dispatch; retain byte/ownership checks here.
    if (kind !== "pause" && g.provider !== "google") requireThat(c.material.settings, "explicit_provider_settings_required", 422);
    // A safety pause binds the observed receipt, including legacy provider plans.
    // It must not require inventing a daily approval or rebuilding provider objects.
    const plan = kind === "pause" ? { pauseReceipt: c.receipt } : this.providers[g.provider].plan(c, g, a);
    const payload = {
      kind,
      campaignId,
      revision: c.revision,
      grantRevision: g.revision,
      plan,
      packetId,
    };
    return await this.request<Operation>(
      project,
      key,
      payload,
      "operation",
      async () => {
        requireThat(
          !(await this.store.list<Operation>(project, "operation")).some(
            (o) =>
              o.campaignId === c.id &&
              (["queued", "running", "unknown"].includes(o.state) ||
                (kind === "prepare" && o.kind === kind && o.campaignRevision === c.revision && o.state === "succeeded") ||
                (kind === "activate" && o.kind === kind && o.packetId === packetId && o.state === "succeeded")),
          ),
          "existing_operation_requires_reconciliation",
        );
        if (kind === "activate") requireThat(c.state === "paused", "paused_preparation_required");
        const operation: Operation = {
          id: id(),
          projectId: project,
          campaignId,
          campaignRevision: c.revision,
          grantRevision: g.revision,
          accountId: g.accountId,
          kind,
          packetId,
          payloadDigest: kind === "pause" ? c.receipt!.payloadDigest : digest(plan),
          state: "queued",
          reason: null,
          receipt: null,
          createdAt: new Date(this.now()).toISOString(),
        };
        if (kind === "activate") await this.advertisingBudgets.reserve(c, operation);
        await this.store.put(project, "executionActor", operation.id, p);
        return operation;
      },
    );
  }
  private async audienceContext(p: Principal, project: string, input: AudienceContext, expiry?: number) {
    await this.auth(p, project, true);
    requireThat(input.facet === "country" && input.locale === "en_US", "country_search_unsupported");
    requireThat(Number.isSafeInteger(input.expectedGrantRevision), "invalid_revision");
    draftMaterial(input.material);
    requireThat(Buffer.byteLength(JSON.stringify(input.material)) <= 16384, "audience_material_too_large");
    const g = await this.grant(project, input.grantId, "prepare");
    requireThat(g.revision === input.expectedGrantRevision, "grant_changed");
    const m = input.material, settings = m.settings;
    requireThat(g.provider === "meta" && settings?.provider === "meta" && settings.apiVersion === "v26.0" &&
      settings.accountId === g.accountId && settings.delivery === "ordinary" && settings.objective === "OUTCOME_TRAFFIC" &&
      settings.optimization === "LINK_CLICKS" && settings.format === "single_image" && m.purpose !== "recruitment" &&
      !m.advertisingBudget?.daily && !settings.targeting?.languages?.length && !settings.targeting?.interestGroups?.length &&
      !settings.targeting?.excludedCustomAudiences?.length, "country_search_unsupported");
    const provider = this.providers[g.provider]; requireThat(provider instanceof NativeProvider, "country_search_unsupported");
    const authority = await this.connections.campaignAuthority(p, g, expiry);
    const scope = digest({ project, principal: p.userId, authority: authority.digest, grant: g,
      apiVersion: "v26.0", locale: input.locale, facet: input.facet,
      restrictions: { settings, purpose: m.purpose, advertisingBudget: m.advertisingBudget,
        ageMin: m.audience?.ageMin, ageMax: m.audience?.ageMax, expansion: m.audience?.expansion } });
    return { g, provider, authority, scope };
  }
  private async withAudienceContext<T>(p: Principal, project: string, input: AudienceContext,
    work: (context: Awaited<ReturnType<MarketingServer["audienceContext"]>>, guard: () => Promise<void>, commit: <V>(local: () => Promise<V>) => Promise<V>) => Promise<T>) {
    const context = await this.audienceContext(p, project, input);
    const guard = async () => {
      const current = await this.audienceContext(p, project, input, context.authority.credentialExpiresAt);
      requireThat(current.scope === context.scope, "audience_access_changed");
    };
    const commit = <V>(local: () => Promise<V>) => this.connections.sessionAuthority.withLiveSessions(context.authority.sessions,
      () => this.store.transaction(async () => { await guard(); const result = await local(); await guard(); return result; }));
    return work(context, guard, commit);
  }
  async searchAudience(p: Principal, project: string, input: AudienceCommands["searchAudience"]["input"]): Promise<AudienceSearch> {
    text(input.query, 80); const query = input.query.trim();
    requireThat(query.length > 0 && !/[\x00-\x1f\x7f]/.test(query), "invalid_country_search", 422);
    if (input.continuation) text(input.continuation, 160);
    try {
      return await this.withAudienceContext(p, project, input, async (context, guard, commit) => {
        const { scope, provider, g } = context;
        const cacheKey = digest([scope, query, input.continuation ?? null]);
        const cached = await commit(() => this.store.get<AudienceCache>(project, "audienceSearch", cacheKey).catch(error => {
          if (error instanceof DomainError && error.code === "not_found") return null; throw error;
        }));
        if (cached && cached.scope === scope && cached.query === query && cached.expiresAt > this.now()) return cached.view;
        let cursor: AudienceCursor | null = null;
        if (input.continuation) cursor = await commit(async () => {
          const c = await this.store.get<AudienceCursor>(project, "audienceCursor", input.continuation!);
          requireThat(c.scope === scope && c.query === query && c.expiresAt > this.now() && c.pages < 4, "audience_cursor_stale"); return c;
        });
        await guard();
        const page = await provider.searchCountries(g, query, cursor?.after, guard);
        await guard();
        const seen = cursor?.seen ?? [], identities = { ...cursor?.identities };
        requireThat(!page.after || !seen.includes(page.after), "country_search_repeated_cursor");
        for (const c of page.countries) {
          requireThat(!identities[c.code] || identities[c.code] === c.label, "country_search_conflicting_identity"); identities[c.code] = c.label;
        }
        const pages = (cursor?.pages ?? 0) + 1;
        return commit(async () => {
          const expiresAt = Math.min(this.now() + 120000, context.authority.expiresAt);
          const choices: AudienceChoice[] = [];
          for (const c of page.countries) {
            const choice = { id: id(), scope, query, ...c, expiresAt };
            await this.store.put(project, "audienceChoice", choice.id, choice);
            await this.store.put(project, "audienceDisplay", digest([scope, c.code]), choice);
            choices.push({ choiceRef: choice.id, label: c.label, kind: "country" });
          }
          const continuation = page.after && pages < 4 ? id() : null;
          if (continuation) await this.store.put(project, "audienceCursor", continuation, { id: continuation, scope, query,
            after: page.after, seen: [...seen, page.after], identities, pages, expiresAt });
          const view: AudienceSearch = { state: page.after ? "partial" : choices.length ? "available" : "empty", choices, continuation,
            reason: page.after ? continuation ? "More countries may be available." : "Search limit reached. Refine the country name." : null };
          await this.store.put(project, "audienceSearch", cacheKey, { id: cacheKey, scope, query, expiresAt: Math.min(expiresAt, this.now() + 30000), view });
          return view;
        });
      });
    } catch (error) {
      // Authentication/forged references remain explicit command errors.
      if (error instanceof DomainError && !/country_search/.test(error.code)) throw error;
      return { state: error instanceof DomainError && error.code === "country_search_unsupported" ? "unsupported" : "unavailable",
        choices: [], continuation: null, reason: "Country search is unavailable for this account and campaign. Check access or retry." };
    }
  }
  async resolveAudience(p: Principal, project: string, input: AudienceCommands["resolveAudience"]["input"]) {
    requireThat(Array.isArray(input.choiceRefs) && Array.isArray(input.selected) && input.choiceRefs.length + input.selected.length <= 20 &&
      input.choiceRefs.every(r => typeof r === "string" && r.length <= 160) && input.selected.every(countryCode), "invalid_country_selection");
    return this.withAudienceContext(p, project, input, async (context, guard, commit) => {
      const selections = await commit(async () => {
        const result: AudienceSelection[] = [];
        for (const ref of input.choiceRefs) {
          const choice = await this.store.get<AudienceDisplay>(project, "audienceChoice", ref);
          requireThat(choice.scope === context.scope && choice.expiresAt > this.now(), "audience_choice_stale");
          result.push({ choiceRef: ref, label: choice.label, kind: "country", code: choice.code, state: "resolved" });
        }
        return result;
      });
      const resolutionBegan = this.now();
      const resolutionGuard = async () => { requireThat(this.now() - resolutionBegan < 30000, "country_resolution_deadline"); await guard(); };
      for (const code of input.selected) {
        let country: { code: string; label: string } | null = null;
        try { await resolutionGuard(); country = (await context.provider.resolveCountries(context.g, [code], resolutionGuard))[0]!; }
        catch { await guard(); }
        if (!country) { selections.push({ choiceRef: "", code, label: "Unresolved selected country", kind: "country", state: "unresolved" }); continue; }
        await commit(async () => {
          const choice = { id: id(), scope: context.scope, query: code, ...country!, expiresAt: Math.min(this.now() + 120000, context.authority.expiresAt) };
          await this.store.put(project, "audienceChoice", choice.id, choice);
          await this.store.put(project, "audienceDisplay", digest([context.scope, code]), choice);
          selections.push({ choiceRef: choice.id, code, label: choice.label, kind: "country", state: "resolved" });
        });
      }
      await guard();
      return { selections: [...new Map(selections.map(s => [s.code, s])).values()], reason: selections.some(s => s.state === "unresolved") ? "Some selections could not be resolved. Keep them for review, retry or remove them." : null };
    });
  }
  async audienceStatus(p: Principal, project: string, input: AudienceCommands["audienceStatus"]["input"]) {
    requireThat(Array.isArray(input.selected) && input.selected.length <= 20 && input.selected.every(v => typeof v === "string" && v.length <= 160), "invalid_country_selection");
    return this.withAudienceContext(p, project, input, (context, _guard, commit) => commit(async () => {
      const selections: AudienceSelection[] = [];
      for (const code of input.selected) {
        const c = await this.store.get<AudienceDisplay>(project, "audienceDisplay", digest([context.scope, code])).catch(error => {
          if (error instanceof DomainError && error.code === "not_found") return null; throw error;
        });
        const current = c && c.scope === context.scope && c.code === code && c.expiresAt > this.now();
        selections.push({ choiceRef: current ? c.id : "", code, label: c?.label ?? "Unresolved selected country", kind: "country", state: current ? "resolved" : "unresolved" });
      }
      return { selections, reason: selections.some(s => s.state === "unresolved") ? "Account, campaign or access may have changed. Resolve selected countries before continuing." : null };
    }));
  }
  private checkKey(p: Principal, key: string) { text(key, 160); return `campaign-check:${digest([p.userId, key])}`; }
  private async checkContext(p: Principal, project: string, campaignId: string, credentialExpiry?: number) {
    await this.auth(p, project, true);
    const c = await this.store.get<Campaign>(project, "campaign", campaignId);
    const g = await this.grant(project, c.grantId, "prepare");
    requireThat(g.provider === "meta", "campaign_prerequisite_tuple_unqualified", 422);
    const authority = await this.connections.campaignAuthority(p, g, credentialExpiry);
    const tracking = await this.tracking.campaignConfiguration(p, project, c.id);
    const assets = await Promise.all(c.material.assetIds.map(id => this.store.get<Asset>(project, "asset", id)));
    const provider = this.providers[g.provider];
    requireThat(provider instanceof NativeProvider, "native_campaign_check_required");
    const plan = provider.plan(c, g, assets);
    const binding = await prerequisiteBinding(this.store, c, g, plan);
    return { c, g, authority, assets, provider, plan, binding, tracking };
  }
  private async assertCheckContext(p: Principal, project: string, expected: Awaited<ReturnType<MarketingServer["checkContext"]>>) {
    const current = await this.checkContext(p, project, expected.c.id, expected.authority.credentialExpiresAt);
    requireThat(current.binding === expected.binding && current.authority.digest === expected.authority.digest, "campaign_prerequisites_stale");
    return current;
  }
  async campaignCheck(p: Principal, project: string, input: Commands["campaignCheck"]["input"]) {
    const session = await this.reportSession(p, project);
    await inspectLiveSessions(this.studio.sessions, [session]);
    await this.auth(p, project);
    await this.store.get<Campaign>(project, "campaign", input.campaignId);
    let r: PrerequisiteRecord | null = null;
    if (input.requestKey) {
      const key = this.checkKey(p, input.requestKey);
      const row = await this.store.db.prepare("SELECT record_id FROM requests WHERE project_id=? AND request_key=? AND kind='campaignCheck'").get(project, key);
      if (row) r = await this.store.get(project, "campaignCheck", String(row.record_id));
      requireThat(!r || r.campaignId === input.campaignId && r.actorId === p.userId, "request_key_payload_conflict");
    } else {
      const pointer = await this.store.get<{id:string}>(project, "campaignCheckCurrent", input.campaignId).catch(() => null);
      if (pointer) r = await this.store.get(project, "campaignCheck", pointer.id);
    }
    if (!r) return null;
    const view = structuredClone(r.view);
    if (view.state === "checking" && this.now() - Date.parse(r.createdAt) >= 120000) {
      view.state = "incomplete"; view.reasons = ["Check did not finish. Start a new check; the original attempt is retained."];
    }
    if (view.state === "ready") {
      try {
        const current = await this.checkContext(p, project, r.campaignId);
        const trusted = await currentPrerequisite(this.store, current.c, current.g, current.plan, this.now());
        requireThat(trusted.id === r.id && r.view.evidence === (this.mode === "fixture" ? "fixture" : "provider") && r.authority === current.authority.digest, "campaign_prerequisites_stale");
      } catch { view.state = "stale"; view.reasons = ["Campaign data or access changed, or this check expired. Check updated campaign before preparing."]; }
    }
    await inspectLiveSessions(this.studio.sessions, [session]);
    return view;
  }
  async checkCampaign(p: Principal, project: string, input: Commands["checkCampaign"]["input"]) {
    keys(input, ["campaignId", "expectedRevision", "expectedGrantRevision", "requestKey"]);
    text(input.campaignId, 160);
    requireThat(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0 && Number.isSafeInteger(input.expectedGrantRevision) && input.expectedGrantRevision > 0, "invalid_revision", 422);
    const session = await this.reportSession(p, project);
    const requestKey = this.checkKey(p, input.requestKey);
    let created = false;
    const attempt = await this.reportGuard(p, session, true, () => this.request<PrerequisiteRecord>(project, requestKey,
      { actorId: p.userId, ...input }, "campaignCheck", async () => {
        const c = await this.store.get<Campaign>(project, "campaign", input.campaignId);
        const g = await this.grant(project, c.grantId, "prepare");
        requireThat(c.revision === input.expectedRevision && g.revision === input.expectedGrantRevision, "stale_revision");
        const previous = await this.store.get<{id:string;generation:number}>(project, "campaignCheckCurrent", c.id).catch(() => null);
        const record: PrerequisiteRecord = { id: id(), projectId: project, campaignId: c.id, actorId: p.userId,
          generation: (previous?.generation ?? 0) + 1, action: "prepare", contract: NATIVE_PREREQUISITE_CONTRACT,
          createdAt: new Date(this.now()).toISOString(), binding: null, authority: null, sessions: [session],
          view: { id: "", campaignId: c.id, campaignRevision: c.revision, grantRevision: g.revision,
            evidence: this.mode === "fixture" ? "fixture" : "provider", state: "checking", checkedAt: null, expiresAt: null, reasons: [], facts: [] } };
        record.view.id = record.id;
        await this.store.put(project, "campaignCheckCurrent", c.id, { id: record.id, generation: record.generation });
        created = true; return record;
      }));
    // Request identity is durable before reads; retries/restarts never repeat a check.
    if (!created) return structuredClone(attempt.view);
    try {
      const context = await this.checkContext(p, project, input.campaignId);
      requireThat(context.c.revision === input.expectedRevision && context.g.revision === input.expectedGrantRevision, "stale_revision");
      const guard = async () => { requireThat(this.now() - Date.parse(attempt.createdAt) < 120000, "campaign_check_read_deadline"); await inspectLiveSessions(this.studio.sessions, [session]); await this.assertCheckContext(p, project, context); };
      const c = context.c;
      material(c.material, context.g.provider);
      const blockers = providerBudgetBlockers(c.material);
      requireThat(!blockers.length, blockers[0] ?? "budget_semantics_unverified");
      requireThat(c.material.purpose === "acquisition" && context.tracking.outcome === "inquiry", "first_party_inquiry_required");
      await this.assets(c); // Retained ownership, actual bytes and decoding, outside locks.
      const snapshot = await this.store.get<{url:string;source:string}>(project, "destination", c.material.destinationDigest);
      requireThat(snapshot.url === c.material.destination, "destination_snapshot_mismatch");
      if (this.mode === "live") requireThat(byteDigest(await this.readDestination(c.material.destination)) === c.material.destinationDigest, "destination_changed");
      await guard();
      const facts = await context.provider.inspectPrerequisites(c, context.g, context.assets, context.authority.account!, context.authority.identities, guard);
      await guard();
      const expires = Math.min(Date.parse(attempt.createdAt) + 120000, context.authority.expiresAt, facts.expiresAt, session.expiresAt, Date.parse(c.material.endAt));
      requireThat(expires > this.now(), "campaign_prerequisites_expired");
      return await this.connections.sessionAuthority.withLiveSessions(context.authority.sessions, () => this.tracking.withCampaignConfiguration(context.tracking, () => this.store.transaction(async () => {
        await guard();
        const pointer = await this.store.get<{id:string}>(project, "campaignCheckCurrent", c.id);
        attempt.credentialExpiresAt = context.authority.credentialExpiresAt; attempt.binding = context.binding; attempt.authority = context.authority.digest; attempt.sessions = context.authority.sessions;
        attempt.scope = { projectId: project, campaignId: c.id, campaignRevision: c.revision, action: "prepare",
          grantId: context.g.id, grantRevision: context.g.revision, accountId: context.g.accountId, pageId: context.g.pageId,
          instagramUserId: context.g.instagramUserId ?? null, materialDigest: digest(c.material), planDigest: digest(context.plan),
          selectedMedia: context.assets.map(a => ({ id: a.id, digest: a.digest, mime: a.mime })),
          destination: c.material.destination, destinationDigest: c.material.destinationDigest, purpose: c.material.purpose,
          trackingBindingId: context.tracking.id, trackingRevision: context.tracking.revision, sourceRevision: context.tracking.source.revision,
          trackingDigest: digest(context.tracking), outcome: context.tracking.outcome, contract: NATIVE_PREREQUISITE_CONTRACT };
        attempt.checkedFacts = facts.checkedFacts;
        attempt.receiptReferences = [attempt.id, ...context.authority.receiptReferences];
        attempt.view = { ...attempt.view, state: pointer.id === attempt.id ? "ready" : "stale", checkedAt: new Date(this.now()).toISOString(),
          expiresAt: new Date(expires).toISOString(), facts: facts.facts,
          reasons: pointer.id === attempt.id ? [] : ["A newer campaign check replaced this attempt."] };
        await this.store.put(project, "campaignCheck", attempt.id, attempt);
        await this.store.append(project, c.id, "campaign.prerequisites_checked", { checkId: attempt.id, state: attempt.view.state });
        await guard(); return structuredClone(attempt.view);
      })));
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "campaign_prerequisite_read_unavailable";
      // Retain failure even when the original session is gone; never persist ready on failure.
      attempt.view = { ...attempt.view, state: /unavailable|incomplete|missing|deadline/.test(code) ? "incomplete" : "blocked",
        checkedAt: new Date(this.now()).toISOString(), expiresAt: null, reasons: [code], facts: [] };
      await this.store.transaction(async () => { await this.store.put(project, "campaignCheck", attempt.id, attempt); });
      await inspectLiveSessions(this.studio.sessions, [session]);
      return structuredClone(attempt.view);
    }
  }
  private async consumeCampaignCheck(p: Principal, c: Campaign, g: Grant) {
    const assets = await Promise.all(c.material.assetIds.map(id => this.store.get<Asset>(c.projectId, "asset", id)));
    const proof = await currentPrerequisite(this.store, c, g, this.providers[g.provider].plan(c, g, assets), this.now());
    const context = await this.checkContext(p, c.projectId, c.id, proof.credentialExpiresAt);
    requireThat(digest(context.g) === digest(g) && context.c.revision === c.revision && proof.view.evidence === (this.mode === "fixture" ? "fixture" : "provider") && proof.authority === context.authority.digest,
      "campaign_prerequisites_stale");
    await inspectLiveSessions(this.connections.sessionAuthority, proof.sessions);
    return proof;
  }
  async prepare(
    p: Principal,
    project: string,
    input: Commands["prepare"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.auth(p, project, true);
      const c = await this.store.get<Campaign>(
        project,
        "campaign",
        input.campaignId,
      );
      requireThat(!c.material.settings?.conversion, "provider_event_delivery_unqualified_use_tracking_diagnostics");
      requireThat(
        (await this.store.list<Setup>(project, "setup")).some(
          (s) => s.grantId === c.grantId && s.state === "ready",
        ),
        "verified_setup_required",
      );
      return await this.reserve(
        p,
        project,
        input.campaignId,
        "prepare",
        input.requestKey,
      );
    });
  }
  async packet(
    p: Principal,
    project: string,
    input: Commands["packet"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.auth(p, project);
      const c = await this.store.get<Campaign>(
        project,
        "campaign",
        input.campaignId,
      );
      const g = await this.grant(project, c.grantId, "activate");
      requireThat(
        c.state === "paused" && c.receipt?.intent === "paused",
        "paused_preparation_required",
      );
      const assets = await this.assets(c, false); // Preparation already decoded these exact retained bytes.
      const plan = this.providers[g.provider].plan(c, g, assets);
      requireThat(
        c.receipt.payloadDigest === digest(plan),
        "provider_payload_changed",
      );
      const expires = Math.min(
        this.now() + 15 * 60000,
        Date.parse(g.expiresAt),
        Date.parse(c.material.endAt),
      );
      requireThat(expires > this.now(), "delivery_window_ended");
      const tracking = await this.packetTracking(project, c);
      const packet: Packet = {
        id: id(),
        projectId: project,
        campaignId: c.id,
        campaignRevision: c.revision,
        grantId: g.id,
        grantRevision: g.revision,
        accountId: g.accountId,
        action: "activate",
        material: c.material,
        tracking,
        assetDigests: assets.map((a) => a.digest),
        effectivePlan: plan,
        receipt: c.receipt,
        digest: "",
        createdAt: new Date(this.now()).toISOString(),
        expiresAt: new Date(expires).toISOString(),
      };
      packet.digest = digest({
        ...packet,
        digest: undefined,
      });
      await this.store.put(project, "packet", packet.id, packet);
      return packet;
    });
  }
  private async packetTracking(project: string, c: Campaign) {
    const binding = (await this.store.list<import('../core/index.js').TrackingBinding>(project, 'trackingBinding'))
      .find(b => b.owner.kind === 'campaign' && b.owner.id === c.id) ?? null;
    // Preserve optional historical configuration as such. The packet does not
    // turn it into current test authority or add a new mandatory Tracking gate.
    return binding;
  }
  private async currentPacket(
    project: string,
    packetId: string,
    suppliedDigest?: string,
  ) {
    const packet = await this.store.get<Packet>(project, "packet", packetId);
    requireThat(
      !suppliedDigest || packet.digest === suppliedDigest,
      "packet_digest_mismatch",
    );
    requireThat(
      packet.digest ===
        digest({
          ...packet,
          digest: undefined,
        }),
      "packet_corrupt",
    );
    const g = await this.grant(project, packet.grantId, "activate");
    const c = await this.store.get<Campaign>(
      project,
      "campaign",
      packet.campaignId,
    );
    requireThat(
      g.revision === packet.grantRevision && g.accountId === packet.accountId,
      "grant_changed",
    );
    requireThat(
      c.revision === packet.campaignRevision &&
        digest(c.material) === digest(packet.material) &&
        digest(c.receipt) === digest(packet.receipt),
      "stale_material",
    );
    requireThat(Date.parse(packet.expiresAt) > this.now(), "packet_expired");
    requireThat(digest(packet.tracking ?? null) === digest(await this.packetTracking(project, c)), 'tracking_configuration_changed_review_packet');
    requireThat(
      digest((await this.assets(c, false)).map((a) => a.digest)) ===
        digest(packet.assetDigests),
      "stale_assets",
    );
    requireThat(
      digest(this.providers[g.provider].plan(c, g, await this.assets(c, false))) ===
        digest(packet.effectivePlan),
      "stale_provider_plan",
    );
    return packet;
  }
  async decide(
    p: Principal,
    project: string,
    input: Commands["decide"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.store.authorize(p, project, [...HUMAN], true);
      requireThat(
        ["approved", "rejected"].includes(input.decision),
        "invalid_decision",
        422,
      );
      return await this.store.transaction(async () => {
        const packet = await this.currentPacket(
          project,
          input.packetId,
          input.digest,
        );
        requireThat(
          !(await this.store.list<Decision>(project, "decision")).some(
            (d) => d.packetId === packet.id,
          ),
          "decision_already_recorded",
        );
        const d: Decision = {
          id: id(),
          packetId: packet.id,
          projectId: project,
          digest: packet.digest,
          actorId: p.userId,
          decision: input.decision,
          decidedAt: new Date(this.now()).toISOString(),
          revokedAt: null,
        };
        await this.store.put(project, "decision", d.id, d);
        await this.store.append(project, d.id, "human.decided", {
          packetId: packet.id,
          decision: d.decision,
        });
        return d;
      });
    });
  }
  async revoke(
    p: Principal,
    project: string,
    input: Commands["revoke"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.store.authorize(p, project, [...HUMAN], true);
      const d = await this.store.get<Decision>(
        project,
        "decision",
        input.decisionId,
      );
      d.revokedAt = new Date(this.now()).toISOString();
      await this.store.put(project, "decision", d.id, d);
      return d;
    });
  }
  private async approved(project: string, packetId: string) {
    const packet = await this.currentPacket(project, packetId);
    const d = (await this.store.list<Decision>(project, "decision")).find(
      (x) => x.packetId === packet.id,
    );
    requireThat(
      d &&
        d.decision === "approved" &&
        !d.revokedAt &&
        d.digest === packet.digest,
      "human_authorization_required",
      403,
    );
    await this.store.authorize(
      {
        userId: d.actorId,
      },
      project,
      [...HUMAN],
      true,
    );
  }
  async execute(
    p: Principal,
    project: string,
    input: Commands["execute"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "editor", "approver"]);
      const old = await this.store.db
        .prepare(
          "SELECT kind,record_id FROM requests WHERE project_id=? AND request_key=?",
        )
        .get(project, input.requestKey);
      if (old) {
        requireThat(old.kind === "operation", "request_key_payload_conflict");
        const operation = await this.store.get<Operation>(
          project,
          "operation",
          String(old.record_id),
        );
        const packet = await this.store.get<Packet>(
          project,
          "packet",
          input.packetId,
        );
        requireThat(
          operation.kind === "activate" &&
            operation.packetId === packet.id &&
            packet.digest === input.digest,
          "request_key_payload_conflict",
        );
        return operation;
      }
      const packet = await this.currentPacket(
        project,
        input.packetId,
        input.digest,
      );
      await this.approved(project, packet.id);
      return await this.reserve(
        p,
        project,
        packet.campaignId,
        "activate",
        input.requestKey,
        packet.id,
      );
    });
  }
  async pause(
    p: Principal,
    project: string,
    input: Commands["pause"]["input"],
  ) {
    return await this.store.transaction(async () => {
      return await this.reserve(
        p,
        project,
        input.campaignId,
        "pause",
        input.requestKey,
      );
    });
  }
  /** Called by the one host execution owner. Claims are persisted before any I/O.
   * A process lost during I/O leaves running; recover() changes it to unknown,
   * never queued. An uncertain account lease remains fenced until readback. */
  async dispatch(project: string, operationId: string) {
    await this.store.db.assertExecutionOwner();
    let o = await this.store.get<Operation>(project, "operation", operationId);
    if (o.state !== "queued") return o;
    const c = await this.store.get<Campaign>(project, "campaign", o.campaignId);
    // Preserve queued identities, leases and holds when tracking delivery is unqualified.
    requireThat(o.kind === "pause" || !c.material.settings?.conversion, "provider_event_delivery_unqualified_use_tracking_diagnostics");
    let g: Grant;
    try {
      g = await this.grant(project, c.grantId, o.kind);
      requireThat(
        g.revision === o.grantRevision && g.accountId === o.accountId,
        "grant_changed",
      );
      const p = await this.store.get<Principal>(
        project,
        "executionActor",
        o.id,
      );
      if (o.kind === "activate")
        await this.store.authorize(p, project, ["admin", "editor", "approver"]);
      else await this.auth(p, project, true);
      requireThat(c.revision === o.campaignRevision, "stale_material");
      if (o.packetId) await this.approved(project, o.packetId);
      requireThat(
        (o.kind === "pause" ? c.receipt?.payloadDigest : digest(this.providers[g.provider].plan(c, g, await this.assets(c)))) ===
          o.payloadDigest,
        "payload_changed",
      );
      if (g.id.startsWith("connection:") && o.kind !== "pause" && this.providers[g.provider] instanceof NativeProvider) await this.consumeCampaignCheck(p, c, g);
      const v = await this.providers[g.provider].verify(
        g,
        c,
        await this.assets(c),
        o.kind,
      );
      requireThat(
        v.accountId === g.accountId &&
          v.currency === g.currency &&
          (o.kind === "pause" && g.provider === "linkedin" || v.timezone === g.timezone) &&
          v.permissions.includes(o.kind),
        "provider_capability_missing",
      );
      if (this.mode === "live" && o.kind !== "pause")
        requireThat(
          byteDigest(await this.readDestination(c.material.destination)) ===
            c.material.destinationDigest,
          "destination_changed",
        );
      // Recheck after asynchronous preflight, immediately before claiming effects.
      const currentGrant = await this.grant(project, g.id, o.kind);
      requireThat(
        currentGrant.revision === o.grantRevision &&
          currentGrant.accountId === o.accountId,
        "grant_changed",
      );
      if (o.packetId) await this.approved(project, o.packetId);
      requireThat(
        (await this.store.get<Campaign>(project, "campaign", c.id)).revision ===
          c.revision,
        "stale_material",
      );
      await this.store.transaction(async () => {
        await this.store.db.assertExecutionOwner();
        const current = await this.grant(project, g.id, o.kind);
        requireThat(
          current.revision === o.grantRevision &&
            current.accountId === o.accountId,
          "grant_changed",
        );
        const actor = await this.store.get<Principal>(
          project,
          "executionActor",
          o.id,
        );
        if (o.kind === "activate")
          await this.store.authorize(actor, project, [
            "admin",
            "editor",
            "approver",
          ]);
        else await this.auth(actor, project, true);
        requireThat(
          (await this.store.get<Campaign>(project, "campaign", c.id))
            .revision === o.campaignRevision,
          "stale_material",
        );
        if (o.packetId) await this.approved(project, o.packetId);
        requireThat(
          (await this.store.get<Operation>(project, "operation", o.id))
            .state === "queued",
          "operation_already_claimed",
        );
        if (o.kind === "activate") await this.advertisingBudgets.assert(c, o);
        const lease = await this.store.db
          .prepare(
            "SELECT operation_id FROM leases WHERE project_id=? AND account_id=?",
          )
          .get(project, g.accountId);
        requireThat(!lease, "account_execution_pending");
        await this.store.db
          .prepare("INSERT INTO leases VALUES(?,?,?)")
          .run(project, g.accountId, o.id);
        o = {
          ...o,
          state: "running",
        };
        await this.store.put(project, "operation", o.id, o);
        await this.store.append(project, o.id, "execution.dispatched", {
          kind: o.kind,
          payloadDigest: o.payloadDigest,
        });
      });
    } catch (error) {
      return this.store.transaction(async () => {
        const current = await this.store.get<Operation>(
          project,
          "operation",
          o.id,
        );
        if (current.state !== "queued") return current;
        const blocked = {
          ...current,
          state: "blocked" as const,
          reason:
            error instanceof DomainError
              ? error.code
              : "provider_preflight_unavailable",
        };
        if (o.kind === "activate") await this.advertisingBudgets.settle(c, o, "not_dispatched");
        await this.store.put(project, "operation", o.id, blocked);
        return blocked;
      });
    }

    const provider = this.providers[g.provider];
    const withWriteAuthority = async <T>(action: () => Promise<T>) => {
      const actor = await this.store.get<Principal>(project, "executionActor", o.id);
      const proof = g.id.startsWith("connection:") && o.kind !== "pause" && provider instanceof NativeProvider
        ? await this.consumeCampaignCheck(actor, c, g) : null;
      const local = () => this.store.transaction(async () => {
        await this.store.db.assertExecutionOwner();
        const current = await this.grant(project, g.id, o.kind);
        requireThat(
          current.revision === o.grantRevision &&
            current.accountId === o.accountId,
          "grant_changed",
        );
        const actor = await this.store.get<Principal>(
          project,
          "executionActor",
          o.id,
        );
        if (o.kind === "activate")
          await this.store.authorize(actor, project, [
            "admin",
            "editor",
            "approver",
          ]);
        else await this.auth(actor, project, true);
        requireThat(
          (await this.store.get<Campaign>(project, "campaign", c.id))
            .revision === o.campaignRevision,
          "stale_material",
        );
        if (o.packetId) await this.approved(project, o.packetId);
        if (provider.evidence === "provider" && o.kind !== "pause") {
          if (proof) await this.consumeCampaignCheck(actor, c, current);
          else validateAccountCapability(c, current, true);
        }
        const lease = await this.store.db.prepare("SELECT operation_id FROM leases WHERE project_id=? AND account_id=?").get(project, g.accountId);
        requireThat(lease?.operation_id === o.id, "operation_lease_lost");
        if (o.kind === "activate") await this.advertisingBudgets.assert(c, o);
        return action();
      });
      if (proof) {
        const tracking = await this.tracking.campaignConfiguration(actor, project, c.id);
        return this.connections.sessionAuthority.withLiveSessions(proof.sessions, () => this.tracking.withCampaignConfiguration(tracking, local));
      }
      return local();
    };
    const beforeWrite = () => withWriteAuthority(async () => {});
    try {
      const receipt =
        o.kind === "prepare"
          ? await provider.prepare(
              c,
              g,
              await this.assets(c),
              o.id,
              async (ids) => {
                o.receipt = {
                  ids,
                  payloadDigest: o.payloadDigest,
                  intent: "paused",
                  delivery: "unverified",
                  providerRequestId: null,
                  observedAt: new Date(this.now()).toISOString(),
                  evidence: provider.evidence,
                };
                await this.store.put(project, "operation", o.id, o);
              },
              beforeWrite,
            )
          : o.kind === "activate"
            ? await provider.activate(c, g, beforeWrite)
            : await provider.pause(c, g, beforeWrite);
      return await withWriteAuthority(() => this.finish(o, c, g, receipt));
    } catch {
      o = {
        ...o,
        state: "unknown",
        reason: "external_outcome_unknown_reconcile_before_retry",
      };
      await this.store.put(project, "operation", o.id, o);
      return o;
    }
  }
  private async finish(o: Operation, c: Campaign, g: Grant, receipt: Receipt) {
    requireThat(
      receipt.payloadDigest === o.payloadDigest &&
        receipt.intent === (o.kind === "activate" ? "enabled" : "paused"),
      "provider_receipt_mismatch",
    );
    return await this.store.transaction(async () => {
      await this.store.db.assertExecutionOwner();
      const lease = await this.store.db.prepare("SELECT operation_id FROM leases WHERE project_id=? AND account_id=?").get(c.projectId, g.accountId);
      requireThat(lease?.operation_id === o.id, "operation_lease_lost");
      const current = await this.store.get<Campaign>(c.projectId, "campaign", c.id);
      requireThat(current.revision === o.campaignRevision, "stale_material");
      await this.advertisingBudgets.settle(c, o, receipt.intent);
      const next = {
        ...o,
        state: "succeeded" as const,
        receipt,
        reason: null,
      };
      await this.store.put(c.projectId, "operation", o.id, next);
      await this.store.put(c.projectId, "campaign", c.id, {
        ...c,
        state: receipt.intent,
        receipt,
      });
      await this.store.db
        .prepare(
          "DELETE FROM leases WHERE project_id=? AND account_id=? AND operation_id=?",
        )
        .run(c.projectId, g.accountId, o.id);
      await this.store.append(c.projectId, o.id, "execution.observed", {
        intent: receipt.intent,
        delivery: receipt.delivery,
      });
      return next;
    });
  }
  async recover() {
    await this.store.db.assertExecutionOwner();
    const projects = await this.store.db
      .prepare("SELECT id FROM projects")
      .all();
    for (const row of projects) {
      const project = String(row.id);
      for (const kind of ["operation", "job"])
        for (const o of await this.store.list<Operation | GenerationJob>(
          project,
          kind,
        )) {
          if (o.state === "running")
            await this.store.put(project, kind, o.id, {
              ...o,
              state: "unknown",
              reason: "host_restarted_reconcile_required",
            });
        }
    }
  }
  async reconcile(
    p: Principal,
    project: string,
    input: Commands["reconcile"]["input"],
  ) {
    const session = await this.reportSession(p, project);
    const { o, c, g } = await this.reportGuard(p, session, true, async () => {
      const o = await this.store.get<Operation>(
        project,
        "operation",
        input.operationId,
      );
      requireThat(o.state === "unknown", "operation_not_unknown");
      const c = await this.store.get<Campaign>(
        project,
        "campaign",
        o.campaignId,
      );
      const g = await this.grant(project, c.grantId, "report");
      requireThat(c.revision === o.campaignRevision && g.revision === o.grantRevision && g.accountId === o.accountId &&
        (o.kind === "pause" ? c.receipt?.payloadDigest : digest(this.providers[g.provider].plan(c, g, await this.assets(c, false)))) === o.payloadDigest, "reconciliation_material_changed");
      return { o, c, g };
    });
    // Readback and decoding must permit unrelated work and authority revocation.
    const assets = await this.assets(c);
    await inspectLiveSessions(this.studio.sessions, [session]);
    const receipt = await this.providers[g.provider].reconcile(c, g, o);
    return this.reportGuard(p, session, true, async () => {
      requireThat(digest(await this.grant(project, g.id, "report")) === digest(g) &&
        digest(await this.assets(c, false)) === digest(assets), "reconciliation_material_changed");
      const current = await this.store.get<Operation>(project, "operation", o.id);
      const campaign = await this.store.get<Campaign>(project, "campaign", c.id);
      // Concurrent successful readback returns the same original operation.
      if (current.state === "succeeded") {
        requireThat(current.receipt && digest({ ...current, state: o.state, receipt: o.receipt, reason: o.reason }) === digest(o) &&
          digest(campaign) === digest({ ...c, state: current.receipt.intent, receipt: current.receipt }), "operation_changed");
        return current;
      }
      requireThat(digest(campaign) === digest(c), "reconciliation_material_changed");
      requireThat(digest(current) === digest(o), "operation_changed");
      return receipt ? this.finish(o, c, g, receipt) : o;
    });
  }
  async generate(
    p: Principal,
    project: string,
    input: Commands["generate"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.auth(p, project, true);
      await this.store.get<Campaign>(project, "campaign", input.campaignId);
      text(input.prompt, 6000);
      text(input.rightsReceipt, 200);
      requireThat(
        Array.isArray(input.parentAssetIds) && input.parentAssetIds.length <= 5,
        "invalid_lineage",
        422,
      );
      for (const a of input.parentAssetIds)
        requireThat(
          (await this.store.get<Asset>(project, "asset", a)).campaignId ===
            input.campaignId,
          "lineage_scope_mismatch",
        );
      const grant = await this.store.get<GenerationGrant>(
        project,
        "generationGrant",
        input.grantId,
      );
      this.generation.validate(grant);
      requireThat(
        this.mode === "fixture" || grant.provider !== "fixture",
        "fixture_not_live_generation",
      );
      return await this.request<GenerationJob>(
        project,
        input.requestKey,
        {
          ...input,
          requestKey: undefined,
        },
        "job",
        async () => {
          requireThat(
            !(await this.store.list<GenerationJob>(project, "job")).some(
              (j) =>
                j.campaignId === input.campaignId &&
                j.kind === grant.kind &&
                ["queued", "running", "processing", "unknown"].includes(
                  j.state,
                ),
            ),
            "generation_pending_reconcile_before_resubmit",
          );
          const current = await this.store.get<GenerationGrant>(
            project,
            "generationGrant",
            grant.id,
          );
          requireThat(
            valid(current.expiresAt, current.revokedAt, this.now()) &&
              current.usedJobs < current.maxJobs,
            "generation_grant_unavailable",
            403,
          );
          await this.store.put(project, "generationGrant", grant.id, {
            ...current,
            usedJobs: current.usedJobs + 1,
          });
          const job: GenerationJob = {
            id: id(),
            projectId: project,
            campaignId: input.campaignId,
            grantId: grant.id,
            kind: grant.kind,
            prompt: input.prompt,
            promptDigest: digest(input.prompt),
            rightsReceipt: input.rightsReceipt,
            parentAssetIds: input.parentAssetIds,
            state: "queued",
            providerRequestId: null,
            assetId: null,
            reason: null,
            createdAt: new Date(this.now()).toISOString(),
          };
          await this.store.put(project, "executionActor", job.id, p);
          return job;
        },
      );
    });
  }
  async dispatchGeneration(project: string, jobId: string) {
    await this.store.db.assertExecutionOwner();
    let job = await this.store.get<GenerationJob>(project, "job", jobId);
    if (job.state !== "queued") return job;
    const grant = await this.store.get<GenerationGrant>(
      project,
      "generationGrant",
      job.grantId,
    );
    await this.auth(
      await this.store.get<Principal>(project, "executionActor", job.id),
      project,
      true,
    );
    requireThat(
      valid(grant.expiresAt, grant.revokedAt, this.now()),
      "generation_grant_unavailable",
    );
    this.generation.validate(grant);
    const beforeWrite = async () =>
      this.store.transaction(async () => {
        await this.store.db.assertExecutionOwner();
        await this.auth(
          await this.store.get<Principal>(project, "executionActor", job.id),
          project,
          true,
        );
        const current = await this.store.get<GenerationGrant>(
          project,
          "generationGrant",
          job.grantId,
        );
        requireThat(
          valid(current.expiresAt, current.revokedAt, this.now()) &&
            digest(current) === digest(grant),
          "generation_grant_changed",
        );
      });
    await this.store.transaction(async () => {
      await beforeWrite();
      requireThat(
        (await this.store.get<GenerationJob>(project, "job", job.id)).state ===
          "queued",
        "job_already_claimed",
      );
      job = {
        ...job,
        state: "running",
      };
      await this.store.put(project, "job", job.id, job);
    });
    try {
      const output = await this.generation.submit(
        job,
        grant,
        async (requestId) => {
          job.providerRequestId = requestId;
          await this.store.put(project, "job", job.id, job);
        },
        beforeWrite,
      );
      return await this.retainOutput(job, output);
    } catch {
      job = {
        ...job,
        state: "unknown",
        reason: "generation_outcome_unknown_no_resubmission",
      };
      await this.store.put(project, "job", job.id, job);
      return job;
    }
  }
  private async retainOutput(job: GenerationJob, output: GenerationOutput) {
    return await this.store.transaction(async () => {
      const current = await this.store.get<GenerationJob>(
        job.projectId,
        "job",
        job.id,
      );
      if (current.state === "retained") return current;
      if (output.state === "retained") {
        requireThat(
          output.bytes &&
            output.bytes.length > 0 &&
            output.bytes.length < 100 * 1024 * 1024,
          "invalid_media",
        );
        requireThat(
          job.kind === "video"
            ? output.mime === "video/mp4" && output.seconds! > 0
            : ["image/png", "image/jpeg", "image/webp"].includes(output.mime!),
          "rendered_media_required",
        );
        const media = await inspectMedia(output.bytes, job.kind, output.mime);
        const asset: Asset = {
          id: id(),
          projectId: job.projectId,
          campaignId: job.campaignId,
          version: 1,
          kind: job.kind,
          digest: byteDigest(output.bytes),
          mime: media.mime,
          width: media.width,
          height: media.height,
          seconds: media.seconds || null,
          jobId: job.id,
          source: this.generation.evidence,
          rightsReceipt: job.rightsReceipt,
          parentAssetIds: job.parentAssetIds,
        };
        await this.store.db
          .prepare("INSERT OR IGNORE INTO blobs VALUES(?,?,?)")
          .run(job.projectId, asset.digest, output.bytes);
        await this.store.put(job.projectId, "asset", asset.id, asset);
        job.assetId = asset.id;
      }
      job = {
        ...job,
        state: output.state,
        providerRequestId: output.requestId || job.providerRequestId,
        reason:
          output.state === "failed"
            ? "provider_generation_failed"
            : output.state === "unknown"
              ? "generation_outcome_unknown_no_resubmission"
              : null,
      };
      await this.store.put(job.projectId, "job", job.id, job);
      await this.store.append(job.projectId, job.id, "generation.changed", {
        state: job.state,
        assetId: job.assetId,
      });
      return job;
    });
  }
  async reconcileGeneration(
    p: Principal,
    project: string,
    input: Commands["reconcileGeneration"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.auth(p, project, true);
      const job = await this.store.get<GenerationJob>(
        project,
        "job",
        input.jobId,
      );
      requireThat(
        ["processing", "unknown"].includes(job.state),
        "job_not_reconcilable",
      );
      const grant = await this.store.get<GenerationGrant>(
        project,
        "generationGrant",
        job.grantId,
      );
      requireThat(valid(grant.expiresAt, grant.revokedAt, this.now()), "generation_grant_unavailable");
      const output = await this.generation.reconcile(job, grant);
      return await this.retainOutput(job, output);
    });
  }
  async storyboard(
    p: Principal,
    project: string,
    input: Commands["storyboard"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.auth(p, project, true);
      await this.store.get<Campaign>(project, "campaign", input.campaignId);
      text(input.text, 6000);
      const bytes = Buffer.from(input.text);
      const a: Asset = {
        id: id(),
        projectId: project,
        campaignId: input.campaignId,
        version: 1,
        kind: "storyboard",
        digest: byteDigest(bytes),
        mime: "text/plain",
        width: null,
        height: null,
        seconds: null,
        jobId: null,
        source: "uploaded",
        rightsReceipt: "",
        parentAssetIds: [],
      };
      await this.store.transaction(async () => {
        await this.store.db
          .prepare("INSERT OR IGNORE INTO blobs VALUES(?,?,?)")
          .run(project, a.digest, bytes);
        await this.store.put(project, "asset", a.id, a);
      });
      return a;
    });
  }
  async event(p: Principal, project: string, input: Commands["event"]["input"]) {
    return this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "collector"]);
      // Reserved authenticated namespaces cannot be impersonated by legacy import.
      const bindings = await this.store.list<import("../core/index.js").TrackingBinding>(project, "trackingBindingHistory");
      requireThat(!bindings.some(b => b.source.id === input.sourceId), "use_authenticated_tracking_collector", 403);
      return this.recordEvent(project, input);
    });
  }
  private async recordEvent(project: string, input: Commands["event"]["input"]) {
    return this.store.transaction(async () => {
      text(input.id);
      text(input.personId);
      text(input.consentReceipt);
      text(input.sourceReceipt);
      instant(input.occurredAt);
      requireThat(
        Date.parse(input.occurredAt) <= this.now(),
        "future_event",
        422,
      );
      requireThat(
        ["click", "form_completed", "qualified", "purchase", "applicant_request_mou", "application_completed", "applicant_qualified", "hired"].includes(
          input.kind,
        ),
        "invalid_event",
        422,
      );
      if (input.revenue)
        requireThat(
          Number.isSafeInteger(input.revenue.minor) &&
            input.revenue.minor >= 0 &&
            /^[A-Z]{3}$/.test(input.revenue.currency),
          "invalid_revenue",
          422,
        );
      if (input.sourceId !== undefined) text(input.sourceId);
      requireThat(input.purpose === undefined || ["acquisition", "recruitment"].includes(input.purpose), "invalid_purpose", 422);
      for (const flag of [input.synthetic, input.test, input.productionMetricsExcluded]) requireThat(flag === undefined || typeof flag === "boolean", "invalid_test_flag", 422);
      const recruitment = ["applicant_request_mou", "application_completed", "applicant_qualified", "hired"].includes(input.kind);
      requireThat(!recruitment || input.purpose === "recruitment", "recruitment_purpose_required", 422);
      requireThat(input.purpose !== "recruitment" || !["form_completed", "qualified", "purchase"].includes(input.kind), "purpose_outcome_mismatch", 422);
      // A source event cannot become a different outcome by changing kind on retry.
      const identity = digest([input.sourceId ?? null, input.sourceReceipt]);
      const legacyIdentity = digest([input.sourceId ?? null, input.kind, input.sourceReceipt]);
      const inputDigest = digest({ ...input, id: undefined });
      const evidence = (await this.store.list<{ id: string; eventId: string; inputDigest: string }>(project, "sourceEventEvidence")).find(e => e.id === identity || e.id === legacyIdentity);
      if (evidence) {
        requireThat(evidence.inputDigest === inputDigest, "source_event_payload_conflict");
        return this.request<FirstPartyEvent>(project, `event:${input.id}`, input, "event",
          () => this.store.get<FirstPartyEvent>(project, "event", evidence.eventId));
      }
      const retry = await this.store.db.prepare("SELECT * FROM requests WHERE project_id=? AND request_key=?").get(project, `event:${input.id}`);
      if (retry) {
        requireThat(retry.kind === "event" && retry.digest === digest(input), "request_key_payload_conflict");
        return this.store.get<FirstPartyEvent>(project, "event", String(retry.record_id));
      }
      const existingEvents = await this.store.list<FirstPartyEvent>(project, "event");
      const sourceEvents = existingEvents.filter(e => e.sourceReceipt === input.sourceReceipt &&
        (e.sourceId ?? null) === (input.sourceId ?? null));
      requireThat(sourceEvents.every(e => e.kind === input.kind), "source_event_payload_conflict");
      requireThat(!existingEvents.some(e => e.id === input.id && !sourceEvents.includes(e)), "source_event_id_conflict");
      let campaignId: string | null = null;
      if (input.kind === "click" && input.campaignId) {
        await this.store.get<Campaign>(project, "campaign", input.campaignId);
        campaignId = input.campaignId;
      } else if (input.clickId) {
        const click = await this.store.get<FirstPartyEvent>(
          project,
          "event",
          input.clickId,
        );
        requireThat(
          click.kind === "click" &&
            click.personId === input.personId &&
            (click.purpose ?? "acquisition") === (input.purpose ?? "acquisition") &&
            (!(click.synthetic || click.test || click.productionMetricsExcluded) || (input.synthetic || input.test || input.productionMetricsExcluded)) &&
            click.consentReceipt,
          "attribution_identity_mismatch",
        );
        const elapsed =
          Date.parse(input.occurredAt) - Date.parse(click.occurredAt);
        if (elapsed >= 0 && elapsed <= 7 * 86400000) {
          const clicks = (
            await this.store.list<FirstPartyEvent>(project, "event")
          )
            .filter(
              (e) =>
                e.kind === "click" &&
                e.personId === input.personId &&
                (e.purpose ?? "acquisition") === (input.purpose ?? "acquisition") &&
                Boolean(e.synthetic || e.test || e.productionMetricsExcluded) === Boolean(input.synthetic || input.test || input.productionMetricsExcluded) &&
                Date.parse(e.occurredAt) <= Date.parse(input.occurredAt),
            )
            .sort(
              (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
            );
          const last = clicks[0];
          requireThat(last?.id === click.id, "not_last_eligible_click");
          requireThat(
            clicks.filter(
              (e) => Date.parse(e.occurredAt) === Date.parse(last.occurredAt),
            ).length === 1,
            "ambiguous_last_click",
          );
          campaignId = click.campaignId;
        }
      }
      const saved = await this.request<FirstPartyEvent>(
        project,
        `event:${input.id}`,
        input,
        "event",
        async () => {
          const old = (
            await this.store.list<FirstPartyEvent>(project, "event")
          ).find(
            (e) =>
              e.sourceReceipt === input.sourceReceipt && e.kind === input.kind && (e.sourceId ?? null) === (input.sourceId ?? null),
          );
          const next = {
            ...input,
            projectId: project,
            campaignId,
          };
          if (old) {
            requireThat(
              digest({
                ...old,
                id: undefined,
              }) ===
                digest({
                  ...next,
                  id: undefined,
                }),
              "source_event_payload_conflict",
            );
            return old;
          }
          return next;
        },
      );
      await this.store.put(project, "sourceEventEvidence", identity, { id: identity, eventId: saved.id, inputDigest });
      return saved;
    });
  }
  async conversation(
    p: Principal,
    project: string,
    input: Commands["conversation"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "sales"]);
      await this.store.get<Campaign>(project, "campaign", input.campaignId);
      const lead = await this.store.get<FirstPartyEvent>(
        project,
        "event",
        input.leadEventId,
      );
      requireThat(
        lead.kind === "form_completed" &&
          lead.campaignId === input.campaignId &&
          lead.consentReceipt === input.consentReceipt,
        "conversation_link_denied",
      );
      text(input.id);
      requireThat(
        Array.isArray(input.messages) && input.messages.length <= 100,
        "invalid_messages",
        422,
      );
      input.messages.forEach((m) => {
        text(m.speaker);
        text(m.text, 5000);
        instant(m.at);
      });
      const c: Conversation = {
        ...input,
        projectId: project,
      };
      await this.store.put(project, "conversation", c.id, c);
      await this.store.append(project, c.id, "conversation.linked", {
        campaignId: c.campaignId,
      });
      return c;
    });
  }
  async conversations(
    p: Principal,
    project: string,
    input: Commands["conversations"]["input"],
  ) {
    return await this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "sales"]);
      await this.store.get<Campaign>(project, "campaign", input.campaignId);
      await this.store.append(
        project,
        input.campaignId,
        "conversation.accessed",
        {
          actorId: p.userId,
        },
      );
      return (
        await this.store.list<Conversation>(project, "conversation")
      ).filter((c) => c.campaignId === input.campaignId);
    });
  }
  private window(from: string, until: string) {
    instant(from);
    instant(until);
    for (const value of [from, until]) {
      const normalized = new Date(value).toISOString();
      requireThat(value === normalized || value === normalized.replace(".000Z", "Z"), "invalid_instant", 422);
    }
    requireThat(
      Date.parse(from) < Date.parse(until),
      "invalid_report_window",
      422,
    );
  }
  private async reportSession(p: Principal, project: string) {
    const binding = sessionBinding(p), inspection = await this.studio.sessions.inspectSession(binding, project);
    assertSessionInspection(inspection, binding, project); return inspection;
  }
  private async reportGuard<T>(p: Principal, s: SessionInspection, write: boolean, local: () => Promise<T>) {
    requireThat(!write || ["admin", "editor"].includes(s.role), "forbidden", 403);
    return this.studio.sessions.withLiveSessions([s], () => this.store.transaction(() => this.reportLocal(p,s,write,local)));
  }
  private async reportLocal<T>(p: Principal, s: SessionInspection, write: boolean, local: () => Promise<T>) {
    await inspectLiveSessions(this.studio.sessions, [s]); await this.auth(p, s.projectId, write);
    const result = await local(); await inspectLiveSessions(this.studio.sessions, [s]); return result;
  }
  async syncMetrics(p: Principal, project: string, input: Commands["syncMetrics"]["input"]) {
    const session = await this.reportSession(p, project);
    const { c, g, reportingBasis } = await this.reportGuard(p, session, true, async () => {
      this.window(input.from, input.until);
      const c = await this.store.get<Campaign>(project, "campaign", input.campaignId);
      const g = await this.grant(project, c.grantId, "report");
      const reportingBasis = this.providers[g.provider].evidence === "provider"
        ? { ...providerDayWindow(input.from, input.until, g.timezone, this.now()),
          ...(g.provider === "linkedin" ? { timezoneSource: "provider_reporting_and_budget_policy" as const } : g.provider === "meta" ? { timezoneSource: "provider_account" as const } : {}) }
        : { window: "fixture-window" as const, timezone: g.timezone, from: input.from, until: input.until, completeThrough: null };
      return { c, g, reportingBasis };
    });
    // Report-authorized network reads never hold database/session locks.
    const values = await this.providers[g.provider].metrics(c, g, input.from, input.until);
    return this.reportGuard(p, session, true, async () => {
      requireThat(values.currency === c.material.budget.currency && values.timezone === c.material.timezone && values.from === input.from && values.until === input.until, "metrics_scope_mismatch");
      const currentGrant = await this.grant(project, g.id, "report");
      requireThat(digest(currentGrant) === digest(g) && (await this.store.get<Campaign>(project, "campaign", c.id)).revision === c.revision, "metrics_scope_changed");
      const snap: Metrics = { ...values, reportingBasis, id: id(), projectId: project, campaignId: c.id };
      await this.store.put(project, "metrics", snap.id, snap); return snap;
    });
  }
  async results(
    p: Principal,
    project: string,
    input: Commands["results"]["input"],
  ): Promise<Results> {
    const session = await this.reportSession(p, project);
    const preparedBinding = await this.reportGuard(p, session, false, async () =>
      (await this.store.list<import("../core/index.js").TrackingBinding>(project, "trackingBinding")).find(b => b.owner.kind === "campaign" && b.owner.id === input.campaignId) ?? null);
    return this.tracking.withCoverage(project, preparedBinding, coverageAuthority => this.reportLocal(p, session, false, async () => {
      await this.auth(p, project);
      this.window(input.from, input.until);
      const c = await this.store.get<Campaign>(
        project,
        "campaign",
        input.campaignId,
      );
      const currency = c.material.budget.currency;
      const snap = (await this.store.list<Metrics>(project, "metrics"))
        .filter(
          (m) =>
            m.campaignId === c.id &&
            Date.parse(m.from) === Date.parse(input.from) &&
            Date.parse(m.until) === Date.parse(input.until) &&
            m.currency === currency && m.timezone === c.material.timezone,
        )
        .at(-1);
      const windowEvents = (
        await this.store.list<FirstPartyEvent>(project, "event")
      ).filter(
        (e) =>
          e.campaignId === c.id &&
          Date.parse(e.occurredAt) >= Date.parse(input.from) &&
          Date.parse(e.occurredAt) < Date.parse(input.until),
      );
      const excluded = (e: FirstPartyEvent) => e.synthetic || e.test || e.productionMetricsExcluded;
      const events = windowEvents.filter(e => !excluded(e));
      const acquisition = events.filter(e => (e.purpose ?? "acquisition") === "acquisition");
      const submissions = (kind: FirstPartyEvent["kind"], purpose: "acquisition" | "recruitment") =>
        new Set(events.filter(e => e.kind === kind && (e.purpose ?? "acquisition") === purpose)
          .map(e => digest([e.sourceId ?? null, e.sourceReceipt]))).size;
      const count = (kind: FirstPartyEvent["kind"]) =>
        new Set(acquisition.filter((e) => e.kind === kind).map((e) => e.personId))
          .size;
      const binding = (await this.store.list<import("../core/index.js").TrackingBinding>(project, "trackingBinding")).find(b => b.owner.kind === "campaign" && b.owner.id === c.id);
      const coverageRows = (await this.store.list<ValidatedCoverage>(project, "validatedCoverage")).filter(w => w.version === 1 && coverageAuthority !== null && w.sourceUniverseDigest === coverageAuthority.sourceUniverseDigest && w.collectorId === coverageAuthority.collectorId && w.collectorRevision === coverageAuthority.collectorRevision && w.campaignId === c.id && w.materialDigest === digest(c.material) && w.sourceId && w.checkpoint && w.provenance && w.collectorId && binding && w.bindingId === binding.id && w.bindingRevision === binding.revision && w.sourceId === binding.source.id && w.sourceRevision === binding.source.revision);
      const covered = (purpose: "acquisition" | "recruitment") => coverageRows.some(w =>
        w.purpose === purpose && Date.parse(w.from) <= Date.parse(input.from) &&
        Date.parse(w.until) >= Date.parse(input.until));
      // One source checkpoint cannot establish completeness for outcomes ingested
      // through another namespace. Preserve those events and report unknown.
      const sourceCovered = (purpose: "acquisition" | "recruitment") => covered(purpose) &&
        events.filter(e => e.kind !== "click" && (e.purpose ?? "acquisition") === purpose).every(e => e.sourceId === binding?.source.id);
      const coverage = sourceCovered("acquisition"), recruitmentCoverage = sourceCovered("recruitment");
      const leads = coverage ? count("form_completed") : null,
        customers = coverage ? count("purchase") : null;
      const purchases = acquisition.filter((e) => e.kind === "purchase");
      const revenue =
        coverage && purchases.every((e) => e.revenue?.currency === currency)
          ? purchases.reduce((n, e) => n + e.revenue!.minor, 0)
          : null;
      const spend = snap?.spendMinor ?? null,
        impressions = snap?.impressions ?? null,
        clicks = snap?.clicks ?? null;
      return {
        campaignId: c.id,
        timezone: c.material.timezone,
        currency,
        from: input.from,
        until: input.until,
        observedAt: snap?.observedAt || null,
        stale: !snap || this.now() - Date.parse(snap.observedAt) > 3600000,
        source: snap?.source || "unavailable",
        attribution: "last-paid-click-7d-v1",
        spendMinor: metric(spend),
        impressions: metric(impressions),
        clicks: metric(clicks),
        leads: metric(leads, "collector_coverage_unknown"),
        completedSubmissions: metric(coverage ? submissions("form_completed", "acquisition") : null, "collector_coverage_unknown"),
        uniquePeople: metric(leads, "collector_coverage_unknown"),
        purpose: c.material.purpose ?? "acquisition",
        applicantGoal: c.material.applicantGoal,
        applicantRequests: metric(recruitmentCoverage ? submissions("applicant_request_mou", "recruitment") : null, "collector_coverage_unknown"),
        applicants: metric(recruitmentCoverage ? submissions("application_completed", "recruitment") : null, "collector_coverage_unknown"),
        qualifiedApplicants: metric(recruitmentCoverage ? submissions("applicant_qualified", "recruitment") : null, "collector_coverage_unknown"),
        hires: metric(recruitmentCoverage ? submissions("hired", "recruitment") : null, "collector_coverage_unknown"),
        excludedTestEvents: metric(coverage && recruitmentCoverage ? windowEvents.filter(excluded).length : null, "collector_coverage_unknown"),
        leadBasis: "trusted-source-submissions-v2;legacy-leads-unique-people-v1",
        reportingBasis: snap?.reportingBasis ?? (() => {
          try { return providerDayWindow(input.from, input.until, c.material.timezone, this.now()); }
          catch { return { window: "partial-or-open-window" as const, timezone: c.material.timezone,
            from: input.from, until: input.until, completeThrough: null }; }
        })(),
        qualified: metric(
          coverage ? count("qualified") : null,
          "collector_coverage_unknown",
        ),
        customers: metric(customers, "collector_coverage_unknown"),
        purchases: metric(coverage ? submissions("purchase", "acquisition") : null, "collector_coverage_unknown"),
        refundTreatment: "gross_before_refunds",
        coverage: { state: sourceCovered(c.material.purpose ?? "acquisition") ? "validated" : "unknown", sourceIds: coverageRows.map(w => w.sourceId), checkpoints: coverageRows.map(w => w.checkpoint), reason: covered(c.material.purpose ?? "acquisition") && !sourceCovered(c.material.purpose ?? "acquisition") ? "Outcomes from another source are present. This checkpoint cannot establish their completeness; multi-source campaign totals remain unknown." : "Current single-source catalogue and collector authority plus an exact retained checkpoint are required; changed or unavailable authority and unsupported multi-source coverage remain unknown. A passing test is not production coverage." },
        revenueMinor: metric(revenue, "revenue_or_currency_unknown"),
        ctr: ratio(clicks, impressions),
        mediaCacMinor: ratio(spend, customers),
        mediaRoas: ratio(revenue, spend),
        providerConversions: metric(c.material.audience.provider === "meta" ? null : snap?.providerConversions ?? null, c.material.audience.provider === "meta" ? "meta_conversion_mapping_unqualified" : "provider_conversion_mapping_or_snapshot_unavailable"),
      };
    }), commit => this.studio.sessions.withLiveSessions([session],commit));
  }
  async call<K extends Command>(
    p: Principal,
    project: string,
    command: K,
    input: Commands[K]["input"],
  ): Promise<Commands[K]["output"]> {
    const audienceFields = {
      searchAudience: ["grantId", "expectedGrantRevision", "material", "locale", "facet", "query", "continuation"],
      resolveAudience: ["grantId", "expectedGrantRevision", "material", "locale", "facet", "choiceRefs", "selected"],
      audienceStatus: ["grantId", "expectedGrantRevision", "material", "locale", "facet", "selected"],
    };
    if (Object.hasOwn(audienceFields, command)) {
      const name = command as keyof typeof audienceFields; keys(input, audienceFields[name]);
      const fn = this[name] as (p: Principal, project: string, input: unknown) => Promise<Commands[K]["output"]>;
      return fn.call(this, p, project, input);
    }
    if (command === "checkCampaign") return this.checkCampaign(p, project, input as Commands["checkCampaign"]["input"]) as Promise<Commands[K]["output"]>;
    if (command === "campaignCheck") { keys(input, ["campaignId", "requestKey"]); return this.campaignCheck(p, project, input as Commands["campaignCheck"]["input"]) as Promise<Commands[K]["output"]>; }
    if (command === "reconcile") { keys(input, ["operationId"]); return this.reconcile(p, project, input as Commands["reconcile"]["input"]) as Promise<Commands[K]["output"]>; }
    if (command === "captureDestination") { keys(input, ["url"]); return this.captureDestination(p, project, input as Commands["captureDestination"]["input"]) as Promise<Commands[K]["output"]>; }
    if (command === "results" || command === "syncMetrics") { keys(input, ["campaignId", "from", "until"]); return (command === "results" ? this.results(p, project, input as Commands["results"]["input"]) : this.syncMetrics(p, project, input as Commands["syncMetrics"]["input"])) as Promise<Commands[K]["output"]>; }
    if (Object.hasOwn(trackingCommandFields, command)) return this.tracking.call(p, project, command as keyof TrackingCommands, input as never) as Promise<Commands[K]["output"]>;
    if (Object.hasOwn(studioCommandFields, command)) return this.studio.call(p, project, command as keyof StudioCommands, input as never) as Promise<Commands[K]["output"]>;
    if (Object.hasOwn(connectionCommandFields, command)) return this.connections.call(p, project, command as keyof ConnectionCommands, input as never) as Promise<Commands[K]["output"]>;
    const unlockedFields = {
      setup: ["grantId", "requestKey"], resumeSetup: ["setupId", "expectedRevision"],
      saveCampaign: ["id", "expectedRevision", "grantId", "material", "requestKey"],
      promoteDraft: ["draftId", "expectedRevision", "grantId", "expectedGrantRevision", "material"],
      planningWrite: ["command", "input", "requestKey", "scope"],
    };
    if (Object.hasOwn(unlockedFields, command)) {
      const name = command as keyof typeof unlockedFields;
      keys(input, unlockedFields[name]);
      if (name === "planningWrite") {
        const nested = input as Commands["planningWrite"]["input"];
        const nestedFields = { ...unlockedFields, saveDraft: ["id", "expectedRevision", "requestKey", "material"] };
        requireThat(["saveCampaign", "saveDraft", "promoteDraft"].includes(nested.command), "invalid_planning_command", 422);
        keys(nested.input, nestedFields[nested.command]);
      }
      const fn = this[name] as (p: Principal, project: string, input: unknown) => Promise<Commands[K]["output"]>;
      return fn.call(this, p, project, input);
    }
    return await this.store.transaction(async () => {
      await this.auth(p, project);
      const fields: Record<Exclude<Command, keyof ConnectionCommands | keyof StudioCommands | keyof TrackingCommands | keyof CampaignCheckCommands | keyof AudienceCommands>, string[]> = {
        captureDestination: ["url"],
        workspace: [],
        planningWrite: ["command", "input", "requestKey", "scope"],
        acknowledgePlanningWrite: ["id"],
        setup: ["grantId", "requestKey"],
        resumeSetup: ["setupId", "expectedRevision"],
        saveCampaign: ["id", "expectedRevision", "grantId", "material", "requestKey"],
        promoteDraft: ["draftId", "expectedRevision", "grantId", "expectedGrantRevision", "material"],
        saveDraft: ["id", "expectedRevision", "requestKey", "material"],
        prepare: ["campaignId", "requestKey"],
        packet: ["campaignId"],
        decide: ["packetId", "digest", "decision"],
        revoke: ["decisionId"],
        execute: ["packetId", "digest", "requestKey"],
        pause: ["campaignId", "requestKey"],
        reconcile: ["operationId"],
        generate: [
          "campaignId",
          "grantId",
          "prompt",
          "rightsReceipt",
          "parentAssetIds",
          "requestKey",
        ],
        reconcileGeneration: ["jobId"],
        storyboard: ["campaignId", "text"],
        event: [
          "id",
          "campaignId",
          "kind",
          "personId",
          "occurredAt",
          "consentReceipt",
          "sourceReceipt", "sourceId", "purpose", "synthetic", "test", "productionMetricsExcluded",
          "clickId",
          "revenue",
        ],
        conversation: [
          "id",
          "campaignId",
          "leadEventId",
          "consentReceipt",
          "messages",
        ],
        conversations: ["campaignId"],
        results: ["campaignId", "from", "until"],
        syncMetrics: ["campaignId", "from", "until"],
      };
      requireThat(Object.hasOwn(fields, command), "unknown_command", 404);
      keys(input, fields[command as keyof typeof fields]);
      // Dispatch only the closed command allowlist; internal executor methods are never exposed.
      const fn = this[command as keyof typeof fields] as (
        p: Principal,
        project: string,
        input: Commands[K]["input"],
      ) => Promise<Commands[K]["output"]>;
      return await fn.call(this, p, project, input);
    });
  }
}
