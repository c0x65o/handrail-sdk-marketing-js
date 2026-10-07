# LinkedIn Connections independent end-to-end review

Work request `27455f5b-9e18-4740-864e-6fa7ef90c396`, 2026-10-07. Source and
synthetic HTTP qualification only. The initial candidate requires the corrections
below. Exact final checks and verdict are recorded in
`artifacts/linkedin-e2e-review/verification.json`; hashes and preservation checks
are in `custody-final.json`. This review does not qualify live access, native UI,
Preview adoption, publication or Ready for Clinton.

## Entry custody and scope

Before edits, all 119 source files matched candidate digest
`7990b09f37a86c742769a75de216603dd51c2f049004f5ee6345b67a9e222593`.
Candidate custody SHA-256 was
`a42e66070fc73af2f0d72c58ac0068b5bb1d2f9288be32e0b263206ec0e99c83`;
artifact manifest SHA-256 was
`625d1ad983f26a5829f3704ccd672a37dbe7a50924da56f394fccb73b7e36145`.
All 5,475 predecessor entries, including the older 5,187, and 736 candidate
manifest entries matched. Entry inventory covers all 6,213 existing artifacts.
Historical two unauthenticated Facebook navigation failures remain FAILED and
byte-preserved; successful guarded checks do not relabel them.

Handrail current-context read confirmed this task and authentication snapshot
08346f8bc724. No applicable AGENTS.md or skill was found for this repository review.
No other repository was modified. Baseline remains
`fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, version 0.1.7. No commits, push,
lock/version changes, release, deployment, schema changes, host database/queue
writes, real credentials, provider requests, OAuth grants, ads, spend or events.
Test stores are disposable real SQLite and isolated socket-only PostgreSQL.

## Corrections and native integration

- `r_ads` was already recognized by the candidate's native client. New regression
  coverage now creates a NEW reporting Connection through the actual SQL,
  custody and consent flow, invokes NativeProvider/native client verification,
  and persists a real SDK metrics snapshot through synthetic analytics HTTP.
  There is no substitution of `rw_ads` and no organization request on this path.
- NativeProvider previously projected prepare/activate/pause from management
  scope, a runnable account, matching organization reference and social-write
  scope. It did not establish account/Page roles or the complete publishing scope
  bundle. Native verification now reuses the bounded Connections finders and
  same-member ACL join. Campaign creation requires CAMPAIGN_MANAGER,
  ACCOUNT_MANAGER or ACCOUNT_BILLING_ADMIN and ADMINISTRATOR or
  DIRECT_SPONSORED_CONTENT_POSTER on the exact associated organization.
  VIEWER/CREATIVE_MANAGER and unqualified content-admin aliases cannot create
  campaigns. All six supported role combinations reach actual native preparation
  and readback with synthetic HTTP, rather than merely passing discovery.
- The native pre-write hook checks the same current scope/role/organization
  contract after transport awaits and rechecks local executor authority before
  dispatch. Page-denied publishing leaves separately verified reporting usable.
  Report and safety-pause checks do not call Page APIs; pause requires current
  campaign-capable account authority and `rw_ads`, without imposing new Page
  scopes on historical safety pauses. Campaign-specific eligibility, billing,
  exact approval, budget, material and readback fences remain independent.
- Native token verification no longer trusts cached refresh scopes over current
  introspection or treats an account GET as proof of an inactive token. Active
  historical `rw_ads` grants still support reads. Missing current scope evidence,
  expired/inactive tokens and contradictory client/status/auth-type metadata
  require fresh qualification. Native client requests reject redirects.
- Missing exchange scope remains a provisional expected consent envelope only.
  Before the first finder and before promotion, fresh introspection must match
  that exact envelope, including rejecting extra scopes. Thus missing returned
  scope cannot infer provider authority from the requested or configured list.
  This preserves the original durable callback receipt rather than replaying a
  consumed code to obtain missing evidence.
- Contradictory state on any ACL row for the selected organization denies the
  Page snapshot, including an approved role alongside a revoked unsupported role.
  Pagination remains complete and bounded, including empty continuation pages;
  next links have a 4 KiB limit and are reconstructed only for the same finder.
- Publishing-only app metadata no longer invalidates a separate reporting or
  pause-only Connection. OAuth client identity/secrets and the current host policy
  remain bound; publishing still requires its full app configuration digest.
- Public account and identity choices now display complete provider IDs alongside
  names. Identical names and identical four-digit suffixes can be distinguished;
  typed IDs still cannot replace opaque selection references. Control and bidi
  override characters are removed from display labels. Unmapped internal
  checkpoint codes use ordinary recovery copy.

The [official introspection reference](https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection)
was rechecked: active status and optional scope/client/expiry metadata are provider
observations, not configured permission evidence. No documented exception supports
ignoring an inactive result after an account read. The
[account-role definitions](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-account-users?view=li-lms-2026-09)
were rechecked for reporting, creative-only and campaign-management distinctions.
The candidate's retained official sources and [LinkedIn contract](LINKEDIN-CONNECTIONS.md)
remain authoritative for Advertising product/scopes and narrow Page role mapping.
No blanket Community Management requirement, `rw_organization_admin`, conversion
scope, organizationLookup fallback, role-request write or 403 scope expansion.

## Product and regression evidence

The packed public consumer uses SDK UI, public imports, Fetch routes, real HTTP,
disposable SQLite and no Agent at 1440/390/320. It now supplies two identically
named LinkedIn accounts ending in 2041 and selects the full ID explicitly.
The existing exact access review, account/Page choice, app configuration help,
reporting while publishing is blocked, retry, back, reload, cancellation,
revocation and lost acknowledgements remain qualification cases. Screenshots are
inspected separately; exact results and limitations live in the artifact receipt.
The loopback proxy is preflighted before browser launch, then browser negative
controls cover redirects, popups, images, frames, fetch, CONNECT and WebSockets;
service workers are blocked. No provider navigation is permitted.

The server example and React mount are unchanged: 58 + 14 source lines, excluding
existing host authentication/session policy, Store, protected app/cipher and
executor infrastructure. All generated app, Node bridge, login/provisioning,
synthetic provider, installation/build, browser assertions and guard helpers are
inventoried separately in `glue-manifest.json`. No host LinkedIn form or provider
logic was added. This is an uncommitted packed projection, not proof of a public
HTTPS Git/full-SHA dependency installation with matching lockfile.

Focused regressions preserve campaign IDs/material/readback, lost-ack read-only
reconciliation, daily Meta denial, budget reservations, reporting and
submission/person/QA/recruitment semantics. Advertising and creative crash tests
retain original operation identities. Manual OpenAI/xAI ciphertext retention,
credential-use fence and zero-effect billing inspection are unchanged and receive
focused regression coverage. The whole native aggregate is expected to exceed
five minutes and is skipped per task; targeted LinkedIn native preparation,
readback and historical safety pause run separately. No full native/media,
live-provider, real device, screen-reader or native accessibility claim is made.

## Remaining native and host gates

The supplied read-only Preview source qualification is
`a9d31a1a829c88e9e4c6e0d954a32365c25effb7`: Auth.resolve returns verified user plus
nonsecret session UUID; private marketing.bind rechecks app_sessions. Public
session inspection and a local commit guard are missing. This review does not
independently inspect or modify Preview and implements no new native auth API.

The next bounded contract is SessionAuthority.authenticateRequest,
inspectSession and withLiveSessions for short local commits; a system browser
must authenticate independently and explicitly claim the same verified actor.
Recheck both native and browser sessions before and after remote awaits and at
local promotion. SameSite=Strict/cross-site API middleware requires an SDK callback
landing followed by fresh same-origin authenticated completion. Return only a
non-authoritative hint; resume through the original authenticated native session.
Store.bindExternalPrincipal alone does not bind an external host session. No Lax
cookie copy, cookie bridge or WebView. This remains separately scoped security
architecture and native product work, not an owner question in this source review.

Actual app 265827087 runtime client binding, enabled product/scopes, member token
and account/Page roles remain UNVERIFIED. Conversions Standard approval is neither
Advertising Standard nor organization permission. Host ingress/session/retention
qualification, authorized live account checks, native presentation and dual-session
handoff, Preview adoption/device QA and the remaining Marketing lifecycle,
Studio/tracking/Results product acceptance remain open. No isolated publication.
