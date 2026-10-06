# Marketing SDK parity foundation — workspace tranche

This tranche changes only `c0x65o/handrail-sdk-marketing-js`. It is a candidate for
review, not a qualified consumer cutover or live delivery claim. Preserve one
creative set per campaign and Create → Launch → Results. The canonical target is
this single Git-published package, installed by full HTTPS commit SHA with a
matching lockfile and normal `prepare` compilation. Do not remove Handrail's
custom code or older embedded SDK before cutover qualification.

## Evidence and limits

| Source | Frozen identity | Inspection and implications |
| --- | --- | --- |
| Marketing SDK v0.1.4 | `d271cea3e8fe216f56300f23b07df21e778f92c8` | HEAD at entry, clean working tree; package scripts, core, server, React, native clients and PostgreSQL runner read locally. No applicable AGENTS.md found in the repository or readable parent locations. Attached KB and saved decisions (none) applied. |
| Handrail custom implementation | `08645a4f6edbf8e9efb35c4b84026edd78408c6b` | MCP source reads confirm this revision. `src/server/services/owner-marketing/index.js:411–565` provides the budget authorizer; `linkedin-lifecycle.js:120–130,285–309,408–439` separates daily allocations from group total budgets. `lifecycle.js:3191–3411` preserves original completed forms, source evidence, attribution and retries; `completed-forms.js:1–36` counts accepted submissions and excludes QA. These are parity evidence, not imported host globals. |
| Handrail older embedded SDK | Same Handrail revision | Its `marketing-sdk/README.md` and package scripts still describe the embedded build. Queue-time native comparison: **19 shared blobs identical, 22 differ**; not a second canonical package. The blob comparison was supplied by the request, not rerun here. |
| Hitcents ERP | `eb460d6aa504cc617962d289da32456059f4a79c` | Source unavailable in this worker's mounted/project source scope. Existing marketing data is a preservation requirement supplied by the owner context; its schema and runtime integration are **unverified**, not asserted implemented or missing. Parallel ERP preparation must attach an exact-revision mapping before cutover. |
| Agent SDK | `4535c367c77272d673b6a9748ef3c9ebca972a6e` | Source unavailable in this worker's scope. Public read probe of `c0x65o/handrail-sdk-agent-js` returned repository not found; this does not establish absence of the SDK. Owner context reports Vault/browser infrastructure and disabled, unqualified Facebook setup. The local Marketing `AgentPort`/`HostAgent` seam is inspected; the Agent revision itself remains **unverified**. |

Handrail MCP current-context confirmed this SDK project, this work request and
requirements snapshot `08346f8bc724`. No authentication behavior was changed.
Native inventory supplied with the request was **62 saved campaigns: 48 Meta,
14 LinkedIn; 9 configured active, 40 paused, 12 draft, 1 do-not-use**. These are
saved configuration counts, not current provider status, spend or delivery proof.
No production data, credentials, campaigns or provider accounts were read by tests.

## Comparison and delivered foundation

“Implemented” means source exists; provider transport verification below is
**fixtures only**, not live qualification. “Missing” and “deferred” must not be
advertised as provider capabilities.

| Capability | SDK baseline | Handrail custom evidence | This tranche / remaining gate |
| --- | --- | --- | --- |
| Durable authority | Implemented: grants, human packet approval, SQL executor/account leases, idempotency, unknown reconciliation | Authorizer rechecks policy, automated mode, applicant unknown effects and spend | Reuse existing machinery. Budget reservation joins operation transaction. Check account lease before every write and before finish. Current revision/plan/grant required for reconciliation. No new provider authority or scheduler. |
| Advertising budgets | Legacy `Material.budget` lifetime amount; LinkedIn incorrectly reused it as daily | Separate campaign daily, portfolio daily/period, observations and concurrent reservations | Implemented additive `AdvertisingBudget`, host `AdvertisingBudgets`, durable project/portfolio reservations and observed-spend basis. LinkedIn requires an explicit daily amount; Meta daily mode retains a campaign lifetime spend cap. Google daily mode fails closed pending provider mapping. |
| Activation cycles | Successful kind/revision permanently blocked the next activation after pause | Lifecycle operations track current effects | Reproduced from source and regression; a new approved packet/request can activate after observed pause without material edits. Same key returns same operation; unresolved operations of any kind fence new effects; a consumed activation packet cannot be reused. |
| Leads / people | `leads` counted distinct people, receipt dedupe existed | Completed form totals count submissions, independently of qualification; source/event retry receipts preserve historical resolution | Implemented explicit `completedSubmissions` and `uniquePeople`; legacy `leads` stays unique people. Immutable original input receipt precedes attribution retry. No historical attribution rewrite/backfill. |
| QA and recruitment outcomes | No explicit test flags/purpose contract | Completed-form QA exclusions; recruitment paths in custom lifecycle | Implemented explicit synthetic/test/exclusion flags, acquisition vs recruitment events and separate applicant/qualification/hire results. Recruitment completeness requires its own coverage. Recruitment provider campaign publication is **unsupported and fail-closed**, not enabled by event support. |
| Reporting | Nullable metrics, exact windows, stale timestamps; native midnights but no completion guard | Completed-window and saved observation evidence are distinct from delivery | Implemented first-local-date boundary and completed-day guards (23/25h DST supported), returned reporting basis, timezone snapshot matching; empty provider response remains null. Fixtures explicitly identify their arbitrary windows. |
| LinkedIn initial readback | Snapshot included daily budget/bid/objective/type/organization but initial comparison omitted them | `linkedin-lifecycle.js` normalizes campaign and group money separately and preserves organization | Implemented initial comparison of daily money/currency, bid money/currency, objective, type, format, cost type, organization and account alongside targeting, schedule, group total and creative. Fixture transport proves mismatch rejection, lost ack read-only reconciliation and subsequent drift fences. |
| Targeting and creative parity | Meta Facebook feed traffic; LinkedIn locations/titles and one image; Google exact search | `lifecycle.js:45,183,262,393–394` has strict-interest/Instagram/Employment paths; `linkedin-lifecycle.js:157–237` resolves professional taxonomy; document format in client | **Missing/deferred**: qualification gates below. The support client's methods alone do not constitute supported SDK campaign workflows. |
| Host integration | Implemented core/server/React imports, unconnected SQL drafts, host identity binding, AgentPort | Embedded SDK diverges; custom host owns business orchestration | Preserve additive interfaces and boundaries. Consumer and DB verification are local. ERP/Agent source comparison still needs parallel owners' exact-revision evidence. |

Implementation references: [core types](core/index.ts), [budget reservations](server/budgets.ts),
[service and lifecycle](server/service.ts), [native plans/readback](server/providers.ts),
[calendar reporting](server/reporting.ts), [validation](server/validation.ts),
[React presentation](react/index.tsx). Tests: [budgets](tests/budgets.test.ts),
[service](tests/service.test.ts), [native transport](tests/native-writes.test.ts),
[provider plans](tests/providers.test.ts), [clean consumer](tests/consumer.ts.txt).

## Host contract changes and migration

1. Existing `budget: Money` remains the lifetime media approval. Optional
   `advertisingBudget: { lifetime, daily?, campaignDailyCeiling?,
   campaignLifetimeCeiling? }` uses whole minor units, the same currency and a
   lifetime value equal to `budget`. Never divide lifetime approval by days or
   use it as a daily cap. Existing Meta/Google lifetime plans remain supported.
   Legacy LinkedIn material without explicit daily approval now fails closed:
   the old unsafe lifetime-as-daily interpretation is intentionally not preserved.
   New LinkedIn objective/format plans use normalized provider enum values.
   Safety pause binds the existing receipt without rebuilding its plan or inventing
   daily approval. Native snapshot field sets are versioned in receipt IDs so old
   readback digests remain usable for pause; new preparations use version 2.
2. Trusted host code configures `server.advertisingBudgets.configure(policy)` and
   supplies `observe(policyProjectId, observation)`; neither is a browser/agent
   command. Explicit advertising budgets require a configured project policy.
   Any configured portfolio policy containing that project applies additionally.
   Scoped execution requires explicit daily pacing; a lifetime-only approval
   cannot satisfy a daily policy ceiling.
   Portfolio members must share the same Store/schema transaction guard; this is
   not a cross-database distributed budget service. Hosts authenticate ownership,
   select member projects, and attach existing approved ceilings. Configuration
   does not grant launch permission or replace grants/human approval.
3. Observations include exact policy interval, local day, currency, timezone,
   timestamp, source and durable aggregate receipt. Include all member campaigns,
   including externally managed ones. Null, stale, mismatched or future spend
   cannot authorize a write. Fixture observations cannot fund live execution.
   The host supplies real zero only from complete known aggregate evidence.
   Campaign delivery schedules must fit every applicable policy interval.
4. At enqueue, reserve daily and period headroom atomically with the operation,
   request receipt and actor. Period reservation is conservatively
   `min(lifetime, daily × remaining local calendar days)`; current-day partial
   time is rounded up to a whole day. Check `observed today + daily reservations`
   and `observed period + period reservations` against ceilings. This intentionally
   double-counts potentially overlapping observations/commitments rather than
   releasing money on ambiguous evidence. It may reject affordable launches.
   Recheck current spend before claim and every write. There is no background
   pacing daemon or claim that a provider daily budget is an exact intraday cap.
5. Holds become active on enabled readback, release on observed pause or proved
   pre-dispatch block, and **never expire** for unknown/running effects. A policy
   with held/active reservations is immutable; pause/reconcile and install the
   next period policy explicitly. Automatic period rollover and less conservative
   spend netting remain later qualification work. Do not clear a lease/reservation
   to retry an uncertain provider write. Reconciliation cannot repair a missing
   account lease automatically; operator recovery must prove the original effect.
6. Collector/admin calls are trusted server boundaries. Bind `sourceId` from the
   authenticated connector, never from an anonymous website payload. Persist the
   source's event identity in `sourceReceipt`; retain source timestamps, person
   identity, purpose and QA flags. New source receipts persist original input
   digests so late clicks cannot change retries. Legacy records stay untouched;
   evidence conflicts fail closed. Historical host attribution requires an
   explicit adapter with its original mapping/evidence, not SDK re-ingestion that
   silently runs the SDK's `last-paid-click-7d-v1` attribution again.
7. New `completedSubmissions` counts distinct acquisition source/receipt identities;
   `uniquePeople` and legacy `leads` count distinct people completing forms.
   Recruitment uses `application_completed`, `applicant_qualified`, `hired` and
   explicit `purpose: recruitment`. Acquisition qualification/purchase do not
   accept recruitment purpose. Test events cannot inflate either outcome group.
   `firstPartyCoverage` without purpose means legacy acquisition only; recruitment
   requires its own attested interval. Missing coverage gives null, never zero.
   `excludedTestEvents` requires coverage for both purposes and counts events,
   including excluded clicks, not just forms. No retroactive QA inference from PII
   is added: importers must carry Handrail's historical exclusion evidence.
8. Native `syncMetrics` only accepts completed, exact provider-local calendar days
   and returns an exclusive interval and `completeThrough`. Core results can still
   read arbitrary first-party windows, but provider snapshots must match the exact
   window/timezone/currency. No zero-fill, widening, or delivery inference. A
   full provider-day picker is deferred. The review now defaults Results to completed
   account-local days contained in the campaign, excludes partial/current days, and
   disables provider sync for the separately labeled full first-party campaign window.

Persistence uses new kinds in the existing `records` table:
`advertisingBudgetPolicy`, `advertisingObservedSpend`,
`advertisingBudgetReservation`, `sourceEventEvidence`. No DDL migration,
production backfill, version bump, dependency change or data deletion is performed.
The package entry points remain unchanged; the server exports the additive
budget/calendar helpers. The React form has an explicit daily amount and approval
review shows it separately. Results label people and submissions separately.

Before host adoption, import active commitments and original operation identities
through a separately reviewed mapping. Do not enable policy enforcement over an
unaccounted active portfolio. Current policy storage alone cannot discover
campaigns managed outside this SDK. Existing campaigns/material/history are
unchanged by this workspace delivery.

Rollback: retain all durable records, pending operations, leases, provider IDs,
material revisions and attribution evidence. Pause dispatch during rollback.
Do not dispatch new typed-budget campaigns with v0.1.4: it cannot enforce these
reservations and has the LinkedIn mapping defect. Roll back host routing to the
previous authority only after reconciling outstanding effects and proving a single
writer; do not run both implementations. Read-only rollback can preserve records,
but old reporting ignores the new purpose/QA basis and must not replace qualified
new reporting silently. Cutover/removal is not authorized by this tranche.

## Remaining staged gates

- **Provider parity:** Meta strict interest IDs/AND-OR grouping and expansion
  exclusions, connected Instagram actor/placement checks, objective/optimization
  and tracking mappings, provider money/readback normalization, and independent
  transport tests. Never silently broaden targeting or drop requested placements.
- **LinkedIn:** professional facets and taxonomy resolution, document upload/ad
  readback, conversion objectives and tracking binding, normalized comparisons,
  pagination and partial-read recovery. Existing support-client methods remain
  unadvertised until core plan/validation/approval/results tests cover them.
- **Employment recruitment:** explicit purpose-specific Meta Employment category
  and country/targeting restrictions, LinkedIn employment objectives and applicant
  conversion binding; QA applicant setup stays isolated. Unknown setup effects
  fence activation. No recruitment provider combination is enabled in this tranche.
- **Lifecycle:** exhaustive provider-specific partial-write inventories, missing
  ID/lease recovery, external pause/drift reconciliation, policy period rollover,
  changed-grant recovery, and import of existing active reservations. Never retry
  uncertain effects or manufacture a material change to bypass identity fences.
- **Generation:** typed pause/cancel/resume with request-ID reconciliation, billing
  reservation settlement and retained asset lineage. Keep ad and generation
  budgets separate; reuse existing GenerationPort/BillingPort and host execution.
- **Product UI/drafts:** typed provider controls, local draft validation and editing,
  completed-day reporting selection, policy diagnostics, accessibility/browser QA,
  one creative set, clear Create → Launch → Results. Do not advertise unsupported
  provider/purpose/format combinations; raw JSON editing is not the final UX.
- **Website / A/B:** adapter to existing Product Analytics source/key APIs and
  `product_analytics` provisioning, privacy-safe aggregate reports, stable
  experiment/variant keys, explicit actual exposure (assignment alone is not
  exposure), idempotent conversions, imported attribution/exclusion receipts.
  Descriptive aggregate recommendations only; no invented significance, winner
  automation, raw-event analytics store or parallel attribution rewrite.
- **Optional AgentPort onboarding:** consume the parallel Agent SDK's qualified
  Vault/browser port; setup/consent/credentials remain host-owned, with human
  takeover and exact readback. Disabled Facebook setup is not qualified. No new
  credential store, token creation/revocation, arbitrary browser authority or
  independent scheduler framework belongs here.
- **Consumer cutover:** ERP owner attaches source/schema mapping at its pinned
  revision; Agent owner attaches exported port/security/readiness evidence at its
  pinned revision. Handrail compares all active identities, historical reports,
  exclusions and outstanding operations in shadow read-only mode. Then separately
  qualify one full-SHA public Git install, package lock, current auth/context,
  grants, production migrations (if any), rollback and deployment. Remove custom
  code/embedded copies only after qualified cutover and explicit authority.

## Verification and handoff

All provider writes in tests use in-process fixtures/intercepted HTTP with dummy
credentials. PostgreSQL uses the repository's disposable socket-only cluster,
private test schemas, actual SQL adapter/migrations and one worker. No shared or
production DB is used. Exact final source identity and final check results are
recorded in the worker handoff and ignored `artifacts/parity-*` logs. The normal
build emits `.marketing-build/source-manifest.json` covering source/tests/docs.

The independent-connection budget race is PostgreSQL-specific. SQLite’s synchronous
local test adapter cannot exercise concurrent transactions on separate connections
in one event loop; that test is explicitly skipped there, while same-Store race
coverage and the rest of the SQLite suite still run.

The initial regression run exposed and repaired two LinkedIn fixture assumptions
(dummy OAuth fields and explicit daily budget/policy). A subsequent PostgreSQL
run passed 66 tests with two existing dialect-specific skips. Final verification
must follow the last source edit. MariaDB and MariaDB browser runners were
attempted but returned `UNVERIFIED`: local `mariadbd` is absent. No shared DB
fallback or configured check alteration is used. Prior repository logs put the
full SQL suites near 20 seconds, below the five-minute policy. Published-Git
consumer qualification remains deferred because this is workspace-only delivery;
use the existing clean candidate-projection consumer check here.


## Independent qualification follow-up (WR 61399bd5-8d22-403a-b5b0-2e8d3efeb755)

The earlier evidence above is retained as the predecessor's record. The complete
pinned-source comparison in supplied project KB review-state revision 1,
`marketing-sdk-migration-parity-baseline-20261006`, entry
`f539c339-4ca9-42ac-8f40-ad6fce8b53e5`, supersedes the earlier request for ERP/Agent
comparison evidence. This reviewer inspected only this SDK checkout; KB conclusions
are supplied source-backed context, not fresh ERP/Agent source inspection. Host
mapping, qualified Agent readiness and cutover remain gates, without reopening
already completed pinned-source comparison work.

Runtime PostgreSQL now has explicit migration-free `Store.openExistingPostgres`
and separate trusted `Store.migratePostgres` APIs, exported with
`PostgresStoreOptions` and `POSTGRES_SCHEMA_VERSION` from `/server`. The legacy
`Store.postgres` factory remains migrating for compatibility. See [host startup
contract](DRAFTS.md). Schema version remains 2; no SQL schema files changed.
Existing schema 1 installations need separately authorized migration 2 before
restricted startup. Schema validation does not replace mapping or data integrity
qualification. No live startup, DDL, cutover or infrastructure change was performed.

Source event identities now bind source plus receipt independently of outcome
kind: changing the kind cannot mint another event. Predecessor evidence keys remain
readable, imported event IDs cannot be overwritten by a new source receipt, and
unknown historical attribution is preserved. Source connectors must use a stable,
event-specific receipt, not a reusable person/form ID.

The review's new JSON report is `PARITY_REVIEW.json`; exact final source hashes,
changed-file inventory and check outcomes are in ignored
`artifacts/parity-review-handoff.json`. Predecessor handoff/logs remain intact.
The PostgreSQL runner accepts `--browser` and reuses the current browser/app fixture;
package check scripts and worker limits are unchanged. MariaDB remains unverified
when local `mariadbd` is absent. Neither PostgreSQL fixture success nor browser QA
constitutes live-provider or published consumer qualification.

All remaining provider feature expansion, recruitment publication, lifecycle
rollover/recovery, full UI/draft overhaul, Website A/B, optional Agent onboarding,
full-SHA public Git qualification and live host cutover gates above remain open.
Rollback must retain revocation state, event input evidence, all reservations,
leases and operation identities. Quiesce dispatch, reconcile unknown effects and
prove a single writer before routing rollback. Never downgrade typed-budget
execution or replay uncertain operations to make an old host work.

## Provider-capability workspace continuation (2026-10-06)

The next bounded implementation is recorded in [CAPABILITIES.md](CAPABILITIES.md),
including the exact conditional matrix, guided editor, recruitment MOU semantics,
source evidence and remaining account/document gates. It starts from published
v0.1.5 and does not change the independent qualification record above. Independent
review and publication of this new workspace candidate are still outstanding.


## Independent provider/editor qualification (2026-10-06)

The new review in [PROVIDER_REVIEW.json](PROVIDER_REVIEW.json) and the leading
constraints in [CAPABILITIES.md](CAPABILITIES.md) supersede only the candidate's
provider/editor readiness claims. Original foundation qualification and immutable
implementation artifacts remain unchanged. LinkedIn new execution/reporting is UTC
only; Meta daily exposure semantics are unqualified and native writes for that mode
are blocked. Full-material eligibility, actual account IDs, independent GET response
shapes, post-await authority, unexpected conversion associations, durable save retry
and late UI reads were repaired. Native typed reservations remain held after pause
until a qualified delayed-spend settlement path exists. No database migration,
publication, consumer cutover, credentials or provider effects are part of this review.
Search/pickers and local-draft promotion remain product gaps, not completed guided UX.
Exact checks and final source identity live in the separate ignored review handoff.


## Guided workflow continuation (2026-10-06)

The workspace continuation in [CAPABILITIES.md](CAPABILITIES.md) adds bounded
searchable resolved choices, matrix tuple guidance, calendar reporting/scheduling,
explicit durable local-draft promotion and purpose-specific result presentation.
It does not reopen or overwrite previous qualification evidence. New local source,
check and screenshot custody is `artifacts/guided-workflows-20261006/handoff.json`.
Independent acceptance and production host QA remain outstanding. All provider,
Meta daily-cap, native paused-reservation settlement and deferred-format gates
remain unchanged.

### Meta sharing contract continuation (2026-10-06)

The current combined candidate adds explicit disabled ad-set budget sharing to
new Meta campaign plans and uses Meta readback v4 with all v3 checks retained.
Historical receipts remain unchanged for inspection/safety pause; new activation
from older Meta versions needs separate supported requalification. Unknown effects
must not be reset or recreated. See [CAPABILITIES.md](CAPABILITIES.md#meta-budget-sharing-correction-workspace-2026-10-06)
for the supplied current official-docs audit, remaining counter/cap and REACH
normalization gaps, and final combined proof location. Daily preparation,
activation and native daily-cap accounting remain denied. The earlier network
failures do not imply missing documentation. No account, strict objective, release,
consumer cutover or overall parity qualification is claimed. Previous immutable
review records and the guided-UX source/proofs are preserved.
