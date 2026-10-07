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
blocked.** The current public-docs audit supplied on 2026-10-06 establishes the
v24+ sharing requirement and ordinary daily flexibility; the earlier 429/login
results were transport limitations, not evidence that documentation was missing.
The bounded correction and remaining cap/counter qualification gaps are below.
Field existence and host eligibility receipts cannot override the existing denial.
No exposure factor or additional provider cap is enabled by this correction.
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

The guided continuation below adds bounded host-catalog search/pickers, completed-day
selection and planning-only draft promotion. Live taxonomy/identity discovery and
account qualification remain host-owned; unresolved manual IDs remain explicit. Document,
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
new claim of Meta eligibility. The earlier review's guide reads were rate limited;
the v26 schema verifies field spellings, not combinations. The current public audit
does not qualify strict objectives or REACH readback normalization (see below).
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
receipt, not a rebuilt plan. Historical v1/v2/v3 readback digests retain their
original field sets. New Meta plans/receipts use `readbackVersion: "4"`; LinkedIn
stays on v3. Older Meta receipts cannot qualify new activation without separate
supported requalification; this correction provides no automatic upgrade.

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

## Guided workflow continuation (workspace, 2026-10-06)

This continuation starts from released `cad968f87f4e8967961dd2e1b9f6936aed640d0f`.
The preceding review and its artifacts remain immutable predecessor evidence.
New evidence is in `artifacts/guided-workflows-20261006/`; this is not independent
acceptance, publication, live qualification or a Ready-for-Clinton claim.

Resolved targeting now uses searchable checkbox lists, twenty choices per page,
readable selected labels and keyboard-removable chips. The separate Audience tab
uses the same account country/location catalog. Catalog processing is bounded to
5,000 supplied entries and labels/IDs to 200 characters; missing/truncated catalogs
explain how to request a narrower or refreshed host catalog. Unknown saved values
remain visible and removable. Manual location/identity/conversion compatibility
is explicitly unresolved. No asynchronous discovery endpoint was added: workspace
reads carry the host-owned catalog and existing scope fences discard late reads.

Trusted hosts may add `Grant.selectionOptions` with `{ kind, id, label }`, where
kind is `page`, `instagram`, `organization`, `pixel` or `conversion`. Identity
choices are restricted to the already-granted identity IDs. This field provides
names only; it is not eligibility, conversion type/event evidence, or authority.
It is absent from command inputs. Existing native discovery and execution ownership
checks are unchanged. Hosts still own catalog freshness and actual resolution.

Objective/optimization/bidding choices come from the existing matrix, filtered by
explicit purpose. Selecting one changes only that tuple, retaining incompatible
fields with blockers. Manual CPC remains explicit and an unfinished amount is
retained when switching to automatic bidding and back. No consent, purpose,
identity, targeting or budget is changed by choosing a tuple. New campaign copy,
destination, targeting and monetary amounts start blank, with no product fixture
copy. Date fields use the existing account-calendar/DST helpers, expose the exact
UTC instants and explain exclusive ends. LinkedIn midnight/UTC restrictions remain.
Results have a separate bounded completed-day picker and purpose-specific metrics;
first-party full windows cannot be synced as provider reports. Unsupported windows
are rejected, never rounded or relabeled. Submitted events, unique people, QA
exclusion coverage and ApplicantRequestMOU meanings remain unchanged.

`promoteDraft` is additive planning-only API. See [DRAFTS.md](DRAFTS.md) for its
server-derived durable identity and retry contract. It preserves the local document,
retains provenance on subsequent campaign edits, and cannot prepare, launch,
create access, spend or move assets between campaigns. No schema migration or
new persistence mechanism is introduced. Existing published command clients stay
compatible; hosts with closed route allowlists must explicitly add this command.

Remaining limits: catalogs are host-supplied bounded snapshots, not live search;
missing names/records need host discovery. Malformed partial provider settings
have an explicit reconstruction control in promotion: it preserves the source,
clears provider settings/outcome binding and consent, and remains unqualified. New planning campaigns
still need campaign-owned media and all existing preparation/launch gates. No live
provider, deferred format, Meta daily exposure, paused-hold settlement, Agent or host
cutover capability is enabled. Production host integration needs separate target
platform QA. Exact check outcomes, failures and local screenshot custody belong to
the new handoff, not to the predecessor's acceptance record.

## Meta budget-sharing correction (workspace, 2026-10-06)

This bounded continuation preserves the reviewed and guided-UX candidate at HEAD
`cad968f87f4e8967961dd2e1b9f6936aed640d0f`, starting source digest
`799d6889eceda4160e8db2f2ae58de9c7d3932ae972cb90baa89346a14506276`.
`PROVIDER_REVIEW.json` and all predecessor copied source/proofs remain historical,
unchanged records. Current combined hashes, deltas, checks and local screenshots
are in `artifacts/meta-budget-sharing-20261006/handoff.json` and its source manifest.
Independent combined review and supervising visual review remain required; this
is neither a Ready-for-Clinton claim nor overall parity or real-account acceptance.

New explicit Meta plans include literal `is_adset_budget_sharing_enabled: false`
on the PAUSED campaign and a separate plan/readback version 4. The existing client
transmits `false` through its query serializer and rejects omitted/non-false
campaign-create input. No sharing-enabled option is exposed. Both representable
ad-set lifetime and daily plans carry the flag; daily preparation/activation and
native daily-cap accounting remain denied, including with an account receipt.
The approved amounts, targeting, identity, material and authority fences are unchanged.

Version 4 requests and hashes the campaign sharing field in addition to every v3
account, media, identity, objective, optimization, expansion, targeting, creative,
budget and schedule field. Only JSON boolean `false` qualifies: omitted, null,
true, numeric/string substitutes or other malformed evidence cannot establish
initial authority, qualify new activation or settle an uncertain v4 creation.
Changed readback still blocks activation. A failed/lost response retains known IDs
and an unknown operation/lease; same-key retries return the same operation,
new-key replay is blocked, and reconciliation is read-only. An unknown create
without sufficient IDs stays unknown; no reset, recreation or material migration
is provided. A status write acknowledgment is not observed delivery.

Historical v1/v2/v3 snapshots retain their exact field sets and digest meaning;
paused/active inspection and receipt-based safety pause remain available with the
original IDs. New activation fails with `meta_readback_requalification_required`
at the native adapter, and the changed plan digest also prevents an old receipt
from minting a new service approval packet. Saved unknown operations whose old
plan digest no longer matches require separate supported investigation/requalification;
they are never silently upgraded or replayed. No such requalification workflow
is implemented here. LinkedIn v3 branches stay unchanged; unknown snapshot
versions reject instead of falling through to a weaker historical contract.

Public evidence below is the **independent unauthenticated official-docs audit
supplied with this work request on 2026-10-06**. This worker's web-tool rereads of
all six URLs returned HTTP 429; that does not negate the successful supplied
cloud-browser audit. No authenticated provider/account call was made. These
contracts inform source code, not action authorization:

- [Ad-set budget sharing](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/guides/adset-budget-sharing):
  v24+ ad-set-budget campaign creation must explicitly supply true or false;
  omission yields 4834011. False disables sharing. Sharing maxima are 2.1D/day
  and 8.4D/week; one active ad set has no sharing. This task enables none of it.
- [Campaign creation](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/campaigns):
  PAUSED OUTCOME_TRAFFIC example includes sharing=0. Campaign spend cap has a
  $100 USD minimum or approximate local equivalent and is unavailable for
  Reach/Frequency and Premium Self Serve. Exact EUR/GBP/CAD/AUD thresholds remain
  unqualified; no FX threshold or budget alteration is inferred.
- [v24 changelog](https://developers.facebook.com/docs/graph-api/changelog/version24.0/):
  ordinary daily flexibility is 75%, averaged Sunday–Saturday with weekly spend
  at most 7D. Generic Budgets prose still saying 25% is stale and is not a basis
  for lower exposure. This does not qualify native daily-cap accounting.
- [Ad-set reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign):
  daily schedule duration must be strictly greater than 24 hours; lifetime needs
  end_time. `daily_spend_cap` requires campaign-level daily_budget and cannot be
  grafted onto this ad-set-budget plan. No partial-day prorating is authorized.
- [Campaign reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign-group):
  exposes sharing/readback, buying type, budget/cap eligibility and scheduling.
  Reference UI version v25 and examples using v26 are distinct from exact-account
  acceptance; the v24+ flag requirement is explicit.
- [High-demand periods](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/high-demand-period):
  scheduled increases may reach 8× base. They remain unsupported and disabled.

The audit did not establish complete counter timezone/DST/reset semantics or
all budget/cap eligibility. Native Meta daily mode remains blocked in direct
adapter, headless live execution and live UI paths; fixture demonstrations are
not provider qualification. Retained paused reservations are not released.
Lifetime-only material still cannot satisfy a required daily policy approval.

Official bidding prose also notes REACH may normalize to IMPRESSIONS with
frequency controls. Exact objective/optimization readback remains required:
that normalization is rejected until separately proved for the exact plan and
account. No broad REACH/IMPRESSIONS equivalence is introduced. Sharing=false
proves neither account eligibility, budget-mode support, strict objective
acceptance nor that normalization.


## Independent combined review corrections (2026-10-06)

The optional React workspace now wraps planning writes in the existing durable
request/record store. An actor's unacknowledged result blocks a different planning
intent, including a changed form, target, source revision or new request key.
Reload shows the original saved result for explicit acknowledgment. Original
receipts remain immutable; acknowledgments are separate records. Acknowledgment
has no advertising or grant side effect. Existing headless commands keep their
original contracts; integrations using this UI must allow `planningWrite` and
`acknowledgePlanningWrite` as well as the existing commands. See DRAFTS.md.

Promotion preserves a snapshot of the original document even for legacy drafts
without a prior write receipt. Identity/targeting/bid reconstruction is explicit,
resets consent and does not alter the source. Account currency/timezone mismatch
has explicit clear-and-reenter controls; no FX or timezone reinterpretation occurs.
Saved choice labels and IDs remain visible, including renamed, removed or
ambiguous catalog records. Unsupported currencies cannot use the decimal inputs.
UTC controls reject timezone-less/invalid instants. Completed-day selection handles
an entirely skipped local date as well as midnight DST gaps and overlaps.

Planning saves recheck actor/session and grant after awaited validation. The
planning envelope also checks an opaque workspace scope captured before pre-save
awaits, rejecting replacement logins even when their credentials are valid. SDK
session principals retain a hashed session binding for these checks; trusted host
principals remain compatible, and the embedding host still owns host-session
validity. Canceled/unmounted forms cannot acknowledge a late result or begin a
promotion after destination capture. Server-retained unresolved results survive
those UI lifetimes. Fresh local proof is in
`artifacts/combined-review-20261006/handoff.json`; this does not qualify any platform
cutover, live account, Meta daily mode or deployment.

## LinkedIn Connections source qualification (2026-10-07 candidate)

[The bounded Connections contract](design/LINKEDIN-CONNECTIONS.md) now supports
reporting with `r_ads+r_ads_reporting` and separately reviewed publishing with
`rw_ads+r_organization_admin+w_organization_social+r_organization_social` (reporting
only when requested). Trusted server app capability precedes new publishing OAuth;
actual granted scopes and exact member/account/approved Page roles follow consent.
This changes setup qualification, not campaign tuples or daily/budget denials.
Account reference/display alone never establishes Page rights. The associated
organization/campaign entity/post author equality is an SDK restriction.
Live app/account evidence and independent final-candidate review remain open.
