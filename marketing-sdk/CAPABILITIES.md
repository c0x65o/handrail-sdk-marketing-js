# Provider capabilities — workspace candidate

Baseline: published v0.1.5, `b5e725a1d2cff4864c98acb98f9e6e8e8e370f51`.
Contract: `2026-10-06.1`. Independent source review and repairs are recorded in
[PROVIDER_REVIEW.json](PROVIDER_REVIEW.json). This remains a workspace candidate,
not publication, account qualification or observed delivery.
No version/dependency/lockfile change, SQL migration, host cutover, Vault setup,
new runtime or scheduler is part of this delivery.

## Independent review constraints (2026-10-06)

The starting implementation evidence in `artifacts/provider-capabilities/` is
immutable. New source identity, every dirty path, generated-file hashes, commands,
timings, failures, skips and rendered screenshots are recorded separately in
`artifacts/provider-capabilities-review/handoff.json` and `source-manifest.json`.
The normal final build hashes this document and all source/tests; the handoff is
outside that hash to avoid self-reference. Published v0.1.5 evidence is unchanged.

LinkedIn now requires **UTC** for new grants/material, reporting and native budget
policy. This is [provider reporting policy](https://www.linkedin.com/help/lms/answer/a420851),
not an account timezone observation. The documented
[account GET schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts?view=li-lms-2026-09)
has ID and currency but no timezone. Verification reads those fields, ignores
unrelated `timeZone`/`timezone` extras, and exposes the policy provenance. Ordinary
responses without either extra work. Missing/mismatched IDs and currency fail.
Existing non-UTC grants are not rewritten; launch/reporting with them is blocked,
while receipt-based safety pause remains available.

For this release, LinkedIn schedules must use UTC midnights and end-exclusive
instants. Partial-day and non-UTC/DST schedules are rejected rather than rounded.
Reports accept only completed UTC days; the native adapter translates the
exclusive end to the previous [inclusive reporting date](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting-schema?view=li-lms-2026-09),
and validates returned campaign pivots, daily date ranges and duplicates. First-party
windows remain separately labeled. A future host display/scheduling timezone must
be a separate field and must not change the provider basis.

Meta account IDs are validated as documented `act_<digits>` strings on readback;
no numeric coercion or fallback to the submitted ID establishes identity.
[Official v26 account fields](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.0/facebook_business/adobjects/adaccount.py)
and [modern Instagram identity](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.0/facebook_business/adobjects/adcreativeobjectstoryspec.py)
are exercised at the transport seam. Eligibility keys now bind full material,
project, grant ID/revision and account context. Expiry/revocation, post-await scope
changes and each native write boundary fail closed. LinkedIn initialized image
IDs are retained before upload; unknown effects are not replayed.

**Meta daily budget preparation/activation and native daily-cap accounting are
blocked.** [Meta Help](https://www.facebook.com/business/help/190490051321426)
returned a login/block page and [developer budgeting prose](https://developers.facebook.com/docs/marketing-api/bidding/overview/)
returned 429. Field existence and host eligibility receipts cannot override this
missing semantics proof. No overspend factor or additional provider cap is invented.
The nominal input may be saved as a draft; its daily exposure is unknown. Existing
safety pause remains usable. Lifetime-only material does not establish a daily cap;
policies requiring a daily approval reject it.

[LinkedIn campaign budgeting](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09)
describes up to 150% daily charging for daily continuous/fixed and daily-plus-total
continuous schedules. Lifetime-only pacing is not lifetime divided by days as a
daily ceiling. This tranche requires explicit daily approval, reserves 150% bounded
by the approved lifetime, and never derives daily from lifetime. New native typed
holds remain active after observed pause: incurred but delayed spend has not been
settled. No automatic capacity release or reactivation is authorized by pause alone;
final-spend settlement/rollover is an unresolved host integration gate. Budget
reductions do not shrink retained holds. Configured targets, reservation exposure,
provider limits and observed spend are distinct. Coverage is managed media; external
campaigns, taxes and fees require separate host accounting.

The editor is **partially guided**, not a finished guided product. It has labeled
controls, resolved-option lists, full material review, Back/Cancel, draft retries
and scope fences. Campaign saves now optionally use durable `requestKey` receipts;
callers must reuse a key for an identical uncertain retry. Existing callers remain
compatible. This does not change provider-operation replay rules. The browser uses
that key to prevent duplicate campaigns after a lost save acknowledgment.

Still missing: searchable/paginated taxonomy discovery, friendly country/location
pickers for the separate Audience tab, connected-identity discovery, pixel/conversion
pickers (manual ID/URN entry remains), dependent objective defaults, a convenient
completed-day picker, and a complete local-draft-to-connected-campaign flow. Document,
PDF, lead-gen, job-application, video and advanced options remain unavailable and
cannot be forged into launch. Mock successes prove code behavior only.

The requested parity KB slug was unavailable through `kb_get_entry` and native
search. Repository `PARITY_REVIEW.json` and `PARITY_ROADMAP.md` preserve the prior
pinned comparison conclusions; no fresh cross-project inspection is claimed and
that supplied comparison is not reopened. Full-baseline reconfirmation remains
unverified. No AGENTS.md or local skill was present in this checkout/ancestor chain;
no unrelated installed skill was applicable to this SDK source review.

## Exact implemented matrix

All new Meta/LinkedIn campaigns use one image and one creative set. Combinations
outside these rows reject before any provider or fixture effect. The public
`CAPABILITY_MATRIX`, `ProviderSettings`, `ProviderMaterial`, `capabilityBlockers`,
`capabilityKey` and `capabilityStatus` expose the same browser-safe contract used
by the server. Enum membership alone never authorizes an effect.

| Provider / API | Purpose | Objective | Optimization / bid | Format / placement | Targeting / additional gate |
| --- | --- | --- | --- | --- | --- |
| Meta v26.0 | acquisition | OUTCOME_TRAFFIC | LINK_CLICKS / lowest cost, no cap | single image; Facebook Feed, Instagram Feed, or both | Ordinary traffic, separate from strict interests. Country/adult age/languages; no interests or custom exclusions in this ordinary contract. |
| Meta v26.0 | acquisition | OUTCOME_TRAFFIC | IMPRESSIONS or REACH / lowest cost, no cap | same feed choices | Strict US application contract; resolved interest OR groups ANDed together; resolved languages; existing account custom-audience exclusions. |
| Meta v26.0 | acquisition | OUTCOME_AWARENESS | REACH / lowest cost, no cap | same feed choices | Same strict US contract; explicit Page promoted object; explicit provider UNDEFINED destination readback. |
| Meta v26.0 | recruitment | OUTCOME_LEADS | OFFSITE_CONVERSIONS / lowest cost, no cap | same feed choices | US EMPLOYMENT category and category country required. Ages 18–65+, no language/interests/exclusion narrowing. Existing pixel/custom conversion must match exact ApplicantRequestMOU event rule. Account eligibility remains required. |
| LinkedIn 202609 | acquisition | WEBSITE_VISIT | NONE / explicit manual CPC | STANDARD_UPDATE / LinkedIn feed | Resolved geo and professional facets; positive bid required. |
| LinkedIn 202609 | acquisition | WEBSITE_VISIT | MAX_CLICK / auto CPM | same | No inferred bid amount. |
| LinkedIn 202609 | acquisition or recruitment | WEBSITE_CONVERSION | ENHANCED_CONVERSION / explicit manual CPC, or MAX_CONVERSION / auto CPM | same | Existing enabled conversion owned by exact account; one exact campaign association, no extra association. Acquisition: LEAD/Lead or PURCHASE/Purchase. Recruitment: OTHER/ApplicantRequestMOU, event-specific Conversions API rule. |
| LinkedIn 202609 | acquisition | BRAND_AWARENESS | MAX_REACH / auto CPM | same | Explicit organization, consent, budget and schedule. |
| LinkedIn 202609 | acquisition | ENGAGEMENT | MAX_CLICK / auto CPM | same | Explicit organization, consent, budget and schedule. |
| Google v25 | legacy acquisition | unchanged exact Search | existing manual CPC contract | existing Search text only | No Google expansion in this tranche. Existing Google validation/readback and lifetime-budget fence remain. |

Meta strict and employment rows are **conditional application contracts**, not a
new claim of Meta eligibility. Fresh Meta developer guide requests were rate
limited/unavailable; the v26 schema verifies field spellings, not combinations.
Non-US strict/employment targeting remains gated. Ordinary acquisition retains
country inputs but every new live contract still needs exact account evidence.
No new country restriction is inferred from prose or SDK enum presence.

Meta identity includes a Page and, when selected, its connected Instagram user.
The wire field is `object_story_spec.instagram_user_id`; `instagram_actor_id` is
not emitted. Instagram placement is `stream` (feed), never Reels, Stories,
Audience Network or automatic additional placements. Strict expansion readback
requires explicit zero for both unique `detailed_targeting` and `lookalike` bits.
Missing/null/false/blank/duplicate/unknown entries fail. Targeting automation and
complete groups/exclusions must match the authored request; unknown extra
fields are not silently discarded. Provider reordering is conservatively gated
rather than treated as a newly qualified normalization.

LinkedIn facets are `titles`, `jobFunctions`, `seniorities`, `employers`,
`industries`, `staffCountRanges`. Values are typed URNs plus resolved labels;
includes are OR within a facet and AND between facets, exclusions are OR.
Titles plus included functions/seniorities, employers plus included
industries/size, and size on both sides are rejected. The locale is explicitly
limited to en_US in the wire plan/readback. Offsite delivery, audience expansion
and connected-TV-only delivery must read back false. Political consent is
required for all targeted regions so an unresolved EU location cannot bypass it.
The guided editor displays nondiscrimination and political-intent notices.

## Authority, evidence and host integration

`settings` is additive to stored Material. New preparation/activation for Meta
and LinkedIn requires it. Old material can still be read and saved as planning
material; it cannot mint new provider effects through the service or native
adapter using the legacy hardcoded plan. `providerPlan` retains the old mapping
only for inspection/reconciliation compatibility. Pause uses the original
receipt, not a rebuilt plan. v1/v2 readback digests retain their original field
sets; new explicit plans retain `readbackVersion: "3"`.

Trusted host code supplies account-scoped `Grant.targetingOptions` from the
existing native taxonomy clients, and `Grant.capabilityEvidence` after obtaining
actual provider eligibility evidence for the exact `capabilityKey`. Evidence
contains the canonical key, verified/expires instants and durable receipt; the
key binds the full material, project, grant identity/revision and account context,
including API, purpose/goal, objective, optimization, format, placements, identity,
targeting, copy, destination, media, budget and schedule. It is neither a browser flag nor an
agent command. The UI never marks an account verified just because the SDK has a
supported row. This worker did **not** create any real account eligibility
receipt. Without one, all new native provider publication remains blocked.

At execution, the existing native clients re-read Page/Instagram ownership,
Meta interests/custom audiences, LinkedIn taxonomy, and conversion ownership,
type and event binding before writes. Options that cannot be exactly resolved
remain blocked; the host must supply supported locale labels. The SDK does not
create conversions, pixels, taxonomies, exclusions, credentials or grants.
Eligibility collection/onboarding remains host-owned and is not automated here.

New initial snapshots compare the account and identity; objective, optimization
and bid; exact targeting/grouping/exclusions; budgets; schedule; creative and
media references; media owner/status; and conversion association. Missing fields
are unknown. Stable image identity/status is retained separately from expiring
media URLs. Drift prevents activation and read-only reconciliation cannot bless
an incomplete or changed initial snapshot. Existing leases, before-write
checks, source fences, unknown-effect recovery, receipts and human packets are
reused. Any material save invalidates old packet authority.

LinkedIn daily and lifetime approvals remain separate. New explicit LinkedIn
plans reserve `min(lifetime, ceil(daily × 1.5))` against the existing daily policy
and campaign ceilings, and use this exposure in the conservative period
reservation. The authored provider daily amount is unchanged. Stored legacy
holds are not recomputed. No daily amount is derived from lifetime, and no
provider pacing policy is described as an exact intraday spend cap.

`applicantGoal` binds `ApplicantRequestMOU / completed_mou_request` through
Material, Packet and Results. Trusted first-party `applicant_request_mou` events
produce `Results.applicantRequests`. Application completions, qualified
applicants, hires, acquisition submissions, unique people and customers keep
separate counts. LinkedIn `externalWebsiteConversions` remains aggregate
`providerConversions`; it is never applicant-request evidence. Existing source
identity/dedupe, QA exclusions, coverage, historical attribution and reporting
windows remain intact. Unknown first-party coverage stays null.

The partially guided React editor uses fields/selects and resolved options, with explicit
readiness blockers. No primary raw-JSON editing remains. Local unconnected drafts
remain incomplete planning documents and render in the workspace; they do not
inherit an account or become campaigns automatically. Back/Cancel preserve or
restore local edits; in-flight saves fence repeated clicks and account switches.
An account change creates a fresh form and never translates prior targeting,
identity, consent, bids, money or schedules. Launch shows the exact readable
purpose, identity, objective, audience groups, budget/exposure and time window.
Headless and agent save paths use the same server validator.

## Deferred / not advertised

- Document ads: no PDF asset kind, immutable upload receipt, packet or editor
  option has been enabled. Follow-on must validate actual PDF bytes/page limits,
  owner and AVAILABLE status and immutable upload identity. Initially permit
  only ungated BRAND_AWARENESS/ENGAGEMENT with a separately qualified document
  optimization and `SPONSORED_UPDATE_NATIVE_DOCUMENT`. No website-visit document
  fallback; gated documents require a qualified Lead Gen Form flow.
- Ad video, new placements, new Google options, non-US Meta strict/employment,
  arbitrary Meta objectives, Lead Gen Forms, taxonomies beyond listed facets,
  automatic bidding/budget adjustments and automatic conversion creation.
- Live provider/account qualification and delivery observation; a UI selector or
  successful fixture is not acceptance by any real provider.
- Provider-normalized targeting order, additional conversion rule shapes and
  host taxonomy locale/pagination qualification beyond exact returned options.
- Optional concrete Agent SDK/Vault integration, host migrations/data mapping,
  consumer cutover and later publication. Existing published
  Agent/Marketing Git references have not changed.

## Source manifest and verification handoff

The normal build emits `.marketing-build/source-manifest.json`. Final check
outcomes and hashes are retained in ignored
`artifacts/provider-capabilities/handoff.json`; logs and browser screenshots are
in that same directory. This avoids a self-referential checked-in build hash.
No configured check or worker limit was changed. Checks run sequentially and
follow the saved five-minute policy; no shared/operator database is used.

Original implementation source inspection on 2026-10-06 (retained; independent review sources and limits are above):

| Source | Evidence / limit |
| --- | --- |
| This SDK baseline and package PARITY_ROADMAP.md / PARITY_REVIEW.json | Read before changes; preserve reviewed budget/reporting/recovery and migration-free startup. Handrail current-context verified this work request and requirements snapshot 08346f8bc724. No applicable AGENTS.md found. |
| [Handrail strict controls](https://github.com/c0x65o/handrail/blob/08645a4f6edbf8e9efb35c4b84026edd78408c6b/src/shared/meta-targeting-controls.js) | MCP read at exact revision; SHA-256 `6a3e4a79765429db68aa59f6d9a575885c036c9c30e8e73eb1eace5fec309f33`. Strict objective and zero-bit behavior are application evidence. |
| [Handrail Meta lifecycle](https://github.com/c0x65o/handrail/blob/08645a4f6edbf8e9efb35c4b84026edd78408c6b/src/server/services/owner-marketing/lifecycle.js#L305-L445) | MCP exact revision/range; Page/Awareness destination, strict targeting, Employment category payload and custom conversion path. Older actor field not copied. |
| [Handrail LinkedIn lifecycle](https://github.com/c0x65o/handrail/blob/08645a4f6edbf8e9efb35c4b84026edd78408c6b/src/server/services/owner-marketing/linkedin-lifecycle.js#L393-L473) | MCP readback plus lines 155–239 taxonomy path; reused client boundary, not automatic old CPC defaults. |
| [Meta v26 object story spec](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.0/facebook_business/adobjects/adcreativeobjectstoryspec.py), [targeting](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.0/facebook_business/adobjects/targeting.py), [adset](https://github.com/facebook/facebook-python-business-sdk/blob/26.0.0/facebook_business/adobjects/adset.py) | Fresh official schema reads confirm modern fields. They do not prove combination eligibility. Special-category/targeting guides returned 429/unavailable; account gates remain. |
| [LinkedIn objective mapping](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/campaign-objectives?view=li-lms-2026-09) | Fresh mapping confirms the six image objective/optimization/bid rows. |
| [LinkedIn campaign requirements](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09) | Fresh requirements for optimizationTargetType, political consent, nondiscrimination notice and daily overdelivery exposure. |
| [LinkedIn facets](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/ads/targeting-criteria-facet-urns) | Fresh Boolean compatibility restrictions and typed URNs. |
| [LinkedIn conversion schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema?view=li-lms-2026-09), [conversion tracking](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversion-tracking?view=li-lms-2026-09) | Fresh OTHER vs application semantics and exact campaign association GET/PUT. The business meaning of ApplicantRequestMOU comes from the owner contract. |
| [LinkedIn Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2026-09) | Fresh ownership/status/upload requirements inspected; document support deliberately deferred. |

Breaking/migration implications: no DDL or startup migration change. Type additions
are compatible for inspection; effectful Meta/LinkedIn callers must explicitly
upgrade material before new prepare/activate. New LinkedIn exposure accounting
can deny launches that the prior nominal-daily accounting admitted. Hosts must
retain old IDs, revisions, reservations, source receipts and pending-operation
identity; do not auto-upgrade historical material or reset unknown effects.
After separately authorized publication, consumers still need full-SHA public
HTTPS Git installs and matching lockfiles. Workspace consumer projection is not
proof of a published Git installation. Rollback must quiesce dispatch and
reconcile effects; an old SDK cannot enforce this new contract.
