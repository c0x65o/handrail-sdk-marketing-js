# @handrail/marketing

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
| `@handrail/marketing/server` | MarketingServer, Store, provider/billing/generation ports, HostAgent and credential cipher |
| `@handrail/marketing/react` | Optional MarketingRoot, MarketingWorkspace, ApprovalPanel, MaterialReview |
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
workspace candidate has not been published. See the linked review handoff.
