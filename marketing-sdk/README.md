# Handrail Marketing SDK

The [maintained product specification](PRODUCT.md) defines the intended user
experience and acceptance gates. This guide describes existing engineering
surfaces; it is not evidence that the full product or Preview integration works.
The [Connections design](design/CONNECTIONS.md) and [public contracts](design/CONNECTIONS-CONTRACT.md)
now have an uncommitted advertising implementation. These new APIs are absent from
the frozen published 0.1.7 baseline; the candidate keeps that version unchanged.
The [independent review](design/ACCEPTANCE.md#independent-review-verdict-2026-10-06)
permits a bounded implementation handoff; full UI and native product proof remain open.

Typed headless API, durable server authority, optional React components and an executable standalone reference host. Install from the public Git repository as described in the root README. No browser-agent runtime is included.

## Entry points

| Source | Public purpose |
| --- | --- |
| `core/index.ts` | Browser-safe types, `createMarketingClient`, canonical material serialization. No React or server imports. |
| `server/service.ts` | `MarketingServer.call(principal, project, command, input)` and typed methods; membership, grants, exact human decisions, journal and reconciliation. |
| `server/store.ts`, `server/schema*.sql` | Durable PostgreSQL, MariaDB and SQLite transactions, revisions, unique request keys, byte storage, sessions and outbox. |
| `server/ports.ts` | Replaceable provider, generation, billing and Agent ports. Host retains execution ownership. |
| `agent/index.ts` | Restricted tool schemas and dispatcher using the same authenticated client. No human decision tool. |
| `react/index.tsx` | Optional `MarketingWorkspace`, `MarketingConnections`, `ApprovalPanel`, `MaterialReview`; import `react/style.css`. |
| `reference/host.ts` | Same-origin HTTP host, authentication, static UI, media range requests and one serialized executor. |

Compile with `npm run build` (also run by `prepare`). Declarations and JavaScript
are emitted to `.marketing-build`; Vite emits the reference UI to
`marketing-sdk/reference/dist`. Public package imports are documented in the root README.

## Run a local fixture host

Node 22.23.1 and ffmpeg/ffprobe are required. Use `npm ci --include=dev --no-audit --no-fund`, then `npm run build`.

The reference datastore supports PostgreSQL and isolated host-managed MariaDB.
See [PostgreSQL and local drafts](DRAFTS.md) for embedding with real host identity
and no provider credentials. For the MariaDB fixture example below, use generated
`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`.
It does not read a control-plane DATABASE_URL or a SQLite path. Build with the normal pipeline, then configure:

```text
PORT=8080
APP_ENV=staging
MARKETING_MODE=fixture
MARKETING_DATASTORE=isolated-mariadb
MARKETING_PUBLIC_URL=https://<declared-staging-origin>
MARKETING_BOOTSTRAP=staging-fixture
HANDRAIL_FIXTURE_QA_USERNAME=<non-secret QA login>
HANDRAIL_FIXTURE_QA_PASSWORD=<protected native ENV binding, never a literal command>
```

Supply bootstrap credentials through the host's protected secret bindings, never source
or command-line literals. Start with `npm start`. First use atomically seeds only an
empty database; ordinary starts never reset users, memberships or grants. Use one
replica and a stop-before-start rollout: the reference host owns the sole executor.
The reference default port is 8080; embedding hosts choose their declared port.

The server retains all records/media in InnoDB and holds a database connection lock as its sole executor. Lock loss fences further writes; recovery marks interrupted effects unknown. All Store/service methods and provider retention/authority callbacks are asynchronous and must be awaited. SQLite remains a disposable local regression harness only. `npm run test:mariadb` allocates a fresh socket-only MariaDB (requires local `mariadbd` and `mariadb-install-db`); it never uses ambient database credentials. `test:browser:mariadb` exercises the actual responsive host on that private server. Neither is staging acceptance.

## Client and optional UI

```ts
import { createMarketingClient } from '@handrail/marketing';
const marketing = createMarketingClient(location.origin, authenticatedProjectId);
const workspace = await marketing.call('workspace', {});
// Existing 0.1.7 continuation only: requires a trusted, pre-existing grant.
// This cannot onboard a fresh project; do not seed a grant to simulate onboarding.
const checkpoint = await marketing.call('setup', {
  grantId: workspace.grants[0]!.id, requestKey: crypto.randomUUID(),
});
// Show the human handoff link, then resume with checkpoint.id/revision.
```

The URL's project ID is a selection, not authority. Every call reloads the server's membership. `examples/headless.mjs` exercises the same HTTP endpoint with a privately supplied bearer session. `examples/embedded.tsx` demonstrates embedding the full optional UI. A host may render only the approval component or use no React.

Commands are defined in `core/Commands`: workspace; setup/resume; capture destination; save material; generate/reconcile media; storyboard; prepare paused objects; packet; decide/revoke; execute/pause/reconcile; event/conversation ingestion; conversation inspection; metric sync/results. POST JSON to `/api/projects/:id/:command`. Login/logout use `/api/login` and `/api/logout`, identity uses `/api/me`, assets use authenticated `/api/projects/:id/assets/:assetId`, and `/api/projects/:id/events?after=0` reads durable events. IDs and expected revisions come from responses.

Use stable request keys for setup, generation and external operations. An identical key replays the retained result; changed payload conflicts. A new key cannot bypass an unresolved external write. Read `operations`/`jobs`, and reconcile an unknown outcome instead of resubmitting. Unknown synchronous image jobs without a retrieval facility remain fenced for provider support investigation. Revoking a decision prevents future execution; it does not undo a completed external launch. Use explicit pause for that separate action.

## Authority and host integration

Roles are persisted memberships: admin/editor prepare material; human admin/approver decide; admin/editor/approver execute an already approved packet; analyst reads non-transcript workspace/results; sales/admin access conversations; collector/admin ingest first-party events. Principal objects contain only a server-authenticated user ID. The store rechecks disabled status, role and human/agent kind. An embedding host must resolve this identity from its own session, never a caller header or claimed role. Provision agent identities with `kind='agent'` and separate sessions via trusted host code, never reuse a human's cookie for agent tools.

`MarketingServer` starts no timers, planner or scheduler. An embedding host must await `store.db.acquireExecutor()` before `dispatch`, `dispatchGeneration` or `recover`, then await all service operations. Reconciliation stays under the same current authority and unknown-write fences. The standalone reference host is the sole executor for its isolated datastore. Do not point both at the same store. Outbox consumers retain their cursor and dedupe events; no outbound sends are implemented.

Account grants and generation grants are provisioned by a trusted host, never public
HTTP. `HostAgent(store, origin, oauthApps, cipher, fetcher?)` requires a
`CredentialCipher` supplied by the host. `createCredentialCipher(activeKeyId,
resolveKey)` provides AES-256-GCM with an injected 32-byte key resolver, preserving
the existing iv/tag/ciphertext envelope and key IDs. Keep old keys available when
rotating; no default key, home-directory file or platform Vault access exists.
The standalone reference host reads `MARKETING_CREDENTIAL_KEY` (64 hex characters)
and optional `MARKETING_CREDENTIAL_KEY_ID` from protected environment bindings.
Embedding hosts can supply their own key service. Fixture mode needs no key.
`HostAgent` supports provider-origin OAuth consent and native verification only.
Live credentials never enter React. Browser-agent setup remains unavailable.

Each campaign retains one creative-set identity with material revisions. A 15-minute human packet binds the project/account, grant revision, action, provider plan, money/time, targeting, destination HTML digest and asset bytes. Execution rechecks these and actor rights before each provider write. Live destination capture accepts direct public HTTPS HTML only and rechecks exact bytes; redirects, private hosts and changing pages fail closed. Dynamic landing pages need a stable approved destination before execution. Provider preparation creates paused/draft objects only. Enabled intent is reported separately from delivery; no live delivery has been verified by this implementation run.

## Supported native adapter surface

The following table is the historical initial adapter scope, retained for context.
For the exact 0.1.7 conditional matrix and denials use [CAPABILITIES.md](CAPABILITIES.md)
and the [product provider/media map](PRODUCT.md#provider-and-media-truth).
In particular, new LinkedIn execution requires explicit daily approval and UTC;
Meta daily execution remains blocked. Older prose about total budgets or traffic
alone must not be used to bypass current validation or imply live qualification.

| Provider | Implemented surface | Deliberate limits |
| --- | --- | --- |
| Meta v26.0 | Existing native client; account/page/billing validation; one image, ordinary traffic, country/age targeting, lifetime budget, paused ad tree, activation/pause/readback/reporting | Feed placement; no special-category ads, automatic expansion or video-ad upload. |
| Google Ads v25 | New OAuth REST adapter; optional manager ID; exact-plan validate-only and atomic mutation; Search RSA, exact keywords and native geo criteria, custom-period total budget, paused tree, readback/reporting | Text Search only; account read access alone never advertises write capability. Explicit copy minimums apply. |
| LinkedIn 202609 | Existing native client; role/organization validation; single-image sponsored content, native geo/job-title criteria, draft group/campaign/creative, total group cap, activation/pause/readback/reporting | No offsite/automatic expansion or video-ad upload. |

The exact native plan, including pacing and bid choices, is shown in the human packet. Unsupported combinations reject instead of silently widening audiences. Native transports are implemented, but live account permissions, billing and delivery are unverified. All paid activation tests use fixture providers.

OpenAI image generation uses the installed SDK with retries disabled. xAI video generation retains request IDs, polls status and retains decoded playable MP4 bytes. Storyboards are separate text assets. Only new generation is supported; reference-image edits reject explicitly. Generated video can be inspected and played but is not supported as ad material by these initial native campaign surfaces. Each paid job requires a separate existing generation grant and cost-quote/billing binding; ad approval cannot authorize generation. Unknown outcomes retain cost reservations. No actual paid generation ran in this worker.

## First-party data and metrics

Ingest only trusted completed-form/click/order receipts with consent and stable source identities. Duplicate source receipt IDs cannot double-count an event. Current reporting distinguishes completed submissions from unique people; legacy `leads` counts people completing forms without requiring qualification. Historical imports preserve original attribution and QA exclusion evidence. Recruitment applications, qualified applicants and hires remain separate from acquisition leads, qualification and customers. Attribution for new SDK events is last paid click within seven days; tied/ambiguous clicks reject. Conversations require a matching campaign's completed-form event and separate sales permission. No private messages are sent. See the [tracking product blueprint](PRODUCT.md#tracking-and-business-outcomes): ingestion and conversion ownership do not prove a website fires events or a provider accepts them.

The host collector must attest collection coverage before absent first-party rows can become zero: write project-scoped `firstPartyCoverage` records with `from`, `until` and a retained source receipt from the collector's completeness checkpoint using trusted `Store.put`. Never infer coverage from a successful API call or expose this as an agent boolean. Without coverage the results are null with a reason. The fixture seed's synthetic coverage is explicitly labelled. Live collector integration remains deployment-specific.

Results use `[from, until)`, campaign timezone and currency, one-hour provider freshness, `ctr=clicks/impressions`, `mediaCacMinor=media spend/customers`, and `mediaRoas=attributed revenue/media spend`. These are media-only CAC/ROAS; no untracked business costs are implied. Missing data, mixed currencies and zero denominators have null reasons. Provider conversions are separate from first-party counts.

See [session mapping and migration](server/migrations/README.md) for host identity boundaries.

## Shared Connections integration

`createConnections({ store, custody, accessPolicy, sessions? })` is exported from
`@handrail/marketing/server`; pass it in MarketingServer's eighth constructor
argument `{ connections }`. Use the same Store and HostAgent as existing provider
operations. Bind a current human grant-maker policy with exact allowed operations,
OAuth scopes, bounded duration and discovery use lifetime. SDK-authenticated
principals carry `sessionTokenHash`. External principals must carry an opaque
`externalSessionRef`; `sessions.current` checks that original reference afresh,
including logout/replacement. User ID alone is insufficient.

The [complete Fetch adapter](examples/connections-server.ts) compiles using public
exports. It receives existing authentication, custody, policy and generation ports;
its HTTP route does not contain provider business logic. Host transport remains
responsible for ingress callback-query redaction and existing execution ownership.
The reference runtime deliberately does not invent grant-maker policy: without an
explicit factory policy, providers display the configuration dependency.

The Connections catalogue retains all three advertising and two creative rows.
OpenAI/xAI manual configuration uses the SDK private secure-entry routes below.
The earlier missing-contract finding is preserved in its dated receipt; this
addition still needs independent review and provider/live qualification.
No existing Agent 0.2.15 pre-grant compatibility, Flutter widgets, live provider
qualification or complete Marketing acceptance is claimed.


## Manual creative Connections

Use [the complete creative host composition](examples/creative-server.ts) together
with [the Fetch adapter](examples/connections-server.ts) and the existing
`MarketingConnections` or `MarketingWorkspace` mount. These examples compile from
public installed package exports. No provider forms or Agent SDK are needed.

`CreativeConnections` accepts the same Store, a fixed host `environment`, and
`EncryptedCredentialCustody` using
the existing host cipher, current session adapter, `accessPolicy`, and optional
BillingPort inspection. The policy maps existing grant-maker rights to environment,
configuration revision, app label, allowed models, finite maximum duration and IDs
of independently issued generation grants. It must return null when denied.
The policy environment must match the fixed host environment. No public input can
supply policy, ready flags, provider verification or a grant. With null policy,
new setup/use is blocked but a current authorized owner can still inspect and
explicitly disconnect an existing binding in that environment.
An empty grant list supports credential configuration only, with paid use blocked.
The creative mount wires both the existing credential resolver and the final
`creative.assertCredentialAccess` check into NativeGeneration. Custom compositions
must wire that optional fourth constructor hook too, so disconnect or policy loss
during awaited executor authorization fences transport without freeing reservations.

Pass the adapter as `createConnections({ store, custody, creative, ... })`.
The existing `.routes({ origin, authenticate, returnPath })` serves both advertising
handoff and `/api/projects/:project/creative/:provider[/intent]`. Mount these before
ordinary JSON command routes. `authenticate` and optional `sessions.current` use
existing host identity; no new login, cookie bridge or scheduler is created.
HTTPS is required outside loopback fixture qualification.

The SDK owns requirements, selection, expiry, exact access review, private key
entry, consent, status, cancellation and disconnect. The private page contains no
scripts or external resources and never echoes credentials. **Exclude its request
bodies from ingress access logs, APM, replay and analytics before dispatch.** Use
current session validation and preserve CSP/no-store/same-origin-referrer headers. The private page uses
same-origin referrers so browsers retain the Origin header on native form POST;
cross-origin referrers remain suppressed and no secret appears in any URL. Normal
Marketing commands, React state, agent tools and browser storage receive safe
metadata only. Browser/password-manager/OS behavior is outside SDK custody; device
and accessibility qualification remains separate.

`creative.inspect(principal, project, id)` and catalogue status do not decrypt keys,
call a provider, reserve cost, create jobs or issue authority. Status distinguishes
local credential retention, missing/expired/revoked/unavailable access, independent
generation-grant state, unverified provider
entitlement and billing metadata. `BillingPort.inspect` is optional and read-only;
absence is unavailable. `BoundGenerationBilling.inspect` enforces its existing exact
binding/quote checks without reserving. Its legacy `apiKey` field is now optional,
so metadata-only billing can pair with encrypted creative custody. Legacy
`.credentials` still requires that field; the new composition instead uses
`creative.credentials(provider, project, grantId)` for `NativeGeneration`.

Every paid job still needs an existing generation grant and the original billing
`authorize`, quote, ceiling, idempotency and unknown-outcome fences. Configuring a
key does not create those grants or verify provider model access. Original human
session, membership, policy revision, environment and grant remain required at use;
logout or policy change blocks use and requires fresh review. Reusing an existing
credential requires the same project/provider/model/environment/owner, explicit
consent and an expiry no later than its source. Source revocation blocks descendants.
Local disconnect tombstones the new encrypted envelope while retaining safe intent
receipts; provider-wide key revocation is a separate external operation.

This is an uncommitted candidate projection. The required public HTTPS full-SHA
installation with matching lockfile remains gated on separately authorized source
publication. Native Flutter dual-session handoff, Agent pre-grant compatibility,
real provider entitlement and full Studio/tracking/Results/lifecycle acceptance are
not qualified here. xAI video is generation, not X Ads or supported video-ad placement.
