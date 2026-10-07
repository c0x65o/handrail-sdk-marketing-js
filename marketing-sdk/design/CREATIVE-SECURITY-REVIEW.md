# Manual creative Connections security review

Work request `efc0cb63-6fd4-4d9c-a6f0-134cbe8abc96`, 2026-10-07. Workspace-only
review of the manual candidate, distinct from read-only checklist monitoring.

**Verdict:** the original candidate required corrections. The bounded SDK web
journey is implementable without Agent and without a host provider form. This is
not live credential/provider qualification, a complete Marketing product, native
support, Preview adoption or Ready for Clinton. Final check results and exact
source hashes are recorded in `artifacts/creative-security-review/verification.json`
and `custody-final.json`; predecessor receipts are historical evidence only.

## Source and custody

Current-context MCP confirmed the active work request and authentication snapshot
`08346f8bc724`. No applicable AGENTS.md or repository skills were present. No
subagents, other repositories, control-plane mutations, application database,
migrations, real keys, OAuth, provider requests, spend, release or Git writes were
used. HEAD remains `fe24434b620ca143cf2f9b6124a7dc6a8cac04cf`, package 0.1.7.
Before editing, all 114 source hashes matched candidate digest
`a8923f4390eaf7e0f72c48fd193f9fd5f5889d0a2ef4493251dbe0efe0bfebca`, with 37
status entries. Candidate custody SHA-256 was
`130d346fae16b1eb03cc922a2ad8e53427ad07693f53fc43f82d917dd857fa68`.
All 4,974 predecessor artifacts, including 58 original receipts, and 211 candidate
manifest entries matched. The input manifest retains hashes of all 5,187 artifacts
present before this review. Historical two synthetic unauthenticated Facebook
navigation isolation failures remain **FAILED**, independently of new guard proof.

## Corrections

- Disconnect previously overwrote the encrypted vault envelope with a tombstone.
  It now changes the binding state only. Source revocation fences dependent use;
  ciphertext, history, independent grants, unknown jobs and reservations survive.
  Cancel before saving creates no vault tombstone. The unused destructive custody
  `revoke` helper was removed; no physical cleanup is inferred.
- Approval now checks review expiry again after awaited custody/authority work;
  late consent rolls back the vault write. Access expiry is checked at the end of
  the authority guard as well as before use.
- Reuse checks encrypted custody availability. Start rechecks source/grant and
  current authority after asynchronous policy calls, inside the existing SQL
  transaction; stale options cannot commit a new intent. Grant identity and source
  project fields must match the selected record. Host model/grant inventories must
  be arrays: a malformed string cannot authorize guessed grant-ID substrings.
  Status rechecks after retention
  inspection so it cannot return earlier configured evidence after revocation.
- The executor previously awaited `beforeWrite` after releasing the key, without
  rechecking creative binding revocation. An optional pre-transport custody fence
  now runs after that await (and before video reconciliation transport). The public
  creative composition wires `assertCredentialAccess`; this reuses the existing
  binding/authority guard without decrypting again. Legacy credential callbacks
  still run once, and denied late use retains the billing reservation.
- Return paths reject whitespace/control/backslash URL normalization escapes and
  must resolve to the canonical origin. The local HTTP exception is explicitly
  HTTP on 127.0.0.1, not arbitrary schemes with a loopback hostname.
- Native form validation errors now redirect to an authenticated GET notice with
  a closed, nonsecret reason; reload cannot resubmit the credential POST. Ordinary
  Fetch errors retain HTTP error status. Notice parameters convey no authority.
- Private page and error headings receive focus using native HTML autofocus;
  keyboard users land on the new page summary without adding a script to entry.
  Expired reviews now say expired and direct cancellation/fresh review, rather than
  reporting a missing key and inviting approval through an unavailable form.
- Pixel review found clipped native select labels at 320px and excessive heading
  wrapping at 200% CSS zoom. Native radio groups now expose complete wrapping
  model/source/grant/expiry choices without scripts; responsive spacing and heading
  sizes preserve usable narrow content width. Exact expiry labels explicitly say UTC.

## Authority, custody and recovery

The SDK owns requirements, model/source/independent-grant/duration selection,
exact review, script-free key entry/approval, status, reuse, disconnect and recovery.
Host authentication is trusted input, then current human membership/session is
rechecked. Agent users cannot approve. The key owner is the configuring human;
a different administrator neither inherits that key nor receives private status.
Creative admin-revoker UI is not implemented. Existing host membership/session or
independent grant revocation fences use without revealing credentials. Advertising
admin revocation is separate and unchanged.

The host's `accessPolicy` authorizes configuration/reuse for the current principal,
project and provider, and supplies the fixed environment, current revision, model
allowlist and finite maximum duration. `grantIds` is an inventory of independently
issued existing GenerationGrants, not a grant-creation callback. Configuration with
no grant is permitted but creates no generation/spending authority. Source reuse
requires the same owner/project/environment/provider/model and original policy,
source revision, original current session, expiry and independent grant if bound.
Guessed IDs, other owners, changed policy/session or unavailable custody cannot
confer access. New policy or logout can require disconnect and fresh entry/review;
there is no silent credential migration, rotation, takeover or session rebinding.

Each fresh intent gets a distinct random vault ref; approval replay returns the
original receipt without overwriting its key. Vault write, binding and event commit
use the same existing Store transaction. SIGKILL before commit rolls back all local
writes; death/lost acknowledgement after commit recovers the original intent.
There is no external Vault write to reconcile in this adapter and no parallel
secret store. An external nontransactional custody implementation would require
its own separately reviewed recovery contract; this evidence does not qualify it.

Close/back/reload preserve nonsecret server choices. Password input is not echoed;
reload needs fresh input before an uncommitted save. Cancel/disconnect invalidate
use. Expiry and policy loss also fence future resolution. Already dispatched or
unknown paid effects retain their operation identity and spend reservations.
These actions do not revoke a provider-wide key, delete another grant, refund
spend or cancel an already submitted job.

No retention purge is implemented. The existing custody owner must authorize any
later physical erasure, check dependent bindings/retained jobs/audit records,
retention periods, legal holds, backups and key-rotation policy, and retain required
idempotency tombstones. The review neither chooses a retention duration nor deletes
ciphertext. Reconnecting allocates a new envelope and requires exact fresh consent.

## Private ingress and harmless status

The Fetch route enforces canonical origin/HTTPS (local fixture exception), current
human auth, exact POST Origin, method, form content type, 16 KiB streamed body limit,
closed unique fields, no arbitrary query (only closed GET notices), allowed fetch-site, finite review/revision binding,
no-store, CSP frame-ancestors/form-action/default-src/base-uri and nosniff. Output
escapes metadata and projects safe status/events; it never echoes key, ciphertext,
secretRef or exception body. Entry has no script, telemetry or React state. Public
Marketing commands do not accept an API key. Password input remains masked in all
new entry screenshots. A local return contains no credential or authority.

These controls start **after** the host has received the Request. The public SDK
cannot redact reverse-proxy access logs, APM/body capture, request clones supplied
to authentication middleware, exception instrumentation, browser extensions,
autofill/password managers or a previously installed controlling service worker.
The host must exclude these routes from body/URL capture and session replay before
parsing/dispatch, avoid analytics injection, serve over its canonical HTTPS origin,
stream rather than prebuffer unlimited bodies, and keep secure entry outside any
service-worker-controlled/cached scope. `autocomplete=off` is a hint, not proof of
browser nonpersistence. The fixture Node bridge buffers up to 256 KiB before the
SDK's 16 KiB limit; it is test infrastructure, not a qualified production ingress.
Same-origin referrers allow native form POST Origin; only clean nonsecret paths
are used. A host injecting secrets into metadata is outside this safe metadata
contract. None of these host obligations is proven by a synthetic browser run.

Billing inspection calls only the optional `inspect`, never `authorize`, provider
transport, generation or reservations. The built-in adapter reads exact matched
project/grant/provider/model/capability/currency/current quote metadata. Setup
always says paid operation blocked and provider unverified. Existing paid executor,
quote/ceiling checks, credential callback and unknown-job fences remain intact.
The manual composition also binds the optional final custody-use fence. Consumers
composing NativeGeneration directly must wire both `credentials` and
`assertCredentialAccess` to retain this late-revocation protection.
Custom host billing inspection must actually be side-effect-free; a TypeScript
interface cannot constrain arbitrary host callback code. Key configuration proves
neither provider key validity nor account/model entitlement.

## Integration and qualification limits

The public examples compose existing Store, cipher custody, current authentication,
session and permission policy, billing and branding. They use public exports and
normal package prepare. `HostAgent` here is the SDK's existing credential broker,
not an Agent SDK installation or agent approver. The consumer starts with zero
advertising/generation grants, imports public entry points and renders the SDK UI.
Synthetic SQL grants in domain tests exercise preexisting-authority matching; they
are not required or seeded in the manual browser consumer.

The two server examples plus React mount total 93 source lines; that excludes
existing host auth/session/custody/billing/permission implementation and HTTP
adaptation. The glue manifest separately counts the complete generated app,
fixture login/provisioning, Node bridge, policy/billing stubs, package installer,
browser assertions and egress guard. Those fixture helpers are not claimed as
production glue. The uncommitted pack projection is not a public HTTPS Git/full-SHA
installation. Such installation with a matching lockfile remains unverified until
separately authorized publication; no forbidden SDK dependency was introduced.

OpenAI images and xAI video remain separate from advertising. xAI is not X Ads;
generated video cannot publish on initial ad surfaces. LinkedIn publishing stays
blocked on its separately qualified organization permission/app contract. Existing
campaigns, grants, IDs, media bytes, approval/readback, daily denials, budget holds,
reporting and submission/person/QA/recruitment semantics are regression obligations.
Native Flutter initiation/return and dual-session binding remain unqualified. No
cookie bridge, WebView, new identity scheme or native package was added. Coherent
Studio/tracking/lifecycle/Results, actual Preview adoption, native QA and dot's
target-platform review still gate complete Marketing and Ready for Clinton.
