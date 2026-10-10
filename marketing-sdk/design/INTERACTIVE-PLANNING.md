# Interactive text planning contract

2026-10-07, saved before implementation. Extends STUDIO-BLUEPRINT and the final
Studio/Tracking reviews; no release, actual grant, provider call or unattended use.

The SDK owns connection/model choice, saved brief, exact request review, one human
decision, durable progress, validated suggestions and explicit selection. Manual
Studio remains available without Agent. Text permission is independent of saved
credentials, image/video/ad grants and setup consent. The host supplies its current
external SessionAuthority, existing text permission/custody and billing facts. No
host-built planning wizard, new identity store, scheduler or conversation ledger.

## Contract and acceptance mapping

| Requirement | Implementation contract | Required proof |
| --- | --- | --- |
| 1–2 Connections/authority | Public safe text catalogue with current connection/model and prerequisite explanations; host supplies private custody reference and purpose-specific permission. Current interactive human only; no fallback grants | Empty/missing/revoked/model/project/environment/session negatives; Agent absent |
| 3 exact review | Immutable logical request binds connection/config/credential/permission revisions, actor/session, environment, draft revision, brief, prompt/schema/body digest, token bound/basis, output/attempt bound and quoted ceiling/currency/expiry | Changed input/model/pricing/currency invalidates decision; byte count is displayed separately from trusted token bound |
| 4 native composition | Server-only factory with allowlisted OpenAI/xAI Responses endpoint, owned strict schema, bounded SSE/JSON parsing and timeout. Synthetic factory has permanent separate runtime identity | Browser/public exports; synthetic private credential, no real egress, fixture cannot be cast into native evidence |
| 5 durable execution | Existing Store records, transaction and executor lease. External quote work outside guards; host session then text-permission guard then short Store transition; physical dispatch rechecks and durable attempt fence | Slow quote/provider leaves unrelated work/revocation available; duplicate workers and crash fences |
| 6 settlement | Extend billing composition with exact atomic reservation and idempotent measured settlement; unknown costs stay held; conflicting settlement fails | Duplicate/conflicting reservation/settlement; refusal/invalid output may bill; missing usage never zero |
| 7 uncertain effects | Retain diagnostic request ID separately; retain response ID on response.created before output processing. No retries, fallback or automatic repair | Lost ack/timeout/missing identity remains reserved; new request key cannot escape unresolved draft exposure |
| 8 selection/lifecycle | Only SDK validation yields selectable suggestions. Preserve manual fields/history; changed draft/selection/trash prevents delayed apply | Repeated clicks, Back/Cancel/reload, stale draft, long labels, 1440/390/320 and keyboard |

Quote creation is harmless. Approval is a separate exact command; one quote admits
at most one physical attempt. Cancel before dispatch prevents submission; closing
the UI after admission does not cancel the provider or release spend. A successful
output can remain unsettled. New work is blocked while exposure is unresolved,
including failed/refused results with unknown usage. No persistent authority is
implemented. An executor may complete only the originally admitted interactive
operation while its exact original authority remains current.

Host token metering must conservatively cover the exact serialized body, including
schema, prompt, provider framing and reasoning/output allowance for that model.
The SDK checks its finite bound and binds its basis/revision; UTF-8 length alone is
not asserted to be a token count. No static prices or model entitlement are invented.
Measured monetary settlement requires the existing billing owner's factual final
cost receipt, exact request/attempt/quote scope and currency, not telemetry or an
estimate. Unknown spend retains the full ceiling.

## Provider research (official docs, inspected 2026-10-07)

- https://developers.openai.com/api/docs/guides/structured-outputs — strict schema,
  required properties, refusal handling; SDK semantic validation remains necessary.
- https://developers.openai.com/api/docs/guides/streaming-responses — lifecycle
  events allow identity retention before completed output. Disconnection is uncertain.
- https://developers.openai.com/api/docs/guides/your-data — store:false is not a
  promise of zero provider retention; background has separate retention behavior.
- https://docs.x.ai/developers/model-capabilities/text/structured-outputs — structured
  outputs; supported schema/model behavior must be current host facts.
- https://docs.x.ai/developers/rest-api-reference/inference/responses — text format,
  store flag, response identity, token usage and cost_in_usd_ticks fields.

Use foreground, store:false, stream:true with no tools. There is no promised
retrieval after a lost stream and no retrieval call in this slice. Response IDs
are evidence, not proof of retrievability. Missing identity can occur before parsing
or after a crash; diagnostic headers are not response IDs.

## Qualification and release boundary

Use disposable SQLite and isolated PostgreSQL, real external host SQL sessions,
local synthetic provider/billing boundaries, public consumer exports and actual
SDK UI. Qualify loopback isolation before browser work. Retain failed attempts and
old evidence. Focus affected checks; skip unchanged >5-minute aggregates. Measure
one combined Studio → Tracking → Results workload under the shared 120/min budget;
do not infer all-mounted Preview/native behavior. Actual host/provider authority,
spend, persistent use, pinned public Git installation, native adoption, whole-product
acceptance and dot review remain independent gates. Publication remains stopped.

## Implemented candidate and host integration

`core/text-planning.ts` adds safe connection, exact review, receipt and measured
settlement contracts. `reviewTextPlan`, `approveTextPlan`, `cancelTextPlan` and
`textPlanningConnections` use the existing Studio command/controller/client.
`requestPlan` and `ResponsesPlanningAdapter` remain fixture-only and are never
promoted to native authority. Native requests use an opaque factory capability,
permanent synthetic/provider evidence and `PlanningRequest.textReceipt`.

`CreativeConnections({purpose:'text'})` reuses private secure entry, encrypted
custody, original human session and policy/revision checks, with a separate record
namespace and `/api/projects/:project/text-creative/:provider` route. Media grants
are rejected. `createTextPlanningAccess` requires a separate existing host
text-purpose permission; setup consent alone supplies none. Its host guard must
serialize every text-permission/configuration/credential writer, after the existing
SessionAuthority guard and before the SDK transaction. Default media paths retain
their original keys/namespace and behavior.

`createNativeTextPlanning` fixes the allowlisted provider endpoints and native fetch.
`createSyntheticTextPlanning` permits only the explicitly labelled synthetic
boundary used in qualification; a cast, copied object or browser command cannot
change the runtime factory identity. Credentials are read from the existing private
custody after claim and rechecked at physical dispatch. No secret enters public
review/receipt data. The foreground SSE path awaits durable identity retention
before processing subsequent output; non-SSE identity is available only after the
bounded JSON parse. Total response is capped at 1 MiB, output text at 256 KiB,
request at 256 KiB, and the default operation timeout at 60 seconds (max 120).
No retrieval, retry, fallback, tool, background conversation or repair call exists.

The existing executor invokes `server.studio.dispatchPlanning(project,id,signal)`
once for an accepted operation. The host owns this existing executor, not a new
SDK scheduler. Request state and the physical attempt fence are committed before
HTTP. A crash in the gap remains uncertain. Quote/metering and measured-cost
resolution run outside SQL/session locks; physical fetch starts under the short
current-authority guard, and its network promise is awaited after guard release.
Current quote/configuration/session and exact draft are checked again before a
usable result. Billing evidence can be retained after authority loss without
making output selectable. Dismissal does not authorize a new attempt.

`BoundTextPlanningBilling` extends existing planningReservation records. Quote
operation ID, request/connection digest, project/environment/model, pricing revision,
currency, finite token/output/attempt limits and expiry are immutable. The host's
LOCAL inspect/admit/settle hooks participate in the same Store transaction and
rollback; a remote ledger requires a separately qualified atomic composition and
cannot use network calls under this contract. Atomic duplicate reservations and
settlements return the same result; changed settlement content is rejected.
`measure` must return a factual charge receipt matching measured usage, not an
estimate derived from incomplete token/pricing details. OpenAI aggregate token
usage alone does not establish an exact bill. Without a measured receipt the
whole ceiling remains reserved, including successful, refused or invalid output.
An unresolved operation blocks new request keys for that draft. Intentional
regeneration after settled exposure requires another visible quote/decision.

The SDK Connections screen exposes harmless text setup inspection and its private
setup links. Studio shows labelled choices, saved brief/prompt and an optional full
request view, bound/byte distinction, formatted ceiling, expiry and separate cost
status. It never requires ordinary users to paste authority IDs or JSON. Validated
options remain suggestions; explicit retain/edit/select commands keep their
provenance. Manual fields, media, checks and Tracking handoff remain the reviewed
Studio flow. Readback is explicit and uses existing bounded visible lifecycle;
no new hidden polling is introduced. A running request checked after interruption
is shown as unknown; a still-authorized original response can later finish.

Public composition is demonstrated in `examples/text-planning-server.ts`. The
host mounts SDK private routes before its ordinary JSON command route, authenticates
with its existing session adapter, supplies narrow factual permission/billing hooks,
and uses its existing executor. There is no Agent dependency or copied Studio UI.

## Known limits and independent review gate

This is an unpublished source candidate, not a real-provider or production-host
acceptance. The next independent review must inspect text setup/permission separation,
lock ordering and every billing writer's atomic participation, physical dispatch
and crash fences, streamed identity/usage handling, projection of host metadata,
selection idempotency and the final installed SDK UI/evidence. In particular, no
remote-ledger atomicity, actual model entitlement, final provider invoices or
persistent execution is established by local synthetic hooks.

The browser setup uses a synthetic existing text-purpose permission and billing
owner, separate SQL host sessions and SDK private secure entry. It does not mint an
actual permission. The combined driver corrects the model's synthetic destination
through the SDK editor before Tracking; an unrelated destination correctly fails
source matching. Native select labels may truncate, while the full reviewed label
wraps below. The narrow page remains vertically long; no native-device or full
accessibility verdict is claimed. Final check counts, failures and source/runtime
hashes are recorded in `artifacts/planning-5d996985/`.

## Independent review — 2026-10-07

`artifacts/planning-review-5a6d17fe/receipt.json` binds the reviewed source, fixes,
actual checks, failures and remaining gates. The stream requires an initial durable
response identity, ordered OpenAI sequence numbers (ordered xAI numbers when
provided), matching lifecycle/response identities and one terminal status. Error,
misordered, oversized or partial streams expose no options. Reported token counts
above the allowance cannot turn into missing usage: safe integer counts retain
their value, and malformed/unsafe counts prevent selection. Reader/credential
resolution is bounded; local cancellation does not cancel the provider or prove a
zero charge. Diagnostic HTTP IDs remain separate. The billing owner's bounded
original observation and payload digest are retained before settlement, including
a rejected over-ceiling fact; this is audit evidence, not another financial ledger.

The private authority snapshot also binds the encrypted custody envelope digest;
replacing a value at the same reference invalidates the old review even when host
revision metadata is unchanged. No credential value or envelope enters the browser.

Connection lookups cancel stale reads and prevent duplicate checks. Explicit
original-outcome readback refreshes the saved progress displayed in Studio.

SQLite remains a synthetic regression harness. The native provider factory now
rejects SQLite because it has no executor lease; no skipped SQLite assertion is
claimed as multiple-executor proof. Real independent PostgreSQL connections qualify
lease exclusion, takeover fencing and process death before send, after possible
send, after response ID retention, before final commit and after final commit.

Host prerequisites are concrete: current external session/RBAC inspections and
coordinated writers; encrypted custody and current model entitlement; a distinct
text-purpose permission guard; factual request/model token bounds and pricing;
LOCAL billing admission/settlement in the SDK Store transaction; and its existing
leased executor. A remote ledger cannot implement these local hooks with network
callbacks. Its atomic integration, uncertain-effect/accounting recovery, canonical
model identification, real price/usage rounding and final invoices remain
unimplemented or unqualified in this repository. No new ledger, retry executor,
credential policy or persistent grant is supplied by the SDK example.

The consumer uses the SDK's private setup, explicit permission/model selection,
brief/review/dispatch/options/media/checks and actual loopback first-party Tracking.
It inserts no campaign or metric rows to turn the draft into a reporting success.
For this no-advertising-grant, unpromoted draft, Results is explicitly unavailable
and links back to Studio/Tracking. Populated campaign reporting remains separately
qualified source/fixture behavior; a single promoted-campaign-to-populated-Results
product journey is still an open gate. QA tests never become production outcomes.

Next product gate: qualify the existing target host's public session/permission/
model/pricing/atomic-billing/executor composition and the SDK-owned promotion-to-
Results path, using synthetic boundaries first. Actual public Git/full-SHA install,
Preview/native/device/accessibility and dot review remain separate, and publication
remains stopped. Manual Studio, synthetic native-adapter qualification, actual
provider/host readiness, persistent use and whole Marketing have separate verdicts.
