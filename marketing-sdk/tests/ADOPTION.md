# Historical campaign retention

`HistoricalCampaignImports` is a server-only SDK service for importing a host's
consistent campaign snapshot. The host port supplies current identity/source
authorization and a snapshot of explicitly selected safe source fields. The SDK
owns validation, immutable records and revisions, retry identity, source-count
and compatible-total reconciliation, persistence and read APIs.

Records retain original source IDs, source revisions, reporting and collection
times, purpose, provenance, missing-data reasons, material/budget/authority facts
and unsettled operation references. Payloads must be JSON; credentials do not
belong in the source projection. Verified reporting references must resolve to
an existing SDK provider evidence revision for the same native campaign, provider,
account, provider campaign set, window and values. Legacy observations remain
legacy observations. A copy of an old approval is not a new grant.

Every normalized metric contribution must reconcile to exactly one source total.
Totals have explicit disjoint partitions (including snapshot/revision and
granularity) and exact window/timezone/currency. Incompatible rows cannot be
combined; unknown contributions keep their totals unknown. Raw historical records
whose metric semantics cannot be established can still be preserved with their
missing-data explanations rather than fabricated normalized metrics.

Repeating a request returns the original immutable receipt. Unchanged content
with a later capture timestamp or different enumeration order does not invent a
revision. Changed content needs a new request key and appends a revision linked
to the prior import. Earlier records and receipts remain readable. Host access is
rechecked at import and read boundaries; source/current-access failure before
commit rolls the SDK transaction back.

The receipt deliberately says `executionTransferred: false`. This stage creates
no SDK execution campaign, provider object, grant, advertising reservation or
conversion event. Source reconciliation and single-owner execution transfer must
be implemented by the consumer workflow before a campaign can run under the SDK.
This service is not a completed live migration or permission to resume spending.

Disposable PostgreSQL tests cover original identities, unresolved effects,
unknown values, concurrent replay, reopen persistence, immutable corrections,
counts, incompatible windows/currencies, total coverage, double counting, forged
evidence references, cross-project scope and source-access rollback. No provider
network request is made by the import service.

`HistoricalProjectImports` retains project-wide operational records and unattributed
leads/events with an explicit `scope: "project"` and `scopeReason`. It never invents
a campaign identity. Original nullable or later-corrected campaign references remain
in each source payload; project imports cannot contain campaign records or claim
a top-level campaign/provider/account identity. Verified evidence in this scope must
resolve to SDK provider evidence whose native campaign identity is null. Evidence
for a known campaign belongs to its campaign import. The two import scopes have
separate request/current pointers and outbox event types, and their read APIs reject
each other's receipts. Existing campaign v1 hashes and receipts remain unchanged.

Project tests additionally cover concurrent replay, persistence reopening, corrections
without rewriting prior attribution, scope rejection, unknown metrics, reconciliation
failures and rollback/read rejection when current host access is revoked.

After an uncertain HTTP acknowledgement, `readRequest(principal, project, requestKey)`
resolves that actor's original receipt without capturing current source or retrying
an import. A missing receipt returns null. Lookup retains current SDK membership
and source authorization; project/campaign request namespaces stay separate.

## Existing-provider execution adoption

`CampaignExecutionAdoptions` is the server transition from reconciled native
history to one paused SDK execution campaign. Its only action inputs are native
campaign identity and request key. A trusted host source supplies current material,
existing grant, original provider identities, upload provenance and retirement/
settlement evidence; none are browser- or agent-authored approval fields.

The SDK checks intact retained history, account/campaign/purpose identity, original
uploaded bytes and media metadata, and current grant/session/source access. The
host must verify the upload intent and accepted provider acknowledgment referenced
by the retained media record, including the post-transcoding hash for Meta. A
matching provider image ID alone is insufficient. The SDK's provider port then
performs fresh read-only inspection of the exact stopped hierarchy/material.

The required host `readMedia` port returns original asset metadata and exact
provider-upload bytes directly from native storage. No pre-existing SDK campaign,
asset, or blob is required. The SDK verifies content hashes and decoded dimensions,
rechecks current metadata/bytes during provider inspection and under the final
source guard, then inserts the asset/blob in the ownership transaction. Existing
identical media can be reused; conflicting IDs, metadata, or bytes fail without
overwriting them. Rights provenance remains the original receipt reference and
is included in the adoption receipt's `mediaAssetsDigest`. A rollback leaves no
new asset or orphan blob. This operation never calls provider upload APIs.

Transfer requires all legacy writes to be disabled monotonically and every
historical unresolved operation to have current reconciliation evidence. The host
must hold source/identity guards through the SDK commit and prohibit competing
writers. The present Handrail pause-only quiescence receipt does not satisfy this
contract. This requirement cannot be satisfied by passing an imported approval or
by observing an expired writer lock alone.

The final SDK transaction retains the native campaign ID, links its original
history/revision, records one owner for each campaign-owned mutable provider
object, and saves an immutable request receipt. Existing SDK campaign/uncertain
operation identities also block a duplicate owner. LinkedIn's shared group and
media never receive campaign execution ownership. A lost commit acknowledgment
is resolved through `readRequest`; replay creates no second campaign or provider
objects. History, original grants and conversions remain untouched. The transition
creates no approval decision, spending reservation, scheduler, worker or paid
provider request. New activation still requires current exact-revision approval
and existing spending controls.

Daily-only original campaigns use `material.budget: null`, an explicit
`advertisingBudget.daily`, and no `advertisingBudget.lifetime`. An open-ended
original schedule uses `endAt: null`; null is an explicit absence, not an unknown
amount or zero. Missing daily amounts, mixed currencies, conflicting lifetime
fields and invalid schedules are rejected. Provider plans and inspections retain
that absence without supplying a campaign cap, group cap or end date. Reporting
still selects finite, completed provider days. Draft promotion and review preserve
the same terms. Meta daily activation qualification and existing finite budget
authority checks remain required; representing or adopting the original terms
does not grant permission to spend.

The contract is implemented and exercised with intercepted provider observations
and disposable SQL. A consumer must implement the trusted source (including original-media reads),
current Vault/grant binding and monotonic native execution guard before invoking
it live. Passing these tests is not evidence that Handrail has transferred a
campaign or completed an authorized live pilot.

Existing LinkedIn campaigns retain exact UTC instants, including partial-day
starts, and explicit `interfaceLocales` targeting. Manual CPC with website
conversions and `NONE` optimization is represented without changing it to an
optimized-bidding mode. AND child order and facet-member order are compared as
unordered collections, preserving grouping, duplicates and unknown fields.
These terms follow the provider's [campaign schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-01)
and [website conversion objectives](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/campaign-objectives?view=li-lms-2026-08),
and a current Handrail provider observation (2026-10-15T00:19Z).

Read-only adoption marks the existing LinkedIn group as shared in the generated
receipt. Its account/identity and original observed configuration remain in the
readback digest, but its cap/schedule are not relabeled as this campaign's terms.
Campaign daily/lifetime amounts and schedule still require exact agreement.
Later operations retain this receipt and never acquire group ownership or mutate
its budget/schedule/status. A changed campaign cap, start time, locale target or
account is still rejected. Newly created group validation remains unchanged.

Validation: normal compilation and 59 disposable-PostgreSQL tests passed across
capabilities, adoption and provider paths, including reordered targeting, changed
membership, distinct shared-group terms, partial-day schedules and lost responses.
This qualifies the implementation against intercepted transports, not a live
execution adoption or campaign resumption.

## Existing native credential binding — 2026-10-15

The exported LinkedIn client now reports the earliest known expiry from OAuth
refresh and current token introspection. A later refresh response cannot extend
the introspection bound; absent expiry remains unknown when neither source
provides one. Five cases cover shorter refresh, shorter introspection, absent
introspection expiry, direct tokens and wholly unknown expiry. Normal build and
45 focused provider/connection tests passed with the disposable database runner.

The public server entrypoint exports `capturePublicDestination` for native
adoption to bind real HTML content bytes. It retains the existing public-HTTPS,
pinned-DNS, no-redirect implementation; a destination URL hash is not a substitute
for a page snapshot. Neither API issues a grant or transfers campaign execution.

Existing LinkedIn material capture uses the SDK's read-only credential port and
an exact account/campaign GET. `captureExistingLinkedInMaterial` preserves current
provider daily/lifetime terms, UTC instants, optimization/bid and Boolean targeting,
while the host supplies original copy, media identity, destination content digest,
explicit purpose and retained policy acknowledgements. It returns no execution
readiness or grant. Complete hierarchy/media inspection and guarded adoption are
still required. Identifier display fallbacks are not taxonomy eligibility receipts.
The intercepted transport tests cover unknown/drifting facts and revocation; the
native-writes regression distinguishes a shared group cap from a campaign cap.

LinkedIn adoption additionally inventories every campaign creative before returning
its inspection receipt, using pageSize=100 and metadata.nextPageToken until the
provider reports the end. Extra children, duplicate IDs, active children, missing
elements, incomplete pages and repeated cursors reject transfer. The receipt
retains an inventory digest. This follows LinkedIn's documented cursor contract:
https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/cursor-based-pagination?view=li-lms-2026-09

The source also supplies its retained provider observation. Current daily budget,
bid, schedule, organization/group, locale, objective/format, political setting and
Boolean targeting must reconcile with that observation; drift is not silently
adopted. Missing historical optimization/lifetime facts remain in original history;
current capture does not turn them into historical facts or spending authority.
