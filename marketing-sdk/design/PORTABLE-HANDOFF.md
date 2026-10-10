# Portable Connections protocol v1

Latest-state note: [Shared Connections review](SHARED-CONNECTIONS-REVIEW.md) and
[external creative sessions](EXTERNAL-CREATIVE-SESSIONS.md) supersede the earlier
script-free creative, historical-provenance and helper-count limitations below.
Those dated findings remain historical evidence. Current private creative pages use
isolated SDK scripts with required host headers and the shared SessionAuthority;
source-issued historical pending records safely restart without rewritten authority.


Normative additive contract, 2026-10-07. This supersedes the project-path callback
and request-start-only external session design for **new** Connections. Implementation
and verification receipts must identify any incomplete parts. No production host
adapter, native UI, device return or live provider qualification is implied.

## Authentication and final local transitions

The public server `SessionAuthority` port authenticates an incoming host request,
inspects an opaque server-side session binding, and runs `withLiveSessions` over a
bounded local transition. Bindings contain verified issuer/subject, SDK principal
mapping and nonsecret session reference. They contain no cookie, password, token,
email-based identity or client-authored membership. Host authentication uses its
existing session database. `Store.bindExternalPrincipal` remains the stable identity
mapping, not a session store. Its role comes from current authoritative project
authorization; a client-selected project never supplies that role.

Inspection must reject inactive/disabled users, revoked/expired sessions, changed
identity, kind, role/project rights and host authorization configuration. A revision
is an opaque equality fence covering those facts; expiry is checked at use. The
SDK separately checks exact intent, provider app, policy, connection and decisions.
Unavailable inspection or lock acquisition fails closed. Replacement sessions do
not inherit a binding even for the same issuer/subject.

Lock order is host revocation/authorization guard first, then the configured SDK
Store transaction guard, then record CAS. The reference authority uses that same
Store guard directly (nested transactions share it). Host logout, user disablement,
role/password changes and configuration changes must participate in the host guard.
It must remain held through the SDK commit acknowledgement. A SELECT before the
commit, process-local mutex in a multi-process host, or lease without fencing is
insufficient. Cross-database hosts hold their host guard while awaiting the bounded
local SDK transaction; they never acquire these locks in the reverse order. A
failed/unknown SDK commit is recovered by its existing request/record identity,
not replay of an OAuth code. No distributed transaction or shadow identity/session
database is introduced. Direct writes that evade the guard are not qualified.

Only bounded local metadata validation, encrypted local custody and SQL/CAS run
inside the guard. No provider HTTP, remote policy service, login or human wait may
run there. Host policy/inspection callbacks used inside it must be local and bounded.
Inspect both sessions before/after every provider boundary; final authority-bearing
transitions additionally use the guard. Restricted encrypted exchange outcomes may
be retained after revocation for recovery, but cannot promote authority.

## Initiation, independent browser claim and return

The existing start/review/approve commands retain exact project, provider/app,
operations, duration, revisions and original session before OAuth. `beginConnectionHandoff`
adds a version-1 `handoff` descriptor: opaque correlator, canonical trusted browser
start URL, expiry and fixed allowlisted `marketing` return-route ID. It is token-free
and authorizes nothing. `handoffPath` remains compatible navigation data. Stable
request keys and CAS retain lost-start/handoff acknowledgement recovery.

GET browser entry shows generic sign-in/recovery guidance when authentication is
missing or belongs to another actor. Host login is independent and never copies
the native cookie. After authentication, the SDK shows the exact retained approval.
An explicit same-origin POST claims it, comparing verified issuer AND subject and
inspecting the original session under the short guard. It binds the exact browser
session atomically and issues one separate high-entropy OAuth state. A later
browser login cannot replace it. No display-name or email matching is permitted.

OAuth state binds the original and claimed browser sessions, connection/approval
revision, provider/app, configuration and exact callback URI. Only its digest is
ordinary record metadata; existing encrypted custody retains the authorization URL
and PKCE verifier. Browser return carries only the correlator. It is a wake hint,
never success evidence. The original app rereads with its ORIGINAL current session.
Final creation of a ready local grant requires original-session `resumeConnection`;
browser completion alone cannot establish that the original app remains alive.
Web-only use has identical original/browser bindings and continues normally.

Native process death/new login allows authorized safe outcome/draft inspection,
not silent continuation. Explicit existing takeover discards old decisions and
credentials; unresolved exchanges first require original-outcome reconciliation.
There is no token handoff, cookie bridge, fabricated SDK session hash or new login.

## Stable callback and Strict-cookie ingress

One configured app per provider uses the fixed canonical HTTPS URI
`/api/marketing/oauth/{meta|google|linkedin}/callback`, identical across projects.
The origin is trusted server configuration, never Host/forwarded/client input.
Multi-app aliases are unsupported in v1; additional apps require explicit future
configuration and review, never arbitrary route input. Save the exact callback URI
and app digest when issuing state and reuse it verbatim for token exchange.
Existing encrypted project-path attempts retain their original URL through expiry;
they are not rewritten. App/secret/origin/policy changes invalidate pending attempts
and require fresh explicit consent, preserving their history.

The server-only `Store.locateOAuthState` queries only fixed `connectionCallback`
and legacy `oauth` kinds and one validated SHA-256 ID, with a two-row bound in the
SAME Store. Absent or ambiguous matches fail closed. It returns only internal
project/kind/record references. Canonical project loading and all session/provider/
app/intent checks follow. Locator output is never authorization or a public API.
No project enumeration, sentinel project, separate index store or signed state.

The narrowly classified callback **GET** is an unprivileged SDK landing, allowed
through the host's cross-site API guard only for those exact paths/method. It does
not authenticate, look up private state, exchange or grant access. A small private
script captures bounded code/state in memory, immediately replaces the URL with
its clean path, then sends a same-origin authenticated JSON **POST** to the exact
completion route. Completion checks Origin, fetch site, method/content type, closed
unique fields and bounded body; it resolves state internally and checks the exact
claimed browser plus original session before exchanging. All other API origin/auth
guards remain active; SameSite=Strict stays enabled.

No code/state in React, core commands, Agent tools, ordinary records, storage,
telemetry, referrers or screenshots. No durable code intake is needed. Missing login
discards the response and requests independent sign-in plus restarted consent; codes
are never saved across login/reload. Reload/back shows recovery, without replaying a
consumed code. Uncertain exchange stays unknown; lost commit acknowledgement uses
authenticated readback of the retained receipt. Return parameters create no grants.

SDK headers: no-store, no-referrer, nosniff, restrictive nonce CSP, no third-party
resources, no framing/base override. Host ingress MUST redact query/body capture
before dispatch, exclude these private paths from analytics/APM/session replay,
avoid injected resources, and keep them outside any service-worker control/cache.
The SDK cannot police reverse-proxy logs, extensions, preinstalled service workers
or arbitrary authentication middleware. Host TLS, ingress limits, clean login and
return paths, service-worker exclusion and exact mount order require separate proof.

## Preserved scope and qualification

No schema migration, native widgets, Dart changes, platform links, browser launcher,
native media transport or provider expansion. Manual OpenAI/xAI retention, exact
consent, final credential-use fence, independent billing and no-Agent setup remain.
Meta/Google/LinkedIn gates and campaign IDs/material/budgets/readback, reporting,
leads/QA/recruitment semantics remain independent.

Required synthetic proof: real SQLite and isolated PostgreSQL; public imports and
external existing-session fixture with no SDK passwords; independent browser login,
Strict callback without cookie, dual revocation/expiry/role/config races, final commit
vs logout/disablement, ambiguity/swaps/provider/app/project checks, callback replay,
lost acknowledgements/process death and original-session resume. Browser guard and
local negative controls precede 1440/390/320 keyboard/back/reload and pixel review.
Historical two Facebook navigation failures remain FAILED and byte-preserved.

Target Preview still needs public inspection and a revocation-coordinated local
commit guard (qualified source `a9d31a1…`); this SDK work does not supply that adapter.
Flutter still needs independently qualified launch/app-link return, process lifecycle
and SDK-owned native presentation. A later native media byte/range stream must use
the current original host session, pin HTTPS origin, deny redirects, bind project/
asset and MIME/range/size, and avoid credentials in URLs or external player requests.
Device return only wakes an authenticated reread; it never imports authority.
Live apps/accounts, native/device QA, independent security/product review, full
Studio/tracking/Results/lifecycle and personal platform validation remain gates.
Not Ready for Clinton.

Provider callback references: [Google exact redirect validation](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri-validation),
[Meta strict mode](https://developers.facebook.com/documentation/facebook-login/security#strict_mode),
[LinkedIn authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).
Google and LinkedIn were reread for this work; Meta retrieval failed, so its supplied
verified requirement is retained without claiming a fresh successful source read.

## Public consumer wiring and implemented limits

The implemented server exports are `SessionAuthority`, `SessionBinding`,
`SessionInspection`, `createStoreSessionAuthority`, `sessionBinding`,
`inspectLiveSessions` and `classifyConnectionRoute`. `ConnectionsOptions.sessionAuthority`
selects the host adapter; omission uses the existing Store sessions. New external
setups fail closed without the port. `Principal.externalIdentity` contains the
verified issuer/subject; `externalSessionRef` is the host's nonsecret session ID.
`SessionInspection` contains binding, projectId, current role/kind, expiresAt in
milliseconds and an opaque revision. The SDK checks exact snapshot equality and
expiry inside its SQL transaction immediately before commit, while the host guard
remains held. Reference Store writers already use the shared transaction guard.
Hosts must also coordinate authorization-policy/app-configuration changes with it;
an arbitrary callback that changes configuration outside that guard is unqualified.

```ts
import { createConnections, classifyConnectionRoute } from '@handrail/marketing/server';
import { externalSessionAdapter } from './external-sessions.js';
// externalSessionAdapter is the compiling public-only example, not a host auth engine.
const adapter = externalSessionAdapter(store, existingHostSessions);
const connections = createConnections({
  store, custody, accessPolicy, sessionAuthority: adapter.authority,
});
const routes = connections.routes({
  origin: configuredHttpsOrigin,
  authenticate: adapter.authenticate,
  loginPath: '/login', returnPath: '/marketing',
});
// At ingress, BEFORE ordinary API authentication:
// classifyConnectionRoute(pathname, method) === 'callback_landing'
// permits only the SDK unprivileged GET landing. All other classes retain guards.
```

Use [the complete Fetch mount](../examples/connections-server.ts) to compose this
with MarketingServer/NativeProvider. Use [the external adapter](../examples/external-sessions.ts)
for the existing host's verified authentication, inspection and revocation lock.
The example's project-route authentication checks host project membership before
refreshing `Store.bindExternalPrincipal`; request fields never supply the role.
Stable callback authentication needs no client-supplied project: the private locator
resolves it, and both authoritative session inspections check it again. The SDK
never accepts an external session ref as a login credential.

The Fetch mount is 59 lines; external adapter 58; existing React mount 14 (131
combined). This excludes the existing host's authentication/database/lock/custody,
Node HTTP bridge and ingress. The synthetic host SQL/session helper, browser harness,
installer/build and network guard are separately inventoried in the artifact glue
manifest. The fixture uses real SQL host tables and zero SDK password/session rows;
its shared SQL guard demonstrates the port, not a cross-database production adapter.

Existing `startConnection`, review/decision, `beginConnectionHandoff`, `connection`
and `resumeConnection` commands remain the public interaction path. The descriptor is
`{ version: 1, correlator, browserStartUrl, expiresAt, returnRouteId: 'marketing' }`.
Claim GET renders retained project/operations and exact prior provider approval;
claim POST carries only the expected revision, checks exact Origin, and returns the
private provider navigation location. Its nonce script uses Fetch so no-referrer
does not turn a native HTML form's Origin into `null`. OAuth state never enters the
ordinary core/React client. Completion POST accepts only `{ state, code }` on the
private route, and returns only `{ correlator }`. Denial uses a null code. Return
query `correlator` never selects project/account or conveys success. The original
client reads `connection({ connectionId: correlator })` in its retained project and
session, then uses normal reviewed commands; `resumeConnection` refuses browser-only
grant creation with `original_session_resume_required` and SDK recovery copy.

The old `oauth` record kind remains an internal locator kind for existing grant-only
flows. Its project-path completion retains that historical contract and cannot
create a new Grant; external hosts must restart such legacy flows through new
Connections. No stronger dual-session or modern PKCE-custody claim is made for
historical grant-only records. Historical **Connection** attempts use the exact URI
already sealed in their authorization URL when newer metadata is absent.

Checks and failures are retained under `artifacts/portable-handoff/`. This work's
input matched both supplied custody hashes and all 6,213 historical entries;
all later review receipts were inventoried too. At worker start, the clean checkout
was `c39c095e9f657f5cabe320d7b0aa1e0987d15012`, version 0.1.8. Only package.json and
package-lock.json differed from the 121-file reviewed source manifest; neither is
modified by this work. The final verification/custody receipts distinguish each
tested source snapshot, inherited failures and remaining qualification gates.

## Independent review amendments · 2026-10-07

The [security review](PORTABLE-SECURITY-REVIEW.md) supersedes the candidate's
historical-record and fixed-glue-count claims. Missing retained session/decision
authority requires a safe restart; preserving an old issued callback URI is not
proof of that authority. Actual historical durable-record compatibility is unverified.

`routes({ mutationHeaders: async request => ({ 'x-preview-request': '1' }) })`
is the public private-page host-header seam; use the host's actual required value
and CSRF mechanism. The same option is passed through the Fetch mount example.
The authenticated GET `/complete` returns only these headers after URL scrubbing;
it reads no OAuth state and causes no provider effect. Claim HTML safely embeds
its authenticated headers. Host middleware validates every mutation normally.
Ordinary core calls use `createMarketingClient`'s existing injected fetcher, which
can add current host headers without copying SDK commands. No browser header is
accepted as an actor, role, session reference or project membership.

`MarketingWorkspace` and `MarketingConnections` accept `visible` and `sessionKey`.
Set visible false/unmount for host navigation, and replace the client or sessionKey
on login/logout/project change. Unsent reads are suppressed and pending reads fenced
on disposal/document hiding. Return triggers a fresh read. Relevant pending work
has bounded five-second refresh; idle views have no polling. An aborted mutation
may already have committed, so resume/readback retains its original identity.
The receipt reports standalone counts, not shared Preview cold-start acceptance.

Legacy grant-only `oauth` records likewise lack original-session, app and issued-URI
provenance. The portable HTTP handler now rejects completion without consuming them;
the reference host's direct GET-exchange fallback was removed. Safe restart is required.
Manual creative script-free forms do not use the new advertising header seam and
cannot send a required `x-preview-request` header; that Preview integration remains
an explicit blocker, not permission to waive its mutation policy.
