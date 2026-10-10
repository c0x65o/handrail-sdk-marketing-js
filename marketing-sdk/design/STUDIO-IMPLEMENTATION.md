# Studio implementation candidate

This candidate evolves canonical main from the retained `f82d2cc7` source snapshot;
the earlier Connections verdict does not qualify these changes. No publication.

Implementation decisions before coding: use the existing campaignDraft aggregate
with additive Studio state and immutable revision records. Legacy draft commands
must not erase Studio state. A stable draft creativeSetId owns version-2 media;
copies retain immutable blob references and record source lineage. Legacy campaign
assets, jobs and creativeSetId are not reparented. Trash is reversible local
visibility, distinct from archive; neither deletes history or performs provider work.
Permanent deletion stays unavailable: no exact host retention/hold/backup policy.

Planning is separate from image/video grants. Only synthetic execution is enabled
in this tranche. Public adapter request/response contracts retain structured schema,
provider identity and unknown usage without retry. Real text custody, billing and
persistent execution remain BLOCKED pending their separately reviewed host contract.
Current interactive creative setup confers no unattended authority.

New commands use the same Store transactions, authenticated session authority and
public Marketing client. No new scheduler, polling framework or private Handrail
runner dependency. Checks are local reproducible evidence, never provider approval;
tracking remains Not tested until an authenticated collector supplies actual evidence.

## Public delta and host prerequisites

Browser-safe core adds BusinessBrief, CampaignOption/CopyVariant, StudioDraft,
StudioAsset/CreativeOwner, DraftGenerationJob, PlanningAuthority/Request/Usage,
StudioReport and TrackingHandoff/Receipt. Commands extend the existing client:
`studio`, `saveBrief`, `saveCampaignOption`, `selectCampaignOption`,
`saveStudioMaterial`, `selectStudioMedia`, `listCampaigns`, `copyToDraft`,
`setCampaignLifecycle`, `reviewStudioDeletion`, `studioImportStatus`, `checkStudio`, `promoteStudio`,
`requestPlan`, `planningRequest`, `reconcilePlanning`, `applyPlanningOption`,
`generateDraftMedia`, `reconcileDraftMedia`. Existing commands and legacy asset/job
shapes remain exported. Legacy save/promote reject Studio records to prevent
silently dropping their selection/ownership state.

React exports `CampaignStudio`; MarketingWorkspace opens Campaigns by default.
One UI mount and createMarketingClient supply the library and all Studio steps.
The optional binary methods on MarketingClient preserve existing host clients.
The SDK `handleStudioMedia` owns bounded stream parsing, raster validation and
project-scoped byte reads. The existing Connections host example mounts this route
and shares its SessionAuthority automatically; there is no host-authored wizard.

Server adds CampaignStudio, PlanningPort/ResponsesPlanningAdapter, the common strict
schema and SDK prompt, DraftGenerationPort, createNativeDraftGeneration and the
binary handler. NativeGeneration is now generic with its legacy GenerationJob as
its default. The draft factory uses an explicit v2 job and billing contract; no
cast or dummy campaign ID enters a legacy GenerationPort. BoundGenerationBilling
adds harmless quote inspection and exact existing-reservation verification for v2.
The quote binds currency, unit ceiling, receipt and expiry; unknown jobs do not
release reservations. Host executors call dispatchPlanning/dispatchDraftMedia
explicitly after acquiring the existing Store execution lock. They are not UI
commands and install no scheduler. Running records survive crashes as dispatch
fences; explicit readback cannot submit a replacement.

Host prerequisites remain: current authenticated session and project membership;
SessionAuthority's coordinated revocation guard; durable Store and blob capacity;
existing Origin/CSRF protection and the **same shared 120 requests/minute limit**;
binary request support up to 10 MiB; optional existing executor, credential custody,
exact billing quote/reservation authority; branding/CSS and native return hooks.
Text planning is synthetic-only even if a transport is configured. No AI SDK or
Agent installation is required for the manual product. Real persistent execution,
actual provider eligibility, native UI and target-platform qualification stay BLOCKED.

## Verified provider contract sources (2026-10-07)

The adapter owns a common root-object schema, all fields required, nullable
optional destination and additionalProperties:false. It validates domain bounds
after receipt; model success does not grant access or approve claims.
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
and [xAI structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
document the Responses text.format boundary. No unsupported AI Assistant request
field or Agent outputType is cast into existence.

Background is false and store is false. [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)
has a separate retention choice; [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses)
and [deferred chat](https://docs.x.ai/developers/advanced-api-usage/deferred-chat-completions)
do not establish a universal retry/readback contract. A diagnostic request ID is
not assumed retrievable. Missing readback leaves an explicit unknown fence.

The input ceiling conservatively bounds UTF-8 bytes of prompt/schema/brief plus
wire overhead; it is not a reported token count. [OpenAI token counting](https://developers.openai.com/api/docs/guides/token-counting)
remains separate from observed usage. The output ceiling covers all generated
output tokens. Refusal, incomplete and invalid output retain usage and response
identity; unavailable costs stay null. [xAI cost tracking](https://docs.x.ai/developers/cost-tracking)
reports USD ticks at 1e10 per USD. Raw decimal strings and units are retained;
unsafe numeric values are unavailable, never rounded into invented zero.

## Deliberate remaining gates

Deletion review returns actual retained-reference counts and an explicit disabled
policy; it does not implement or pretend to implement erasure. A future exact host
policy must address holds, assets, audit, backups, derived reports and provider
history with current human deletion authority, immutable impact, expiry and
confirmation. Trash/restore and archive/recover already work independently.

Tracking is a typed handoff, not an installed collector. Reports retain their
actual safe input snapshot and digest. Technical checks, editorial claim review
and provider approval remain separate. Current configured conversion IDs cannot
change Not tested into ready. Promotion creates only a local campaign with new
campaign-owned asset aliases and unchanged retained blobs; existing exact launch
packets, human decisions and executor remain the sole provider-write path.


## Local verification and integration boundary

The independent consumer uses one `MarketingWorkspace` mount and one
`createMarketingClient`, with zero custom Studio screens and no Agent installed.
Its host supplies existing external-session authentication, the public command
router and `handleStudioMedia`, an existing executor lock, and Origin/CSRF plus the
unchanged shared 120/minute limiter. Synthetic planning and generation transports
are fixture arrangements, not production billing or credentials. Exact helper
files/line counts and final source-bound results are retained in
`artifacts/studio-3baf00fd/final/`.

This unpublished candidate is tested by the existing clean package-projection
harness, including normal preparation, public exports, browser bundles, strict
NodeNext/Bundler compilation, and public host-example compilation. It is **not** a
public HTTPS full-SHA installation receipt. That acceptance remains unverified
until separately authorized publication allows a matching Git dependency and lock.
No dependency policy was changed and no SDK dependency was installed from a local
file/tarball in a host project.

Reversible lifecycle, immutable retries, malformed/refused/incomplete planning,
changed actor/session/project/revision/account/assets and actual executor process
loss are exercised against disposable SQLite and socket-only PostgreSQL. Raster
imports decode actual bytes, reject animation/trailing payloads and retain rights
attestations. MP4 retention records decoded duration and remains blocked for ad
publishing. Original failed fixtures/browser attempts remain evidence; final
results do not erase them. Full aggregate checks exceeding five minutes are skipped
under the existing bounded-test rule, not represented as passed.

Manual browser acceptance includes invalid-input recovery, unsaved reload,
lost-save and lost-import response recovery, explicit copy/artwork selection,
archive/recover/trash/restore, conflict comparison/reapplication, Back/Cancel,
keyboard and 1440/390/320-width checks. Planning/media calls are synthetic; no ad
provider effect or conversion is sent. Hidden/idle refresh is checked using the
existing disposal/visible-refresh mechanism; no new polling framework exists.
The combined source still requires independent final-source/product review.

## Independent review corrections · 2026-10-07

Work request `457f6826-cb49-4554-8340-a8ef49532766` reviews the combined candidate,
not the historical Connections approval. Machine-readable findings, final source,
installed consumer, SQL/browser receipts and artifact custody are retained under
`artifacts/studio-review-1a8c3ad5/`; `receipt.json` is the final index.

The review repairs unsaved lifecycle/edit cancellation, cross-draft editor state,
readable capability/check/handoff presentation and retained handoff recovery. A
manual user gets a saved review summary with exact material/outcome and an honest
collector dependency. It is not a Tracking test receipt or launch approval.

Current host roles are checked independently of cached SDK membership. Media quote
reads and decoding happen outside local SQL/revocation locks. New planning/media
requests retain the original SessionInspection inside an internal record envelope;
current session/configuration, grant, draft and executor facts fence finalization.
Historical requests without that snapshot are not silently given current authority.
Late/stale output cannot become selectable material. Terminal planning results cannot
be overwritten by concurrent readback; each observed planning response remains
restricted immutable evidence, with unknown costs/reservations retained.

The command wire shapes and browser exports remain unchanged. The public-import
host composition example adds optional `draftBilling: DraftGenerationBilling`.
It composes `createNativeDraftGeneration` with the same CreativeConnections
`credentials` and `assertCredentialAccess` hooks and original-session guards.
An existing `BoundGenerationBilling` can supply `quote` and `authorizeDraft` through
that v2 adapter; it creates no grant, credential, scheduler or spending authority.
Absent v2 billing leaves generation unavailable. This source composition and native
OpenAI wire transport have synthetic evidence, not authorized live execution.

Real text planning remains blocked at `PlanningPort`/`PlanningAuthority`'s
fixture-only evidence contract and `ResponsesPlanningAdapter`'s synthetic callback.
There is no qualified text-specific custody/setup, quote/reservation settlement or
persistent permission binding. The fixture reference field in the UI is not real
AI onboarding. That contract and its SDK-owned selection UI are a concrete follow-on;
image/video billing or advertising grants cannot substitute for text authority.
