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

`NativeProvider.inspectExistingMetaHierarchy` supplies narrower current state
evidence for reconciliation without requiring a complete material candidate.
It verifies the account/currency/timezone, exact paused campaign and complete
unfiltered, paginated ad-set/ad edges (currently one of each), including creative
association. Every request uses read-only Vault custody with revocation checks.
Its digest covers explicit identity/state facts. It does not settle historical
effects, verify material or upload bytes, transfer ownership or grant spending.
Hosts must bind the supplied IDs to original history and current native mappings.

`HistoricalEffectResolutions` records reconciliation of a known material readback
failure after its affected objects were durably mapped. The trusted host source
proves the failure/mapping relationship and guards original records through commit;
the SDK independently reads the complete paused Meta hierarchy through its provider
port. The immutable resolution links the original import/operation/record IDs and
provider evidence. Original partial status and unknown historical request coverage
remain unchanged. Unknown transport outcomes require their specific recovery and
cannot be relabelled through this source contract. Request-key replay/read APIs
preserve a single resolution per import/operation, with source/session revocation
checks and no provider writes, execution transfer, approvals or spending grants.
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

Representing Meta daily terms does not qualify provider pacing against a native
spending ceiling. `meta_daily_budget_semantics_unverified` still prevents paid
execution; unknown exposure is never treated as zero. The public material capture
returns `executionReady: false`. Tests use real SDK clients and disposable SQL
storage with intercepted provider HTTP; they are not live account eligibility or
delivery proof. Provider field references: [Meta creative schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py)
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
host-owned campaign mappings across one Meta account. It paginates the account's
campaign/ad-set/ad edges once, checks account/currency/timezone and current Vault
custody, and returns only the requested campaign hierarchies with collection times
and a snapshot digest. Newly observed children participate in paused-state checks;
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
