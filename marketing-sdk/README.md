# Handrail Marketing SDK

Typed headless API, durable server authority, optional React components and an executable standalone reference host. Install from the public Git repository as described in the root README. No browser-agent runtime is included.

## Entry points

| Source | Public purpose |
| --- | --- |
| `core/index.ts` | Browser-safe types, `createMarketingClient`, canonical material serialization. No React or server imports. |
| `server/service.ts` | `MarketingServer.call(principal, project, command, input)` and typed methods; membership, grants, exact human decisions, journal and reconciliation. |
| `server/store.ts`, `server/schema.sql` | Durable MariaDB transactions, revisions, unique request keys, byte storage, sessions and outbox. |
| `server/ports.ts` | Replaceable provider, generation, billing and Agent ports. Host retains execution ownership. |
| `agent/index.ts` | Restricted tool schemas and dispatcher using the same authenticated client. No human decision tool. |
| `react/index.tsx` | Optional `MarketingWorkspace`, `ApprovalPanel`, `MaterialReview`; import `react/style.css`. |
| `reference/host.ts` | Same-origin HTTP host, authentication, static UI, media range requests and one serialized executor. |

Compile with `npm run build` (also run by `prepare`). Declarations and JavaScript
are emitted to `.marketing-build`; Vite emits the reference UI to
`marketing-sdk/reference/dist`. Public package imports are documented in the root README.

## Run a local fixture host

Node 22.23.1 and ffmpeg/ffprobe are required. Use `npm ci --include=dev --no-audit --no-fund`, then `npm run build`.

The deployed reference host requires an **isolated host-managed MariaDB**, using generated `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`. It does not read a control-plane DATABASE_URL or a SQLite path. Build with the normal pipeline, then configure:

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

| Provider | Implemented surface | Deliberate limits |
| --- | --- | --- |
| Meta v26.0 | Existing native client; account/page/billing validation; one image, ordinary traffic, country/age targeting, lifetime budget, paused ad tree, activation/pause/readback/reporting | Feed placement; no special-category ads, automatic expansion or video-ad upload. |
| Google Ads v25 | New OAuth REST adapter; optional manager ID; exact-plan validate-only and atomic mutation; Search RSA, exact keywords and native geo criteria, custom-period total budget, paused tree, readback/reporting | Text Search only; account read access alone never advertises write capability. Explicit copy minimums apply. |
| LinkedIn 202609 | Existing native client; role/organization validation; single-image sponsored content, native geo/job-title criteria, draft group/campaign/creative, total group cap, activation/pause/readback/reporting | No offsite/automatic expansion or video-ad upload. |

The exact native plan, including pacing and bid choices, is shown in the human packet. Unsupported combinations reject instead of silently widening audiences. Native transports are implemented, but live account permissions, billing and delivery are unverified. All paid activation tests use fixture providers.

OpenAI image generation uses the installed SDK with retries disabled. xAI video generation retains request IDs, polls status and retains decoded playable MP4 bytes. Storyboards are separate text assets. Only new generation is supported; reference-image edits reject explicitly. Generated video can be inspected and played but is not supported as ad material by these initial native campaign surfaces. Each paid job requires a separate existing generation grant and cost-quote/billing binding; ad approval cannot authorize generation. Unknown outcomes retain cost reservations. No actual paid generation ran in this worker.

## First-party data and metrics

Ingest only trusted completed-form/click/order receipts with consent and stable source identities. Duplicate receipt IDs cannot double-count an event; a real completed form counts once per person without requiring qualification. Attribution is last paid click within seven days; tied/ambiguous clicks reject. Leads, qualification and paying customers remain separate. Conversations require a matching campaign's completed-form event and separate sales permission. No private messages are sent.

The host collector must attest collection coverage before absent first-party rows can become zero: write project-scoped `firstPartyCoverage` records with `from`, `until` and a retained source receipt from the collector's completeness checkpoint using trusted `Store.put`. Never infer coverage from a successful API call or expose this as an agent boolean. Without coverage the results are null with a reason. The fixture seed's synthetic coverage is explicitly labelled. Live collector integration remains deployment-specific.

Results use `[from, until)`, campaign timezone and currency, one-hour provider freshness, `ctr=clicks/impressions`, `mediaCacMinor=media spend/customers`, and `mediaRoas=attributed revenue/media spend`. These are media-only CAC/ROAS; no untracked business costs are implied. Missing data, mixed currencies and zero denominators have null reasons. Provider conversions are separate from first-party counts.

See [session mapping and migration](server/migrations/README.md) for host identity boundaries.
