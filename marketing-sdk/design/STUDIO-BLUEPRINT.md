# Campaign Studio: implementation contract proposal

Design only, 2026-10-07. **All new surfaces in this document are unimplemented.**
This is the next SDK product tranche, not a replacement form or authorization for
generation, provider writes, a scheduler, publication or host implementation.
Normative parents: [PRODUCT](../PRODUCT.md), [acceptance](ACCEPTANCE.md), and the
[original vision](https://github.com/c0x65o/handrail/blob/08645a4f6edbf8e9efb35c4b84026edd78408c6b/docs/work-requests/marketing-sdk-proposal-v2/REQUIREMENTS.md).

## Source findings and boundary

`core/index.ts: Commands` has saveDraft/saveCampaign/promoteDraft, generate,
reconcileGeneration, storyboard, packet/decide/execute and results. It has no brief,
structured planning, media import, search/copy/archive/recover/delete command.
`Asset` and `GenerationJob` require campaignId; `GenerationGrant.kind` and
`server/ports.ts: GenerationPort` support image/video only. NativeGeneration rejects
parentAssetIds (`reference_edits_not_supported`). Existing saved drafts are not an
asset-ownership or text-model execution contract. Launch is a journey over existing
packet/prepare/decide/execute commands, not a new public `launch` method.

Handrail `owner-marketing/brief-generation.js` uses
`createCampaignBriefGenerator({ requestWork })`, strict JSON Schema/AJV and separate
normalization/audience-review validation. Its prompts are Handrail B2B specific;
copying them would incorrectly hard-code this SDK's product and market.
`project-ai-work.js: requestProjectAiWork` freezes input/schema, hashes requests,
retains provenance and validates results, but imports the canonical host DB,
work-request routing, queue admission and Codex runner. That private execution is
not a portable SDK dependency or a publicly available planning service.

Direct MCP source/provenance is retained in
`artifacts/shared-connections-review/{research-0,planning-source}.json`. The original
requirements file was read completely at Handrail `084fe07a…` with SHA-256
`d21f5b6e74d3dcd17dbd1114f474d670328dfdde9c4f232de536f6326196f520`.
The pinned GitHub fetch failed; equality to `08645a4…` is not newly proven.
The planning files were read at `f25b4b53…`; their content hashes match the preceding
discovery read. No other repository was edited or private execution invoked.

## SDK-owned journey

1. **Campaigns.** Search drafts/campaigns by name and brief text in the authorized
   project; filter Active/Archived, draft/campaign and local workflow status. Cursor
   paging (default 25, maximum 50), deterministic updatedAt/id ordering, labelled
   result count only when known. Each row shows name, saved revision/time, next step,
   provider intent and last observed provider state separately. Empty: “Start a
   brief”; no connections: “Save an idea” plus a Connections link. Opening an item
   restores the saved step and current dependencies. An archive is never a pause.
2. **Brief.** Ask what is offered, to whom, desired outcome, supporting evidence,
   destination, brand/tone and constraints. Save incomplete human notes without a
   connection, grant, Agent or model. Distinguish budget suggestions from authorized
   budgets. Display saved revision and unsaved edits; Save/close, Back and reload
   preserve the last acknowledged revision. A conflict offers compare/reapply or
   copy; it does not overwrite newer work.
3. **Campaign options.** Manual option creation always works. Optional “Suggest
   options” first shows exact text-model/cost authority and the input snapshot.
   Return 1–3 editable approaches: audience hypothesis, supported channel/media
   suggestion, message/offer, copy variants, destination and rationale/unknowns.
   Compare, edit, discard or select explicitly. Suggestions are drafts, never
   entitlement, targeting IDs, grants, approvals or spend permission. Result
   arrival does not overwrite a human edit or select an option automatically.
4. **Copy and media.** Choose supported destination format BEFORE generation or
   import. Edit copy with provider-specific length/field checks and see revision
   differences. Choose an existing authorized asset, bounded raster upload, or
   separately authorized image/video generation. Show real retained thumbnails,
   dimensions, rights and lineage; video requires retained bytes and playback.
   Storyboard is text planning, never video. Failed/unknown jobs retain their IDs
   and reservations with “Check outcome”; new requests cannot buy an implicit retry.
5. **Provider-fit preview and checks.** Show selected exact copy/media, account,
   identity, audience, destination and native format. Static preview is labelled
   an approximation; current capability evidence is a separate receipt. Missing
   connection offers setup and return to this saved draft. Failures identify the
   field and repair action; unavailable evidence is not zero or eligible. Editing
   makes dependent checks stale, retaining previous material and receipts.
6. **Tracking → Launch review.** Save the selected material revision, then hand off
   typed destination/outcome/tracking requirements. A configured pixel ID remains
   “Not tested”. Return exact authenticated evidence stages; then create/review a
   packet for the exact material/grant/budget/time. Preparation and activation keep
   distinct human decisions and the existing sole executor. Studio never launches
   while selecting an option, saving material, uploading or generating an asset.

At 1440 use brief/options/preview panels; at 390/320 use one ordered column and an
explicit step heading, not horizontally clipped cards. Labels wrap, keyboard order
matches reading order, errors link to fields, focus moves to the step/error heading,
and async statuses use a polite live region. Loading retains the last safe saved
content; permission/session changes clear sensitive data and offer reauthentication.
No blank unsupported screen. Back preserves edits with explicit discard confirmation;
secrets never enter draft autosave/history. Manual work does not wait for AI.

Use existing `visible`, sessionKey/client replacement and AbortSignal lifecycle.
No hidden/idle polling. Authorized return refreshes immediately; active jobs use
the existing bounded refresh mechanism and explicit reconcile after the cap.
Host-wide 120 requests/minute remains shared and must be measured after adoption.

## Public structured-planning proposal

Add to core commands and the SAME controller/client used by optional Agent:

| Proposed command | Input and durable result |
| --- | --- |
| saveBrief | draftId, expectedRevision, requestKey, bounded human fields → immutable BriefRevision and new draft revision |
| requestPlan | draftId, briefRevision, expectedDraftRevision, planningGrantId, quoteRef, requestKey → PlanningRequest; SDK chooses prompt/schema revisions |
| planningRequest | requestId → safe status, validated proposals, provenance and usage/unknown usage |
| reconcilePlanning | requestId → original-request readback only; no new submission |
| saveCampaignOption | draftId, expectedRevision, optionId/new, bounded edited content → immutable option revision |
| selectCampaignOption | draftId, expectedRevision, optionId, optionRevision → explicit selected revision; no grant or provider effect |

`BriefRevision` is immutable `{id, projectId, draftId, revision, parentRevision,
fields, digest, actorRef, createdAt}`. Bounded fields: name (200), offer (4000),
audience (4000), outcome (enum from maintained product purposes), destination
(validated HTTPS URL or absent), tone (1000), constraints (4000), evidence
(up to 10 references, 2000 characters each). No arbitrary fetching of supplied
URLs. Server canonicalizes once, rejects unknown properties and computes digest;
revision CAS and stable requestKey conflicts use existing Store principles.

SDK-owned `campaign-options-v1` JSON Schema has additionalProperties=false on every
object, 1–3 options with 1–3 copy variants, bounded strings and enum channel/format
values. Each option has title, audienceHypothesis, offer, rationale, unknowns,
headline/body/CTA suggestions, destination suggestion and supported-media preference.
The schema contains NO permission, credential, provider account ID, verified,
approval, executable budget or eligibility field. SDK validates schema and semantic
constraints again on receipt; escaped strings remain content, never HTML or model
instructions. Invalid output is retained as restricted failed evidence, not applied.
Human edits pass the same semantic checks and create new revisions with provenance.

Proposed server-only port, separate from image/video GenerationPort:

```ts
// Proposed names/types; not exported or implemented.
interface StructuredPlanningPort {
  readonly evidence: "fixture" | "model";
  submit(request: PlanningRequest, authority: PlanningExecutionAuthority,
    retainProviderId: (id: string) => Promise<void>,
    beforeWrite: () => Promise<void>): Promise<PlanningOutcome>;
  reconcile(request: PlanningRequest,
    authority: PlanningExecutionAuthority): Promise<PlanningOutcome>;
}
```

SDK owns prompts, schema, request identity, status controller, validation, UI and
selection. A host adapter supplies its existing approved model transport/custody,
billing and execution owner, not a provider-specific Studio wizard. No Agent is
required. Agent invokes the same commands and cannot approve access/spend or turn
untrusted text into instructions. No import of Handrail's canonical project runner,
new scheduler, autonomous retry queue, shell or browser execution surface.

`PlanningGrant` must independently authorize project, actor/execution policy,
text provider/model, purpose=campaign_planning, max input/output tokens, request and
cost ceilings, currency, expiry, revision, custodyRef and billingCapabilityRef.
Image/video grants or advertising budgets cannot satisfy it. A cost quote binds
model, policy and price revision, unit/currency/expiry and maximum total before
submission; unavailable quote/authority blocks AI only. Existing original-human-
session creative bindings confer no unattended authority. Text custody/setup and
any unattended execution policy require their own reviewed public contract before
real planning transport is enabled; do not weaken a guard to implement this port.
Persistent setup/campaign automation is BLOCKED pending a separately approved
owner grant in the existing host permission model and synthetic/host qualification.
Interactive text planning must inspect its own current text-specific session,
permission, model and cost authority; image/video credentials confer none of these.

`PlanningRequest` freezes brief/option revision, actor/session inspection, input
digest, SDK prompt/schema versions, grant/quote revision, model and stable request
identity. States: queued, running, unknown, succeeded, failed, cancelled. Persist
reservation/dispatch identity under short authority guard + Store CAS, release locks
before remote work, retain provider request ID before further awaits, recheck rights
before storing a usable result. Provenance includes provider/model/request ID,
input/output digests, validation version and observed token/cost usage. Missing
usage stays unknown; do not fabricate zero cost or free a reservation. Cancellation
before dispatch can stop work; after dispatch fences application and preserves
unknown effects until readback. New schema/brief/model/quote requires a new request
and exact authority; same key with different material conflicts.

## Draft media ownership and exact promotion

Introduce an additive version-2 owner envelope shared by Store media/job logic:
`CreativeOwner = {kind:"draft", draftId} | {kind:"campaign", campaignId}` plus
projectId. Keep existing public Asset/GenerationJob and historical rows unchanged.
New draft commands use version-2 public media/job types and a version-2 generation
port. Old GenerationPort remains campaign-only; NEVER pass a dummy campaignId or
silently widen a consumer's accepted type. Reuse existing custody/blob inspection,
reservation and dispatch code through an explicit adapter/version branch.

Proposed `importDraftRaster` uses authenticated bounded binary streaming to SDK-owned
routes; no base64 in ordinary commands and no arbitrary remote download. Initial
limit: JPEG/PNG/WebP, 10 MiB, decoded maximum 40 megapixels, single frame, valid
dimensions and media sniffing. Reject SVG, animation, archives, malformed/polyglot
payloads and decompression limits. Store real bytes plus SHA-256, detected MIME,
dimensions, upload actor/time, original digest and explicit rights declaration.
Sanitized raster derivatives have their own digests and parent links. User rights
attestation is not independently verified ownership; missing rights blocks selection.
Authenticated byte reads stay project-scoped. Cropping is an explicit derivative,
not NativeGeneration reference editing. No reference-image generation promise.

Promotion atomically checks expected draft/brief/option/media/grant revisions,
rights, provider fit and chosen material. Create new campaign-owned Asset metadata
references to the retained immutable blob, with draft asset ID/revision/digest and
job provenance; do not reparent jobs/assets or mutate historical campaign creativeSetId.
Create a new creative-set lineage for a new campaign and record its source draft
selection. Existing campaigns retain their lineage; changing selected material
creates a new material revision and invalidates dependent packets. Late draft job
completion cannot alter an already promoted campaign. An explicit later selection
is required. Copy creates a new local draft with source references, never copied
grants/approval/provider IDs/jobs/reservations or execution identities.

Provider fit preserves current gates: Meta bounded single-image Feed tuples and
daily execution denial; LinkedIn single-image STANDARD_UPDATE, exact scopes/Page,
daily-budget approval and UTC policy; Google Search text and its actual fields.
No X advertising, video-ad, PDF/document-ad or new daily Google promise. xAI video
can be retained/playable for Studio but cannot be selected for initial ad launch.
Supported code, configured provider, account entitlement and billing are independent.

## Lifecycle and Tracking contracts

Proposed `listCampaigns({query,kind,archived,cursor,limit})`, `copyToDraft`,
`archiveCampaignItem` and `recoverCampaignItem` use current authorization, exact
expected revisions and idempotency. Archive only hides local draft/stopped work;
enabled/unknown provider campaigns must be stopped/reconciled under separately
authorized operations before routine archive. Archive never pauses providers,
deletes unknown effects, frees reservations or discards original IDs/receipts.
Recover restores visibility only, not prior rights, approvals or provider objects.

Permanent deletion stays unavailable until an explicit host retention policy binds
record/blob/audit/hold/backup/derived-report treatment and an exact impact receipt.
Proposed reviewDeletion/decideDeletion require a current human admin with explicit
deletion permission, exact affected IDs/revisions/digests, expiry and cancellation
as default. Unknown operations, active delivery, references and holds prevent purge.
No invented retention duration, automatic archive purge or implicit provider delete.
Reversible copy/archive/recover do not depend on that later erasure-policy decision.

Proposed `TrackingHandoff` binds project, draft/campaign, materialRevision/digest,
destinationDigest, purpose/outcome and required account/conversion evidence.
`TrackingReceipt` returns testSessionId, bindingRevision, source identity, event
dedupe reference, occurred/received time, QA exclusion, consent basis and separate
websiteObserved/localReceived/providerAccepted/matched/attributed evidence states.
Each state is unknown/pending/verified/failed with source/time/expiry and safe reason.
A typed configured pixel/conversion binding is distinct from a verified test receipt.
Changed destination/outcome/material makes its use stale. Launch consumes exact
required stages; lack of a real collector receipt cannot produce a successful test.
Reuse existing site analytics/CRM and consent hooks; no second tracking database.

## Implementation order and future proof

| Gate | Next implementation and observable proof |
| --- | --- |
| L01 | Search/list and immutable revisions; copy/archive/recover with stale-write and cross-project tests; preserve IDs/unknown reservations. Permanent delete remains policy-gated |
| S01 | Manual brief/options/media selection first; then structured planner and version-2 draft media using real SQL, bounded transport fixtures, retained bytes/lineage and unknown-cost recovery; live output only under separate authorization |
| S02 | Supported-format selection before generation; real provider-fit negative cases and exact native fields, preview labels and current capability receipts |
| T01 | Typed handoff, actual destination interaction plus authenticated QA collector receipt; configured ID alone fails |
| A01 | Promotion and material changes stale packets; exact preparation/activation authority, unchanged budgets/IDs/reservations and no duplicate dispatch |
| I01 | Clean new public HTTPS full-SHA/lock consumer, normal prepare, manual Studio without Agent; public config only. Inventory complete host auth/custody/billing/HTTP/executor glue, no copied form/private runner |
| Q01 | Same SDK UI adopted in Preview later; full mounted-app request budget, native presentation/device/media/accessibility and dot's actual platform judgment |

Independent design judgment is recorded in [SHARED-CONNECTIONS-REVIEW](SHARED-CONNECTIONS-REVIEW.md).
These gates require implementation and proof; this document does not satisfy them.
