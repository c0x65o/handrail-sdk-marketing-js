# Tracking and Results implementation design

2026-10-07 · candidate, no publication or live provider actions.

Source baseline: reviewed Studio digest
`aa2ac4d43b6624fcafe0aedae49a3de11ddc22ec847b7aecfca037a5dcdd4103`.
The content-addressed snapshot and verification receipt are retained in
`artifacts/tracking-41429fed/`. Existing source, index, review artifacts, runtime,
PostgreSQL evidence and retained Connections archive/patch hashes match.

## State and screens

The default Workspace exposes Tracking beside Campaigns and Results. Studio's
saved handoff opens Tracking for the exact draft. The SDK chooses a host-authorized
source and destination, displays domain/environment, collector capabilities and
installation instructions, then saves a versioned binding. Saving leaves Not tested.
Optional provider mapping comes from the current material/account and is displayed
as configuration only. An entered pixel ID cannot verify firing.

An outcome is a completed inquiry submission, completed purchase, MOU request,
application, qualified applicant or hire. Acquisition qualification is separate from
inquiry. Purpose remains acquisition/recruitment throughout. Purchases require
amount/currency and an explicit gross-before-refunds policy; no net-revenue claim.

Start test freezes project, source revision, environment, destination, outcome,
owner revision/material digest and binding revision. Durable request identity
survives response loss and reload; one active test per binding. Tests expire in
five minutes. Correlation is a routing identifier, never an authorization token.
The SDK opens only the catalogue's exact no-send fixture destination. A separate
site server performs its intended interaction and calls the authenticated public
receipt HTTP handler. Browser observation is diagnostic only. Cancel, expiry,
changed configuration/material and revoked source never qualify readiness.
Late authenticated receipts retain QA-excluded evidence.

Diagnostics show site observation, local acceptance/dedupe, provider delivery,
matching and attribution independently. This tranche has no provider delivery or
pixel-verification transport: explicitly unavailable, with a concrete integration
action. First-party test success is never production completeness or launch approval.
Results retains existing formulas, completed-day picker and provider synchronization,
and shows coverage/provenance, unavailable reasons and separate provider conversions.

## Public trust boundaries reviewed against source

Browser commands extend the existing core/client/service dispatch. Source catalogue
and guarded current-source inspection are host facts; the SDK owns binding and test
workflow. Human commands reuse Studio's SessionAuthority and short Store transitions.
Catalogue/network reads run outside guards, with exact inspections checked again at
commit. The host coordinates source revocations just as it coordinates human session
revocations. No new identity, credential, warehouse, scheduler or schema is introduced.

Collector authentication is a separate server-only port. It resolves project/source
scope from existing host authentication. Completion/consent facts are independently
resolved from the host's retained receipt, not accepted as browser booleans or opaque
nonempty proof strings. Bounded HTTP input carries only stable receipt identity and
test correlation; the host verifier returns minimized factual event evidence.
The existing event engine preserves immutable input, source dedupe and seven-day
last-paid-click attribution. Verified test context forces permanent QA exclusion.
Current source/collector guards cover acceptance; original setup authority is checked
again for readiness. No raw contact/order/applicant data enters general diagnostics.

Completeness is a separate authenticated, server-only checkpoint operation. Validated
records bind campaign, source/configuration, purpose, window and provenance. Legacy
interval-only records remain retained but cannot establish completeness. No browser
command accepts completeness/verified/accepted flags. Meta conversions stay null
with an explicit mapping reason. Historical event attribution is never rewritten.

## Verification and remaining gates

Use disposable SQLite and isolated socket-only PostgreSQL, actual loopback HTTP site
interactions, external sessions, strict public exports/build/browser isolation, and
negative auth/replay/revision/timeout/cancel tests. Before browser journeys qualify
the existing loopback guard. Inspect 1440/390/320 pixels, keyboard/recovery and cold,
active and hidden requests under the unchanged shared 120/minute budget. Preserve
all failed attempts. Aggregate suites over five minutes remain separately skipped.

Real AI planning custody/billing, persistent authority, permanent deletion policy,
provider event delivery, exact published-Git consumption, mounted target-host/native
media/accessibility and dot review remain separate gates. No denied publication retry.

## Implemented public contracts and custody

Core exports `TrackingOwner`, `TrackingOutcome`, `TRACKING_OUTCOMES`,
`TrackingSource`, `TrackingBinding`, `TrackingTest`, `TrackingDiagnostic`,
`TrackingView` and `TrackingCommands`. The existing client adds `tracking`,
`bindTracking`, `startTrackingTest`, `observeTrackingTest`, `cancelTrackingTest`.
No browser receipt acceptance or completeness command exists. Bindings retain
source snapshots, owner/material/account digests and optional existing provider
mapping. Test requests retain their original human SessionInspection internally.
Readiness expires with the five-minute test; historical accepted evidence remains.
Only the original current setup session can qualify readiness; other authorized
readers can inspect retained history and start their own test after closure.

Server exports `MarketingTracking`, `TrackingOptions`, `TrackingSources`,
`TrackingCollector`, `CollectorInspection`, `CollectorCompletion`,
`CollectorCheckpoint`, `ValidatedCoverage` and `handleTrackingCollector`.
The existing `MarketingServer` accepts optional `tracking: TrackingOptions` beside
`studio`/`connections`. `marketing.tracking.acceptReceipt(request,
{sourceReceipt,testId})` and `attestCoverage(request,{checkpoint})` are server only.
The HTTP handler accepts at most 2 KiB of reference JSON in five seconds; verified
completion facts are bounded to 8 KiB. Source setup and receipt authentication are
independent. The host's verifier must resolve durable completion/consent facts from
its existing collector; echoing browser fields is an invalid adapter implementation.
Checkpoint verification attests retained completeness of the whole bound source
namespace for the purpose/window, including absence, consent and QA exclusions.

The existing public host composition example mounts `/api/marketing-collector/receipt`
and `/api/marketing-collector/coverage`, sharing the host's existing request budget.
It accepts optional factual `tracking` ports and reuses the same external session
authority as Studio. No new auth store, credential, persistent grant, scheduler,
provider transmission or application-database DDL is introduced. Source/collector
guard callbacks coordinate all host revocation/configuration writers and may only
hold short local transitions. Catalogue, completion verification and metric HTTP
reads occur before those guarded transitions.

React exports `MarketingTracking`; the default Workspace owns navigation, forms,
retry/reload, bounded active-test refresh and diagnostics. Launch reads the exact
campaign Tracking status. Existing provider conversion settings remain configuration
only. Required conversion preparation/activation is blocked with
`provider_event_delivery_unqualified_use_tracking_diagnostics`; queued execution
is fenced before mutation without clearing operations, leases or budget holds.
Safety pause remains available. Provider pixel firing, delivery and matching are
unavailable until a separately qualified adapter supplies precise evidence.

Results reuses existing completed-day windows, formulas and provider reads. It adds
completed purchases, gross-before-refunds semantics and validated coverage provenance.
Provider conversions remain separate; missing Meta mapping has an explicit reason.
Changing this code does not rewrite historical events, attribution, provider IDs or
legacy intervals. Historical interval-only coverage now reports unknown, deliberately.

## Candidate evidence and limits

The first installed browser run completed manual Studio → source configuration →
actual HTTP no-send inquiry, purchase and MOU interactions → diagnostic receipt →
Results. It used one public Workspace/client, zero host marketing screens, external
SQL-backed host sessions, no Agent and no provider grants. Website form/server and
collector authentication/completion/checkpoint facts are explicitly test-boundary
fixtures; the website is a separate HTTP interaction, not a seeded passed record.
Synthetic campaign/provider snapshots arrange Results; no paid campaign is created.

Initial browser measurement: cold 2, active 49, hidden 0, peak rolling minute 51/120.
This is the complete primary manual journey, not the prior extended synthetic
Studio stress journey combined into a single minute, mounted Preview, or native
proof. A normal installed package projection, strict NodeNext/Bundler/host compile
and browser/server isolation passed. Exact public HTTPS Git-SHA installation remains
unverified because publication remains prohibited. Current final receipts, failures,
source-only delta and hashes are recorded under `artifacts/tracking-41429fed/`.

## Independent review repairs · 2026-10-07

Review evidence is retained in `artifacts/tracking-review-b37ad76f/`. This is a
package-consumer qualification, not Preview/native adoption or public Git-install
proof. Earlier failures and implementation receipts remain unchanged.

The review repaired unsaved Tracking choices lost on Back/reload, misleading
user-observation wording, stale Studio handoff persistence, source-universe and
producer revocation gaps in completeness, and retained Meta values presented without
a qualified mapping. Money is displayed in currency units and reporting dates in
the stated campaign timezone. A setup user's `observeTrackingTest` records an
unverified observation; it cannot establish site completion or provider firing.

The public factual adapter contract now requires:

- `TrackingSources.inspectAccess(session, source)` checks the current user's source
  permission under the existing host guards. A general project role is insufficient.
  Missing support denies configuration/testing, rather than assuming access.
- Optional `inspectUniverse(projectId)` returns the complete authoritative project
  source catalogue, including namespaces with no events. It is a bounded local read,
  not a caller-visible subset or a network lookup. `withLiveSources` must serialize
  project catalogue additions, removals, revisions and source permission writers.
  Absence leaves completeness unknown. More than one active source for the purpose
  cannot be attested complete by this version.
- `CollectorInspection.permissions` separates `completion` from `coverage` authority.
  `verifyCheckpoint` must resolve an authorized producer's durable complete-source
  checkpoint, including all outcomes for the purpose, consent and QA exclusions.
  A completion credential, browser flags or a single passing test cannot attest it.
- Optional `TrackingCollector.inspectCollector(id)` resolves current producer
  authority outside commit guards. Without it, retained Results remain readable but
  completeness stays unknown. `withLiveCollector` rechecks exact permission,
  revision, expiry, source and revocation through commit acknowledgement.

Validated coverage binds the full source-universe digest as well as the existing
checkpoint, material, binding, source and producer revisions. Legacy rows without
that digest stay retained and unknown; nothing is migrated or rewritten. Changed
bindings, revoked producers, catalogue changes, unsupported multiple sources and
partial/overlapping windows never silently establish complete totals. This version
requires one checkpoint covering the requested window; it does not union partial
windows. Historical counts/events/snapshots are retained even when the current
basis can no longer qualify a complete total. Meta conversions remain null even
if an old snapshot contains an unmapped value. Other provider totals stay separate.

External catalogue, completion and producer resolution occurs before commit guards.
Local guard order is human session (when applicable), collector, source, SDK Store.
Local source/permission/session inspectors must use current bounded host facts;
network work belongs in the preceding resolution phase. The Studio final transition
rechecks exact test/binding/source/session/expiry and persists its report in that
same guard. Receipt acceptance coordinates the original human session when it can
qualify readiness; revoked sessions may retain permanently excluded late QA history.
Guards are not recursively acquired. The host must coordinate all relevant writers;
these ports do not create a replacement identity or analytics engine.

The review's consumer reuses the previously installed qualification dependencies
and browser assets, with an isolated copy of the public package projection updated
from the normal build. No SDK dependency is installed from a file or tarball and
no package/publication command is run. Strict exports/NodeNext/Bundler and browser
isolation checks qualify this projection only. Exact public HTTPS full-SHA/lockfile
installation remains blocked by the stopped publication action. Real host facts,
provider observation/delivery/matching, real AI custody/billing and persistent
readiness, native/device/media-range/full accessibility and dot review remain
separate gates; full Marketing is incomplete.
