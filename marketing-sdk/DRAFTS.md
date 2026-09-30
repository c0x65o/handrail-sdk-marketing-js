# PostgreSQL and local campaign drafts

The destination is the embedding application's declared PostgreSQL database.
Opening the SDK store creates/initializes its own schema (default `marketing`),
without taking over application tables. No separate MariaDB resource is needed.

```ts
import { Store, MarketingServer } from '@handrail/marketing/server';

const store = await Store.postgres({
  connectionString: declaredApplicationPostgresBinding,
  schema: 'marketing',
});
const service = MarketingServer.unconnected(store);
```

The binding comes from trusted host configuration. Standard `pg` TLS options are
supported. The database role needs to own the SDK schema and its objects; it may
create the schema itself or use a schema pre-created for it. The SDK forces its
schema search path on each new connection, including when the URL specifies a
different search path. Schema names use lowercase ASCII letters, digits and
underscores, start with a letter/underscore and are at most 63 characters;
`public` and `pg_*` names are rejected. Use a distinct schema per SDK installation.
Projects within an installation share the existing project membership boundary.

For the reference datastore opener, explicitly select `MARKETING_DATASTORE=postgres`,
bind `MARKETING_DATABASE_URL` to that same declared resource, and optionally set
`MARKETING_POSTGRES_SCHEMA`. It deliberately does not fall back to an ambient
`DATABASE_URL` or `PG*` resource. MariaDB's existing `isolated-mariadb` / `MYSQL_*`
configuration and `new Store(sqlitePath)` remain available. Opening a PostgreSQL
store applies schema 1 and session migration 2 transactionally under a schema
advisory lock. Reopening preserves records. No separate migration/package step.

## Authentication and scope

For hosts using the SDK's own login, trusted `provision` accepts empty
`accountGrants` and `generationGrants`; authenticate the resulting session with
`store.authenticate(token)` before every request. Empty passwords remain allowed
by the configured authentication policy. Existing rate limits remain enforced.

For embedding hosts such as Preview, keep the application's real authentication.
Create the SDK project once through trusted provisioning, then bind the verified
stable identity and **current** role on every request:

```ts
// These values come from the host's authenticated session and membership lookup,
// never from the command body, claimed role, display name or selected project.
const principal = await store.bindExternalPrincipal(projectId, {
  issuer: stableHostIssuer,
  subject: verifiedUserId,
  kind: 'human', // use 'agent' only for the host's separately authenticated agents
}, currentMarketingRole); // null removes this project's membership

const draft = await service.call(principal, projectId, 'saveDraft', {
  requestKey: savedRequestKey,
  material: { name: 'Autumn campaign', headline: '', budget: { currency: 'USD' } },
});
```

`bindExternalPrincipal` is a trusted server API, not an HTTP command. It derives
an immutable SDK ID from issuer/subject, atomically updates only that project's
membership, and creates no password or SDK session. External records cannot log
in through SDK password authentication. Rebinding cannot change human/agent kind
or re-enable a disabled SDK user. Never expose `Store` methods to clients.
The host must reject revoked/expired host sessions before binding or calling the
service. SDK authorization independently reloads membership and disabled state.
Drafts are project documents: current members can read them; admin/editor members
can write. They are not private per-user documents within a shared project.

## Draft read, edit and retry

`saveDraft` requires a nonblank name and validates typed, bounded optional fields.
Copy, targeting, budget and scheduling can remain incomplete. It requires no
grant, destination fetch, credential, generated media or provider connection.
The response is a `CampaignDraft` with `state: 'draft'`,
`connection: 'unconnected'`, `grantId: null`, `receipt: null`, ID and revision.
`workspace.drafts` reads the latest saved documents; `campaigns` still contains
only the existing account-bound campaigns. No synthetic metrics or grants appear.

```ts
const workspace = await service.call(principal, projectId, 'workspace', {});
const edited = await service.call(principal, projectId, 'saveDraft', {
  id: draft.id,
  expectedRevision: draft.revision,
  requestKey: nextSavedRequestKey,
  material: { ...draft.material, headline: 'A revised headline' },
});
```

An edit replaces the material at exactly `expectedRevision`. A create omits both
ID and expected revision. Persist the request key and exact payload until the
result is known: retrying the same actor/project/key/payload returns the immutable
original write receipt, even after another edit. Different payloads or actors
with the same key conflict. Concurrent creates with one key produce one draft;
competing revisions allow one edit. Authorization is checked again on every
retry. Use a new key for an intentional new edit, and reload on revision conflict.
Draft changes, write receipts, request keys and outbox events commit together.

`createMarketingClient` exposes the same commands through the existing HTTP host.
An embedding host must add `saveDraft` to its own route allowlist and render
`workspace.drafts`. The optional existing React campaign UI still serves the
account-bound campaign workflow; it does not render local drafts automatically.

## Boundary with advertising and generation

An unconnected server has explicit unavailable provider/generation ports; it is
live local persistence, not fixture mode. It never reports provider success.
Draft IDs are stored in a separate record namespace and cannot be used as
campaign IDs for preparation, approval, activation, metrics or generation.

When separately authorized to connect an account, the host constructs
`MarketingServer` with real authorized ports. Submit completed draft material
through existing `saveCampaign` with a genuine grant to create an account-bound
campaign; the local draft remains a separate document. Full material validation,
destination/asset verification, grant permissions, human launch approval,
spending limits and separate generation authority still apply. No automatic
promotion, activation, spend or data fabrication follows from saving a draft.

## Transactions and execution ownership

PostgreSQL uses the same store transaction guard as MariaDB, `READ COMMITTED`
and a pinned connection per asynchronous transaction. All implicit writes join
the transaction; nested failures abort it even when caught. Revisions use atomic
conditional updates, records/requests have composite project keys, bytes use
`bytea`, and the outbox uses a monotonic bigint cursor. Raw PostgreSQL bigint
columns/counts remain driver strings to avoid precision loss; Store JSON records
retain their original types. The SDK's `?` bindings and outbox identifier quoting
are adapted internally; this is not a general SQL-dialect translator.

Draft-only embedding needs no executor. Hosts executing protected operations
must acquire the existing `store.db.acquireExecutor()` lock and recover unknown
effects before dispatch. PostgreSQL holds a schema-scoped session advisory lock
on a dedicated connection; loss permanently fences that Store instance. Use
direct/session-pooled connections, not transaction-mode connection pooling.
Close stores during shutdown with `await store.close()`.

Verification uses real disposable PostgreSQL and MariaDB plus SQLite, including
HTTP/authentication, draft retries/edits/isolation, migrations, external identity
binding, rollback, concurrency and executor loss. Existing provider, generation,
blob, session and reporting regression tests use explicitly labelled external
test doubles; they make no real provider writes. Application adoption and
protected browser verification in Preview are a separate integration step.
