# Measurement qualification, 2026-10-14

## Execution follow-up — 2026-10-14

The subsequent execution goal repaired the LinkedIn prerequisite producer and
the native execution fixture. A real connected LinkedIn account can now obtain
durable prerequisite evidence through `checkCampaign`; exact grant/organization,
current account role, Page role, scopes, serving status, targeting, material and
tracking configuration remain checked. Checks allow only provider REST reads and
the token introspection POST; they perform no advertising writes or token refresh.
The prerequisite contract revision invalidates older proofs and requires a fresh
check before execution. No campaign spending approval is granted by a check.

All 30 LinkedIn native connection/execution tests pass on disposable PostgreSQL,
including the previously failing preparation/readback and lost-ack reconciliation
cases. Added tests cover durable retry replay, stale material, and changed Page
role/account status/scopes. All 36 existing Meta prerequisite tests also pass.
Fixtures now retain campaign/destination/tracking and obtain checks through the
actual service instead of bypassing the prerequisite contract. Native write guards
were preserved. The normal SDK build (including TypeScript compilation) passes.

LinkedIn role/scope behavior was checked against the official account access and
marketing concepts references:
https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/account-access-controls
https://learn.microsoft.com/en-us/linkedin/marketing/getting-started

These tests intercept external provider HTTP; live Handrail execution, historical
adoption, recruitment tracking, placement expansion and full cutover still need
their separate implementation and verification. The historical measurement-only
qualification record below is retained.

The measurement change is scoped to provider reporting, durable evidence and the
existing reporting service. It grants no provider write authority and does not
qualify campaign publication or browser verification.

The focused disposable-PostgreSQL run covered measurement, collectors, providers,
provider review, native writes, service and capabilities: 88 tests passed before
the final equivalent-instant regression was added. It exercised Meta cursor
pagination on trusted endpoints, LinkedIn date partition failure, denied and
expired credentials, retries and safe receipts, placement reconciliation,
weighted CPM, outbound CTR, null versus zero, window/currency mismatch, DST,
immutable corrections, concurrent replay, persistence across reopening, and the
real authorized syncMetrics-to-results evidence link. Google retains its existing
reporting implementation; only Meta/LinkedIn were replaced here.

A full SDK PostgreSQL run reported 697 tests: 674 passed, 20 failed, 3 skipped.
Three failures were corrected: the Meta native-write reporting fixture now
includes real report identity/date fields; the LinkedIn invalid-row test now
asserts unknown metrics plus a durable rejection reason instead of requiring an
exception; and the capability reconciliation fixture authenticates a real Store
session. The focused rerun above passed these cases.

The other 17 failures are in linkedin-native-connections.test.ts publication and
write-recovery qualification. Re-running that file with the exact previously
committed providers.ts from 077f02b51f898749d7d554dc844989d11f2c899f reproduced
17 failures and 9 passes. The fixture does not establish the current preparation
prerequisite records and fails before those writes. That comparison replaced only
the NativeProvider import and retained the other SDK modules, which this change
does not alter for publication. No production guard was weakened, and the test
expectations were not lowered. They remain a separate execution-qualification
issue; the full SDK suite is not claimed green. Temporary baseline source/build
files were removed after comparison.

Provider external requests in these tests use explicitly synthetic HTTP fixtures.
They do not prove live provider behavior. Live Handrail reporting qualification
and its public Git dependency installation belong to the consumer integration.

Final checks after the equivalent-UTC-instant and scope validation changes:
`npm run build` passed; all 18 measurement/collector checks passed; and all 36
service checks passed against disposable PostgreSQL. The final service check
requires evidence provider/account/campaign/window to match the authorized
reporting scope before persisting its reference.


Observed-spend contract v0.1.13: normal build and strict public consumer compile
passed. All 14 measurement tests passed against disposable PostgreSQL, including
current-day observed spend versus unknown final totals, explicit zero, immutable
inputs, missing rows, expired-credential evidence, partial pagination, freshness,
future/synthetic observations, overlap and incompatible currencies/windows.
This is an observation API for existing host spending controls, not new authority
or a guarantee against reporting lag. No provider mutation was performed.


Read-only observed-window selection v0.1.14: normal build, strict public consumer
compile and all 15 measurement tests passed. The added test uses a reader with no
write methods, checks subset amount and original stored parent ID, changed native
provider bindings, missing campaigns and a later partial correction. Existing
materialized-window revision tests also passed after sharing the selection logic.
