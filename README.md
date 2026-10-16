# @handrail/marketing

`@handrail/marketing/agent` exports `marketingStudioToolSchemas` for the same
local Studio brief, option, material, media-selection, library, check and promotion
commands used by React. `agentTools` dispatches their exact names through the
supplied client; the server validates current host invocation/session authority,
revisions and immutable request receipts. Hosts may bind an existing native
invocation and adapt their original request key. These commands grant no human
approval, credential access, paid generation or provider execution. Native-agent
promotion requires the host's current canonical identity binding. It copies exact
retained tracking configuration without granting consent or certifying tests,
coverage or publication readiness; tracking setup remains human-only.

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

Hosts with existing advertising connections may supply `MarketingServer`'s
`campaignAccess: CampaignAccess` alongside their `NativeProvider` credential port.
This qualifies country selection and exact campaign preparation or activation without an SDK
OAuth journey or SDK vault row. `CampaignAccess.campaignAuthority` returns current
account/identity facts, original authority receipt references, live session
inspections and an access digest. `withCampaignAuthority` holds the existing host
session/configuration/revocation guard through the local SDK commit; no provider
HTTP belongs inside that guard. It cannot grant account permissions, approve
material, allocate advertising budget or replace tracking checks.

Native execution using campaign checks does not require a legacy `setup` record.
Queuing preparation is local; dispatch consumes current exact prerequisite proof
before provider I/O and rechecks it before effects. Missing, stale or revoked
proof blocks dispatch even if an old setup record says ready. Hosts must never
fabricate setup records to connect their existing credential custody.

`checkCampaign` accepts `action: "prepare" | "activate"` (omission means preparation).
The returned `CampaignCheck.action`, private evidence binding and provider write
checks all retain that action. A ready preparation check cannot authorize launch;
activation needs its own current read-only check. The grant and discovered account
must allow the selected action. An activation-only host grant needs no preparation
permission. The agent schemas expose both checking and saved-check recovery; the
React workspace requests the action appropriate to the current campaign state.
Checks establish prerequisites, not approval or budget/spending authority.

After an uncertain host activation, read-only reconciliation may use a renewed,
higher-revision grant for the same exact campaign/account with only `report`
permission. It preserves the original operation, effect grant revision, material,
provider IDs and budget exposure. This does not replay activation or restore old
spending permission; a later launch still needs current independent authorization.

The matching `VaultPort.prerequisiteBinding(grant)` returns a private nonsecret
credential/configuration revision binding from current host custody. It must
change on rotation, scope/configuration changes or replacement and reject revoked
or unavailable access. Credential `use`/`useReadOnly` must enforce that same native
authority. Inspection functions do local reads only; finish refresh/discovery
before entering SDK commit guards. Credentials remain in host custody. A host
binding error is terminal for that operation, with no SDK credential fallback.
`credentialExpiresAt` is the exact usable envelope deadline, not proof of the
provider token's lifetime; retain unknown provider expiry separately. Pinning a
previous deadline cannot extend or revive an expired/replaced envelope.

Host custody requires exact prerequisite evidence regardless of grant ID. The
provider holds one credential binding through its requests, preserves returned
object IDs before stopping after an uncertain write, and never replays an unknown
operation. Prerequisite contract v6 binds both this custody and the exact action. Earlier checks
remain historical records and need fresh qualification before use. The SDK's own
Connections service implements the same authority interface for its existing
OAuth records. A package upgrade does not supply a native host adapter or new
publication authority.

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

`NativeProvider.inspectExistingMetaHierarchy` supplies narrower current state
evidence for reconciliation without requiring a complete material candidate.
It verifies the account/currency/timezone, exact paused campaign and complete
unfiltered, paginated ad-set/ad edges (currently one of each), including creative
association. Every request uses read-only Vault custody with revocation checks.
Its digest covers explicit identity/state facts. It does not settle historical
effects, verify material or upload bytes, transfer ownership or grant spending.
Hosts must bind the supplied IDs to original history and current native mappings.

`HistoricalEffectResolutions` records reconciliation of known material or paused-state
readback failures after their affected objects were durably mapped. The trusted host source
proves the failure/mapping relationship and guards original records through commit;
the SDK independently reads the complete paused Meta hierarchy through its provider
port. The immutable resolution links the original import/operation/record IDs and
provider evidence. Original partial status and unknown historical request coverage
remain unchanged. Unknown transport outcomes require their specific recovery and
cannot be relabelled through this source contract. Request-key replay/read APIs
preserve a single resolution per import/operation, with source/session revocation
checks and no provider writes, execution transfer, approvals or spending grants.
For paused-state failures, retained image/creative IDs may accompany the affected
serving object IDs. They must reference original Meta non-delivery mappings; they
are preserved assets, not a claim that an image or creative has a paused delivery
state. Superseded creatives remain in history, while complete current inventory
identifies the creative actually attached to each ad.
LinkedIn creative creations already reconciled to an original mapped ID use
`mapped_creative_after_creation_reconciliation`. `inspectExistingLinkedInHierarchy`
checks the account, organization, group relationship, stopped campaign and complete
paginated creative inventory. A shared group may remain ACTIVE and is never
modified or claimed as exclusively owned. The host must prove the original
reconciliation diagnostic and mapping/run relationship; a partial status or old
creation timestamp alone is insufficient. Original unknown request coverage stays
unknown, and image mappings remain non-delivery history.

Adoption must revalidate the native source and current provider material/state.

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

## Native execution authority

`MarketingServer.continuePreparation(principal, projectId, {campaignId,
operationId, expectedRevision, expectedGrantRevision})` is an explicit trusted-host
continuation of an original **queued** preparation. It requires the exclusive
SDK executor, current host execution authority, unchanged material/grant/plan and
no competing account lease. The caller supplies fresh current prerequisite and
credential custody through the same server ports as ordinary preparation. It
never resets a running, unknown or terminal operation and never creates a new
operation/request/approval. The original execution actor stays unchanged; an
atomic dispatch event records the new actor's opaque host reference separately,
without SDK session hashes or credentials. Current authority is rechecked before
provider effects and final commit. This is a write-authorized continuation, not
the read-only reconciliation API, and starts no scheduler.

Preparation, update, activation and pause provider ports accept a separate optional
`beforeRead` guard for permission discovery. MarketingServer checks the current actor, exact grant
and material, executor ownership and operation lease at each discovery boundary.
LinkedIn discovery also uses the client's sealed credential transport. The full
campaign/tracking/budget write proof is still checked after discovery and before
each external effect; a read check grants no write authority. Ports called
without the separate read guard use their supplied write guard. This avoids
repeatedly consuming the complete write proof for each read-only discovery page;
it does not extend prerequisite, grant or credential expiry. LinkedIn preparation
uses that full check at the client POST/PUT boundary, including authenticated
retries, without another duplicate check before entering each client method.
Revocation before a later effect stops that effect and retains earlier identities.

`MarketingServer.stopUncertainActivation` accepts a current host-authorized pause
for an exact unknown activation. It retains the original operation verbatim in
`ActivationStopIntent`, queues a separate pause under the actual actor, and only
transfers the original account lease when that pause claims dispatch. It never
replays activation, changes provider identity or grants spending authority. A
failed preflight leaves the original lease intact. An uncertain stop keeps the
lease and budget holds; the same request observes its original operation. A new
explicit pause action may retry an uncertain stop, retaining all predecessor
operations. Native pause verifies existing provider material before its writes.

Only a verified pause records `ActivationStopReceipt`, changes the original
activation and earlier uncertain stop attempts to `stopped`, and releases the
execution lease. `stopped` is an execution disposition: the original outcome
remains unknown, with the original receipt, actor and full pre-stop snapshots
retained. Recurring budget reservations retain incurred exposure and the verified
stop boundary; other uncertain-launch reservations remain charged. Typed
`readActivationStop` returns this durable history. New work still needs its own
current authority and budget admission. Original-operation readback is fenced
while a linked stop is pending, and delayed results cannot resurrect stopped
operations. Recovery refuses provider calls still in flight on the same Store.

Activation re-enumerates the complete campaign child collections before effects,
at each delivery write boundary and during final verification. Meta requires the
exact original ad set/ad/creative associations; LinkedIn requires the exact
campaign creative. Pagination must finish; extra, duplicate, missing or foreign
children reject activation. Adoption retains its stricter paused-state checks.
Inventory pages retain current read authority, and full write authority is checked
again after inventory latency. Successful activation/reconciliation receipts keep
an `inventoryDigest`; read-only activation recovery cannot settle an unexpected
hierarchy as successful. Provider reads and writes are separate external requests,
so these checks do not claim an atomic provider-side lock. A discrepancy after
partial effects remains uncertain for explicit recovery; shared groups and
unexpected children are never changed by this check.

`inspectMetaToken` is a server-only, read-only qualification of native Meta
custody using the app-authenticated Graph debugger. It verifies the app, token
validity/type, scopes and both expiry clocks, returning fixed errors without
credential values or provider bodies. Explicit zero expiry is represented as
`no_scheduled_expiry`, separately from the host's actual grant/session lifetime;
missing expiry is unverified. This neither proves account access nor grants
campaign execution or spending authority. Hosts must bind current native authority
and independently verify their exact account and identity.

Meta adoption now inventories both campaign child edges through every returned
page before accepting the saved single-ad-set/single-ad identity. The inspection
requires matching account, campaign, ad set and creative IDs, explicit configured
pause and a paused effective state. Extra or duplicate children, incomplete
pagination and unknown states refuse adoption. Continuations use only the cursor
on the original Graph endpoint; provider-supplied next URLs are never followed.
The candidate receipt retains an inventory digest alongside its material digest.
This is read-only inspection; it grants neither execution ownership nor spending
authority and does not establish independent browser verification.

LinkedIn token verification failures retain fixed `provider_token_*` reason codes
for inactive, changed, wrong-client, unverified-status/auth-type and expired token
evidence. Provider values, bodies and credential details are never included. An
HTTP 200 introspection response alone does not establish current authority. Native
client verification and Connections discovery use the same field validation and
fixed reasons, including checks after an earlier successful account read.

Meta safety-pause verification enumerates the complete current account membership
and requires advertising/management tasks plus `ads_read` and `ads_management`.
It does not require payment setup or publication Page readiness. Missing roles,
scopes, account context or incomplete pagination refuse admission. Preparation
and activation retain their existing billing, identity and budget requirements.

A trusted host can implement `ExecutionAuthority.activationApproval` to bind an
existing exact owner approval or owner-delegated native launch action to the SDK
packet. This is server composition, never a public command or an agent-supplied
approval claim. The SDK retains `hostActivationApproval` with the actual actor,
packet digest and original host receipt references when reserving execution, and
rechecks the same current authority before every effect. Changed/refused host
authority never falls back to a human decision. An explicit SDK rejection or
revocation also remains binding. Without this port the existing SDK human gate
applies. No SDK human decision, spending grant or replacement provider identity is
fabricated. Advertising-budget reservations, credential custody, preparation,
tracking and uncertain-effect recovery remain independently enforced.

Adopted campaigns require a trusted server `ExecutionAuthority` port for SDK
prepare/activate/pause and recovery. The host revalidates its real principal and
exact native action, with revocation guards held through local SDK commits and
released before provider I/O. This supports native agent actions without creating
browser sessions or synthetic session lifetimes. The SDK still enforces current
grants, approvals, budgets, material and exclusive executor/account leases.
`readExecutionRequest` reads the original operation before a caller refreshes
custody; `recoverExecution` marks only the exact interrupted claim unknown under
the exclusive executor. Pause reconciliation may use refreshed report authority
for the same account, preserving the original operation grant revision and never
replaying the provider write. Failed or revoked post-write authority retains an
unknown effect and its lease until qualified readback.

## Recurring host advertising budgets

A trusted server host can bind an existing UTC weekly or monthly policy through
`AdvertisingBudgetPolicy.recurrence: {unit, authorityRef}`. The initial `from` and
`until` must identify one exact Monday-based week or calendar month.
`advertisingBudgetPeriod(policy, now)` gives the current accounting window. This
is explicit recurring host authority; imported history, an open schedule or a
daily provider budget never creates that authority. Without recurrence the
existing bounded-period/lifetime contract remains mandatory.

Recurring accounting preserves original daily-only budgets, older campaign start
times, open ends and provider timezones. It requires fresh complete observations
for the current UTC accounting day and period, with a durable host aggregate
receipt. The host must qualify those observations or conservative spending bounds
across every covered campaign; this API does not convert incompatible measurement
windows into comparable actual spend. Missing/stale/fixture-only observations
cannot qualify provider execution. Provider exposure multipliers and approved
campaign, project and portfolio ceilings remain enforced.

Each activation retains its own immutable exposure basis and original operation
reference. Unknown holds never expire at a day/month boundary. Current bounds
count every provider calendar day touched, including partial boundary days and
DST. Future recurring commitments also fit a conservative full-period bound
(maximum 31-day month or seven-day week, plus two boundary dates outside UTC),
so future starts and shorter months cannot overbook later periods. Bounds may
reserve more than actual spend; they are never reported as measured delivery.

Only the SDK's verified paused receipt for the original running/unknown pause or
preparation operation bounds future exposure. It records the pause operation and
receipt digest, retaining incurred capacity in overlapping accounting windows.
Resumption creates a new reservation without rewriting prior activation/pause
history. Unknown pause effects retain the original active reservation until
read-only reconciliation. Existing host approval, current grants, tracking and
exclusive execution checks still apply; this adds no scheduler or spending grant.

Budget composition can use `readBudgetSpendObservation` to read immutable
measurement revisions for provider windows enclosing a UTC accounting interval.
It returns `observed_provider_calendar_upper_bound`, component windows and exact
parent evidence IDs. Different timezone windows remain incompatible for actual
performance aggregation. Missing scope, changed identities, currencies, stale
collections, partial pagination and newer incomplete corrections make the bound
unknown. The reader writes nothing and does not hide provider reporting lag.
`ObservedAdvertisingSpend.oldestSourceCollectedAt` preserves underlying freshness
when a host reads existing evidence later; a new host observation time cannot
renew stale provider data. The host must still prove the campaign inventory and
current policy under its original authority guard.

## Original source and provider upload media

`prepareMetaImageUpload` owns Meta's encoding: JPEG/PNG bytes stay unchanged;
WebP uses the retained white-background, quality-90 mozjpeg recipe.
`recoverMetaImageUpload` verifies both original source SHA-256 and the immutable
historical upload SHA-256. Re-encoding alone is not proof: missing hashes,
mislabelled media and codec drift fail. Neither helper performs network work.
Native preparation retains the exact upload digest before dispatch.

Execution adoption can retain an original source asset alongside its transformed
provider upload. Each retains its own ID, version, bytes, MIME and rights receipt;
the uploaded asset names the source in `parentAssetIds`. The source history record,
metadata, dimensions and bytes are checked again around provider inspection and
inside the ownership transaction. Both assets/blobs commit atomically with the
paused execution owner; collisions, source mutation or unknown history roll back.
This neither uploads a replacement image nor changes provider identities.

When historical Meta upload bytes are unavailable, paused adoption may instead
retain the original source with `uploadedDigest: null` and `retainedSource`:
the original source checksum/history record, retained provider filename and an
explicit missing reason. It verifies the source bytes and a fresh account-scoped
provider image read (identity, filename, original dimensions and status), plus
the full paused campaign hierarchy/material. The receipt's `mediaProvenance`
keeps source verification separate from `originalUploadBytesVerified: false`.
It never stores a newly encoded candidate as the historical upload, changes
original history or grants approval/spending authority. Missing source history,
changed bytes, mismatched provider metadata or unsettled effects still prevent
transfer. This is representation of incomplete history, not a byte-match claim.

## Existing Meta acquisition material

Historical campaign purpose may be reconciled with `HistoricalPurposeResolutions`.
An authorized human/agent supplies an explicit acquisition/recruitment assessment,
rationale and retained evidence record IDs; no keyword, URL or event-name inference
is used. The immutable receipt names the assessor, original unknown purpose and
source digest. Corrections require the current receipt ID and preserve predecessors.
History, approval, budget and unsettled-effect records are unchanged. Paused adoption
checks the current assessment throughout inspection/commit and retains its ID;
new reporting evidence links that assessment. Already explicit historical purpose
cannot be replaced by this path, and an adopted campaign cannot be reclassified
behind its execution owner. Classification grants no spending or launch authority.

`NativeProvider.captureExistingMetaMaterial` uses read-only custody for the exact
account, campaign, ad set and creative. The host supplies original identity,
copy, conversion and policy facts bound to retained history. Current provider
terms must match that retained observation; a disagreement is rejected without
rewriting either revision. This capture does not prove original media bytes,
complete child inventory, exclusive ownership or permission to resume.

The shared contract represents expanded-interest acquisition Lead campaigns,
explicit detailed/lookalike expansion bits, location types, attribution windows,
original creative description, URL tags and explicit feature enrollment. It
preserves timezone, open schedule, daily budget, optional lifetime cap and native
daily ceiling. Recruitment remains a separate ApplicantRequestMOU contract.
Readback version 5 verifies these fields during initial preparation, adoption
inspection, activation and recovery. Older receipt digests remain readable;
unsupported or changed fields fail instead of being silently dropped.

Awareness page promotion uses `settings.pagePromotion.smartPseEnabled`, separate
from lead conversion configuration. Absence, `false` and `true` are distinct;
readback verifies the exact `promoted_object` including the optional provider
`smart_pse_enabled` boolean. Reconciliation preserves the original observation
and records differences without inventing conversions. Web editing and review
expose all three states. Non-conversion campaigns preserve an omitted provider
attribution list as unknown, distinct from an explicit empty list. Reconciliation
records `current_not_returned`; exact readback rejects a subsequent difference.
Lead capture continues to require explicit attribution. Provider acceptance of a write still requires the
existing eligibility, authority and budget checks; capture is read-only.

Meta daily preparation preserves the requested amount and disables ad-set budget
sharing. Budget reservations use 175% of the nominal daily amount, rounded up to
minor units and bounded by an explicit lifetime cap, following [Meta's daily
budget flexibility guidance](https://z-p4-lookaside.fbsbx.com/business/help/1388266028979935).
The SDK does not use the weekly average to release daily capacity. Activation
requires current readback proving sharing remains disabled, exact account/material
eligibility and sufficient current spending authority. Historical native daily
ceilings remain unchanged; insufficient ceilings block execution rather than being
raised during import. Uncertain operations retain their reservations. Paused daily
budget updates change only the existing ad set's nominal amount; budget mode,
currency, campaign ceilings, lifetime caps and other material remain fixed. The public
material capture returns `executionReady: false`. Tests use real SDK clients and
disposable SQL storage with intercepted provider HTTP; they are not live account
eligibility or delivery proof. Provider field references: [Meta creative schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py)
and [Meta targeting schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targeting.py).

## Measurement evidence

`bindAdoptedMeasurementIdentity(store, input)` connects a fresh native collection
to the SDK's saved execution owner, adoption receipt and verified history. The
host must retain its current read-authority checks around binding and persistence.
Account, provider, campaign, purpose and adoption-origin conflicts fail explicitly.
Collections made before adoption remain unchanged. New collections include the
SDK campaign ID and adoption/history receipt references; the first enriched
identity also links the preceding unbound evidence head through source receipt
references. Each identity retains its own immutable revision chain. This lookup
does not grant execution or spending authority, require a live execution grant,
or promote unknown attribution maturity. Material version remains unknown until
independent interval evidence establishes which material served in the window;
the current campaign revision is not historical attribution.

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
The qualified update fields are Meta lifetime or daily budget and LinkedIn campaign daily
budget, while all owned objects are stopped. LinkedIn group budgets/status and
original campaign/ad/creative/image identities remain unchanged. Other edits are
retained locally but cannot be prepared until their update behavior is qualified.
Meta daily updates use the same 175% exposure check and read-only lost-response
recovery as preparation. Changing budget mode or ceilings is outside this contract.

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

Upload preparation also returns `uploadReceipt`, with an explicit
`sha256_bytes` encoding, binary checksum, size, MIME and matching provider
filename. Do not interpret an unlabelled historic filename as a binary checksum:
Handrail's old uploader hashed a lossy UTF-8 string of the JPEG buffer. Keep that
value as a legacy observation, with original upload digest unknown.
`NativeProvider.inspectExistingMetaImage` reads the exact account/image metadata
through read-only Vault custody and complete pagination. It reports current
identity, name, original dimensions and status separately from original-byte
proof; it does not download signed media URLs, mutate images or authorize spend.

Paused historical material may retain an unknown Meta nondiscrimination
acknowledgement as `null`, with its missing reason and original source references.
The guided editor displays that uncertainty explicitly. Structural material
validation and read-only provider planning do not manufacture acceptance.
`capabilityBlockers`, preflight, preparation and activation still require actual
acceptance; importing paused material creates neither approval nor spend authority.
`ExistingMetaMaterialSource.policy` retains the acknowledgement observation and
returns it as `policyEvidence` separately from current provider material.

`inspectMetaDeliveryInventory` is a read-only server API for refreshing exact
host-owned campaign mappings across one Meta account. It requires an account-scoped
reporting grant; a campaign-scoped grant cannot disclose the account inventory.
It paginates the account's
campaign/ad-set/ad edges once, checks account/currency/timezone and current Vault
custody, and returns the requested campaign hierarchies with collection times
and a snapshot digest. Account campaigns outside those mappings are retained in
`snapshot.unmappedProviderCampaigns`, with `nativeCampaignId: null` and explicit
`ownership: "unverified"`. Only IDs, hierarchy and status fields are retained;
there is no inferred campaign ownership or automatic native binding. Missing
parents and unknown statuses remain explicit. The account visibility scope is
`visible_account_campaigns_and_children`; `allPaused` and `complete` continue to
describe the mapped campaigns only, identified by `pauseScope` and `ownershipBasis`.
Newly observed mapped children participate in paused-state checks;
missing mapped objects/statuses remain unknown. The visibility scope is explicit:
this does not settle historical requests, prove actual impressions, authorize
spending, or claim that an unmapped historical campaign never created an object.

Meta material now represents `advantage_plus_broad` separately from
`advantage_plus_interests`. Broad acquisition preserves the provider's absence
of interest groups, explicit Advantage+ automation/expansion, Lead conversion,
attribution, location types and other targeting fields through capture, review,
planning and exact readback. It cannot silently drop supplied interests or repair
malformed groups. Existing authority, daily-budget qualification and provider
capability gates remain required for execution.

Existing-campaign read failures carry bounded `providerReadDiagnostic` fields
(reason, HTTP status, provider code/subcode and retry timing), never transport
messages or credential-bearing URLs. Meta GET error 80004 is a rate limit;
recognizing it does not retry a request or alter write uncertainty handling.
Unknown-upload adoption failures expose `providerImageDiagnostic` comparisons,
expected/observed dimensions and snapshot identity without weakening the image,
account, filename, active-status or retained-history checks.

Existing Meta material capture also preserves the supported acquisition awareness
(REACH) and traffic (LINK_CLICKS, IMPRESSIONS, REACH) combinations. Strict audiences
require explicit expansion-off evidence; ordinary traffic retains its own audience
contract. Conversion-less campaigns cannot acquire a Lead binding during adoption.
An explicit empty attribution list is retained through plans, readback and review;
missing attribution remains unknown, and Lead capture still requires explicit
nonempty attribution. Existing approval and budget qualification are unchanged.

Existing Meta reconciliation also accepts retained image candidates with original
asset/provider/history identities. The SDK selects the current creative's single
image by exact provider identity, rejecting unknown or ambiguous bindings. Other
variants stay in host history; this does not claim an asset feed is a single-image
creative. Capture and readback explicitly reject an unrepresented asset feed.
When original conversion configuration was not retained, the host can declare
`historical_conversion_not_retained`; the SDK captures only the supported current
Lead conversion and keeps the historical promoted-object comparison unknown.
Known retained conversion bindings still must match. No capture grants approval,
tracking readiness, execution ownership or spending authority.

Unknown-upload adoption retains both the historical upload filename and current
provider filename with an explicit comparison. A different label is not a binary
identity check: current account/hash, dimensions, active image state, original
source bytes/rights, historical mapping and campaign readback remain required.
Original upload bytes stay unverified even when names match.

LinkedIn account discovery uses the standard advertising-account read for current
identity, currency, status and role qualification. Optional reference/profile
expansion is not required for custody. If no Page name is supplied, the original
organization identity remains visible with an explicitly unavailable name; Page
permissions still require the existing independent role checks.

## Exact campaign destinations in Tracking

Destination captures use a version-2 identity containing the exact URL, HTML
content digest and source kind. `digest` identifies the retained snapshot;
`contentDigest` identifies the original bytes. Two campaign URLs serving the same
HTML cannot overwrite each other's evidence. Repeated captures of identical
content retain the original observation/time; changed content creates another
snapshot. Live preparation/reconciliation compares current bytes with the retained
content digest. Historical byte-addressed snapshots remain readable without
rewriting campaign material or approvals. Hosts adopting existing campaigns use
`destinationSnapshot` and `retainDestinationSnapshot` inside their existing
authorized Store transaction; raw blobs remain content-addressed.

`MarketingServer` composes `StudioOptions.withPromotion` with SDK tracking
retention. The host guard runs first and may reject creation or hold current
identity/ownership authority while invoking `local(retainHost)`. The host's
`retainHost(campaign)` and SDK tracking retention run inside the same Store SQL
transaction as the new draft campaign, assets, material version and promotion
receipt. Use that Store connection for native identity writes; a separate database
commit cannot roll back with promotion. Neither callback should perform provider
I/O. A retention failure rolls back all promotion records, including the copied
tracking binding. A completed request replay returns its original campaign without
repeating either retention callback. This creates a draft, not provider objects or
spending authority. Hosts must still bind their native campaign identity and
execution workflow before exposing promotion.

A host source may declare `destinationScopes: [{origin, pathPrefix}]` from its
current owned deployment contract. The SDK resolves the draft/campaign's existing
URL against those explicit scopes and returns `TrackingView.destinations`, keyed
by source. It preserves URL spelling, path, query ordering/encoding and fragment;
selecting a tracking destination never edits campaign material. Explicitly
registered destinations remain available alongside the exact campaign URL.

Scopes are structured ownership facts, not instructions supplied by the browser.
The SDK rejects off-origin URLs, path-prefix lookalikes, normalized traversal,
encoded path separators and malformed scopes. Existing session/source guards
protect binding and revalidation. Revoking or changing a scope makes saved
bindings stale. The canonical source object remains shared across campaigns;
resolving one campaign does not change another campaign's source revision.

A resolved URL has no inferred no-send test URL. It cannot pass a test or attest
coverage from ownership alone. For a collector receipt at a scoped destination,
`CollectorCompletion.destinationUrl` must come from the retained authenticated
completion and match its exact SDK destination ID. A missing or mismatched URL
is rejected. Consent, qualification, provider transport and completeness remain
separate evidence requirements.

## Authenticated paid-click receipts

`TrackingCollector.verifyClick` resolves a `CollectorClick` from an existing
host-retained click receipt. The collector needs explicit `click` permission.
`MarketingTracking.acceptClick(request, {sourceReceipt})` and
`handleTrackingCollector(tracking, request, 'click')` accept only that reference;
no browser-supplied campaign, person, consent, QA or completeness fields are
accepted. The host must retain and guard the original click, consent and identity
facts. URL parameters alone are not proof of a paid click.

SDK admission checks current source ownership, destination, campaign revision,
material digest and acquisition/recruitment purpose before atomically saving the
click event and immutable receipt. QA/test classification remains excluded from
business totals. An accepted receipt replays its original result after later
material edits; newly arriving evidence for stale material is rejected with
`click_campaign_identity_mismatch` and must be reconciled at its source. Changed
payloads cannot overwrite earlier evidence.

Authenticated completion attribution now requires a matching authenticated click
receipt in the same source namespace. Generic event/import records cannot supply
that proof. The existing person, purpose, last eligible click and seven-day rules
still apply. Click admission neither qualifies a no-send completion test nor
attests production coverage, provider delivery or independent Ads Manager
comparison. Hosts without a click verifier remain explicitly unavailable. This
contract does not add a scheduler, credentials, provider writes or spending
permission.

### Authenticated no-send test admission

Source servers can call `MarketingTracking.inspectTest(request, {testId,
interactionUrl})`, or `handleTrackingCollector(tracking, request, 'test')`, before
retaining a no-send interaction. The collector must explicitly grant `test` and
implement `withLiveTestAuthority`. This read-only guard rechecks producer authority
without bypassing `withLiveCollector`'s retained-completion checks.

The typed `CollectorTestAdmission` returns the exact saved destination, owner and
material revision, source, outcome, test URL and lifetime. The SDK rechecks the
original human setup session, source access, current binding/material, cancellation
and expiry under their existing guards. Browser URL parameters cannot assert these
facts. No session credentials are returned. This read creates no completion,
readiness, click, coverage, provider operation or spending authority; the source
still must retain the actual no-send interaction and submit its authenticated
completion receipt. Unbound hosts remain unavailable. HTTP replies are private and
no-store. Existing accepted QA receipts and history remain unchanged.

Hosts may declare `destinationScopes[].testQuery` for their actual no-send route
contract. SDK-generated exact campaign destinations gain a test URL only from one
unambiguous explicit declaration; ownership alone leaves testUrl null. Test links
carry marketing_test, marketing_source and marketing_outcome. Existing campaign
query bytes and fragments are preserved while these control parameters are added.
Reserved controls cannot be overridden; removing/changing the declaration makes
existing test bindings stale. A link still requires authenticated test admission
and an actual source completion; it grants no production metric or send authority.

A no-send producer can retain the admission and set CollectorCompletion's
`testAdmissionDigest` to its canonical SDK digest. The SDK checks the entire
original test/binding snapshot before accepting that receipt. Late observations
remain excluded QA history and cannot qualify expired/cancelled/stale readiness.
Changed owner, material, source, destination or outcome claims are rejected even
when a caller reuses a real test ID.

### Explicit Meta Feed and Reels placements

The single-image contract represents `facebook_feed`, `instagram_feed`,
`facebook_reels` and `instagram_reels` individually and in explicit combinations.
The shared editor and agent schema use the same typed catalogue. Provider plans
emit each selected platform once and its exact positions (`feed` / `facebook_reels`
on Facebook, `stream` / `reels` on Instagram). Any Instagram placement requires
the selected Instagram identity. Historical capture reads the actual positions;
it does not replace a missing or unsupported position with Feed. Duplicate,
missing, additional or changed positions fail validation or exact readback.

Meta documents image advertising on Reels in its [official Reels guide](https://www.facebook.com/business/ads/facebook-instagram-reels-ads).
This implementation supports one retained image across the selected placements;
review vertical artwork and safe zones for Reels. It does not implement video
publication, placement-specific asset customization or automatic cropping.
Representation and intercepted HTTP tests are not account eligibility, provider
approval, rendering or delivery proof. Each exact account/material needs its own
current eligibility evidence. Feed eligibility cannot authorize Reels; changing
placements changes the material evidence key and provider plan. Meta daily-budget
qualification, launch approvals and spending ceilings remain enforced.

Validation: TypeScript/build plus 94 disposable PostgreSQL tests, including all
seven offered objective/delivery combinations across seven independent Feed/Reels
placement documents, native preparation, lost read recovery, activation/pause,
missing/duplicate/extra readback rejection and original historical capture. These
are synthetic provider responses, not live campaign writes or delivery evidence.

### Bind a planned campaign to host execution custody

Hosts composing private credential custody use
`NativeProvider.discoverCampaignAccount(grant, guard)` to obtain current provider
membership through SDK-owned reads before constructing `CampaignAccess`.
Retain the returned LinkedIn member, account role and organization facts in the
access snapshot; configured account IDs alone are insufficient. Discovery does
not grant permissions or qualify publication. The exact campaign check freshly
verifies the snapshot, selected publishing identity, material and current custody.

`CampaignExecutionConnections` is a trusted server API. It binds one unpublished
Studio campaign to a new campaign-scoped grant for the same provider account,
identity, currency and timezone. The shared planning grant must have no execution
permissions and remains unchanged. The new grant has `campaignId`, revision 1,
separate opaque Vault custody and exactly `prepare`, `pause`, `report`; it supplies
no activation approval. No HTTP/agent command exposes the trusted candidate.

Supply the real `SessionAuthority` and `CampaignExecutionConnectionAuthority`.
The host's `withBinding` must guard current native preparation permission, budget,
identity and credential custody through the local commit, including revocation.
Read/refresh provider credentials outside that guard. A current login, historical
policy or imported receipt does not establish execution permission. The SDK does
not create host authority, perform provider I/O, or qualify provider prerequisites.

`bind` preserves campaign ID, material, assets, attribution and Studio origin,
advances the campaign revision, and atomically retains the grant, campaign version,
audit event and request receipt. Existing provider operations (including blocked
attempts), prepared/adopted/archived campaigns, reused grants, changed accounts or
previously occupied version IDs are rejected. `readRequest` reads an original
receipt after an uncertain commit before any retry or credential refresh. Replays
require the original request payload; they do not assert current execution rights.

The scoped grant is rejected for other campaigns and new draft promotion. Shared
Studio/promotion account selectors omit campaign-specific grants. Existing grants
without `campaignId` preserve their scope. Tracking records remain readable and
unchanged; old revision/grant-based readiness becomes stale. Use the existing
tracking configuration/test APIs and current prerequisite checks for the bound
campaign, retaining old tests and evidence rather than upgrading their meaning.
Activation still requires the normal exact packet decision, applicable current
host authority and budget reservations. This local binding is not a launch.

Preparation reconciliation under native `executionAuthority` also accepts a newer campaign-scoped grant with **only** `report` permission. The original account, campaign revision and recomputed payload must still match the retained operation. This permits read-only recovery after credential/grant expiry without extending creation or spending authority. The host must preserve and validate the original grant/binding provenance, issue the narrowed current grant under live read authority, and fence provider writes. The original operation/grant revision remains unchanged; activation reconciliation does not gain this exception.

`server.studio.readRequest(principal, projectId, command, originalInput)` reads
an original local Studio write receipt for `STUDIO_WRITE_COMMANDS`. It requires
current editor authority and the same principal, project, command and exact
input/request key. It returns the immutable result even after subsequent edits;
missing returns `null` (unknown, not proof of rollback or permission to retry).
It performs no provider reads, dispatch or approval, and does not cover read/check
observations, generation or other operations with their own receipt contracts.


### Cancelling an untouched queued launch

The trusted host can call `cancelQueuedActivation(principal, projectId,
{campaignId, operationId, expectedOperationDigest, requestKey})` under current
pause authority and exclusive executor custody. It closes only a queued launch
with no account lease, provider receipt or in-process dispatch. Running and
unknown operations still require reconciliation or a separately authorized stop.
The old grant/packet may have expired or been revoked; neither is renewed or used
as current authority. Changed identities, revisions, material, packet or budget
claims are rejected.

The immutable `ActivationCancellationReceipt` retains the original operation,
packet, campaign, grant, actors and reservations, including portfolio storage.
Only that untouched operation's held reservations are released; its original
request, actor, approval and history remain readable. This server-only receipt
includes private grant references: public hosts must project a redacted summary.
`readActivationCancellation` reads by operation and
`readActivationCancellationRequest` reads an exact request before retrying a
partial host workflow. Local cancellation is **not** a provider pause or delivery
observation. Hosts should finish their usual provider pause and verify it.

A later launch uses the normal fresh grant, packet, approval, prerequisite and
budget checks with a new request key. Repeating the original launch key observes
its cancelled operation and cannot dispatch it again. Cancellation is not exposed
as a public command or a new execution worker.

### Current native invocation grants

A trusted host may retain a campaign-scoped grant with `expiresAt: null` and
`lifetime: { kind: "invocation", invocationRef }` for the exact running native
action. `pause` and `report` use stop/read custody; `activate` additionally needs
the dedicated launch-custody port described below. This represents current
host action authority when provider token expiry is unknown; it does not claim
the provider token never expires. Timestamp grants retain their existing deadline
checks and cannot silently fall back to invocation access.

Both `ExecutionAuthority.assertInvocationGrant` and the private
`VaultPort.assertInvocationGrant` must independently inspect the exact current
host invocation, principal, project, campaign and retained grant. Missing custody,
changed identity, revocation or action termination rejects before further effects
or local receipt commits. Provider transport errors recheck current authority so a
revocation is not mislabeled as a provider outage. Invocation grants cannot create,
edit material, approve spending or serve as human approval. Recovery
preserves original operation/grant revisions; a later host action needs its own
current grant revision. Ordinary SDK connections, reference provisioning, Studio
promotion and UI readiness do not infer liveness from a saved invocation reference.
Infinity may be used only as an internal calculation bound by guarded private
custody; it is never a persisted deadline or a reported token-expiry fact.


`MarketingServer.rebindCampaignBudgetTracking` is a host-only carry-forward for an
existing campaign's daily-budget-only revision. It requires current host execution
authority for preparation throughout the transaction and current session/source
access. The previous campaign revision, provider receipt, account/grant identity,
and all non-budget material must match. It appends a tracking binding revision and
preserves the original binding, tests and events; it neither copies a passing QA
result nor grants spending authority. General tracking setup remains human-only.


An invocation grant containing `activate` requires explicit
`assertInvocationActivationGrant` implementations on both ExecutionAuthority and
private VaultPort. Each must inspect the exact running action and current launch
policy for the campaign/material. Generic stop/read callbacks do not authorize
launch. The SDK still requires its normal current packet approval, tracking,
spending reservation, complete child inventory and write-boundary checks.

Host campaign access may use Infinity only as an ephemeral bound when the grant
and every current session reference the same invocation. Persisted prerequisite
records encode unknown credential expiry as `null`; proof expiration remains
bounded by the existing two-minute check validity and known material/session
limits. Neither a saved grant nor an unknown expiry makes an ended action live.

`HistoricalEffectResolutions` also accepts a host-proven
`mapped_meta_creative_after_creation_reconciliation` candidate. The host retains
an explicit original creation reconciliation, run/mapping provenance, and the
original partial status and unknown request coverage. The provider independently
reads the reconciled creative's exact ID/account and the entire current paused
campaign hierarchy. A later replacement creative stays distinct in the evidence;
this does not recreate an ad, rewrite historical effects, transfer execution, or
grant spending authority. Missing, foreign, inaccessible or active objects prevent
saving a resolution. Request replay reads the immutable saved receipt.

Meta traffic campaigns optimized for impressions or reach can retain an explicit
`expanded` delivery contract, separate from Advantage+ Lead delivery. The two
binary expansion expectations are required; at least one is enabled. A retained
`targeting.optimization: "none"` hint remains a distinct provider field and does
not imply that provider-reported expansion is disabled. Strict delivery continues
to require both observed bits to be zero. Historical reconciliation records a
difference when retained observations said expansion was off; it grants no
material approval or spending authority. Missing, duplicate or non-binary readback
still blocks execution. The editor exposes the expansion expectations without a
Lead pixel or conversion goal. Changing the delivery tuple retains original
targeting until an explicit edit: the guided editor offers removal of an
incompatible expansion expectation and a separate removal of the retained
optimization hint. These edits preserve the rest of the audience, budgets,
attribution, historical source and authority; they do not grant account eligibility
or approve a provider update.

`targeting_optimization_types` stays in the expected provider plan/readback but is
excluded from AdSet creation requests: it is a returned field, not a writable
creation parameter. Exact account/material eligibility and complete matching
readback remain prerequisites; the representable contract does not promise that
Meta will accept or deliver a new campaign with those settings.
