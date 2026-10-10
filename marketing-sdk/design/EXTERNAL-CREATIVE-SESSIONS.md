# Shared external sessions for manual creative setup

Workspace candidate for `791d470c-b78f-43e4-a3fb-ab9b6c0c5cad`. This continues the
portable review; it is not release acceptance, production host qualification, or
Ready for Clinton. Marketing stays at 0.1.8. Historical receipts remain unchanged.

CreativeConnections now accepts the same public `SessionAuthority` as advertising.
The public manual factory passes that exact instance to both services; mismatched
stores or authorities fail at composition. `sessions.current` is no longer a
creative option. Existing Store sessions retain their public adapter. External
hosts use existing authentication, independent current session inspection, and
revocation coordination; no SDK password or SDK session is created. The public
`externalSessionAdapter` maps authenticated issuer/subject only after inspecting
current project membership. Neither request JSON, a public userId, nor a header
establishes identity.

Every setup context rechecks current human role, identity, session, project and
finite expiry around awaited policy calls. Original session inspection and exact
policy/consent/provider/model/purpose/environment/expiry/revisions bind review and
approval. Status/reuse revalidate current rights, retained source revision, custody
presence and independent grant. Start, custody-attempt reservation, final metadata,
cancellation and local disconnect use host revocation guard → SDK SQL transaction
→ CAS, with an expiry/revision inspection inside the transaction before commit.
Access policy and inspection inside these transitions MUST be bounded local reads.
No provider, key-service or billing network call belongs inside the guard.

A single durable `creativeCustodyAttempt` record reserves key entry before custody
runs outside the host/session lock. Metadata becomes configured only after custody
returns and a guarded recheck passes. Lost final acknowledgement reads the same
configured intent without writing a new key. A crashed or uncertain custody attempt
stays fenced: reload exposes recovery, retains any ciphertext and requires explicit
cancellation plus fresh review. It never replays key retention, silently overwrites
the original, deletes ciphertext or promotes an uncertain save. Disconnect revokes
binding use and dependent bindings; it does not physically erase retained data.

## Private host-header submission

Both route factories accept the existing public `mutationHeaders(request)` seam.
The host supplies bounded `x-*` CSRF/mutation values only after authentication and
must validate them on every mutation. For example `x-preview-request: 1` is a
mutation convention, not an identity. Core callers use their existing injected
fetcher for the same host headers. No origin or CSRF check is bypassed.

The SDK private creative document owns an isolated nonce-CSP submission script.
Native form navigation is disabled by CSP. The script reads the dedicated masked
password field only on submit, sends a same-origin fetch with required host headers,
clears the field immediately, refuses redirects, and navigates by GET to the SDK's
returned local outcome. No secret enters React, ordinary commands, agent tools,
URLs/history, storage, telemetry or retained screenshots. Reload/back/pagehide clear
entry; network uncertainty offers original-intent readback. JavaScript is required
for submission. The server retains bounded form parsing, exact Origin/Fetch-site
checks, duplicate-field rejection, safe notices, no-store and no-referrer. Hosts
must not insert telemetry or third-party scripts in this document.

These SDK controls do not prove redaction at ingress, extensions/autofill behavior,
or service-worker exclusion before handoff. Host deployment must exclude private
routes from request capture, analytics, caching and pre-existing service-worker
control. A post-arrival controller check is insufficient. A clean loopback consumer
with workers blocked qualifies only its synthetic fixture.

## Interactive setup versus execution authority

Logging out neither deletes a persistent credential/billing binding nor grants new
paid authority. Under the existing execution contract, `credentials` and the late
`assertCredentialAccess` fence still require the original current human session,
current policy/source and independent generation grant. An ended session makes use
unavailable while retained ciphertext remains. No background actor/session policy
was added. A host seeking unattended execution needs a separately specified and
reviewed execution-authority gate; a configured credential alone cannot supply it.

Setup/status never invoke billing `authorize`, reserve cost, create generation
grants or contact providers. Harmless `billing.inspect` is a separate host contract.
Configured custody, provider-unverified and billing metadata remain distinct. Exact
quote/currency/model/capability/expiry/ceilings, last-use checks, unknown-job
reservations and existing paid executor ownership remain in effect.

## Authentic historical callback shapes

`tests/historical-source-consumer.mjs` installs published 0.1.8
`c39c095e9f657f5cabe320d7b0aa1e0987d15012` and 0.1.7
`fe24434b620ca143cf2f9b6124a7dc6a8cac04cf` through exact HTTPS Git dependencies,
normal npm prepare and matching consumer lockfiles. Git object hashes independently
check installed source and the prepare manifest. npm omits the dependency's own
package-lock from its packlist; its Git blob is checked against the prepare
manifest, and the installed consumer lock is retained separately. No sibling link
or mutated modern record stands in for older source.

The old implementations create their own pending attempts with synthetic transport,
owned SQL and cipher keys. Exact issued URI/state and raw record body strings are
retained before the candidate opens the same database. No production OAuth data,
real-account access or provider exchange is involved. The final verification receipt
records execution verdicts; a source-generated fixture is not real-account proof.

* 0.1.8 pre-grant `connectionCallback`: project-path URI and sealed authorization
  evidence exist, but independent current SessionAuthority/claimed-browser provenance
  does not. Private completion requires fresh consent and leaves records unchanged.
* 0.1.7 HostAgent grant-only `oauth`: a separate shape lacking original-session,
  provider-app/issued-URI and exact decision provenance. It requires a separate
  fixture and safe restart. The candidate must not recreate its existing Grant,
  consume its state, exchange a code, or silently move it to a stable callback.
* Modern records with complete retained authority and an old issued URI may continue
  only under that exact URI, current authorization and matching config. This is a
  modern compatibility case, not authentic historical provenance.

Old creative records without the new inspection snapshot likewise cannot be
silently given authority. Their owner can inspect retained status and explicitly
cancel/disconnect using a current authorized session, then start a new exact review.

## Evidence and next gates

The external fixture now supports independent host and SDK SQL databases, a separate
request-authentication connection, and revocation writers in a separate process.
This is an owned disposable host adapter, not Preview's production adapter. All
production logout/disable/role/project/config/password writers must participate in
the host lock; restoring rights must invalidate prior authority revisions. The
fixture does not prove that an unknown production writer participates.

Exact checks, failures, source/custody hashes, host helper counts and browser pixel
observations are under `artifacts/external-creative`. Preserve the 6,818 entry files,
including all 6,481 review-entry artifacts, later receipts and both original FAILED
Facebook isolation attempts. No aggregate expected over five minutes is required;
run bounded suites sequentially with one test worker. MariaDB/native/full aggregate
results must not be inferred from SQLite/PostgreSQL selections.

The public candidate consumer uses the packed prepared projection because this
workspace is uncommitted. Only the historical fixtures prove published exact-Git
installation; candidate exact-Git qualification needs a separately authorized
release. Host glue inventory includes every server/React example, external adapter,
fixture authentication, HTTP bridge, installer, browser driver and network guard.
There is no copied host provider form, SDK-private import or raw-cookie bridge.

Visibility/disposal and the shared 120 requests/minute host limit remain unchanged.
The earlier bounded standalone read proof is not full mounted-app accounting or
long-running-work UX. Independent source/security review of this final candidate,
production host revocation/ingress/service-worker proof, native Dart/device
return/media/accessibility, live entitlement, full Studio/tracking/Results/lifecycle
and actual target-platform review remain explicit gates. No paid/live effects,
other-repository writes, commits, pushes, version changes or publication are authorized.

## Independent shared review amendment

See [the shared review](SHARED-CONNECTIONS-REVIEW.md) for the final bounded verdict.
Source-session inspection is repeated after awaited custody/SQL reads; a logout
there cannot leave reused status configured. A newer authorized session now sees
still-live same-owner source bindings in the private picker and must approve a new
exact binding. Both source and current sessions remain required; neither ciphertext
retention nor billing metadata creates unattended execution authority. After source
session loss, sign in, disconnect unavailable bindings and start fresh review/key
entry. Do not weaken the source guard to turn retention into background permission.
The prior four-helper/156-line number describes only exported examples, not total
host integration. The shared review inventories complete support and harness files.
