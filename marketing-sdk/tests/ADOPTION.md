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
