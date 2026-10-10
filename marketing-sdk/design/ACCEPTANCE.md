# Review gates, source evidence and remaining dependencies

Independent native prerequisite review · 2026-10-08: [findings and limits](NATIVE-PREFLIGHT.md#independent-review--2026-10-08), with final machine-readable custody and qualification in `artifacts/native-preflight-review-6c1025bc/receipt.json`. This review repairs observation-age, captured-custody and asynchronous readback guards and corrects predecessor request-count labels. It does not clear actual provider/host, public Git installation, native/device/accessibility/dot, migrations or publication gates. P1–P10 and all dated evidence below remain requirements and historical records.

**Current shared review:** [Shared Connections and next Studio](SHARED-CONNECTIONS-REVIEW.md), work request `f9f74c36-9e16-468f-84cd-8c95bc9c8068`. Its exact bounded verdict supersedes earlier candidate gaps below; dated receipts remain historical. [Studio blueprint](STUDIO-BLUEPRINT.md) is the retained design baseline. The subsequent [Studio implementation candidate](STUDIO-IMPLEMENTATION.md) implements local/synthetic portions of L01/S01/S02/T01/A01/I01; see the candidate evidence below. It does not inherit the earlier review verdict.

**Earlier implementation review:** [Connections product and security review](CONNECTIONS-REVIEW.md)
under work request `49a95031-e3a1-4bc4-a321-1b3ec00048fd`. The original matrices and
dated predecessor receipts below remain unchanged evidence. Full Connections is
blocked: LinkedIn publishing discovery and native handoff need the exact contracts
identified there. The manual creative addition below addresses that review’s
secure configuration gap as an uncommitted candidate requiring new independent review. Synthetic shared server/web success
does not clear live-provider, Preview adoption, native QA or dot's review gates.
New check receipts, hashes and all failed attempts are retained separately under
`artifacts/connections-review/`; both historical external-navigation failures remain
failed and are never converted into run-wide isolation success.

Appendix to [PRODUCT.md](../PRODUCT.md). Acceptance cases below retain the required
proof contract. The dated candidate section records current source/fixture checks
and remaining blockers; predecessor documentation receipts stay historical. A design,
wireframe or placeholder is not a working journey. No configured project checks
were supplied. Documentation verification is recorded separately below.

## Independent review verdict 2026-10-06

The visible product still fails the complete reusable Marketing requirement:
Preview exposes a four-field draft editor, and no reusable native Flutter product
has been verified. A passed document review does not deliver that product.

Blocking defects in the submitted design, corrected within these six documents:

1. **Approval came too late for OAuth discovery.** The old Discover step could
   create persistent provider access before C4. The corrected flow records an exact
   human provider-access decision before any new OAuth grant, then a separate
   selected project/account binding decision. C13 tests ordering and refusal.
2. **Pre-grant verification was circular.** Existing custody and verification require
   Grant. The contract now defines internal connection-scoped custody/native reads,
   account-linked identity selection and atomic real-Grant binding without fake
   grants or weakening existing authority. C14 tests the complete transition.
3. **Native reuse was a vague future dependency.** N01 now gates the platform choice
   with concrete SDK-native versus hosted-web options, minimal mounts and actual
   session/handoff/accessibility qualification. React alone cannot clear it.
4. **Recovery actions lacked complete public mapping and session fencing.** Added
   reassignment/local revocation commands, exact UI action mapping and host-session
   validity before/after awaits. Same user in another session is not the old handoff.
5. **Unnecessary future blockers remained.** Removed the historical metric question
   in favor of the owner's explicit CTR/impressions/conversions. Permanent-erasure
   policy gates deletion only; reversible archive/recover and Connections can proceed.

**Disposition:** corrected documentation is sufficient to begin a separately
authorized bounded shared server/web Connections implementation. It includes all
manual requirements/discovery/approval/account-and-identity choice/verification/
recovery/configuration branches, creative-provider setup status and optional Agent
capability presentation. It is not authorization in this docs-only run to implement
or exercise provider effects. Exact provider intent bundles, durable CAS behavior
and callbacks must be implemented/qualified together, not deferred behind host
provider-specific glue. An unqualified provider remains visibly unavailable for its
affected action, not a passed happy path. Native completeness remains gated by N01.

The P1–P10 matrix retains original W1/C1/S1/A1/P1/T1/R1/E1 tasks as observable
journeys. Provider/media truth, tracking stages, recruitment/submissions semantics,
exact launch authority and deployed native QA/dot review remain required. The
Connections blueprint has concrete hierarchy, next actions, narrow-width layouts,
focus/keyboard behavior and empty/error/retry paths; these are reviewable design
instructions, not rendered visual or usability test results.

## Evidence register and limits

| Evidence | Source and finding | Classification |
| --- | --- | --- |
| Current SDK | Runtime baseline `fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, package 0.1.7; review started with exactly six owned dirty Markdown files, no runtime changes | Direct local source inspection; frozen prior baseline, no product acceptance |
| Active scope | `handrail_current_context`: Marketing SDK; work request `3b4e563a-1b92-493b-a5d7-b7f488556d77`; no linked projects or QA campaigns returned | Successful scoped MCP read; no DB/queue updates |
| Independent review scope | `handrail_current_context`: Marketing SDK, review `0a4a0b2c-510c-4e8a-be34-cd83566b7294`; `get_work_request` confirms design predecessor done | Successful scoped read; same authentication snapshot; no state mutation |
| Original product | Authorized `read_source_files(source: handrail)` returned original REQUIREMENTS, proposal.document.json and implementation QA at `1a1fe5a833d29d2a8e868f35ddb93bb158467e68` | Direct cross-project source read through authorized tool. Historical `08645a4…` byte equivalence unverified because source tool has no revision selector; original anchors supplied by owner retained |
| Review original-source provenance | Parent/root independently read REQUIREMENTS and implementation QA at pinned `08645a4f6edbf8e9efb35c4b84026edd78408c6b`, as stated in this review request. This worker's two pinned GitHub reads returned 404; scoped `read_source_code` reread both complete 90-line files at `1a1fe5a…`, with the same newer content digests below | Distinguish supplied exact-pin evidence from this worker's direct newer reads; no historical byte comparison performed or claimed. Tool limitation is not a product/design blocker |
| Live Preview | Work request: server 0.1.30 / `a9d31a1a829c88e9e4c6e0d954a32365c25effb7`, `src/marketing.ts` uses unconnected server and permits only workspace/saveDraft; web `web/src/marketing-drafts.tsx` is custom form; SDK pin 0.1.4 / `d271cea3e8fe216f56300f23b07df21e778f92c8` | Supplied source-verified evidence at 21:26 UTC, not freshly inspected/deployed by this worker |
| Flutter Preview | Supplied `cb36cac1140a24de0aad7eacf68e78dd004dac61`: dormant connection/results UI with same blocked backend | Supplied evidence; no Flutter source edit, build or native QA |
| Agent SDK | Supplied frozen Agent 0.2.15; local public AgentPort and existing parity documents inspected | No Agent checkout/SHA source inspection established. Qualified pre-grant/Vault/takeover API compatibility remains a dependency; manual journey does not wait for Agent installation |
| Prior tests/reviews | [READINESS](../READINESS.md), [PARITY_ROADMAP](../PARITY_ROADMAP.md), [CAPABILITIES](../CAPABILITIES.md), [PARITY_REVIEW.json](../PARITY_REVIEW.json), [PROVIDER_REVIEW.json](../PROVIDER_REVIEW.json) | Historical engineering evidence retained unchanged; none proves current Preview product acceptance |

MCP reported content SHA-256 at the returned Handrail revision:

- `docs/work-requests/marketing-sdk-proposal-v2/REQUIREMENTS.md`:
  `d21f5b6e74d3dcd17dbd1114f474d670328dfdde9c4f232de536f6326196f520`
- `docs/work-requests/marketing-sdk-proposal-v2/proposal.document.json`:
  `1d36125482211d0e8058dca565e5666d9d3a9baec1ca0e4e3901c73b2a9ec299`
- `docs/work-requests/marketing-sdk-implementation/QA.md`:
  `172278e7b3710c06c7c644848485215f91c611f5a9cad77a6798d08fc394ee4f`

These are provenance from the source reader, not newly published evidence files.
No original evidence was overwritten. No AGENTS.md or relevant `.agents/skills`
was found in this checkout or checked ancestor locations. No separate global skill
was needed for repository product/design documentation.

### Focused source anchors

All local paths below refer to inspected frozen Marketing 0.1.7 source. Symbol names
are stable reading anchors; line locations are given for the principal gaps.

| Anchor | What it establishes, and what it does not |
| --- | --- |
| [react/index.tsx](../react/index.tsx), Connections around line 513 / `data.grants.map` | UI begins from grants; no catalogue-based zero-grant start |
| [core/index.ts](../core/index.ts), `Commands.setup` around line 368; [service.ts](../server/service.ts), `setup`/`resumeSetup` around lines 300–410 | Existing grant requirement and account verification; not new human persistent-access provisioning |
| [agent.ts](../server/agent.ts), `HostAgent.inspect`, `begin`, `complete`, `use` | Exact provider OAuth endpoints/scopes, grant-bound state, cipher custody and callback checks; not pre-grant discovery/resume completeness |
| [providers.ts](../server/providers.ts), `VaultPort`, `NativeProvider.verify` around line 310; [google.ts](../server/google.ts), `listAccounts`/`verify` | Server-only access and independent native verification; Google read result doesn't prove exact-plan write access; no public discovery orchestration |
| [ports.ts](../server/ports.ts), `AgentPort`, `ProviderPort`, `GenerationPort` | Host execution and credential/runtime boundary, before-write callbacks; no auto-scheduler |
| [capabilities.ts](../core/capabilities.ts), `CAPABILITY_MATRIX`, `capabilityKey`; [server/capabilities.ts](../server/capabilities.ts) | Bounded material tuples and evidence gates; enums/IDs are not live qualification |
| [generation.ts](../server/generation.ts), `NativeGeneration`, `inspectMedia`; [billing.ts](../server/billing.ts) | Image/video transport, retained bytes and separate billing path; fixtures cannot prove generated output |
| [service.ts](../server/service.ts), `saveDraft`, `promoteDraft`, `results`; [DRAFTS](../DRAFTS.md) | Real local planning/edit/promotion, source receipts/coverage; no full lifecycle or site firing proof |
| [reference/host.ts](../reference/host.ts), `runtime` around line 415 | Existing key/app/generation configuration and sole executor; not a consumer requirement to copy this host |
| [tests/service.test.ts](../tests/service.test.ts), [provider-review.test.ts](../tests/provider-review.test.ts), [sessions.test.ts](../tests/sessions.test.ts), [consumer.ts.txt](../tests/consumer.ts.txt) | Existing fixture/security/public-entry-point patterns available for focused additions; not proof of the new design |

## Required proof cases

Each case must record source/package/host SHA, environment, target device/viewport,
initial state, authenticated actor/role, steps, expected and observed results,
redacted artifact references, evidence class and verdict (`passed`, `failed`,
`unverified` with exact dependency). Never collapse an unavailable integration into
a passing disabled-button check. Retain failed receipts alongside repaired reruns.

| ID | Required observation | Verification boundary |
| --- | --- | --- |
| C01 | New project, zero advertising/generation grants: catalogue includes Meta/Google/LinkedIn separately from OpenAI/xAI, meaningful start actions and useful unconfigured branch | Public UI in clean consumer and exact deployed target; database starts empty through normal authorized provisioning, no seeded provider grants |
| C02 | Manual setup completes requirements, prior approval for any new OAuth discovery grant, account/identity selection, exact project-binding review and verification without Agent SDK installed | Actual reusable UI; narrow provider boundary fixtures for package checks; separately authorized real consent/account read for live proof |
| C03 | Account discovery authenticated and project/user/provider scoped, paginated/partial-aware; one/many/none/duplicate-label choices; invented/stale account refs rejected | Real service/SQL state + narrow HTTP provider fixtures; native permitted-account discovery later. Test cross-project denial and membership revoked while awaiting each page |
| C04 | Missing/bad OAuth app, callback and broker configuration have precise admin next steps; no fake connected state; read-only viewer gets safe status and permission explanation | Negative source/service/UI cases; real target misconfiguration exercises only in approved QA environment |
| C05 | Account verification and action/material qualification independent; Google read-only cannot write; Meta daily blocked; video unavailable; supported-but-not-qualified explained | Provider-specific positive/negative fixtures and visible exact readiness. Live proof requires separately authorized exact account evidence |
| C06 | Secure provider-origin handoff, challenge, declined consent, expiry, popup fallback and native return; secrets absent from chat/UI/state/logs | Redacted native security inspection, protected browser flow and server boundary tests; no copying credentials into artifacts |
| C07 | Double clicks, Back, cancel, close/reload, duplicate callback, lost ack and process restart use same operation; consumed code not replayed; no duplicate grant | Existing SQL runner persistence/CAS/idempotency tests, crash/recovery and deployed restart proof |
| C08 | Expired membership, disabled user, revocation/config change before and after awaited discovery/exchange/refresh/verification deny late data/new authority | Deterministic boundary delays with actual repository persistence and fresh checks; repeated native negative cases |
| C09 | Two users/tabs, changed revisions, explicit reassignment, multiple accounts and project switch preserve scope; late responses cannot repaint old account | Service races and UI keyboard/touch workflow; screenshot plus state evidence |
| C10 | Optional Agent shares checkpoint, names current actor, stops for human and returns safely to manual path; absent/unqualified runtime shows reason | Exact qualified Agent version/API evidence needed; manual acceptance cannot stand in for Agent-enabled acceptance |
| C11 | Advertising and creative connection access approvals are separate; key binding without billing/quote is not paid-generation readiness | Secure configuration/authority tests and real UI; no paid call to prove a card |
| C12 | Same-key replay/conflicting payload, cancellation during effect and unknown outcome cannot be bypassed with new keys or reassignment | Durable repository tests plus lost-response native recovery, restricted audit and no duplicate effect |
| C13 | New OAuth authorization blocked before exact human approval even for discovery with no Grant; scope/offline/config changes invalidate decision; existing session reuse is limited to its actual scope; cancel explains retained provider access | Instrument provider boundary: no authorization URL/exchange before decision, no blanket bundle/default perpetual access, Agent decision denied. Exact scopes/persistence shown in UI; real grant requires separate action-time authorization |
| C14 | Grant-free native account/identity reads lead to one real Grant only after both decisions and fresh verification; Page/org/manager mismatch fails; existing grant checks unchanged | Existing real SQL runners + narrow HTTP fixtures; CAS/unique effect tests, no SQL seed or fake Grant; independent consumer uses SDK-owned pickers |
| C15 | Logout, replaced session, provider identity change and callback from another session cannot expose accounts or commit authority; explicit reassignment/local revocation stop stale work | Before/after-await tests with real persisted session/authority changes; native system-browser return and safe reauthentication later |
| L01 | Edit/copy/archive/recover/delete, permissions and conflicts; explicit exact human delete approval; active/unknown campaign constraints; no provider deletion | Later lifecycle tranche source/tests and target UI. Erasure/retention policy gates permanent deletion only; reversible archive/recover needs no purge policy |
| S01 | Studio brief/variants/material selection/rights; failed/unknown job recovery; image and playable MP4 provenance with separate generation approval | Fixture package checks plus actual retained generated output only when separately authorized; storyboard never counts |
| S02 | Provider/media/audience controls show exact supported tuples and account-qualified evidence; unsupported choices never silently widen | Source/focused provider tests plus target UI; qualified reads for live claims |
| T01 | Bind/install existing site tracking and complete an actual test interaction; timeout/consent/wrong-event diagnostics work | Destination + real authenticated collector receipt; an entered pixel/conversion ID is insufficient |
| T02 | Local receipt, outbox, provider acceptance, matching and attribution shown independently | Real evidence at each claimed stage; unavailable provider transmission remains unverified |
| T03 | QA events excluded; consent/dedupe and historical attribution preserved; repeat submissions vs people and recruitment vs acquisition reproducible | Existing repository DB pattern; minimal event-specific source fixtures and authorized collector QA |
| T04 | LinkedIn app product approval cannot create sending scope or readiness; exact conversion/account rules and future sending transport independently qualified | Future authorized integration; no event transmission or grant change in this milestone |
| A01 | Exact preparation/activation approval expires or becomes stale after any bound material/scope change; unknown effects reconcile and single executor owns dispatch | Existing + added source tests; separately authorized native provider effects. Native software QA is not permission to advertise |
| R01 | Results show CTR, impressions and conversions with source/window/currency/coverage/freshness; null vs zero, provider vs first-party, submission/person/recruitment distinctions; transcript denial | Source/focused tests + exact target data/collector proof; fixtures labelled synthetic; no historical ambiguous-metric question |
| I01 | Independent new consumer uses only public imports/config and reusable UI, manual start with no grants and no Agent install; actual host glue inventoried | Clean public full-SHA HTTPS Git install, matching lock, normal build/typecheck with public declarations; report all glue/helper files and lines, no invented numeric target |
| N01 | Compare viable native Flutter SDK presentation and SDK-hosted web product on actual Preview architecture; identify public mount/session/navigation contract and SDK-owned complete screens | Bounded platform qualification per [PRODUCT](../PRODUCT.md#native-flutter-reuse-qualification); inspect intended host, retain real device handoff/back/logout/accessibility findings, no silent WebView selection or unsupported widget promise. Architecture gate precedes native implementation/adoption acceptance |
| Q01 | Actual Preview later adopts same public UI instead of another custom form; exact deployed native desktop/mobile path personally reviewed by dot | Native QA campaign, exact host/server/SDK identities, findings fixed/rerun, screenshots/video and dot verdict before Ready for Clinton |

## Review and implementation gates

1. **This design review:** independently trace P1–P10 to original requirements and
   cases; replay empty → account selection → human takeover → interrupted resume →
   verification and missing-config branches at desktop/narrow widths from the design.
   Review contracts, real host dependencies and races. Record unresolved critiques.
   Corrected review verdict is recorded above. This is document review, not native
   UI QA; implementation occurs only in its authorized follow-on scope.
2. **Authorized Connections implementation:** review proposed file boundary; keep
   0.1.7/Agent 0.2.15 evidence as predecessor, not a rewritten success story. Implement
   public pre-grant path plus focused tests, safe manual flow, optional Agent capability
   checks and configuration diagnostics together. No isolated styling-only release.
   Compilation/public exports/browser-server separation, source/security review and
   applicable DB/consumer/browser checks must pass after final source change.
3. **Independent new consumer:** use committed public HTTPS full SHA and lockfile,
   normal preparation/build, fresh consumer with existing identity/custody infrastructure.
   Record exact host glue files/lines including transitive helpers and any platform
   adapter. Distinguish existing infrastructure reused from newly written domain glue.
   Fail reuse review if provider-specific screens, private module copies, internal
   imports, SQL-seeded grants or duplicated setup logic are required. Package tests
   support this gate; a local projected package alone does not prove public installation.
4. **Separately authorized Preview adoption:** replace the current custom form via
   the public surface and required backend commands, with exact source/pin evidence.
   A pin upgrade alone does not remove the backend allowlist/absent configuration.
   Preview/Handrail/ERP/Agent sources are outside this work request; owners coordinate
   their own integration changes and retain historical data/rollback evidence.
   N01 must first qualify the native platform integration choice; a shared web
   Connections pass does not prove reusable Flutter UI or authorize bespoke screens.
5. **Native target QA:** deploy only through separately authorized owning workflow;
   no deploy target exists for this SDK project. Start a native software QA campaign
   against the exact deployed host and SDK revision from no grants. Cover manual,
   optional Agent, negative/recovery paths, unavailable versus disabled capabilities,
   desktop and intended mobile platform, keyboard/focus/screen reader/text scaling.
   Test 1440, 390, 320 CSS-pixel layouts and actual native handoff/return where used;
   viewport screenshots alone do not qualify a Flutter or other native application.
6. **Product review:** dot personally uses the actual target-platform experience,
   reviews fixed/rerun native findings and remaining dependencies before Ready for
   Clinton. Full product acceptance additionally requires lifecycle, studio, tracking,
   exact launch and Results proof. A Connections pass alone closes only its tranche.

Native software QA is not a paid advertising campaign. Account enrollment,
persistent live grants, consent, provider mutations, paid media generation, ad
preparation/activation/spend and deployment retain separate exact authorization.
Fixture takeover or synthetic results cannot substitute for real integration proof.
A required case lacking authorization/configuration is unverified with its precise
dependency; do not manufacture a pass or trigger live effects to clear the table.

Future persistence checks must use existing repository DB runners and actual SQL
adapters/transactions, narrow external HTTP fakes, minimal fixtures, one test worker,
sequential expensive runs. No new fake database layer, shared DB reset or live
migration. Native scaffold work later must apply the attached platform KB: iOS
export compliance consistent with actual cryptography, Android Internet permission,
and biometric descriptions/permissions only when used. This doc milestone scaffolds
no app and changes no authentication policy. Snapshot `08346f8bc724` remains intent:
no password minimum/complexity or MFA requirement; authentication rate limit enabled
at 10/60 seconds; IP/account lockouts disabled. Provider MFA challenges are independent.

## Dependencies and deferred product decisions

No missing owner choice blocks a reviewable Connections design. Routine reversible
choices are resolved in [the interaction rationale](CONNECTIONS.md#resolved-choices-and-rationale).
Do not ask the owner to fix a source-tool revision limitation or invent platform APIs.

| Remaining dependency / decision | Who resolves it and when | Effect if unresolved |
| --- | --- | --- |
| Pre-grant discovery and consent implementation | SDK implementation/reviewer qualify each provider's authenticated discovery, exact scope bundle, pagination and real callback integration | Zero-grant journey cannot be advertised as working |
| Host OAuth/broker/configuration and project permission mapping | Intended consumer owner supplies protected app bindings, canonical URLs, existing session/store/executor, access policy and authorized QA identities | Visible setup dependency; no fake ready. No secret collection in this workflow |
| Persistent connection duration / authorized grant-makers | Consumer owner maps existing policy; where absent, explicit policy decision before real grant implementation/use | Do not invent perpetual access or silently grant every editor persistent authority |
| Agent runtime compatibility | Agent owner provides exact 0.2.15 SHA/public API and qualified takeover/Vault capability evidence; later version change separately reviewed | Agent-assisted path unverified; manual flow still implementable without Agent SDK |
| Native reusable UI packaging | Bounded target-platform qualification owner evaluates the specific options and public mounts in PRODUCT/N01 using actual Preview architecture | Shared server/web implementation can proceed; native completeness/adoption cannot pass before platform/session/handoff/accessibility qualification |
| Provider live/account qualifications | Provider/app administrators under explicit authorization; exact account/material readback, billing and permissions | Catalogue/support source fact only; no live readiness or spend |
| Tracking/collector integration | Site/analytics/CRM owners bind real consented event source, coverage and QA exclusion; provider sending separately qualified | No actual test event / acceptance / matching claim |
| Lifecycle retention policy | Genuine product decision: irreversible erasure, audit tombstones/holds and historical aggregate treatment; owner decides before permanent-deletion implementation | Keep permanent delete unavailable with reason; reversible archive/recover without purge and Connections remain implementable |
| First live pilot and generation ceilings | Owner selects exact host/account/material/outcome and separate spend authority at later pilot gate; Preview is already the required later reference adoption | No live account or paid experiment initiated by this design |
| Native QA and dot review | Owning implementation workflow supplies exact deployed target and campaign artifacts; dot provides actual experience verdict | No Ready for Clinton/product acceptance claim |

The current source limits are execution/evidence gaps, not requests for owner
permission. Deferred genuine policy decisions do not suspend this documentation
milestone or constitute recommendations answered by silence.

## Predecessor documentation verification (retained receipt)

- Read scoped current context, repository source/public exports, original product
  and QA documents through authorized source tools, and applicable supplied KB.
- Only root/SDK README clarifications and this maintained specification with three
  design appendices changed. Historical QA/review receipts remain untouched.
- `npm run typecheck` passed against unchanged SDK runtime source.
- Extracted proposed state-type excerpt passed standalone TypeScript
  `--strict --noEmit` validation. This establishes type syntax only; proposed
  commands/factory/UI exports and consumer mounting examples do not exist yet
  and were not misrepresented as compiling against 0.1.7.
- Markdown validation passed for all six changed/new documents: 66 relative
  links/anchors resolve, code fences balance, and no trailing whitespace.
- `git diff --check` passed; final changed-file scope contains only the two
  READMEs, PRODUCT.md and the three design appendices. No tracked runtime/CSS,
  package/lock, historical review receipt or other-project source changed.
- No runtime/browser/native/provider acceptance test is claimed for this design.

## Independent review verification and custody

- Rechecked ancestor/checkout guidance and local skill locations: no applicable
  AGENTS.md or local SKILL.md found; repository documentation uses its existing
  format. Supplied native/authentication/DB-test contracts remain unchanged.
- Read current SDK exports, grant-only setup/OAuth/custody/native verification,
  SQL Store/schema, React grant list and reference configuration. The predecessor
  was done and the initial dirty set matched the six expected Markdown paths.
- `npm run typecheck` passed on unchanged runtime source; the revised browser-safe
  type excerpt passed standalone TypeScript 7.0.2 `--strict --noEmit` with
  `--skipLibCheck`. Neither check compiles the proposed factory/commands/UI mounts
  against 0.1.7; those exports do not exist. No compiler limitation was encountered
  for these bounded checks. No runtime, DB, browser, native or provider QA ran.
- Initial link check found three review-heading anchor mismatches; corrected the
  heading, then reran the six-file relative-link/anchor, fence and whitespace checks.
  All 70 local links resolve. `git diff --check` passed. Checks stayed within the
  five-minute aggregate budget; no configured project checks exist.
- Original six-file input bytes, SHA-256 manifest and review patch were retained in
  run-private `tmp/marketing-design-review` for review `0a4a0b2c-510c-4e8a-be34-cd83566b7294`.
  Historical repository evidence was not edited. All 89 other tracked files retain
  their input hashes; HEAD remains `fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`.
- Custody is limited to `README.md`, `marketing-sdk/README.md`,
  `marketing-sdk/PRODUCT.md`, `marketing-sdk/design/CONNECTIONS.md`,
  `marketing-sdk/design/CONNECTIONS-CONTRACT.md` and
  `marketing-sdk/design/ACCEPTANCE.md`. The final worker report supplies SHA-256
  for each final file (including this one, avoiding a self-referential digest).
  The next writer must compare that manifest before editing and stop on unexpected
  ownership drift. There were no runtime/CSS, package/lock, other-project, credential,
  grant, campaign, database/queue, commit/push or deployment changes.

## Connections implementation candidate 2026-10-06

Work request `ad8737c6-56e0-4c6c-a9ed-be4c7f617218`, worker
`1af9d9d9-f63e-42d6-8214-40a39c8f5801`. This is an **uncommitted, unpublished
shared server/web candidate**, not independent acceptance, native qualification,
Preview adoption, or Ready for Clinton. Current-context MCP succeeded. Checkout
remains `fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, version 0.1.7; all six reviewed
input hashes matched before edits. Original input bytes are retained in
`artifacts/connections-implementation/reviewed-input/`; `before.json` covers the
tracked baseline and four design files. Historical READINESS/CAPABILITIES/parity/
provider-review receipts remain unchanged.

### Concrete implemented advertising journey

Open MarketingWorkspace in a zero-grant project or mount public MarketingConnections.
All three advertising and two creative rows remain visible. Select Meta, Google
Ads or LinkedIn; inspect requirements; choose intended operations and finite expiry;
approve the exact provider-access summary **before** an OAuth URL exists. The SDK
secure route and existing HostAgent handle provider consent. Discover labelled
accounts through authenticated native HTTP reads, choose an account and required
Page/Instagram/organization/manager context, approve the narrower project binding,
and verify current scope/context. Only then does one deterministic real Grant and
compatible Setup commit with the Connection CAS. Campaign/material readiness and
spending approvals remain independent.

Back/save-and-close, optional connection-ID-only browser restoration, current
server checkpoint reads, original-request retries, scoped pagination, cancellation,
explicit takeover, safe verification retry, callback reconciliation and exact local
revocation are implemented. Cancellation does not claim to undo provider access.
Current project roles and original session/configuration/account intent fence
awaited effects. Callback receipt persistence precedes success acknowledgement;
unknown consumed codes cannot be replayed with a new key. A different currently
authorized human can review/revoke local project access without inheriting the
creator's credentials. No second executor, scheduler, identity engine, credential
store, schema migration, ad mutation or paid generation path was introduced.

### Engineering evidence and qualification limits

| Cases / check | Current evidence | Limits |
| --- | --- | --- |
| C01–C06, C13–C14 | `tests/connections.test.ts`: zero grants, manual setup, all three native advertising HTTP adapters, both human decisions, scoped choices/identities, opaque pagination, original request/callback replay, one Grant, recheck and revocation | Narrow synthetic HTTP boundaries; no live/app/account qualification |
| C07–C09, C12, C15 | `tests/connection-security.test.ts`: two-user/project isolation; missing/replaced/external session; membership/session/config changes during reads; logout during exchange; cancellation; original consumed-code unknown; fresh retry authority; changed identity; reconstructed service; concurrent verification, current-human revocation, expired handoffs/credentials and non-rewinding reconciliation | Deterministic SQL/HTTP races. New-connection process-kill/commit-ack crash matrix remains an independent review/qualification concern; reconstructed service is not a process-kill claim |
| SQL regression scope | Disposable SQLite: 105 passed, 1 PostgreSQL-only skip; isolated socket-only PostgreSQL: 110 passed, no skips. Existing service/setup/campaign/readback/planning/drafts/promotion/choices/sessions/budgets/providers/schedule/styles plus PostgreSQL startup/isolation suite | Focused runs, one worker, expensive runs sequential. Whole aggregate expected over five minutes was not run; MariaDB, full native-write/media/capability suite and existing broad browser suite not rerun |
| Public API and package | Typecheck/build; normal `npm pack` preparation; independent temporary pack projection; public-only server/mount compile under strict types; NodeNext/Bundler consumer; runtime imports, real SQLite draft roundtrip and browser bundle exclusion of server modules | No new published Git SHA exists; local pack projection is not I01 public HTTPS full-SHA install qualification |
| C04/C05/C09/I01 web portion | `tests/connections-consumer.mjs`, invoked by `tests/consumer.mjs --connections`: actual loopback HTTP, public client, packed reusable UI, real SQLite, synthetic provider boundary. Full journey at 1440/390/320, keyboard radios/focus, lost start response, interrupted verification/reload, cancellation, review and no horizontal overflow | Browser fixtures prominently labelled. Image pixels inspected; no generated artwork or provider/live/native proof. Native system-browser/device return, screen-reader and native accessibility remain unverified |
| C10 | Manual path runs with no Agent dependency; safe unavailable-assistance explanation | No qualified pre-grant Agent adapter; no compatibility claim for Agent 0.2.15 |
| C11 | Creative rows distinguish OpenAI images/xAI video and independent generation/billing authority; exact missing contract visible | **Blocked:** no usable secure onboarding/status route can be composed from current public broker/billing interfaces. This is not a completed creative connection |
| N01/Q01 and full product | Original requirements and remaining gates retained in PRODUCT and this appendix | No Flutter packaging choice, bespoke host widgets, deployment, Preview edit or dot product acceptance |

Logs, screenshots, the final test/source/custody manifests and actual glue inventory
are retained under `artifacts/connections-implementation/`. After final authority/receipt/expiry fixes, the affected suites are rerun separately
(26 SQLite Connections tests and 30 isolated PostgreSQL Connections/startup tests);
the retained final logs identify their exact scope. Test patterns in existing
regression fixtures are synthetic media, not AI output. They do not qualify live
generation, provider access or native deployed behavior.

**Failed isolation evidence retained:** two early browser harness attempts followed
an HTTP redirect to an unauthenticated Facebook page with synthetic application
values; the route guard then blocked a Facebook CDN resource. No real credentials,
provider account consent, persistent live access, ad mutation or paid call was used.
Those attempts **failed the no-external-provider-network requirement**. The retained
`browser-network-guard-failed.log` records the failure. The corrected harness uses
zero-redirect inspection at the SDK handoff boundary, explicit synthetic consent,
a direct proxy configuration and non-loopback DNS denial. Successful later isolated
runs do not erase the earlier failure or constitute live provider qualification.

Other defects found and fixed during this run: public CSS lacked a declaration for
strict consumer imports; the generic discovery URL builder misread Google's colon
path as a URL scheme; existing narrow CSS hid the project/fixture label; revocation
needed current collaborator authority separate from creator credentials. All final
checks must use the resulting source, and independent review remains required.

### Actual integration delta and implementation issue list

The public [Fetch adapter](../examples/connections-server.ts) is 57 lines and the
public [Workspace mount](../examples/embedded.tsx) is 14 lines. The complete fixture
consumer/browser file and pack/compile driver are counted in the retained glue
manifest, including HTTP bridging, auth, policy, protected synthetic bindings,
provider fixtures and all helpers. Those test files include validation as well as
host plumbing; no production host-size claim is made from the two mount files alone.
No SQL-seeded grants, private consumer imports, copied domain implementation or
host-specific Marketing screen is the success path. Actual host integrations still
bind existing Store/custody/session policy and executor ownership; a pin upgrade
alone does not configure them.

1. **Creative secure contract missing (blocks complete Connections outcome).**
   Existing NativeGeneration and BoundGenerationBilling require a pre-existing
   grant/key/model/billing/quote binding. The existing broker/billing owner must
   expose authenticated safe capability inventory/selection, protected configuration
   navigation, harmless status verification and exact-human persistent binding.
   See [precise contract](CONNECTIONS-CONTRACT.md#integration-and-precise-remaining-seams).
   No credential collection or second billing/custody engine was substituted.
2. **Provider qualification remains source/fixture only.** Exact scopes, account
   roles, Page/org/manager relationships and callback integration need independent
   review plus separately authorized real app/account evidence. Reporting-only local
   intent does not narrow Google's/LinkedIn's bundled provider-management scopes.
   Only Google's reviewed flow offers explicit offline access; Meta/LinkedIn offline
   onboarding is denied as unqualified. No new provider/media support is claimed.
3. **Retention integration is explicit.** Policy bounds discovery credential use;
   physical erasure is not implemented. Existing host Vault/Store retention/holds
   govern restricted expired encrypted records. Hosts requiring ephemeral physical
   deletion need that existing-custody contract qualified before live adoption.
   Callback/request tombstones must survive. No irreversible deletion occurs here.
4. **New-connection crash matrix and provider identity changes need deeper review.**
   Session replacement, token-bound discovery, account/context mismatch and original
   callback identity are tested; exhaustive process termination around every SQL
   acknowledgement and native browser provider-account switching are unverified.
5. **Optional Agent and native package gates remain open.** No qualified
   `inspectConnection` capability is installed. Root coordinates N01 against actual
   Preview architecture before selecting Flutter SDK widgets or any hosted-web path.

### Next independent review, publication and adoption gates

First independently review this workspace candidate against C01–C15, including the
retained failed isolation check, permission/policy/callback races, record retention,
exact scope bundles and the complete creative prerequisite. Resolve defects and
qualify the missing existing-broker contract before claiming complete Connections.
When separately authorized, publish a reviewed commit and repeat I01 from its full
public HTTPS Git SHA with matching lockfile and normal preparation. This run does
not commit, push, release or change versions.

Root separately resolves N01 and coordinates Preview's public adapter/UI adoption
in its own repository. Qualify exact deployed host/server/SDK identities and native
session/handoff/accessibility on actual targets; dot must review before Ready for
Clinton. L01 lifecycle, S01/S02 Studio/material, T01–T04 real collector/tracking,
A01 exact launch and R01 Results evidence remain full-product obligations.


## Manual creative candidate — 2026-10-07

Work request `c5898480-aa82-49d8-8309-36b70ba6e5e9`, workspace only. Read scoped
current context and the reviewed design/product/acceptance source. No applicable
AGENTS.md or repository skill was present. Before edits, all 108 source hashes and
review digest `9ed92b29ffd3977b8c0728b3a2bfce1c6cc654500e49e4e13c226c80bc39aa16`
matched; HEAD was `fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, with exactly 29 owned
status entries. All 58 original receipts matched. The new custody manifest covers
all 4,974 predecessor artifacts, including historical failed attempts.

The maintained contract was extended before implementation. `CreativeConnections`
adds an SDK-owned script-free private browser flow reached from the existing
Connections UI: requirements/model/source/grant/expiry selection, exact persistent
access review and approval, existing-key entry, safe configuration status, reuse,
cancellation, local disconnect and reconnect. The API is public core/server; no
Agent dependency, host provider wizard, fake advertising Grant, generation-grant
creation, secret database, scheduler or schema change was introduced.
`EncryptedCredentialCustody` extracts the existing cipher + Store `vault` boundary;
HostAgent writes share it. All records use existing transactions/revision CAS.

Configuration can start with zero generation grants. Safe metadata separately
reports credential retention and use availability, provider verification, bound
independent generation authority and billing configuration. Provider entitlement
remains unverified, and paid operation remains blocked at setup. `BillingPort.inspect`
and `BoundGenerationBilling.inspect` are harmless local reads. Billing metadata may
omit the legacy mounted key when NativeGeneration uses the creative vault resolver;
paid authorization, cost ceilings and unknown-generation fences remain unchanged.

The host supplies a fixed environment and current permission/session policy; the
policy environment must match. Original current human session, membership, config,
source revision/expiry and exact independent grant are rechecked around awaited
custody/policy/billing work. Replayed approval cannot replace a key; cancellation and
revocation fence late approval. Null policy blocks new setup/use while permitting
current authorized owners to review and disconnect their existing environment-bound
configuration. No authority is conveyed by an opaque binding ID.

The private route's native HTML forms use same-origin referrers so browsers retain
the Origin header on POST; `no-referrer` caused a real browser 403 and was corrected.
CSP blocks scripts, external resources, embeds and foreign form actions. The route
never echoes keys, and entry screenshots are masked. Host ingress/APM must exclude
private request bodies before dispatch. Expiry stops use; explicit local disconnect
tombstones the active encrypted envelope. Physical erasure of DB history/backups,
host Vault retention and provider-wide key revocation are not claimed.

### Evidence and remaining gates

`artifacts/creative-connections/` retains each run, failed checks, masked screenshots,
network negative controls, source/custody manifests and a final verification report.
The tests use synthetic strings only, real disposable SQLite and the existing
socket-only isolated PostgreSQL runner. No ambient provider binding, key or DB env
value was inspected. Expensive runs are sequential, with one Node test worker.
The final report names exact suite counts, tested source hashes and exclusions.
No whole aggregate expected over five minutes, MariaDB, live provider or native
app test is claimed.

The public consumer uses normal install/prepare/pack projection, strict public
NodeNext/Bundler compilation, SDK React UI and actual authenticated loopback HTTP
routes. Every browser attempt first qualifies the unchanged loopback proxy guard
before application navigation. The first launch failed before navigation due to
an overlong Unix socket path; a short owned temporary directory fixed that.
Subsequent failures are preserved: a keyboard focus race in the harness, the form
Origin issue, a lost-navigation-ack harness race, and an overbroad assertion that
counted denied browser-process CONNECT attempts as external page navigation.
Detailed blocked-target logs distinguish these attempts from page requests.
The proxy never opens an upstream socket or performs DNS for a denied target.
No guard rule was relaxed; final checks separately reject all nonloopback page
navigation/subresources and retain every denied browser-process attempt.

The two predecessor unauthenticated Facebook navigations remain **historical
isolation failures**. No later passing fixture run changes that verdict. New
failed logs and screenshots also remain unchanged. A corrected assertion does not
retroactively pass a failed run.

Public host glue is fully counted in the final glue manifest: Fetch bridge example,
creative composition, React mount, generated fixture app, Node HTTP/auth bridge,
policy/billing fixtures, install driver and existing network guard. No `host.*`
callback hides a provider form. Only an uncommitted packed projection is qualified;
public HTTPS full-SHA + matching lockfile adoption awaits authorized publication.

Next independent review must inspect the entire resulting delta against the
original C11/I01 and authority/retention requirements, replay both providers from
zero grants, and independently assess secure-entry isolation, original-intent
recovery, source revocation, metadata-only billing and current session/policy fences.
Provider-key validity/model entitlement, actual billing/grant policy and ingress
redaction need separately authorized target-host qualification. No live credentials,
provider-account change, key generation, paid job, conversion event, deployment,
migration, version change, commit, push or other-repository edit occurred.
LinkedIn publishing remains gated; optional Agent and native token-free dual-session
handoff remain unqualified. Native public presentation, complete Studio/tracking/
Results/lifecycle, actual Preview adoption/native QA and dot’s target-platform review
remain full-product gates. This candidate does not claim complete Marketing acceptance.

Current focused results: 87 SQLite tests and 58 isolated PostgreSQL tests passed;
strict SDK typecheck and public NodeNext/Bundler consumer compilation passed. The
packed consumer completed both providers at 1440/390/320 with zero generation grants,
no Agent, no provider requests, no paid operations/reservations, original-receipt
recovery, reuse, source revocation and cancel/reconnect. Final per-run manifests
identify the precise source and visual checks. One initial SQLite test expected
401 instead of the existing 403 human-kind denial; the failed log is preserved.
Pixel inspection subsequently found a full-page narrow screenshot mask below the
password field (dots visible, no plaintext). Its failed visual receipt is preserved;
credential-entry reruns use viewport captures to align the mask. Layouts are long
but wrap at 320px without horizontal overflow. Screen-reader, device text scaling,
real keyboard/autofill behavior and native-device accessibility remain unverified.

## Independent manual creative security review — 2026-10-07

The [creative review](CREATIVE-SECURITY-REVIEW.md) corrects the preceding candidate's
retention, async expiry/inventory/status checks and return-path validation. In
particular, the earlier receipt's statement that disconnect tombstones the encrypted
envelope describes the old candidate: current disconnect retains ciphertext and
revokes binding use only. No physical erasure was authorized or performed.

`artifacts/creative-security-review/` holds input/final custody manifests, exact-source
checks, crash tests and separately qualified browser evidence. The original receipts,
all failed attempts and both historical Facebook isolation failures remain unchanged.
No live/provider/native/full-product acceptance is implied. The final verification
manifest specifies actual coverage, visual observations, skips and remaining gates;
the earlier 87 SQLite/58 PostgreSQL results do not qualify this changed source.

## LinkedIn publishing-discovery candidate — 2026-10-07

The [source qualification and public contract](LINKEDIN-CONNECTIONS.md) replaces
the historical blanket gate, conditional on trusted server app configuration and
actual scope/member/account/Page verification. C01–C05/C12–C15/I01 remain fixture
qualification; no live or product acceptance. Exact check receipts and final source
hashes are under `artifacts/linkedin-connections`. Historical failures are preserved.
Independent review of the final digest is the next gate. Preview adoption, N01/Q01,
native dual-session work, real app/account evidence and Ready for Clinton remain
open. No isolated publication is authorized.

## LinkedIn independent end-to-end review — 2026-10-07

The [review](LINKEDIN-E2E-REVIEW.md) corrects the native role/scope projection,
current-token evidence and public choice ambiguity. Exact final source checks,
public-consumer pixels, preserved artifacts and remaining gates are recorded in
`artifacts/linkedin-e2e-review/verification.json` and `custody-final.json`.
This is bounded source/fixture evidence only; N01/Q01, live account entitlement,
host qualification and complete Marketing acceptance remain open.

## Portable handoff implementation candidate · 2026-10-07

Work request `a8ed410f-d987-410a-981e-d02db5aef1da`. The maintained
[portable protocol](PORTABLE-HANDOFF.md) now has a workspace server/web reference
implementation: public SessionAuthority authentication/inspection/revocation guard,
non-authorizing descriptor, independent same-actor browser claim, stable callbacks,
private Strict-cookie completion and original-session final grant resume. The
external-host public example compiles and uses real SQL fixture authentication with
no SDK passwords/session duplication. No production Preview adapter was supplied.

The bounded regression selection passed real SQLite (370 pass, three dialect skips)
and isolated socket-only PostgreSQL (371 pass, two MariaDB-only skips). It includes
both sessions at every observed Meta/Google/LinkedIn read headers/body boundary,
logout/disablement serialization, actual grant-commit vs logout in both orderings,
config/role/expiry/actor/project/state denials, stable two-project URLs, encrypted
unknown-exchange retention, lost acknowledgement and SIGKILL recovery. A final exact
record-key lookup refinement and legacy correlator compatibility receive additional
focused checks. Exact snapshots, final checks and honest exclusions are in
`artifacts/portable-handoff/verification.json`, not inferred from this summary.

Both public packed consumers passed at 1440/390/320 behind the existing loopback
proxy and local negative controls: the new external-session login/claim/completion/
recovery path, and the existing three-provider selection/review/verification path.
The last claim-label refinement is rerun and pixel-inspected in the final receipt.
Provider authorize responses are fulfilled locally before any socket opens; all
other external browser traffic is denied. No real provider consent, request, access,
ads/spend/events or credentials. No live/device/production readiness is claimed.

All 6,213 input-manifest entries and later review receipts matched at entry. The
new inventory covers 6,268 existing artifacts; all are preserved. Historical two
unauthenticated Facebook navigation failures remain **FAILED**. This work retains
its failed compile/test/browser attempts too: a browser executable-path error, a
fixture assertion that incorrectly applied cross-site cookie rules to same-origin
reload, and a synthetic provider Back-history handler that expected already-scrubbed
parameters. The failed fixture assertion printed a disposable synthetic host cookie;
that failed receipt is retained and the fixture logging was corrected. SDK code never
logs authorization response bodies. There was no new live-provider network request.

Whole-suite/native-media aggregates expected to exceed five minutes and MariaDB are
not run; bounded SQLite and PostgreSQL selections are run sequentially with one test
worker. Public HTTPS Git/full-SHA installation remains a publication-dependent gate;
the pack projection declares no forbidden SDK dependency and is not that proof.
No package/lock/version changes, migrations to application databases, commits/pushes,
deployments, host/queue state changes or edits to other repositories occurred.

Independent security/product review, actual host revocation-lock/ingress/service-worker
qualification, native widgets/byte-range media/device return and process lifecycle,
live app/account/Page scope qualification, full Studio/tracking/Results/lifecycle
and personal target-platform validation remain. **Not Ready for Clinton.**

## Independent portable protocol review · 2026-10-07

See [review and precise deployment gates](PORTABLE-SECURITY-REVIEW.md) and
`artifacts/portable-security-review/verification.json` for the exact verdict,
source coverage, SQL/browser/consumer checks, failures and omissions. Host CSRF
headers, idle/hidden polling, independent-connection lock evidence, nonce validation
and claim/recovery presentation receive bounded corrections. Historical records
without trustworthy retained authority safely restart; no actual historical durable
record proof is claimed. All predecessor artifacts and both Facebook failures remain.
No publication, native/Preview/full-product or Agent 0.2.16 pair acceptance is implied.

## Shared external creative setup candidate · 2026-10-07

See [the shared session and historical compatibility contract](EXTERNAL-CREATIVE-SESSIONS.md)
and `artifacts/external-creative/verification.json` for exact source, SQL/process,
installed consumer and historical-source evidence. Earlier script-free creative
form/weak external-session limitations are addressed in this candidate, subject to
independent review. The new private page owns header-bearing submission; uncertain
custody is retained and fenced. All earlier failed receipts remain failed.
Production host lock-writer/ingress/service-worker, full mounted-app budget, native
and live/full-product gates remain open. No isolated publication or Ready for Clinton.


## Studio candidate · 2026-10-07 · independent review pending

Work request `9e9d6471-0b1a-4e3d-8c00-29b3cb924d23`, implementation run
`3baf00fd-cd08-4ea9-91c3-a37695289557`. Canonical main was authorized for
source work after retaining the exact reviewed `f82d2cc7…` source under
`artifacts/studio-source-snapshots/`. No commit, publication, host edit or deployment.
All earlier raw review results, failed screenshots and isolation failures remain
historical evidence; none has been relabelled as a completed Studio review.

| Case | Candidate behavior and proof | Boundary |
| --- | --- | --- |
| L01 | SQL revisions, immutable request receipts, searchable paged library, copy/archive/trash/restore, reference preservation, permissions and stale writes; actual UI lifecycle | Permanent deletion explicitly unavailable; read-only impact/policy receipt explains retention and restore. Archive is not a provider pause |
| S01 manual | Brief, editable options/copy, explicit selection, actual raster byte validation/retention and rights attestation; no Agent, AI credential or advertising account required | No invented claims, image-reference edit or remote import |
| S01 planning | Public separate PlanningPort, SDK strict schema/prompt, validated options, exact synthetic authority, one attempt, retained response identity and usage/unknown cost; real executor-process crash recovery | Real text custody/billing and persistent execution remain BLOCKED. Provider/model metadata or telemetry is not spending authority |
| S01 media | Additive draft owner/job/asset v2, native image/video transport reuse, exact quote reservation, explicit selection, immutable retained bytes; fixture generation and duplicate fences | Real paid execution unrun; draft v2 host cost/custody binding requires independent qualification. Video advertising remains unsupported |
| S02 | Shared provider choices and constraints, selected-byte approximation, reproducible safe input snapshot/check digest, repair navigation | Local checks are not provider approval; Meta daily gate, LinkedIn roles/UTC/budget and Google Search constraints remain |
| T01 seam | Typed current-material/outcome/destination handoff and staged TrackingReceipt contract; Missing integration / Not tested | Actual collector/test event, matching, attribution and Results product remain unfinished |
| A01 seam | Local promotion to new campaign creative-set lineage and asset aliases, changed-account/revision fences, no provider effects | Existing exact packet/decision/executor pipeline remains required. Live preparation/activation unrun |
| I01 local | Clean installed candidate projection, strict NodeNext/Bundler types, browser/server separation, MarketingWorkspace with external SQL host sessions and Agent absent | Public HTTPS full-SHA installation of this uncommitted candidate requires separately authorized publication; real host/native reuse unverified |
| Q01 | Loopback guard negative controls before each browser run, desktop/390/320 screenshots, lost-save/reload, navigation and bounded request measurements | Target-platform/native/device and dot review remain open |

Logs, per-run source manifests, negative controls, failed screenshots, final results
and hashes live under `artifacts/studio-3baf00fd/`. Full aggregates remain skipped
under the existing >5-minute rule; focused SQL/provider/media/lifecycle checks are
used. An initial PostgreSQL fixture run failed for missing executor acquisition and
a count type assertion; an initial UI run exposed label/navigation styling, later
runs exposed stale library/step updates. Those failed results are retained, with
corrections tested separately. This is implementation evidence, not independent
acceptance. Persistent credential and campaign automation acceptance stays **BLOCKED**.

## Independent Studio journey review · 2026-10-07

Work request `457f6826-cb49-4554-8340-a8ef49532766`, run `1a8c3ad5-f349-40a0-8916-4d65034feb9e`.
The supplied `827d4f1b…` source, receipt, all artifact/runtime/PostgreSQL manifest
entries and retained `f82d2cc7…` archive/patch verified before editing. The canonical
checkout, index and every unowned source/artifact remain under custody; no release
or publication action was attempted. The final machine-readable verdict and exact
hash index are `artifacts/studio-review-1a8c3ad5/receipt.json`.

Repairs address editor data loss/cancellation and readable saved handoff recovery,
current external-host role/configuration authority, bounded unlocked quote/decode
work, exact-revision finalization and immutable concurrent planning readback. Added
proof includes independent SQL revocation during quotes, expiry during normalization,
exact 10 MiB and one-over raster boundaries, two-option selection/editing, real native
OpenAI transport with synthetic HTTP, and public Connections-to-Studio promotion
racing independent processes without ad writes. Tracking/results measurement remains
a factual source fixture, not an installed collector or successful website test.

Browser evidence is the installed candidate's default MarketingWorkspace at
1440/390/320 CSS pixels, with external host sessions and a zero-grant manual start.
It is not Preview, a public Git-SHA install, native device/range qualification or
personal target-platform acceptance. Cold/active/hidden request counts belong only
to this consumer; full Preview budget and long-running host lifecycle remain gates.
All failed checks are retained, including browser startup, denied browser-background
request assertions, a snapshot-envelope PostgreSQL failure and intermediate compile
failures. Historical Facebook isolation failures and interrupted prior runs remain
unchanged failures. Successful reruns do not relabel them.

Manual Studio and synthetic workflow verdicts are bounded independently in the final
receipt. Real text planning and persistent use remain blocked by the exact contract
gap in STUDIO-IMPLEMENTATION. Full Marketing remains incomplete pending SDK Tracking/
Results, qualified live/host/native integration, authorized exact Git consumption
and actual target/dot validation. Permanent erasure remains unavailable without the
exact retention/impact/owner authority; reversible lifecycle needs no such grant.
# Tracking/Results candidate · 2026-10-07

The additive [Tracking/Results contract](TRACKING-RESULTS.md) implements the reusable
manual first-party journey and narrows Results completeness to authenticated retained
checkpoints. Evidence lives in `artifacts/tracking-41429fed/`; its final receipt binds
source, owned delta, SQL runs, installed consumer and screenshots. Earlier dated
receipts remain unchanged. Initial focused SQLite/PostgreSQL HTTP cases and public
consumer pass; final verification and precise limitations are in that receipt.

Verdicts remain separate: first-party Tracking and Results are candidates with bounded
fixture evidence; provider pixel/event delivery is unavailable; real AI and persistent
authority remain blocked/unqualified; full Marketing is incomplete. An independent
product/security/source review must qualify this combined journey. Published-Git,
target-host/native/media/accessibility and dot review are separate gates. No release,
commit, deployment, persistent grant, provider transmission or spending is authorized.

## Independent Tracking/Results review · 2026-10-07

The retained review at `artifacts/tracking-review-b37ad76f/receipt.json` binds exact
source/runtime/consumer hashes, SQL checks, combined browser request measurements,
failures and remaining gates. [Tracking contract](TRACKING-RESULTS.md#independent-review-repairs--2026-10-07)
records the repairs and required host source/producer permission adapters. Historical
receipts above remain evidence of their original source revisions.

T01–T03/R01 have bounded package-consumer and disposable SQL evidence. This does not
qualify a production collector, provider firing/delivery/matching, committed public
Git installation, mounted Preview/native/device/media-range/full accessibility, or
dot acceptance. The real-AI/persistent-authority gap remains blocked and the full
Marketing product remains incomplete. The denied publication action remains stopped.

## Interactive planning candidate — 2026-10-07

The [contract and mapping](INTERACTIVE-PLANNING.md) extends S01/I01 with SDK-owned text setup and review, a native foreground adapter and existing Store/executor/billing composition. Source and synthetic SQL/public-consumer evidence are recorded under `artifacts/planning-5d996985/`. This candidate is pending independent final-source/product/security review. It does not accept real host grants/spend, persistent access, public Git installation, native adoption, whole Marketing or Ready. The denied publication remains stopped.

## Independent interactive planning review — 2026-10-07

The [planning review contract](INTERACTIVE-PLANNING.md#independent-review--2026-10-07)
and `artifacts/planning-review-5a6d17fe/receipt.json` retain exact source/runtime/
consumer/custody hashes, fixes, actual checks and failed attempts. Strict stream
lifecycle/identity, bounded cancellation, retained billing observations and SQLite's
native-provider lease denial correct the candidate. Connection reads clear stale
state, and Results explains the unpromoted-draft dependency. The browser no longer
inserts a separate reporting campaign to imply continuity. Populated Results and
real target-host atomic billing remain distinct qualification gates; synthetic
success is not actual provider authority, persistent capability or Ready.

## Joined journey candidate · 2026-10-07

[Complete journey contract](COMPLETE-JOURNEY.md) documents promotion/Tracking continuity,
campaign navigation and the explicit public synthetic provider boundary. The final
source-bound evidence, failures and unresolved requirements are indexed by
`artifacts/journey-97c78087/receipt.json`. This candidate requires a separate
independent final product review. Earlier disconnected Results fixtures remain
historical evidence; no target-host, native, live-provider or readiness gate is cleared.

## Independent joined review · 2026-10-07

The [joined review findings](COMPLETE-JOURNEY.md#independent-joined-review--2026-10-07)
and `artifacts/journey-review-51cb26ab/receipt.json` supersede no historical result.
Local synthetic same-campaign completion is qualified with explicit 120/minute
read recovery; rapid and continuous journeys still encounter throttling. Native
adapter HTTP fixture checks pass separately, while joined NativeProvider preparation
is blocked by the missing public exact-material capability producer. No actual
eligibility is fabricated. The final source repairs redundant reads, visible
Retry-After recovery, campaign media ranges, equivalent UTC report-window lookup
and misleading default UI details. Precise checks, failures, pixels, identity chain
and source/runtime/consumer hashes remain in the receipt. Whole Marketing is not
accepted; original public install, host/financial/persistent authority, mounted
Preview/native/device/accessibility/dot and publication gates remain open.

## Native campaign prerequisite candidate · 2026-10-07

The [public campaign check contract](NATIVE-PREFLIGHT.md) extends S02/A01 with
read-only exact-campaign proof and current status, consumed by NativeProvider before
preparation and each write. `artifacts/native-preflight-7ed6998b/receipt.json` records
actual checks, failures, custody and separate verdicts. The installed public-export
consumer uses SDK Connections/Studio/Tracking, native advertising HTTP fixtures and
the same campaign's public native sync/authenticated collector Results. It inserts
no capability evidence to obtain a green status. This candidate still needs
independent review. Actual provider/host spending authority, public Git installation,
persistent access, Preview/native/device/accessibility/dot, migrations and publication
remain open. No historical result or failure is rewritten.

## Country Audience candidate · 2026-10-08

[AUDIENCE.md](AUDIENCE.md) traces this bounded addition to provider-option selection
and easy reuse (P5/S02, P9/I01). The same public client owns country search, selected
resolution and status; no host catalogue or ready receipt supplies native proof.
F9 separates legacy setup effects and campaign media decoding from short guards.
`artifacts/audience-db51378d/receipt.json` records exact checks, failures, manifests
and remaining work. Independent final-source review is required. Broader provider
targeting, actual eligibility, public Git installation, Preview/native/device and
whole-product acceptance remain unqualified. No release or publication is implied.
