# Connections public contracts and minimum consumer

The reviewed design excerpts below remain distinguishable from implementation.
None of their new names is exported by the frozen published Marketing 0.1.7.
The uncommitted advertising candidate implements the commands/factory/UI; the
[actual compiled public example](../examples/connections-server.ts) replaces the
illustrative `host.*` mount for engineering qualification. See the candidate
contract section and the dated manual creative addition below for exact differences;
Agent and native qualification remain separate gates.
Existing symbols are identified explicitly. This is one bounded addition to the
current MarketingServer and UI, not a new orchestration framework or credential store.
See [interaction blueprint](CONNECTIONS.md) and [acceptance](ACCEPTANCE.md).

## Existing seams to retain

| Existing public surface / source | Retain | Gap addressed by proposal |
| --- | --- | --- |
| `@handrail/marketing`: `createMarketingClient`, `Commands`, `Grant`, `Setup`, `PublicGrant`; [core/index.ts](../core/index.ts) | Browser-safe typed commands, project context, revisioned records; hide secret refs | `setup` needs a grant; `Setup.grantId` is non-null. Add a pre-grant Connection operation rather than weakening Grant validity |
| `@handrail/marketing/server`: `MarketingServer`, `Store`, `Principal`; [service.ts](../server/service.ts), [store.ts](../server/store.ts) | Membership authority, durable request receipts/transactions/outbox and sole executor | Add connection transitions and authenticated catalogue/discovery; durable human access decision before trusted grant creation |
| Public `HostAgent`, `OAuthApp`, `CredentialCipher`, `createCredentialCipher`; [agent.ts](../server/agent.ts) | Provider-origin OAuth, encrypted custody, safe callbacks | Extend to pre-grant connection-scoped state and durable callback outcome recovery; existing grant-only begin/complete cannot bootstrap zero grants |
| Public `VaultPort`, `NativeProvider`; [providers.ts](../server/providers.ts) | Server-only credential use and independent account/material verification | Scoped discovery using the same custody, no credential value in view model; provider-specific discovery support requires implementation/tests |
| Public `AgentPort`; [ports.ts](../server/ports.ts) | Optional inspect/resume assistance under host authority | Existing inspect accepts Setup + Grant. Pre-grant assistance must be explicitly qualified as an additive seam; don't pass a fake grant or pretend Agent 0.2.15 already implements it |
| Public `NativeGeneration`, `GenerationPort`, `BillingPort` | Existing secure generation binding and separate billing ownership | Add setup/status presentation without a paid verification call or new billing engine |
| Public `MarketingWorkspace`, `MarketingRoot`, `createMarketingClient` | Same UI and headless server authority | Add reusable Connections component inside Workspace and optional standalone export; host does not reconstruct provider screens |

Existing `setup`/`resumeSetup` remain compatible for real historical grants. A
completed new Connection may link to that verified Setup, but grant creation must
only occur after current human decision and verified scope. Do not make a draft
Connection look like an executable Grant. Existing server authority checks are
reused and strengthened at the new awaited boundaries; this design does not certify
that every required race check already exists in 0.1.7.

## Proposed browser-safe state

This excerpt defines intended shapes, not a universal provider payload. Advertising
uses existing `Provider` and `Permission`; creative generation keeps its separate
authority. SDK-resolved refs are opaque choices, not credentials or caller authority.

```ts
// PROPOSED additions to @handrail/marketing, not current exports.
type ConnectionProvider =
  | { kind: 'advertising'; provider: 'meta' | 'google' | 'linkedin' }
  | { kind: 'creative'; provider: 'openai' | 'xai' };
type ConnectionIntent =
  | { kind: 'advertising'; operations: ('setup' | 'report' | 'prepare' | 'activate' | 'pause')[] }
  | { kind: 'creative'; operation: 'image' | 'video' };
type ConnectionPhase = 'requirements' | 'discovering' | 'choosing_account'
  | 'reviewing_provider_access' | 'choosing_identity'
  | 'reviewing_access' | 'waiting_human' | 'verifying' | 'verified'
  | 'failed_retryable' | 'blocked' | 'outcome_unknown' | 'reconciling'
  | 'needs_reauthorization' | 'cancelling' | 'cancelled';
type EvidenceStatus = 'not_checked' | 'pending' | 'verified' | 'failed'
  | 'expired' | 'revoked' | 'unavailable';
interface SafeEvidence {
  status: EvidenceStatus;
  basis: 'configuration' | 'human_decision' | 'provider' | 'fixture';
  observedAt: string | null;
  expiresAt: string | null;
  receiptRef: string | null; // authorized safe evidence reference, not raw provider response
  reason: string | null;
}
interface NextAction {
  action: string; // closed SDK action enum in implementation, no arbitrary URL/tool
  label: string;
  actor: 'human' | 'host_admin' | 'sdk' | 'provider' | 'optional_agent';
  available: boolean;
  reason: string | null; // required when unavailable
}
interface AccountChoice {
  choiceRef: string; // bound to discovery snapshot/project/provider/actor, expires
  label: string;
  businessLabel: string | null;
  accountSuffix: string;
  currency: string;
  timezone: string;
  timezoneSource: 'provider_account' | 'provider_reporting_and_budget_policy';
  roleSummary: string;
  limitations: string[];
}
interface IdentityChoice {
  choiceRef: string; // server-retained account-bound Page/Instagram/org/manager choice
  kind: 'meta_page' | 'instagram' | 'linkedin_organization' | 'google_manager';
  label: string; accountSuffix: string;
}
interface ConnectionAccessReview {
  decisionRef: string; digest: string; expiresAt: string;
  purpose: 'provider_authorization' | 'project_binding' | 'revoke_project_access';
  summary: string; // SDK-authored exact visible effect, including persistence/impact
  oauthScopes: string[]; // exact provider bundle; empty for local-only decisions
  providerAccountRange: string; // explicit when accounts cannot yet be enumerated
  offlineAccess: boolean;
  providerLifetime: string; // may require provider-side revocation; not local expiry
  projectAccessExpiresAt: string | null;
}
interface ConnectionView {
  id: string; projectId: string; revision: number;
  provider: ConnectionProvider; intent: ConnectionIntent; phase: ConnectionPhase;
  account: AccountChoice | null;
  identities: IdentityChoice[];
  accessReview: ConnectionAccessReview | null;
  grantId: string | null; // null until trusted server commits exact persistent access
  checkpoint: string; currentActor: NextAction['actor'];
  requested: boolean;
  configured: SafeEvidence;
  providerAuthorized: SafeEvidence; // scoped reuse, or prior approval + OAuth receipt
  consented: SafeEvidence; // separate exact project binding decision
  accountVerified: SafeEvidence;
  capabilityVerified: SafeEvidence; // scoped to specific action/material, not login
  readiness: { action: string; materialDigest: string | null;
    ready: boolean; blockers: string[]; evidence: SafeEvidence[] }[];
  actions: NextAction[];
  updatedAt: string;
}
```

`requested`, `configured`, `providerAuthorized`, `consented`, `accountVerified`, `capabilityVerified`
and `readiness` are independent facts. The phase is presentation progress, not an
authority bit. Account or grant revision changes stale downstream evidence.
Creative connections render account verification as unavailable/not applicable with
an explanation and verify the existing provider/project generation binding instead;
they never manufacture an advertising account. A fixture basis cannot satisfy live
readiness. Public data excludes tokens, cookies, codes, OAuth state/verifiers,
secret refs, billing capabilities, private transcripts and raw response bodies.

## Proposed commands and transition rules

Add these to existing `Commands` and `MarketingServer.call` rather than a second
API server. Existing project route context remains authoritative only after current
membership checks. All mutation inputs carry a stable `requestKey`; transitions
carry `connectionId` and `expectedRevision`. Keys bind actor/project/action/payload.
Read-only queries never cause consent or provider writes.

| Proposed command | Intent / result | Server invariant |
| --- | --- | --- |
| `connections` | Catalogue, current safe operations and configuration/dependency facts; works with zero grants | No provider call or account enumeration; include fixed supported provider rows regardless of grants |
| `connection` | Read one operation or resolve original start request key after lost response | Fresh authenticated scope; no another-user discovery choices returned |
| `startConnection` | Provider + typed intent → retained requirements checkpoint | Existing editor/admin permission; does not mint grant; dedupe active equivalent operation |
| `reviewConnectionProviderAccess` | Server creates exact OAuth-access summary, digest and expiring decision ref before discovery or scope expansion | Names app, scopes, provider account range, refresh/offline access and persistent effects; host policy must allow the exact bundle. Does not initiate OAuth |
| `decideConnectionProviderAccess` | Human approve/deny of exact provider-access review | Current human connect authority; persist approval before issuing an authorization URL or exchanging code; Agent cannot call; no blanket future scope approval |
| `discoverConnectionAccounts` | Authenticated discovery snapshot, choices, opaque cursor, complete/partial status | Only configured native adapter and current authorized scope; new OAuth grant requires the prior provider-access decision, even with no local Grant |
| `selectConnectionAccount` | Choice ref + discovery revision → review-access checkpoint | Resolve server-retained choice; revalidate ownership/freshness; raw arbitrary IDs rejected; account change invalidates prior consent/verification |
| `connectionIdentities` / `selectConnectionIdentity` | Explicit authorized discovery of account-linked publishing/manager choices; select opaque refs + snapshot revision | SDK owns native mapping; exact Page/Instagram/organization/manager relationship verified, never supplied as a capability claim by browser/host |
| `reviewConnectionAccess` | Server creates exact access summary, digest and expiring decision ref | Binds tenant/project/provider/account/operations/duration/actor policy/config revision; no browser-authored digest |
| `decideConnectionAccess` | Human approve/deny of exact summary revision/digest → safe status | Human identity and current connect permission; Agent cannot call; role cannot be claimed in JSON |
| `beginConnectionHandoff` | Purpose `discover` or `consent` + revision → short-lived same-origin navigation reference | Either purpose needs matching provider-access approval before NEW OAuth authorization; selected-account consent additionally needs project-binding decision. Existing scoped reuse must not silently initiate new consent. References convey no portable credentials |
| `resumeConnection` | Read retained broker/callback facts, then verify next allowed step | No “connected=true”, token or account assertion. CAS + authority checks before/after reads; never replay unknown exchanges |
| `cancelConnection` | Explicit cancellation request → cancelled or cancelling/unknown | Stop new effects and invalidate leases; preserve in-flight uncertainty; do not implicitly revoke unrelated existing grant |
| `reconcileConnection` | Recover original operation/callback result and bounded safe readback | Same current authority, no blind replay. Unrecoverable consumed-code outcome requests new explicit consent after diagnosis |
| `reassignConnection` | Explicit host-authorized human takeover of a pending operation | CAS; invalidate old actor/session handoffs and unconsumed decisions; new actor rediscovers with their own authority, never inherits credentials |
| `reviewConnectionRevocation` / `decideConnectionRevocation` | Exact affected local grant/revision and dependent operations shown; human confirms local access revocation | Immediately fence new effects and invalidate dependent packets; reconcile in-flight outcomes. Does not revoke shared provider OAuth or pause active ads; those effects remain separate |

Revocation review warns that active ads may keep running and revoked access may
prevent SDK pause; provide the permitted provider-side management route without
performing that action. Do not delay a security revocation until an ad is paused.

**UI action mapping:** Check progress/reload uses `connection`; Retry verification
and Recheck use `resumeConnection` with a retained verification attempt; Check
outcome uses `reconcileConnection`. Manage access opens a new review; adding scope
or reconnecting uses a linked new `startConnection` operation and both approval
gates as applicable. Existing grants remain immutable until an authorized revision
transition; reconnect never clears revocation. These commands also cover the
blueprint's reassignment and local revocation actions, not undocumented host logic.

`connection.changed` extends the existing durable outbox: event ID, project,
connection/revision, phase, safe reason and causation/request ref. At-least-once
consumers dedupe IDs, resume with the existing cursor and reread current state;
no tokens or full account lists in broadcasts. Errors use stable codes, safe copy,
retry class (`read_state`, `retry_safe_read`, `fresh_human_consent`, `fix_configuration`,
`no_retry`) and operation ref. A timeout after exchange is not proof of no effect.

The server validates provider/intent compatibility and explicitly requested scope.
No UI-controlled `ready`, `verified`, `human`, `permissions` or `grantId` field can
create authority. Grant provisioning uses a trusted SDK transition under host policy,
not a public grant-write endpoint, user-supplied SQL or direct Store writes by a
normal consumer. Upgrading connection permissions is a new exact consent decision.

## Host configuration and readiness

These are **actual dependencies**, not defaults that a mock can fill. The host
exposes only safe check results to Marketing; configuration values stay server-side.
The SDK implements provider-specific discovery, consent mapping and verification.

| Host dependency | Existing source / required setup | Ready only when |
| --- | --- | --- |
| Identity and membership | Existing host session plus `Store.bindExternalPrincipal` or equivalent trusted mapping; current disabled/role checks every request | Principal is server-derived and current project access reloaded; no host password/MFA policy invented |
| Persistent authority | Existing role/grant policy and exact human connection-access decision; explicit requested duration and operations | Approved actor is allowed to grant that scope; absent duration/policy is a setup dependency, not endless access |
| Durable store/execution | Existing Store/schema and sole `acquireExecutor` owner; migration-free ordinary startup | Declared configured store is validated; no automatic migration or second executor. Host controls dispatch/recover scheduling |
| Credential custody | Existing `HostAgent` + host `CredentialCipher`/VaultPort, active key ID and key resolver; old keys available for rotation | Key service/broker is configured, tenant/project/account/purpose bound; secret use only inside trusted adapter effect |
| OAuth application | Existing `OAuthApp` clientId/clientSecret per Meta/Google/LinkedIn, safe canonical host origin | Correct environment's registered app and callback; approved required provider product access; secrets resolved through host custody |
| Redirect/handoff | Existing callback shape `${origin}/api/oauth/${project}/${provider}/callback`; proposed pre-grant routes below | Exact HTTPS registered return URL, authenticated state binding, no arbitrary redirect origin; native deep-link/app association verified if used |
| Generation | Existing NativeGeneration credential resolver + BillingPort/BoundGenerationBilling binding | Correct project/provider grant and separate cost authority; a configured key alone gives neither paid-call approval nor ad access |
| Optional Agent | Existing qualified AgentPort/host runtime/Vault bridge; no embedded scheduler | Qualified exact version/capability allows the requested assistance and takeover; absence leaves manual setup usable |

The existing reference host reads protected `MARKETING_CREDENTIAL_KEY` (64 hex
characters), optional `MARKETING_CREDENTIAL_KEY_ID`, `MARKETING_PUBLIC_URL`,
`MARKETING_OAUTH_APPS_PATH` and `MARKETING_GENERATION_BINDINGS_PATH`. These name
existing source configuration, not instructions to read secrets in this milestone.
Embedding hosts can resolve the same contracts from their existing secret service;
no requirement to create another on-disk secret file or copy the reference host.

**Historical baseline OAuth request scope inventory from `server/agent.ts`, not a recommendation
to expand access:** Meta requests `ads_read,ads_management,pages_read_engagement`;
Google requests `https://www.googleapis.com/auth/adwords` and uses its existing S256
PKCE/offline consent path; LinkedIn requests `rw_ads r_ads_reporting
w_organization_social r_organization_social`. Implementers must qualify the exact
necessary scope bundle for each supported intent/provider, display it in review,
and preserve least authority in the local grant even when provider scopes are bundled.
The current broad fixed bundles do not constitute a finished read-only discovery
consent contract. No additional scope is authorized here. If a minimum supported
flow cannot be qualified with these bounds, return a dependency, not hidden expansion.

Keep exact provider authorize origins (`www.facebook.com`, `accounts.google.com`,
`www.linkedin.com`) and allowlisted token endpoints from HostAgent. Provider login,
passwords, MFA codes, terms and billing details remain on the provider origin.
A host handoff route authenticates and redirects; it is not a credential collection
form or arbitrary browser URL. OAuth callbacks must scrub code/state from browser
history, telemetry, referrers and errors and return a safe checkpoint location.
State nonce is high entropy, single-use and server-bound to user/project/provider,
connection and config revisions, intended purpose and expiry. Token exchange remains
server-only; browser success messages or popup `postMessage` are hints to reread,
never evidence of a grant. Preserve provider-specific CSRF/PKCE protections; qualify
any additional provider-specific security requirement before implementation.

Temporary discovery credentials use this same broker, a bounded lifetime and
allowlisted read operations. They are not project Grants, but a NEW OAuth grant
already creates provider access and can outlive local discovery. Exact action-time
human approval must precede its authorization URL, not merely the later project
binding. Reuse is allowed only for existing authorized actor/project/purpose scope;
provider sign-in cookies are not that authority. Never inherit the current fixed
scope bundle or Google's offline consent as a default discovery permission.
Expiration/cancellation stops reuse; deletion/revocation of
provider-side authorization needs its own exact permitted operation and must not
be implied by local cleanup. Host policy defines safe ephemeral retention.

## Pre-grant verification and durable binding

There is a real source dependency: `VaultPort.use(Grant, ...)` and
`NativeProvider.verify(Grant, ...)` both require a Grant. Implement an internal
connection-scoped custody use path in HostAgent and shared native read helpers for
discovery/account/identity verification. Its authority is the retained connection,
current actor/session, approved provider access and exact permitted read, never a
fabricated or partially valid Grant. Keep this capability server-only. Existing
grant-bound methods retain their checks and reuse the same native helpers.

After selecting account/identities, verify their current native relationships and
scope using that custody path. Then transactionally compare the decision, actor,
session, account, configuration and connection revisions; commit the one real Grant,
encrypted credential binding and connection result together. Only then may existing
`setup`/`resumeSetup` operate on it. Campaign-material capability remains a separate
later check. No host callback may assert that discovery or verification succeeded.

Use existing Store `records`, `requests`, transactions, expected revisions and outbox
for connection, decision, discovery, handoff and effect receipts. Retain encrypted
credentials only through existing cipher custody. Stable actor/action/payload request
digests, deterministic decision/effect identities and transactional CAS must prevent
duplicate grants and equivalent active operations; plain `Store.put` without an
expected revision is an upsert, not a uniqueness claim. Prove these invariants on
the existing SQL runners before assuming schema fit. No startup migration or new
database framework is proposed; a demonstrated schema gap requires a bounded
migration design before that dependent implementation proceeds.

## Authority across awaited effects and recovery

For every discovery page, exchange, credential use/refresh, verification or Agent
step: authorize current identity and project; snapshot connection/config/grant
revision and digest; reserve operation/checkpoint transactionally; obtain only the
scoped broker capability; perform the one permitted effect; reauthorize after await;
compare revisions/expiry/revocation before persisting view/grant or dispatching any
next effect. No transaction held across network time is treated as a substitute for
fresh authority. SDK effect guards reuse existing provider `beforeWrite`, leases
and executor fencing; refresh/consent is not an unjournaled loophole.

Bind handoffs and discovery snapshots to a validated host session reference as
well as user ID. `Principal.sessionTokenHash` supports SDK sessions; an external
host must supply an equivalent opaque session reference and fresh validity check
through the public auth hook. A user ID alone cannot detect logout during an await.
Never put session tokens/hashes or broker capabilities in ConnectionView. Session
replacement, logout, provider identity switch or native return in another session
requires explicit reauthentication/rebinding; OAuth state is not a login session.

If authority expires while a call runs, do not disclose its accounts or commit a
new grant. Retain only restricted audit/outcome evidence for authorized recovery;
actual provider effects cannot be undone by pretending the await never happened.
If a collaborator changes the account, config or requested access, reject stale
results. Two approvals/callbacks must not create two grants: use transactional
uniqueness/CAS on connection decision and original effect identity. New request keys
cannot evade unknown effects. Executor loss fences writes and replacement reconciles.

Persist a callback/effect receipt before acknowledging success. If the callback was
consumed and exchange acknowledgement is lost, first read retained outcome; never
replay the authorization code. If no safe retrieval is possible, keep outcome unknown
and explain a fresh user-consent requirement for credential recovery, with no duplicate
local grant. Recheck membership for that recovery, including disabled users and
multi-user reassignment. Reconnect never resurrects revoked grant revisions or old
launch packets. Native return, reload and cancelled popup all use this same path.

## Minimum consumer (proposed)

Two narrow host glue areas below use public imports only. `host.*` names are the
consumer's existing infrastructure, not new Marketing business logic. The adapter
factory/config option and Connections export are proposed. Acceptance must inventory
the actual implemented files and lines, including any hidden glue inside `host.*`;
this example is not a claim of achieved integration size.

```ts
// PROPOSED server mounting example; new createConnections and constructor option.
import { MarketingServer, HostAgent, NativeProvider, createConnections }
  from '@handrail/marketing/server';
// Existing host.store, cipher, OAuth app bindings, identity, generation and router.
const custody = new HostAgent(host.store, host.publicOrigin, host.oauthApps, host.cipher);
// host.oauthApps: Partial<Record<'meta' | 'google' | 'linkedin', OAuthApp>>,
// each configured entry has protected clientId/clientSecret; no literal secrets.
// host.cipher: createCredentialCipher(activeKeyId, existingProtectedKeyResolver).
// host.publicOrigin: canonical HTTPS origin; register the exact per-project callback.
const connections = createConnections({
  store: host.store,
  custody, // same HostAgent/Vault ownership, no second secret store
  accessPolicy: host.marketingAccessPolicy, // role scope + explicit expiry; no UI callback approval
  generation: host.generationBindings, // existing protected generation/billing capability
  agent: host.optionalQualifiedAgent, // omit entirely for guided manual onboarding
  sessions: host.marketingSessions, // opaque session reference + fresh validity check
});
const marketing = new MarketingServer(host.store, {
  meta: new NativeProvider('meta', custody, host.store),
  google: new NativeProvider('google', custody, host.store),
  linkedin: new NativeProvider('linkedin', custody, host.store),
}, host.generation, custody, 'live', undefined, undefined, { connections });
// Proposed eighth constructor option preserves existing clock/destination slots.

host.router.post('/api/projects/:id/:command', async request => {
  const principal = await host.requireCurrentMarketingPrincipal(request);
  // Existing route validates method, size, origin/CSRF and closed command/input schema.
  return marketing.call(principal, request.params.id, request.params.command, request.body);
});
// Proposed public handlers authenticate internally through the supplied host resolver.
host.router.mount(connections.routes({
  authenticate: host.requireCurrentMarketingPrincipal,
  origin: host.publicOrigin,
}));
// Existing executor integration remains the single owner; no new timer/controller.
```

`createConnections` is a narrow composition convenience in the existing server
entry point. Its proposed options are: the **same** Store; the **same** HostAgent
custody; a trusted access policy resolver receiving authenticated principal,
project, provider and requested operations and returning allowed operations,
explicit maximum expiry and configuration revision; existing generation binding
status resolver (safe facts only); optional qualified AgentPort extension.
The session adapter maps the existing host session reference and validates it before
and after async effects; it does not implement provider logic or create sessions.
SDK checks membership and human decisions independently of that resolver. It must
not accept a host callback that implements the wizard or returns arbitrary ready
booleans. Native discovery adapters and provider origin mappings ship inside SDK.

Missing app entries must leave that provider's catalogue card visible. Proposed
stable diagnostic codes include `oauth_application_not_configured` (bind app),
`credential_key_unavailable` (repair custody/key access), `callback_origin_mismatch`
(register shown safe URI), `connection_access_policy_missing` (map grant-maker and
bounded expiry), `host_session_validation_unavailable` (bind session check) and
`provider_scope_unqualified` (qualify the exact intent bundle). Each supplies actor,
safe next action and retry class; none echoes values or substitutes fixture success.
Invalid shared custody/session configuration fails readiness closed; an unrelated
missing provider app must not disable local drafts or the whole catalogue.

The optional assistance seam is an additive, server-only extension of `AgentPort`,
proposed as `inspectConnection(context)`. Context contains the safe connection
checkpoint, authenticated actor reference, expected revision and a host-issued
short-lived broker capability reference for the exact permitted discovery step.
It returns `continue_manual`, `waiting_human`, `blocked` or `checkpoint_available`
with a safe reason and retained checkpoint reference. It cannot return a grant,
consent approval, credential value or authoritative account/capability assertion.
The SDK resolves checkpoint evidence through trusted custody and re-verifies it.
Existing `inspect(Setup, Grant)` remains unchanged; optional feature detection
must not treat its presence as support for `inspectConnection`. No claim is made
that frozen Agent 0.2.15 implements this proposed extension.

`connections.routes` mounts only SDK-owned handoff initiation/return handlers,
including the exact registered OAuth callback above; new pre-grant start route is
`/api/projects/:id/connections/:connectionId/handoff`. It validates safe return
locations rather than accepting arbitrary URLs. No provider tokens are returned
by these handlers. Existing reference grant routes remain compatible. Hosts adapt
HTTP request/response/auth primitives only; they do not implement OAuth logic.

```tsx
// PROPOSED public-only UI mounting; Workspace internally owns Connections.
import { createMarketingClient } from '@handrail/marketing';
import { MarketingWorkspace } from '@handrail/marketing/react';
import '@handrail/marketing/react/style.css';
const client = createMarketingClient(host.apiOrigin, host.selectedProjectId);
<MarketingWorkspace key={host.selectedProjectId} client={client} />;
// Optional proposed narrow mount: <MarketingConnections client={client} />.
// Existing scoped root/theme tokens supply branding; no host provider-specific form.
```

Same typed client commands support headless use. Agent tools may start/discover/read/
resume permitted work and return `waiting_human`; they must exclude access decisions,
secrets and arbitrary navigation. A non-React native host still uses identical domain
contracts; full native reusable UI packaging is a later platform gate, not license
for another four-field custom product. Manual path must run with no Agent SDK
installed. Full-SHA public HTTPS dependency and matching lockfile/normal preparation
remain required; no install or dependency change is performed here.

## Proposed implementation boundary

All paths below are future ownership assignments; no runtime file changes in this milestone.

| Named future file / public entry | Bounded responsibility |
| --- | --- |
| `marketing-sdk/core/connections.ts`, re-export from `core/index.ts` (`@handrail/marketing`) | Closed Connection state/command/view model and separate ad/creative catalogue types |
| `marketing-sdk/server/connections.ts`, export from `server/index.ts` (`/server`) | `createConnections`, safe configuration facts, pre-grant operation/decision/transitions, callback receipt recovery and catalogue |
| `marketing-sdk/server/service.ts` | Add typed commands to existing dispatch/auth; preserve old setup behavior and Store idempotency |
| `marketing-sdk/server/store.ts` only if a focused atomic helper is needed | Existing records/requests/CAS/outbox persistence; no consumer grant seeding, second store or implicit schema migration |
| `marketing-sdk/server/agent.ts`, `server/ports.ts` | Extend HostAgent pre-grant OAuth/handoff and optional qualified pre-grant Agent assistance seam; preserve Vault/Agent/executor ownership |
| `marketing-sdk/server/providers.ts`, `server/google.ts` and bounded server discovery helpers if needed | Authenticated scoped account discovery/verification, pagination and exact identity checks; no provider campaign mutations |
| `marketing-sdk/react/connections.tsx`, export/integrate from `react/index.tsx` (`/react`) | Reusable catalogue and manual/optional-Agent stepper, evidence, recovery, keyboard/project fences |
| `marketing-sdk/tests/connections.test.ts`, `tests/connection-security.test.ts`, consumer/browser fixtures | Focused state, discovery isolation, awaited-race, callback recovery, public import and zero-grant UI proofs using existing DB runners |
| `marketing-sdk/examples/embedded.tsx` and clean consumer example after authorization | Public-only mounting/config guide; measure actual host glue and transitive helpers |

Deferred: campaign lifecycle deletion, complete studio, website instrumentation/
event transmission, expanded ad formats, paid generation, provider writes, Preview/
Handrail/ERP/Agent source changes, deployments and releases. Schema changes, if
implementation finds any necessary, require separate migration design/authority;
this document does not authorize them or assume an unproven schema fit.

## Candidate implementation contracts

Current source: [browser contracts](../core/connections.ts),
[service/factory/routes](../server/connections.ts), [native discovery](../server/connection-discovery.ts),
[HostAgent custody extension](../server/agent.ts), [React journey](../react/connections.tsx).
The existing `setup`/`resumeSetup`, campaign/material/source, budget and reporting
contracts remain separate and retain their previous semantics. No fake Grant is
constructed for discovery or verification. Public commands enter through the
existing MarketingServer dispatcher, outside its legacy transaction wrapper so
provider awaits cannot hide membership changes behind a long transaction.

The concrete `ConnectionsOptions` currently takes the same `store`, optional
`custody`, `accessPolicy`, optional external `sessions`, and explicit synthetic
`evidence` for tests. Missing dependencies leave visible diagnostics. It does not
accept generic generation-status or arbitrary-ready callbacks. `accessPolicy`
returns a current revision, safe app label, allowed operations, allowed OAuth
scopes, explicit offline permission, `maxDurationSeconds` and
`discoveryRetentionSeconds`. The latter bounds **use** of pending discovery
credentials/choices; it does not promise physical erasure. Provider authorization
and selected-account project binding have separate five-minute human decisions.
Project access expiry is explicit in `startConnection`; no perpetual default.
Google's adwords and LinkedIn's rw_ads bundles are displayed as broader native
management permissions even when the narrower project intent is reporting.

`routes({ origin, authenticate, returnPath? })` returns a Fetch-compatible handler
for SDK-owned handoff/callback URLs. `returnPath` is a trusted static local path,
never a query-supplied redirect. Unknown/expired/foreign callbacks scrub their
query and return safely. Existing `oauth` records continue through the original
legacy handler. Access proxies must redact callback query strings before logging;
SDK handlers do not log requests, provider bodies, codes, state or credentials.

Callbacks have one original identity and are durably marked exchanging before the
token request. The encrypted result is retained before acknowledgement, including
when permission changes during the response. Repeated callbacks never exchange the
code again. Reconciliation checks that original receipt; an unrecoverable consumed
code requires explicit fresh consent and cannot create a duplicate local grant.
Read attempts have retained effect identities, CAS and safe interruption recovery;
there is no new scheduler. Cancellation fences later writes and explains that
provider authorization can remain. Explicit takeover clears actor-bound discovery,
credentials and decisions; an unresolved exchange cannot be reassigned.

### Record ownership and retention

No table, migration, schema version or startup migration behavior was changed.
Existing `records`, `requests`, serialized transactions, revision CAS and outbox
own the new records. All are project-scoped; public projections are allowlisted.

| Record / existing table | Contents and retention/use rule |
| --- | --- |
| `connection` in records | Actor/session/config digest, revisioned progress, selected account/context, safe decision and verification evidence. Discovery use expires at host policy deadline; choices additionally expire after five minutes. On binding, connection use is bounded by the exact Grant expiry. Cancel/reassign fences old choices. Minimal audit and causal IDs remain for retry/unknown recovery |
| `connectionCallback` in records | Original state digest, actor/session/config binding, single exchange status and token expiry. State/PKCE verifier/authorization URL are encrypted with existing CredentialCipher. Authorization use expires with the human decision. Callback status is never deleted/reused to enable code replay |
| Existing `vault` kind | Only encrypted credentials, using HostAgent's existing envelope/key resolver. Pending use is fenced by connection lifetime; completed grants reference the same ciphertext custody. Cancellation never implies provider revocation or physical erasure |
| Existing requests/outbox | Actor/action/payload-bound request digest, connection ID, event ID/revision/phase/safe reason. Retained for idempotency and audit; no credentials or full discovery lists in broadcasts |
| Existing `grant` and `setup` kinds | One deterministic real Grant plus a compatible account-verification Setup, committed with the connection CAS after both human decisions and native reads. Existing historical records are preserved |

This tranche performs no retention purge or irreversible deletion. Restricted
expired ciphertext and audit records remain under the host's existing Store/Vault
retention, key rotation, access and hold policy; they are not usable indefinitely.
No new secret store or erasure policy is invented. Hosts requiring physical
short-lived discovery erasure need a separately scoped existing-custody retention
integration before live adoption; `discoveryRetentionSeconds` alone is not that
integration. Preserve original callback/request tombstones when designing it.

### Integration and precise remaining seams

The compiled [server example](../examples/connections-server.ts) accepts existing
host auth, policy, custody and generation ports and implements bounded request
parsing, origin checks and public dispatch. The [web mount](../examples/embedded.tsx)
uses public imports and optional public CSS (now with a TypeScript declaration).
MarketingWorkspace opens Connections in a zero-grant project. Standalone
MarketingConnections accepts `client`, optional non-secret UI `sessionKey`, and
`onContinue`; host identity changes must replace client/sessionKey immediately.
Client calls accept an optional AbortSignal. The component aborts/ignores old
scope responses and stores only a connection ID in optional sessionStorage;
reload resolves the checkpoint through fresh authenticated reads.

**Creative prerequisite:** NativeGeneration's credential resolver and
BoundGenerationBilling resolve an existing GenerationGrant by grant ID, provider,
model, capability reference, expiry, currency, cost quote and key. Neither exposes
an authenticated safe inventory/selection of existing broker capabilities, a
protected configuration navigation route, a no-charge binding-status operation,
or an exact human-approved persistent binding transition. Those are the missing
public contracts. The existing broker/billing owner must expose them, with current
project/session scope and encrypted-custody ownership preserved. This candidate
shows the precise dependency and does not collect credentials, SQL-seed generation
grants, create a billing engine or turn a configured key into paid-call authority.

**Agent prerequisite:** no `inspectConnection` adapter is qualified; absence is
visible and manual setup works without an Agent dependency. Existing AgentPort and
frozen Agent 0.2.15 are not presented as supporting this proposed extension.
**Native prerequisite:** N01 remains a separate target-platform gate; no Flutter
package, WebView selection or host-specific native screen is included.

### Independent review correction

The [implementation/security review](CONNECTIONS-REVIEW.md) records the original
blanket LinkedIn publishing gate. The [2026-10-07 source qualification](LINKEDIN-CONNECTIONS.md)
supersedes it with an explicit trusted app/scopes contract and same-member account/
approved Page-role join. Reporting remains separate; live app evidence is unverified.
No extra scope is requested implicitly. Direct Google
customers require no invented manager selection. Current role/session/record and
Grant checks fence stale status responses, and expiry/new keys cannot bypass an
unknown callback receipt.

The current handoff path is browser-only. N01 requires a public token-free native
handoff descriptor, independently authenticated browser claim and explicit
dual-session authority/recovery semantics before any native integration. The
existing session-validation hook is not a session bridge. Creative capability
inventory, protected configuration handoff, no-charge status and approved billing
binding remain an SDK/broker product contract gap, not host-built replacement UI.

## Manual creative Connections addition (2026-10-07)

This bounded addition supersedes the creative missing-contract finding only where
implemented and verified. OpenAI images and xAI video use the current Connections
catalogue plus SDK-rendered private human pages. They do not use advertising OAuth,
X Ads, a GenerationGrant cast to Grant, Agent approval, or provider test generation.

The public `CreativeConnections` adapter receives the existing Store, cipher custody,
current host sessions, fixed environment, canonical origin, current grant-maker policy and optional
BillingPort inspection. Policy supplies environment, revision, branding, permitted
models, finite maximum access duration and IDs of independently issued generation
grants. The policy environment must match the fixed host binding. No grant is created by
this journey. Null policy blocks new setup/use but still permits current owner
inspection and exact local disconnect in that environment. A project with zero generation grants
can configure an existing key and sees paid use blocked with its exact next step.
An existing configured credential can be chosen within the same project/environment/
provider/model and current human owner; that choice never transfers grant authority.

Requirements → choose model, existing binding or new key, optional existing grant,
and duration → exact persistent-access review → private secure entry/approval →
local configuration/status → explicit local disconnect. The review includes project,
environment, provider/purpose/model, config revision, expiry and bound grant. Entry
is an SDK-owned script-free HTML form, outside Marketing React/domain commands,
telemetry and browser storage. Password input values are never echoed. Hosts must
exclude these routes' request bodies from ingress logs/APM and analytics, and supply
current authentication. CSP disallows scripts, embeds and external resources; POST
requires exact origin, authenticated human session, finite review and intent revision.
Private forms use same-origin referrers: no-referrer would make native browser
POST Origin null and break exact-origin validation. No secret enters a URL.
This is a browser contract only; native token-free dual-session handoff remains
unqualified. No cookie bridge or Flutter screen is introduced.

Use existing records/CAS/transactions and existing encrypted `vault` kind, with
nonsecret `creativeConnection` and request receipts. No schema change or migration
is needed: SQL transaction guards and record revision CAS serialize local effects.
The vault helper is extracted from the current cipher/Store boundary, not a second
secret database. Encrypted values remain isolated there; status inspects existence
without decrypting. Local disconnect invalidates its binding without modifying the
retained encrypted envelope; independent references to an original binding remain
dependent on the original's authority/expiry/revocation. Historical intent and dedupe
receipts remain. Physical deletion requires the existing custody owner's explicit
retention/hold and reference checks; disconnect is not that approval. Provider-side
key revocation is a separate external gate.

Every mutation rechecks current human/session/membership, policy snapshot, record
revision, expiry, source binding and exact independent grant before and after awaited
adapters, then commits with CAS. Lost acknowledgements recover the original intent;
replayed approval cannot replace its key. Cancel/disconnect fence late submissions.
Reconnect creates a new exact intent and consent; no old grant or decision is revived.
A provider, model, environment or policy revision change blocks stale configuration.

Safe status separates credential configuration (missing/configured/expired/revoked),
provider verification (unverified), generation grant and billing configuration.
BillingPort.inspect is optional and read-only; absence means unavailable. Inspection
must never reserve, generate, call a provider or mint spend authority. Bound billing
inspection returns only matched safe metadata; existing authorize/quote/ceiling and
unknown-job fences stay unchanged. Status is never a universal readiness flag.
The NativeGeneration credential callback may use the new exact-grant resolver; its
existing billing executor still owns authorization and generation idempotency.
When composing NativeGeneration with creative credentials, also bind its optional
final custody-use fence to `creative.assertCredentialAccess`; the supplied public
creative mount does this. It runs after awaited executor authorization and before
transport, so a binding disconnected during that await cannot submit with an
already-resolved key. A denied final check retains any existing reservation.

Verification is synthetic only: real disposable SQLite and isolated PostgreSQL,
public packed consumer with Agent absent, private-route browser journey behind the
qualified loopback guard, masked entry screenshots, authority races and no-effect
status assertions. Remaining qualification and failed attempts must be recorded in
ACCEPTANCE and artifacts; no source/live/native/product acceptance is implied.

### LinkedIn intent and app capability contract (2026-10-07)

The normative [LinkedIn contract](LINKEDIN-CONNECTIONS.md) defines exact reporting
and publishing bundles, `OAuthApp.linkedinAdvertising`, member/role bindings,
bounded pagination and source evidence. This supersedes the historical fixed
LinkedIn OAuth inventory for new Connections only. Existing grants retain their
identities; native handoff and creative security/retention contracts are unchanged.
