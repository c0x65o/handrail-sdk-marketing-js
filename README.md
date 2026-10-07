# @handrail/marketing

**Product direction and acceptance:** [From idea to accountable outcome — maintained
product specification](marketing-sdk/PRODUCT.md). Start with the [first-time
Connections journey](marketing-sdk/design/CONNECTIONS.md), [public contract design](marketing-sdk/design/CONNECTIONS-CONTRACT.md)
and [independent review gates](marketing-sdk/design/ACCEPTANCE.md).

Marketing 0.1.7 is a frozen engineering qualification baseline, not acceptance of
the complete marketing product. The deployed Preview described in the work request
is a custom draft form backed by `MarketingServer.unconnected`, not adoption of
`MarketingWorkspace`. A package upgrade alone cannot supply its missing journey.
The reviewed design now has an uncommitted shared server/React advertising
Connections candidate. Manual OpenAI/xAI secure configuration now has an SDK-owned
private route and harmless status adapter; independent review, live, native and
product qualification remain open.
Historical receipts remain intact.
See the [independent review verdict](marketing-sdk/design/ACCEPTANCE.md#independent-review-verdict-2026-10-06)
for corrected consent contracts, the bounded implementation path and native UI gate.

Typed headless marketing workflows, durable trusted-server authority, optional
React components, and a reference HTTP host. Node 22.23.1 (22.x) is required.

Install from this public repository using a verified full 40-character commit:

```sh
npm install --save-exact "git+https://github.com/c0x65o/handrail-sdk-marketing-js.git#$SDK_SHA"
```

Set `SDK_SHA` to the actual published commit, never a branch or tag. npm's normal
Git dependency preparation installs build tools and runs `prepare`: TypeScript
compilation, Vite reference UI compilation, and a source manifest. No separate
publishing job or registry package is required. Keep the matching npm lockfile.

| Import | Purpose |
| --- | --- |
| `@handrail/marketing` or `/core` | Browser-safe types and `createMarketingClient` |
| `@handrail/marketing/server` | MarketingServer, createConnections, Store, provider/billing/generation ports, HostAgent and credential cipher |
| `@handrail/marketing/react` | Optional MarketingRoot, MarketingWorkspace, MarketingConnections, ApprovalPanel, MaterialReview |
| `@handrail/marketing/react/style.css` | Optional UI styles |
| `@handrail/marketing/agent` | Restricted tool dispatcher; no human approval tool or browser runtime |
| `@handrail/marketing/reference` | runtime, createHost, bootstrapFixture, openDatastore, provision |
| `/reference/host`, `/reference/seed` | Individual reference host entry points |

```ts
import { createMarketingClient } from '@handrail/marketing';
const client = createMarketingClient(location.origin, selectedProjectId);
const workspace = await client.call('workspace', {});
```

Import `@handrail/marketing/react/style.css` once for the optional default UI.
`MarketingWorkspace` supplies its own `.marketing-root` boundary in loading,
error and loaded states. For standalone `ApprovalPanel` / `MaterialReview`, or
host-owned login/session UI, wrap only the Marketing content in `MarketingRoot`:

```tsx
import { MarketingRoot, MarketingWorkspace } from '@handrail/marketing/react';
import '@handrail/marketing/react/style.css';

<MarketingRoot aria-label="Marketing area">
  <HostMarketingSessionControls />
  <MarketingWorkspace client={client} />
</MarketingRoot>
```

Do not put the root class on `html`, `body`, or a container holding unrelated host
UI. Ordinary host DOM remains outside the stylesheet's selectors; this is scoped
CSS, not a barrier against host rules cascading into Marketing. Nested roots are
supported. Layout follows the root's available inline width using CSS container
queries (including 320/390px embeddings in desktop pages); give flex/grid mounting
slots a usable width and `min-width: 0`. Modern container-query support is required
for responsive layouts. The SDK neither resets the page nor claims viewport height.
The reference app alone owns its page resets.

Set inherited `--marketing-font-family`, `--marketing-font-size`,
`--marketing-line-height`, `--marketing-color`, `--marketing-background`, and
`--marketing-workspace-min-height` on a host mounting slot to configure defaults.
Without overrides the UI retains its readable light palette and 15px system font;
workspace minimum height defaults to zero. Each workspace owns its local form and
focus state; instances connected to the same project still see shared saved data
and the existing actor-scoped planning recovery contract. There are currently no
portals. Future portaled content must mount inside its owning root (or an explicitly
scoped Marketing container); portaling to the host body is outside this contract.

After building, run `node marketing-sdk/tests/embedding-browser.mjs` for the local
Chromium isolation harness. It exercises real React against the existing disposable
SQLite fixture host; it does not qualify Handrail, ERP or Preview integration.

The host authenticates every request and independently reloads project membership.
Selection of a project never grants access. The server requires exact current
human material approval before provider effects, with durable idempotency and
unknown-effect reconciliation. Revocation does not undo completed effects.

For local source development: `npm ci`, `npm run typecheck`, `npm test` (SQLite),
`npm run test:postgres`, `npm run test:mariadb`, then `npm run test:browser:mariadb`. The MariaDB runner uses
one test worker, a fresh socket-only database and a 64 MiB buffer. It requires
`mariadbd` and `mariadb-install-db`; browser tests additionally require Chromium
(`MARKETING_CHROMIUM_PATH` optional). Video validation uses ffmpeg/ffprobe.
`TMPDIR` must be writable and short enough for a Unix socket. All provider tests
use fixtures or intercepted HTTP; these checks do not establish deployed readiness.

For migration-free PostgreSQL host startup, use
`Store.openExistingPostgres({ connectionString, schema })`. It validates schema 2
and fails closed without DDL. `Store.migratePostgres(options)` is the separate
trusted migration step. Legacy `Store.postgres(options)` still connects and
migrates for compatibility; do not use it for restricted ordinary host startup.
The PostgreSQL runner uses a fresh socket-only cluster, private schemas and one
test worker; it requires `initdb`/`pg_ctl` (`pg_config --bindir`, or
`MARKETING_TEST_POSTGRES_BIN`). Neither database runner reads ambient application
credentials. Run the same browser app fixture on PostgreSQL with
`node marketing-sdk/tests/postgres-runner.mjs --browser` after building; it uses
the same installed Playwright Chromium and supports `MARKETING_CHROMIUM_PATH`.
SQLite and MariaDB remain supported; a PostgreSQL pass does not qualify MariaDB.

`MarketingServer.unconnected(store)` provides real local draft persistence with
no provider/generation capabilities or credentials. Use `saveDraft` and `workspace.drafts`;
existing `saveCampaign` retains its account/material checks. See
[PostgreSQL and draft integration](marketing-sdk/DRAFTS.md) for host authentication,
retry/edit semantics and consumer wiring.

See [host integration](marketing-sdk/README.md) and
[session migration and mapping](marketing-sdk/server/migrations/README.md).
See [readiness and consumer qualification](marketing-sdk/READINESS.md) for media
limits, dependency verification, strict consumer checks and the release handoff.
Existing rights are reserved; see [RIGHTS.md](RIGHTS.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

See [parity foundation and staged migration](marketing-sdk/PARITY_ROADMAP.md) for
explicit daily/lifetime budgets, reporting semantics, host contracts and cutover gates.

The workspace provider-capability continuation is documented in
[marketing-sdk/CAPABILITIES.md](marketing-sdk/CAPABILITIES.md). It includes explicit
Meta/LinkedIn settings, account eligibility gates and guided fields; legacy
campaign inspection/safety pause remain available, while new Meta/LinkedIn
preparation and activation require explicit settings. Independent source review fixed contract defects; Meta daily budget semantics, live
account qualification, complete guided pickers and host cutover remain gated. This
historical workspace-candidate description predates this checkout's 0.1.7 baseline.
See the linked review handoff for its original scope; source/fixture qualification
does not establish a reusable first-time journey or deployed product acceptance.

## Connections candidate (unpublished)

The shared advertising journey starts with zero grants: requirements → exact human
provider-access review → SDK secure handoff → authenticated account and context
selection → separate project-access review → fresh verification → one real Grant.
Manual setup works without Agent. OpenAI/xAI use SDK-owned private secure entry,
exact persistent-access consent, encrypted custody, status and local disconnect.
Configuration does not issue a generation grant or authorize billing. No paid
verification or provider campaign mutation is used. See the [creative integration](marketing-sdk/README.md#manual-creative-connections).

Use the public-only [server adapter example](marketing-sdk/examples/connections-server.ts)
and [Workspace mount](marketing-sdk/examples/embedded.tsx). The standalone
`MarketingConnections` also accepts the same `MarketingClient`; replace its
`client` or `sessionKey` when host identity/project changes. New commands route
through `MarketingServer.call`; the factory's Fetch-compatible `routes` owns OAuth
handoff/callbacks. A trusted static `returnPath` may select the host Marketing route.
Do not log callback query strings upstream. Read the [implemented contracts and
retention](marketing-sdk/design/CONNECTIONS-CONTRACT.md#candidate-implementation-contracts)
before integrating. Ordinary PostgreSQL startup remains migration-free.

`node marketing-sdk/tests/consumer.mjs --connections` compiles the actual public
mount/adapter in a disposable packed consumer and exercises real HTTP and SQLite
with synthetic provider boundaries. A local pack projection does **not** qualify
installation from a newly published full Git SHA. See [candidate evidence and
limits](marketing-sdk/design/ACCEPTANCE.md#connections-implementation-candidate-2026-10-06).
