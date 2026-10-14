# Measurement qualification, 2026-10-14

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
