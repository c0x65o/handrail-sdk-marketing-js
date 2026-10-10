# Portable handoff independent review · 2026-10-07

Latest-state note: [Shared Connections review](SHARED-CONNECTIONS-REVIEW.md) and
[external creative sessions](EXTERNAL-CREATIVE-SESSIONS.md) supersede the earlier
script-free creative, historical-provenance and helper-count limitations below.
Those dated findings remain historical evidence. Current private creative pages use
isolated SDK scripts with required host headers and the shared SessionAuthority;
source-issued historical pending records safely restart without rewritten authority.


Workspace review for `9e0e2ab7-5a05-4d0f-8bd3-689f476a6006`.
The shared SDK protocol and consumer journey receive bounded synthetic evidence,
not release, native or complete product acceptance. The exact final verdict and
checks are in `artifacts/portable-security-review/verification.json`.

Entry matched HEAD `c39c095e9f657f5cabe320d7b0aa1e0987d15012`, all 27 owned dirty
paths, candidate source `a1a263b381ad9abf344715ed3fc353f1ff571153cfc7eda9a4eae1ff21f2422a`,
custody `f8a437455dc65092af3fa00dd825e20324b9de53f2872444e7118795d50153e9` and
artifact manifest `9e460a9b36d23ad0e99e3adb9f0a5f573d7a4c9d843342a22c3279441c28d74c`.
The new entry inventory contains 6,481 artifacts, including all 6,268 candidate
entry artifacts and 6,213 historical entries. Both historical Facebook isolation
attempts remain **FAILED**. Nothing about Marketing 0.1.8 publication establishes
product qualification or its initiator. Package/version/lock remain untouched.
No applicable AGENTS.md or local skill was present. Scoped current-context MCP
confirmed the request and authentication requirements snapshot `08346f8bc724`.

## Corrections and limits

- Private claim/completion previously hard-coded only content type. Hosts enforcing
  `x-preview-request` or a session CSRF header could not use those SDK-owned pages.
  Public `routes({ mutationHeaders })` now supplies bounded custom headers after
  authentication. The unprivileged callback scrubs its URL synchronously, fetches
  an authenticated same-origin GET of the exact completion path for those headers,
  then POSTs the code/state in its private closure. The host MUST still validate
  the header on mutations. Only the exact callback GET bypasses cross-site guards.
  No broader bypass, cookie weakening, copied callback or provider wizard is needed.
  Core commands already accept an injected fetcher for existing host headers.
- Workspace polled every 1.5 seconds regardless of relevance or visibility (40
  reads/minute before any other SDK). Public Workspace and Connections now accept
  `visible`; false disposes their mounted content and aborts outstanding reads.
  Replace `client` or `sessionKey` on identity/project changes. Document hiding
  aborts reads and suppresses timers; visibility/focus/pageshow return coalesces
  one authenticated read. Only relevant pending work polls, at five seconds with
  twelve reads per work identity, then relies on explicit read/return. Mutations
  still keep their durable request identity: abort does not undo an effect.
  The parent does not reread Workspace while Connections owns the view. Hiding
  with CSS alone is not a lifecycle signal; hosts must set `visible` or unmount.
- Claim presentation now prioritizes provider, uniquely identified project,
  approved operations and next action. Exact retained approval remains accessible
  in a details disclosure. Authenticated expired/cancelled screens give a specific
  return/review action; missing/wrong login remains generic. Failed claim offers an
  actual reload action. Project IDs disambiguate same-named projects in React.
- Callback validation now checks the stored state digest against the issued nonce,
  exact issued/canonical callback URI and app client before reserving an exchange.
  Missing historical session/decision authority requires safe restart. Legacy
  grant-only records also lack session/app/issued-URI provenance, so private
  completion rejects them without consumption. The reference host no longer has
  a fallback GET that exchanges directly through the old grant-only API. The old
  test deleted fields from a newly issued record; that was not historical evidence.
  Its retained-URI case now explicitly tests modern authority with an old URI.
  A separate missing-fields negative control is labelled corruption/compatibility,
  not provenance. No authentic historical durable OAuth record is retained in this
  checkout; actual old-record compatibility remains **unverified**. Do not invent
  an authority snapshot or re-exchange an uncertain consumed code to resolve it.

## Authority, SQL and host contract

`bindExternalPrincipal` maps a verified issuer/subject and host-authorized role; it
is not authentication or a session database. Current project membership must come
from the host before mapping. `SessionAuthority` authenticates requests and inspects
exact session references, current enabled user/kind/role/expiry/configuration.
Browser claim compares both issuer and subject, then pins both original and browser
sessions, decision and revisions. Names/email never establish identity. The original
session must resume the final Grant; server-live authority does not prove process life.

The Store adapter uses SQLite `BEGIN IMMEDIATE` or PostgreSQL `BEGIN ISOLATION LEVEL
READ COMMITTED` followed by `transaction_guard WHERE id=1 FOR UPDATE`. Implicit
Store writes use the same guard; nested calls share transaction context. The new
race test uses a separate process and database connection for logout/disablement
against actual final Grant commit, testing both orders. It does not share a JS
mutex. The external fixture's existing-host tables still share this Store database;
it is neither Preview nor a cross-database production adapter.

Hosts acquire their revocation/authorization locks first, then SDK Store locks,
then CAS, and hold through commit acknowledgement. Every logout, disablement,
password/role and authorization-configuration writer must participate. Mutable
policy/inspection inside that guard must be bounded local work. Cross-database and
multi-process deployment qualification is still mandatory; an inspection query or
`bindExternalPrincipal` alone does not fence revocation. Built-in Store hosts must
revoke user sessions on password/security-authority changes; direct SQL writers
that evade the guard or restore old rights without invalidation are not qualified.
No provider HTTP or human wait runs under the authority guard. Current authority
checks surround remote headers/body boundaries; restricted ciphertext may survive
revocation, but it cannot promote a new grant. Unknown effects and historical
private data are retained without automatic irreversible cleanup.

## Ingress, service workers and deployment

Private HTML uses escaping, nonce CSP, no-store/no-referrer, no third-party
resources, canonical configured origin and exact configured local return/login
routes. A callback URL still reaches the browser and ingress before SDK script
runs. SDK headers cannot redact upstream logs, extensions or an existing root
service worker. A controller check after arrival is too late to prove the URL
was unseen. Before opening a handoff, the host must establish a service-worker-free
callback origin/scope (including pre-existing registrations/controllers), exclude
private routes from caches/analytics/APM/session replay and redact request query/body
at ingress before capture. A clean fixture with service workers blocked proves
only that fixture. If the host cannot meet this prerequisite, deployment is blocked;
changing root worker scope/origin is host work outside this review.

Fresh authentication for header bootstrap does not itself approve a connection:
completion still checks exact claimed browser and original session, current project
rights, intent, policy and revisions. Reload/back discards OAuth response data and
uses original-session readback. Return correlators are non-authorizing wake hints.
No OAuth code/state/provider token/secret reference enters core, React or Agent
commands, storage, retained screenshots or public error bodies. All fixture tokens
are synthetic; prior failed logs remain unchanged.

## Integration and remaining gates

The public consumer installs a normal prepared packed projection and compiles
public exports with strict NodeNext/Bundler profiles. It is not a public Git install.
The receipt counts complete host examples plus fixture authentication, Node HTTP
bridge, installer, browser driver and network guard. Existing host auth, custody,
policy and executor infrastructure are explicit dependencies. Agent is absent for
manual setup; there is no hidden host Marketing wizard. The private-browser fixture
resumes from the original session using public HTTP commands; the separate React
consumer covers actual provider-review/account/identity/approval/recovery screens.

Marketing's standalone request counts cannot pass Preview's shared 120/minute budget
or full-app cold start. Repeat actual all-mounted-SDK accounting after host adoption;
do not raise the limit. No production Preview session/CSRF adapter is supplied. The new private-page
header seam covers advertising claim/completion. Manual creative secure entry is
still script-free native form submission and cannot send `x-preview-request`.
Therefore an unmodified Preview mutation-header policy cannot yet mount that
creative flow. Its public form/CSRF integration needs a separately reviewed design;
this review does not weaken the host policy or inject script into key entry.
CreativeConnections also still uses its older `sessions.current` port for external
sessions, not advertising's `SessionAuthority.withLiveSessions`. Its Store-session
regressions do not prove external host revocation-coordinated creative approval.
That external creative contract must be integrated and independently qualified
before claiming the complete reusable product on Preview.
Native Dart widgets, system-browser launch, app links, iOS/Android lifecycle,
authenticated byte/range media and actual device accessibility remain independent
gates. No WebView or cookie bridge is introduced. Live provider scopes/roles/Pages,
actual grants/configuration/credentials and paid generation/ads/events are out of scope.

Manual OpenAI/xAI ciphertext retention, current-use fence, harmless billing and
unknown-job reservation semantics remain separate; no provider/media expansion.
Full lifecycle/Studio/tracking/Results/lead/QA/recruitment and campaign material/ID
acceptance is not established by this source review. Agent 0.2.16
`e699cf960082d55a444dd8275f1b85f3cb682c65` is the newer supplied baseline; historical
0.2.15 pair proofs do not qualify it. Final exact-Git pair testing follows a separately
reviewed/authorized Marketing release. No commit/push/version/deploy, application
DB/migration/queue change, other-repository edit or isolated publication occurred.
Not Ready for Clinton.
