# Independent Connections review — 2026-10-06

Work request `49a95031-e3a1-4bc4-a321-1b3ec00048fd`, workspace only.

**Verdict: the complete reusable Connections product remains blocked.** The
shared server/web manual Meta and Google journey and LinkedIn reporting journey
have synthetic public-consumer proof. LinkedIn publishing discovery is now
explicitly blocked rather than presenting an unqualified permission bundle as
working. Creative onboarding and native portability have unresolved public
contracts. This is neither Preview adoption nor complete Marketing acceptance.

## Source authority and custody

The original P1–P10 requirement-to-proof matrix in [PRODUCT](../PRODUCT.md) and all
C01–C15/I01/N01/Q01 and later product cases in [ACCEPTANCE](ACCEPTANCE.md) remain
authoritative. No requirement was replaced by a new test-count target.
Current-context MCP confirmed this SDK work request and authentication snapshot
`08346f8bc724`. No applicable AGENTS.md existed in the checkout or its checked
ancestors; no listed skill applies to this repository security review or its
existing documentation workflow. No subagents or other-repository edits were used.

Authorized Handrail source reads independently returned original REQUIREMENTS and
implementation/QA.md at `1a1fe5a833d29d2a8e868f35ddb93bb158467e68`, with hashes
`d21f5b6e74d3dcd17dbd1114f474d670328dfdde9c4f232de536f6326196f520` and
`172278e7b3710c06c7c644848485215f91c611f5a9cad77a6798d08fc394ee4f`.
These are the same newer-source hashes in the prior provenance; no independent
byte comparison to historical `08645a4…` is claimed. The source reads reaffirm
the complete workspace/studio/approval/tracking/Results/embed product and actual
native QA obligations. The current Preview/native facts below are supplied
independent source-feasibility evidence, not a new Preview checkout inspection.

Before any edit, all 105 after-manifest hashes matched, including the 28 candidate
source/document changes represented by 26 Git status entries. Baseline HEAD was
`fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, package 0.1.7. Recomputed candidate
digest matched `cb0a43343a29f19baf2642b16431d7be422044199987c8fe6956d533a814487e`.
`artifacts/connections-review/custody-before.json` also hashes every predecessor
artifact. Final custody compares these again. Schema, migrations, lockfile,
package version and historical evidence stay unchanged. No commit/push, release,
deployment, project DB, queue mutation, real OAuth grant, provider API effect,
paid media or production activity occurred.

## Findings and bounded corrections

| Finding | Correction / disposition |
| --- | --- |
| Google direct customers requesting future campaign access entered a manager picker with no possible choice | Require manager selection only when native discovery actually supplies a manager. Real SQL regression covers direct-account selection; public HTTP consumer covers explicit manager selection |
| LinkedIn organization discovery calls `organizationAcls` without an organization-admin scope | Block new publishing-intent Connections before any OAuth review. Show the publishing dependency in catalogue/requirements; leave reporting available. No additional scope, app product or provider authority was silently introduced |
| A status read captured editor permission before awaiting host policy; downgrade could leave private account choices in that response | Recheck member role/kind/session and connection revision before returning; re-read grant revocation/revision/expiry after policy awaits. Regressions change role and grant during those awaits |
| An unknown consumed-code exchange could be bypassed by a new start key after local expiry | Scan unresolved durable effects independently of expiry. Original same-key receipts remain stable. Allow original receipt reconciliation after expiry without exchanging the code again; new-key regression proves denial |
| Empty first identity page hid the load-more control | Render identity pagination even with zero current choices. Public consumer deliberately starts identity discovery with an empty partial page |
| Late background status reads could repaint a newer view | Fence read responses with a monotonically increasing local sequence and invalidate pending reads on mutations; existing client/session remount fencing stays intact |
| Errors, phase names, role codes and generation blocker copy exposed implementation language; cancelled steps falsely showed completed work | Use bounded recovery copy and readable phase/role names, fact-based step completion, and label creative setup as an unavailable product integration instead of suggesting the user can fix it by entering a key |
| Browser isolation only guarded a known redirect and a page route | Force a single-loopback-origin proxy with no external upstream socket/DNS path; reject other HTTP/CONNECT destinations, block WebSockets at context level and service workers at context creation, disable QUIC/nonproxied WebRTC and external DNS. Context routes cover popup pages; inspect the actual handoff redirect with `maxRedirects: 0` before synthetic consent |

## Observed web journey and security boundary

The independent packed consumer uses public exports, normal npm preparation,
Fetch routes, real loopback HTTP, authenticated SDK sessions, encrypted existing
cipher custody and a disposable SQLite file. Normal `provision` creates only
fixture projects/users/memberships; advertising and generation grants start empty.
No provider account or Grant is seeded. Account/identity choices originate only
from the narrow synthetic external HTTP boundary. Agent is absent.

At 1440/390/320, the consumer exercises zero-grant Workspace entry and catalogue,
manual requirements, explicit new-provider-access review, synthetic consent,
account selection, Meta Page selection and empty-page identity pagination, Google
manager context, separate exact project binding, read failure/retry, reload,
cancel/back/repeated use, local revocation and missing configuration. It loses
start, callback and grant-commit acknowledgements after the corresponding server
effect and recovers retained state. Nine total grants represent one connection
per provider/project across three independent projects; LinkedIn is reporting
only. Screenshots and assertions are synthetic, not live-account qualification.
Pixel inspection includes desktop catalogue/selection and narrow consent,
selection, verified, interrupted, cancelled and creative-blocker screens. Full
labels wrap; the 320px review is long and scrolls vertically. Keyboard account
selection, cancel focus and absence of horizontal overflow have local checks.
Screen-reader, text scaling, touch-device and real provider challenge QA remain
unverified, as do exhaustive duplicate-label/account-hierarchy permutations.

Source review confirms a closed command allowlist and server-derived principal;
no ready/permission/role/native identity fields from the browser create authority.
Absent access policy fails closed. The host policy is a trusted current
grant-maker resolver, **not** a browser grant callback. It must return null for a
principal not allowed to grant the requested scope. Editor/admin plus current
human kind, policy, session, exact digest and expiry are required for approval.
Provider consent precedes new discovery access and is distinct from local binding.

State has 256 bits of randomness; Google uses S256 PKCE; Meta/LinkedIn use their
confidential-server code exchanges plus session-bound state, not invented PKCE
parameters. Exchange intent is committed before transport; callback receipt and
ciphertext are committed together before acknowledgement. SIGKILL tests cover
death after exchange/before persistence, after receipt commit, and after Grant
commit. Recovery never silently resubmits a consumed code. Only fresh explicit
consent after original reconciliation may establish new provider access.

Native reads check authority before/after transport and response parsing. Revision
CAS fences selection/cancel/revoke races. Existing SQL transaction guards serialize
record/Grant/setup/request/outbox commits; no migration or parallel ORM/store was
introduced. Discovery cursors are opaque and scoped; arbitrary next URLs are not
followed. Restricted outbox events contain IDs/revision/phase and bounded reason,
not credentials or discovery lists. A different administrator may revoke a local
project binding but receives no creator-private account list/custody capability;
the operation never revokes provider-wide OAuth or pauses unrelated ads.

Callback responses are no-store/no-referrer, omit bodies with secrets, use a fixed
local return and scrub query on success, invalid state, expired or foreign-session
returns. Browser return and replay tests cannot prove ingress logging redaction:
the host **must omit callback queries before access logs/traces capture them**.
A lost navigation response cannot erase a URL already known to the browser; status
recovery must use the clean Connections URL, not code replay. No code/token/
secretRef is returned in the public command views. Same-session status gives
safe progress; another session gets redacted choices and requires explicit fresh
takeover where permitted. Missing receipt is `not_found`; lack of project access
fails authorization first. No absence is treated as proof an effect did not occur.

Use expiry is enforced. Physical discovery-ciphertext erasure remains under the
existing custody/retention owner; `discoveryRetentionSeconds` is not a purge. A
host requiring physical short-lived erasure needs that explicit integration before
live adoption. Callback/request tombstones cannot be erased to allow code replay.

## Current official provider checks

These were documentation reads only, never provider API/account calls.

- Google: the newer [developer-token sunset guidance](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
  says access moved to the OAuth client's Cloud project on September 9, 2026.
  The older [REST header page](https://developers.google.com/google-ads/api/rest/auth)
  still mentions a mandatory developer token. The dated migration guidance
  resolves this conflict: preserve v25 Cloud-project access, no added token.
  `listAccessibleCustomers` plus customer hierarchy reads and manager context do
  not establish write permission; campaign-specific validation still gates writes.
- LinkedIn: [organization access-control permissions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09)
  list organization-admin permission for `organizationAcls`. The candidate bundle
  `rw_ads r_ads_reporting w_organization_social r_organization_social` does not
  establish that access. Next work must qualify the exact read permission/app
  product, response shape and account/organization relationship, revise exact
  human consent and host policy, and add independent scope-negative transport
  tests before re-enabling publishing onboarding. Broadening login consent alone
  is not a fix. Token introspection and current account-role reads remain distinct
  observations for the reporting path; organization eligibility is blocked.
- Meta: source uses v26 `me/permissions`, current ad-account `user_tasks` and
  `promote_pages`/connected Instagram enumeration. The official promote-pages
  page was unavailable to the documentation reader. Endpoint/field/permission
  sufficiency and Page/Instagram eligibility remain **unverified live**; synthetic
  transport acceptance is not independent provider qualification. Do not broaden
  supported media, infer roles from login or waive Meta daily prepare/activate
  denial. OAuth-app registration by itself is not qualification.

xAI remains creative video generation, not X Ads. Generated video is not supported
ad-video publishing. Tracking identifiers still do not prove event firing;
LinkedIn Conversions API product approval does not prove sending scope, dispatch,
matching or attribution.

## Public consumer integration and remaining product gates

The actual server adapter is `examples/connections-server.ts` (57 lines), and
`examples/embedded.tsx` is a 14-line mount. These do not include existing host
authentication, grant-maker policy, protected app/cipher configuration, Store,
GenerationPort or executor infrastructure. Those are explicit injected public
ports, not omitted provider implementations. The host adapter dispatches the
closed SDK commands with origin/content-type/body limits. OAuth/discovery/choice/
approval/recovery UI and provider logic remain SDK-owned. The package's reference
host is not copied by the consumer. No private fixture flag is advertised as a
host business API. The generated app, Node HTTP bridge, synthetic provider
responses, provision/login helper, assertions, installer and egress proxy are all
fixture harness and inventoried in `glue-manifest.json` separately from the 71
integration-example lines. No second Vault, scheduler or application framework
was added. CSS resolves through its public typed export in NodeNext and Bundler.

This is a packed **uncommitted candidate projection**, not a full-SHA Git install.
An SDK dependency must still be public HTTPS Git pinned to an authorized committed
full SHA with a matching lockfile and normal prepare/build. No tarball/file/branch
dependency was introduced and no publication is authorized here.

Creative onboarding needs public, authenticated inventory/selection of existing
broker capabilities, protected configuration navigation, a safe no-charge binding
status and exact human-approved GenerationGrant/billing binding (provider, model,
expiry, currency, limits, quote). Implement that coherent vertical slice in the
existing credential/billing ownership, then wire these reusable SDK screens and
recovery. Neither asking each host to build the product nor adding another key
store resolves the gap. Existing NativeGeneration/BoundGenerationBilling APIs
consume already-created grants; they do not provide onboarding.

Agent integration remains unqualified; manual setup works without it. Studio's
real retained image/video generation, lifecycle edit/copy/archive/recover and
separately governed deletion, tracking installation/firing/collector stages,
Results source/window/coverage semantics, and exact launch/budget approvals remain
their original separate product gates. Focused regressions protect existing
campaign IDs/material/approvals, budget/day denials, reporting and lead semantics;
they cannot substitute for those complete user journeys or actual native QA.

## Native portability verdict and bounded next contract

**Native adoption blocked. Shared web proof is separate.** Supplied independent
Preview feasibility establishes that NativeSessionClient holds a private in-memory
`__Host-preview_session`, confines HTTPS/single-origin calls, and exposes neither
redirects nor session headers. There is no supported cookie/session bridge,
WebView, app-link/launcher/video package or callback binding. The JS SDK assumes
browser fetch/DOM and authenticated asset URLs. Same-origin browser navigation
does not transport the native session and is not a native initiation contract.

Current `beginConnectionHandoff` returns a relative browser path and later checks
the exact initiating session. No public native-start → token-free handoff
descriptor → fresh native-session-scoped status/resume contract exists. Existing
`externalSessionRef` validates an already-authenticated host principal; it cannot
log a system browser in or authorize a second session.

A bounded additive server contract is feasible to design with the existing record
CAS/custody, but **not safe to claim implemented by reusing that path**. It must
define a short-lived opaque handoff ID, expected provider/display context and
fixed safe web route; the descriptor contains no session cookie, OAuth code,
token, secretRef or authority to read accounts. A browser must authenticate
independently through existing host login. Same-user cross-session claim requires
an explicit current human decision and a fresh check of both session bindings;
another user cannot claim it. This dual-session authority transition is a new
public security contract, not an implicit cookie bridge, and needs a separately
bounded host/server design and synthetic contract suite before native adoption.
No new authentication mechanism or Flutter UI is selected here.

| Native scenario | Required authority semantics for that future contract |
| --- | --- |
| Missing browser login / different browser session | Show host login, then explicit same-user claim; no state/descriptor-based login and no account disclosure before both bindings are valid |
| Native logout or browser logout | Invalidate relevant handoff use; restrict any in-flight receipt; native status requires a fresh current session and cannot promote the old receipt silently |
| Browser/native account switch | Reject other principal; same principal with replacement session needs explicit rebinding/consent, never inherited private credentials |
| Callback replay / lost acknowledgement | One durable callback/effect identity; status reads recover receipt; never exchange consumed code again |
| Native process death | Reauthenticate via existing host flow; recover safe status by opaque ID only after authorization. New native session is not the old session |
| Concurrent native/browser actions | Revision/session fences at claim, callback, discovery and grant commit; explicit cancellation wins against late authority promotion |

This review adds no cookie bridge, launcher, WebView, new auth store or native SDK
widgets. Reusable native presentation selection, actual Preview source/mount
integration, device lifecycle/accessibility QA and dot's personal target-platform
validation remain N01/Q01. No basic screen-finding task is delegated to the owner.

## Evidence and verification limits

`artifacts/connections-review/verification.json` records final check results,
timings, source coverage and exclusions; `source-manifest.json` and
`custody-final.json` identify final source and preservation checks. Per-run logs,
browser manifests/screenshots, negative-control results and failed attempts stay
in that directory. PostgreSQL uses the existing fresh socket-only runner, not
ambient project credentials; SQLite uses the existing real file-backed harness.
Expensive runs are sequential with one Node test worker. Whole-suite aggregation,
MariaDB, paid/native provider tests and broad media/native-write suites are not
claimed; the inherited over-five-minute aggregate rule remains in force.

**Historical isolation remains FAILED.** Two predecessor browser attempts followed
a redirect to an unauthenticated Facebook page with synthetic values. There were
no real credentials/consent/grants, but final isolated success cannot change that
run-wide failure. Every predecessor byte, including failed receipts, is retained.
The new proxy negative control uses only a disposable local denied sentinel and
proves zero sentinel requests across redirects/popups/subresources/tunnels. This
review's first guard test lacked a separate WebSocket proof; a later attempt
blocked Playwright's fixture HTTP tunnel and could not reach the initial screen.
Both failed logs remain. Repaired runs allow only the designated fixture socket,
and record isolated success without claiming live-provider acceptance.

An added expired-token browser control initially returned an overbroad synthetic
Meta token scope for reporting-only consent. The server correctly retained an
unknown exchange outcome instead of accepting it; the expiry assertion timed out.
That failed receipt is preserved. The fixture now echoes the scopes observed in
the actual SDK authorization redirect, so the expiry control exercises expiry
without weakening the exact-scope check.
