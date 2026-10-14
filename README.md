# @handrail/marketing

**Product direction and acceptance:** [From idea to accountable outcome — maintained
product specification](marketing-sdk/PRODUCT.md). Start with the [first-time
Connections journey](marketing-sdk/design/CONNECTIONS.md), [public contract design](marketing-sdk/design/CONNECTIONS-CONTRACT.md)
and [independent review gates](marketing-sdk/design/ACCEPTANCE.md).

Marketing 0.1.7 is a frozen engineering qualification baseline, not acceptance of
the complete marketing product. The deployed Preview described in the work request
is a custom draft form backed by `MarketingServer.unconnected`, not adoption of
`MarketingWorkspace`. A package upgrade alone cannot supply its missing journey.
The reviewed design now has an uncommitted shared server/React advertising
Connections candidate. Manual OpenAI/xAI secure configuration now has an SDK-owned
private route and harmless status adapter; independent review, live, native and
product qualification remain open.
Historical receipts remain intact.
See the [independent review verdict](marketing-sdk/design/ACCEPTANCE.md#independent-review-verdict-2026-10-06)
for corrected consent contracts, the bounded implementation path and native UI gate.

Typed headless marketing workflows, durable trusted-server authority, optional
React components, and a reference HTTP host. Node 22.23.1 (22.x) is required.

Install from this public repository using a verified full 40-character commit:

```sh
npm install --save-exact "git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#$SDK_SHA"
```

Set `SDK_SHA` to the actual published commit, never a branch or tag. npm's normal
Git dependency preparation installs build tools and runs `prepare`: TypeScript
compilation, Vite reference UI compilation, and a source manifest. No separate
publishing job or registry package is required. Keep the matching npm lockfile.

| Import | Purpose |
| --- | --- |
| `@handrail/marketing` or `/core` | Browser-safe types and `createMarketingClient` |
| `@handrail/marketing/server` | MarketingServer, createConnections, Store, provider/billing/generation ports, HostAgent and credential cipher |
| `@handrail/marketing/react` | Optional MarketingRoot, MarketingWorkspace, MarketingConnections, ApprovalPanel, MaterialReview |
| `@handrail/marketing/react/style.css` | Optional UI styles |
| `@handrail/marketing/agent` | Restricted tool dispatcher; no human approval tool or browser runtime |
| `@handrail/marketing/reference` | runtime, createHost, bootstrapFixture, openDatastore, provision |
| `/reference/host`, `/reference/seed` | Individual reference host entry points |

```ts
import { createMarketingClient } from '@handrail/marketing';
const client = createMarketingClient(location.origin, selectedProjectId);
const workspace = await client.call('workspace', {});
```

Import `@handrail/marketing/react/style.css` once for the optional default UI.
`MarketingWorkspace` supplies its own `.marketing-root` boundary in loading,
error and loaded states. For standalone `ApprovalPanel` / `MaterialReview`, or
host-owned login/session UI, wrap only the Marketing content in `MarketingRoot`:

```tsx
import { MarketingRoot, MarketingWorkspace } from '@handrail/marketing/react';
import '@handrail/marketing/react/style.css';

<MarketingRoot aria-label="Marketing area">
  <HostMarketingSessionControls />
  <MarketingWorkspace client={client} />
</MarketingRoot>
```

Do not put the root class on `html`, `body`, or a container holding unrelated host
UI. Ordinary host DOM remains outside the stylesheet's selectors; this is scoped
CSS, not a barrier against host rules cascading into Marketing. Nested roots are
supported. Layout follows the root's available inline width using CSS container
queries (including 320/390px embeddings in desktop pages); give flex/grid mounting
slots a usable width and `min-width: 0`. Modern container-query support is required
for responsive layouts. The SDK neither resets the page nor claims viewport height.
The reference app alone owns its page resets.

Set inherited `--marketing-font-family`, `--marketing-font-size`,
`--marketing-line-height`, `--marketing-color`, `--marketing-background`, and
`--marketing-workspace-min-height` on a host mounting slot to configure defaults.
Without overrides the UI retains its readable light palette and 15px system font;
workspace minimum height defaults to zero. Each workspace owns its local form and
focus state; instances connected to the same project still see shared saved data
and the existing actor-scoped planning recovery contract. There are currently no
portals. Future portaled content must mount inside its owning root (or an explicitly
scoped Marketing container); portaling to the host body is outside this contract.

After building, run `node marketing-sdk/tests/embedding-browser.mjs` for the local
Chromium isolation harness. It exercises real React against the existing disposable
SQLite fixture host; it does not qualify Handrail, ERP or Preview integration.

The host authenticates every request and independently reloads project membership.
Selection of a project never grants access. The server requires exact current
human material approval before provider effects, with durable idempotency and
unknown-effect reconciliation. Revocation does not undo completed effects.

For local source development: `npm ci`, `npm run typecheck`, `npm test` (SQLite),
`npm run test:postgres`, `npm run test:mariadb`, then `npm run test:browser:mariadb`. The MariaDB runner uses
one test worker, a fresh socket-only database and a 64 MiB buffer. It requires
`mariadbd` and `mariadb-install-db`; browser tests additionally require Chromium
(`MARKETING_CHROMIUM_PATH` optional). Video validation uses ffmpeg/ffprobe.
`TMPDIR` must be writable and short enough for a Unix socket. All provider tests
use fixtures or intercepted HTTP; these checks do not establish deployed readiness.

For migration-free PostgreSQL host startup, use
`Store.openExistingPostgres({ connectionString, schema })`. It validates schema 2
and fails closed without DDL. `Store.migratePostgres(options)` is the separate
trusted migration step. Legacy `Store.postgres(options)` still connects and
migrates for compatibility; do not use it for restricted ordinary host startup.
The PostgreSQL runner uses a fresh socket-only cluster, private schemas and one
test worker; it requires `initdb`/`pg_ctl` (`pg_config --bindir`, or
`MARKETING_TEST_POSTGRES_BIN`). Neither database runner reads ambient application
credentials. Run the same browser app fixture on PostgreSQL with
`node marketing-sdk/tests/postgres-runner.mjs --browser` after building; it uses
the same installed Playwright Chromium and supports `MARKETING_CHROMIUM_PATH`.
SQLite and MariaDB remain supported; a PostgreSQL pass does not qualify MariaDB.

`MarketingServer.unconnected(store)` provides real local draft persistence with
no provider/generation capabilities or credentials. Use `saveDraft` and `workspace.drafts`;
existing `saveCampaign` retains its account/material checks. See
[PostgreSQL and draft integration](marketing-sdk/DRAFTS.md) for host authentication,
retry/edit semantics and consumer wiring.

See [host integration](marketing-sdk/README.md) and
[session migration and mapping](marketing-sdk/server/migrations/README.md).
See [readiness and consumer qualification](marketing-sdk/READINESS.md) for media
limits, dependency verification, strict consumer checks and the release handoff.
Existing rights are reserved; see [RIGHTS.md](RIGHTS.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

See [parity foundation and staged migration](marketing-sdk/PARITY_ROADMAP.md) for
explicit daily/lifetime budgets, reporting semantics, host contracts and cutover gates.

The workspace provider-capability continuation is documented in
[marketing-sdk/CAPABILITIES.md](marketing-sdk/CAPABILITIES.md). It includes explicit
Meta/LinkedIn settings, account eligibility gates and guided fields; legacy
campaign inspection/safety pause remain available, while new Meta/LinkedIn
preparation and activation require explicit settings. Independent source review fixed contract defects; Meta daily budget semantics, live
account qualification, complete guided pickers and host cutover remain gated. This
historical workspace-candidate description predates this checkout's 0.1.7 baseline.
See the linked review handoff for its original scope; source/fixture qualification
does not establish a reusable first-time journey or deployed product acceptance.

## Connections candidate (unpublished)

The shared advertising journey starts with zero grants: requirements → exact human
provider-access review → SDK secure handoff → authenticated account and context
selection → separate project-access review → fresh verification → one real Grant.
Manual setup works without Agent. OpenAI/xAI use SDK-owned private secure entry,
exact persistent-access consent, encrypted custody, status and local disconnect.
Configuration does not issue a generation grant or authorize billing. No paid
verification or provider campaign mutation is used. See the [creative integration](marketing-sdk/README.md#manual-creative-connections).

Use the public-only [server adapter example](marketing-sdk/examples/connections-server.ts)
and [Workspace mount](marketing-sdk/examples/embedded.tsx). The standalone
`MarketingConnections` also accepts the same `MarketingClient`; replace its
`client` or `sessionKey` when host identity/project changes. New commands route
through `MarketingServer.call`; the factory's Fetch-compatible `routes` owns OAuth
handoff/callbacks. A trusted static `returnPath` may select the host Marketing route.
New Connections use one fixed callback per provider across projects, a token-free
handoff descriptor, independent browser claim and Strict-cookie authenticated
completion. External hosts supply `SessionAuthority`, including a local commit
guard coordinated with logout/user changes; `sessions.current` alone is insufficient.
See the [portable protocol and adapter obligations](marketing-sdk/design/PORTABLE-HANDOFF.md)
and [public external-session example](marketing-sdk/examples/external-sessions.ts).
`classifyConnectionRoute` identifies the exact unprivileged callback GET exception;
keep all other host API guards and exclude private routes from service workers.
Do not log callback query strings upstream. Read the [implemented contracts and
retention](marketing-sdk/design/CONNECTIONS-CONTRACT.md#candidate-implementation-contracts)
before integrating. Ordinary PostgreSQL startup remains migration-free.

`node marketing-sdk/tests/consumer.mjs --connections` compiles the actual public
mount/adapter in a disposable packed consumer and exercises real HTTP and SQLite
with synthetic provider boundaries. A local pack projection does **not** qualify
installation from a newly published full Git SHA. See [candidate evidence and
limits](marketing-sdk/design/ACCEPTANCE.md#connections-implementation-candidate-2026-10-06).
`node marketing-sdk/tests/consumer.mjs --portable` additionally qualifies independent
browser login and original-session resume using a disposable existing-host SQL
fixture with no SDK passwords/sessions. It supplies no production host/native adapter.

## Historical campaign retention

LinkedIn campaign execution preserves shared campaign groups. Pause changes the
campaign first and its creative second; activation changes the creative first
and campaign second, and requires an already ACTIVE group. Neither path edits
group status or budget. Pause/read-only reconciliation accepts stopped owned
children beneath an active group. A paused/draft shared group is not implicitly
reactivated by campaign authority.

Preparation creates a new empty ACTIVE group and DRAFT campaign/creative, with
unchanged budget and approval checks; no ad can serve before campaign activation.
LinkedIn documents ACTIVE/DRAFT group creation and independent child status in
[campaign groups](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaign-groups?view=li-lms-2026-09)
and [status propagation](https://learn.microsoft.com/en-us/linkedin/marketing/usecases/foundations/statuses?view=li-lms-2026-05).
This change does not adopt existing campaigns or grant authority over existing
groups. Native HTTP fixtures cover shared-group preservation, paused-group
activation rejection before writes and read-only recovery after lost readback;
live execution qualification remains required.

`NativeProvider.inspectExistingCampaign` reads retained Meta/LinkedIn object IDs
against the supplied exact configuration through required `VaultPort.useReadOnly`
custody. It admits only provider GETs with current-authority checks around each
read, verifies paused owned children, and recomputes the readback digest; callers
cannot supply historical readback versions/digests. It returns an
`ExistingCampaignInspection`, not an executable campaign: original asset bytes
still require a verified upload-to-provider binding, and execution ownership has
not transferred. No provider objects, grants, approvals or conversions are
created. Host adoption must resolve these requirements before installing its
candidate receipt as execution state.

The server export `HistoricalCampaignImports` retains a host's consistent native
campaign snapshot through an explicit identity/source port. Core exports the
typed snapshot, record, total and receipt contracts. The SDK reconciles source
counts and compatible totals, preserves original identities and immutable
corrections, and provides durable retry/read APIs. Unknown identity, purpose and
measurements require explanations. Existing approvals and unsettled effects are
retained as history, without granting spending authority or replaying events.

This retention stage never transfers execution ownership or creates provider
objects. A consumer must separately reconcile and bind execution under its
existing authority. See [the adoption contract and validation](marketing-sdk/tests/ADOPTION.md).
The normal build and 20 adoption tests plus 15 measurement regressions passed on
disposable PostgreSQL; live consumer adoption remains separate qualification.

## Measurement evidence

The server exports `collectProviderMeasurement`, `buildMeasurementEvidence`,
`saveMeasurementRevision`, `readMeasurementEvidence` and
`readLatestMeasurementEvidence`. Core exports their typed measurement contracts.
These reads do not publish, pause, change budgets or transfer campaign ownership.
Hosts supply current authenticated provider clients and verified account/campaign
scope; credentials never enter evidence records.

The Meta collector uses cursor pagination on the original trusted endpoint. The
LinkedIn collector uses the client's partitioned daily analytics queries because
[adAnalytics does not support pagination](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting?view=li-lms-2026-09).
Transient read retries retain separate safe receipts. Denied or incomplete reads,
absent daily rows and unsupported metrics remain unknown, including when the
provider returns an empty array. Configured/effective status is separate from
observed impressions. Currency, minor-unit scale, timezone and half-open windows
are explicit. CPM uses summed spend divided by summed impressions; outbound CTR
never substitutes total clicks. Provider conversions retain a named definition,
and are separate from host submissions and qualifications. Meta conversion totals
remain unknown unless the host supplies one exact qualified action mapping.

Optional placement queries are separate from totals. Meta uses publisher/platform
position; LinkedIn uses a per-campaign `PLACEMENT_NAME` query. A successful query
alone does not mark placement coverage complete: spend and impressions must
reconcile to campaign daily totals. Placement records are never added to totals.

`saveMeasurementRevision` atomically stores content-addressed evidence and an
outbox reference in the existing Store, deduplicates exact collection replay, and
links corrections to the preceding evidence for the same scope. The original
revision remains readable; reads verify its digest. Source snapshots contain only
typed measurement facts and safe error codes, not raw transport responses, URLs
or credentials. Persist evidence within the host's current authorization boundary;
these trusted server functions do not replace host authorization. Existing native
`syncMetrics` uses that authorized transaction and `results` returns the exact
evidence ID, CPM, outbound CTR, confidence and maturity when evidence is present.
An incomplete report cannot claim a complete-through watermark. Browser comparison
is explicitly `not_compared`; this release does not qualify browser verification.

Attribution maturity requires explicit coverage, lag and reread evidence. A closed
reporting day, a zero provider conversion count or passing tests cannot establish
mature outcomes. Qualification costs additionally require compatible windows,
currency, QA exclusions and verified attribution coverage. Consumer applications
must preserve these distinctions and the cited evidence ID when making decisions.

Saved reporting can use `readCampaignMeasurementRevisions` and
`materializeMeasurementWindow`. A materialized subset is immutable evidence
whose receipts include its original provider evidence ID and whose collection
time remains unchanged. It is not another provider read or an independent
verification. The newest overlapping provider collection must cover the entire
requested window in the same timezone and currency; otherwise the SDK returns
`refresh_required`. Missing or denied reports never fall back to older totals.
Subset attribution stays unknown unless separately measured for that window.


`observedMeasurementSpend(evidence, {asOf, maxAgeMs})` exposes provider-observed
spend for a host's existing spending controls without declaring a current-day
performance total. It requires intact, compatible, nonoverlapping API evidence,
explicit campaign-day rows, completed pagination and the caller's freshness
policy. Missing rows, future observations, synthetic sources and failed reads
remain unknown. Explicit zero is retained. `fullWindowComplete` stays false for
an open day, and `reportingLagUnbounded: true` makes clear that observed use is
not an allowance or a guarantee against delayed provider costs. This API does
not change authority, budgets, schedules or final-performance calculations.


`readObservedMeasurementSpend(reader, scopes, {asOf, maxAgeMs})` selects the latest
stored revision for each native campaign and requested window, verifies the
current provider campaign IDs, and calculates observed spend through the same
SDK rules. `reader` is the Store's read-only `list` interface, so hosts can borrow
an existing admission transaction without another pool connection or any write.
Subsets retain the stored parent's evidence ID and collection time. A newer
incomplete/narrow report invalidates the request; older values are not revived.

Historical retention APIs (`HistoricalCampaignImports`, `HistoricalProjectImports`)
are described in [the adoption contract](marketing-sdk/tests/ADOPTION.md). Project
history preserves unattributed records without inventing campaigns; neither API
creates execution authority or transfers campaign ownership.

Editing a prepared campaign retains its provider receipt and the last verified
`preparedMaterial`. Preparing that edited revision invokes the provider's update
contract; an unavailable update never falls back to creating replacement objects.
The qualified update fields are Meta lifetime budget and LinkedIn campaign daily
budget, while all owned objects are stopped. LinkedIn group budgets/status and
original campaign/ad/creative/image identities remain unchanged. Other edits are
retained locally but cannot be prepared until their update behavior is qualified.
Meta daily-budget execution remains unqualified.

Original daily-only campaigns can retain `budget: null` and an explicit
`advertisingBudget.daily` without a lifetime amount. `endAt: null` preserves an
open schedule. Adoption, draft review and finite reporting windows keep these
terms intact; provider inspection rejects unexpected caps or end dates. Existing
spending controls still require qualified exposure and applicable budget-period
authority. This representation does not authorize activation or create a cap.

Updates require current exact-material capability evidence and host write
authority, compare the previous provider snapshot before writing, and retain
identities before the request. A lost acknowledgment keeps the existing execution
lease and requires read-only reconciliation against the new values. The old
receipt cannot prove that an edited budget was applied. Activation still requires
a new approval packet for the edited revision and the existing spending controls.
These intercepted HTTP and disposable SQL tests do not constitute a live pilot
or authorize changing any deployed campaign budget. The request shapes follow
[Meta's AdSet update API](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py)
and [LinkedIn campaign partial updates](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09).
