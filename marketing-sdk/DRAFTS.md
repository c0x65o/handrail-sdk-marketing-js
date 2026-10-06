# PostgreSQL and local campaign drafts

The destination is the embedding application's declared PostgreSQL database.
Use a dedicated SDK schema (default `marketing`) in that resource. Runtime startup
and trusted migration are separate; no extra database service is needed.

```ts
import { Store, MarketingServer, type PostgresStoreOptions,
  POSTGRES_SCHEMA_VERSION } from '@handrail/marketing/server';

// Host configuration supplies the declared resource and a restricted runtime role.
const options: PostgresStoreOptions = {
  connectionString: declaredApplicationPostgresBinding,
  schema: 'marketing',
};
const store = await Store.openExistingPostgres(options); // Promise<Store>; no DDL
const service = MarketingServer.unconnected(store);
// POSTGRES_SCHEMA_VERSION === 2
```

`PostgresStoreOptions = pg.PoolConfig & { schema?: string }`. Standard `pg` TLS
options are supported. `Store.openExistingPostgres(options): Promise<Store>`
uses a read-only validation transaction and session settings. It requires the
exact supported migration history `[1, 2]`, tables/views with required column
names/types, primary keys and the transaction guard row. Missing, outdated,
future or structurally incomplete schemas fail closed; it never repairs them.
Connection/permission failures also reject and close the pool. It does not
provision projects, users, grants or credentials, or acquire execution ownership.
Runtime DML and provisioning remain explicit host actions.

Before startup, a separately authorized deployment/migration task can call
`Store.migratePostgres(migrationOptions): Promise<void>` with the schema owner's
credentials. It applies the existing schema 1 and session migration 2 under the
schema advisory lock, transactionally, validates, then closes its pool. Repeated
calls are idempotent and preserve records; unknown versions are rejected. There
is no new schema migration in the parity review. Migration is distinct from the
package's normal `prepare` compilation; no packaging/publishing step is added.

The runtime role needs schema USAGE; SELECT/INSERT/UPDATE/DELETE on SDK base
tables; sequence USAGE/SELECT; SELECT on the two `marketing_known_*` views.
It need not own objects or have schema CREATE, database CREATE, ALTER or DROP
privileges. The host provisions these permissions through its existing trusted
migration process. Do not expose migration credentials to ordinary startup.
The contract assumes the host controls schema DDL and does not alter objects
under a running executor. The validator is not a general database integrity audit.

For compatibility, `Store.postgres(options): Promise<Store>` retains its original
**connect-and-migrate** behavior. Existing MariaDB/SQLite openers also retain their
migration behavior. New restricted host integrations must choose
`openExistingPostgres`, not the legacy convenience factory.

The reference opener supports `MARKETING_DATASTORE=postgres`, explicit
`MARKETING_DATABASE_URL`, optional `MARKETING_POSTGRES_SCHEMA`, and
`MARKETING_POSTGRES_INITIALIZATION=open-existing` for DDL-free startup.
The latter defaults to `migrate` for existing reference-host compatibility;
unknown values fail closed. It never substitutes ambient `DATABASE_URL` or
`PG*` resource bindings. MariaDB's `isolated-mariadb` / `MYSQL_*` configuration
and `new Store(sqlitePath)` remain available.

The SDK forces its schema search path on each new connection, including when
the URL specifies another path. Schema names use lowercase ASCII letters,
digits and underscores, start with a letter/underscore and have at most 63
characters; `public` and `pg_*` names are rejected. Use a distinct schema per SDK
installation. Projects within it share the project membership boundary and SQL
transaction guard. Configure migrations and runtime with the same schema.

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
`workspace.drafts`. The React workspace renders local drafts and offers an explicit account promotion review.

## Boundary with advertising and generation

An unconnected server has explicit unavailable provider/generation ports; it is
live local persistence, not fixture mode. It never reports provider success.
Draft IDs are stored in a separate record namespace and cannot be used as
campaign IDs for preparation, approval, activation, metrics or generation.

When separately authorized to connect an account, the host constructs
`MarketingServer` with real authorized ports. Promotion is explicit:

```ts
const campaign = await service.call(principal, projectId, 'promoteDraft', {
  draftId: draft.id,
  expectedRevision: draft.revision,
  grantId: selectedGrant.id,
  expectedGrantRevision: selectedGrant.revision,
  material: reviewedCompleteMaterial,
});
```

The selected grant must be current and project-owned. Promotion uses the same full
material, destination snapshot, asset ownership and capability validation as
`saveCampaign`; a planning campaign may have no assets. Missing fields or consents
are not filled by the server. Readiness to publish still requires the existing
setup, media, account evidence, budget and human authorization gates. Promotion
itself calls no provider port and creates no operation, approval, reservation or
access. A host with a closed route allowlist must add `promoteDraft` to expose it.
The optional agent integration is unchanged and not required.

Under the existing SQL transaction guard, the server derives one binding for
project + draft ID + draft revision + provider + target account. The immutable
receipt also binds actor, grant ID/revision and exact reviewed material. Identical
requests from two clients of the same actor return the same original campaign
receipt, including after a lost response and process reopen. Changing payload,
actor, or using another grant to the same physical account conflicts instead of
creating a duplicate or attributing the work to a new actor. To intentionally
promote a changed local draft, save a new draft revision and review it explicitly.
Current membership, grant validity/revision and draft revision are checked on every
retry; a stale/revoked scope cannot recover a write by bypassing authorization.
If the draft or grant has since changed, inspect the already-created campaign in
the workspace instead of replaying the old promotion.

The source document remains untouched. `Campaign.draftOrigin` retains source ID,
revision, original material digest, actor and account; later campaign edits retain
it. Original material is also retained by existing immutable draft-write receipts.
Binding, campaign/version/audience and outbox writes commit or roll back together.
No new table, persistence framework, backfill or shared-data migration is needed.
The UI shows already-promoted revisions after reload, so a lost acknowledgment
can be recovered by inspecting the existing planning campaign.

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


## Optional guarded planning writes

For an interactive client that must recover even after losing its request key,
wrap one of the existing save/promotion commands:

```ts
const write = await service.call(principal, projectId, 'planningWrite', {
  scope: (await service.workspace(principal, projectId)).planningScope!,
  requestKey: retainedIntentKey,
  command: 'saveCampaign',
  input: { requestKey: retainedSaveKey, grantId, material },
});
// Only after receiving/inspecting the saved result:
await service.call(principal, projectId, 'acknowledgePlanningWrite', { id: write.id });
```

The wrapper uses the existing SQL transaction guard, request digests and records;
there is no schema change. It binds actor, project, exact command/input and current
grant state. Promotion also checks source and grant revisions on retry. One
unacknowledged result per actor/project prevents a changed form, account, revision
or new key from silently creating another campaign/draft. Workspace reads expose
only the current actor's pending results. Another actor cannot acknowledge them.
Both commands require current write authority. If authority is removed, inspection
remains subject to current read access and acknowledgment waits for authorized
access; no grants are created or restored.

Identical retries return the original receipt. The receipt and promotion's source
snapshot remain immutable; acknowledgment is a separate record. The React client
acknowledges responses it actually receives in the current form scope. Lost/late
responses stay visible after reload for explicit review; Cancel does not undo a
committed save. Legacy headless save commands retain their existing request-key
contracts and do not silently opt into this additional acknowledgment workflow.
Hosts adopting the React workflow must expose both additive commands. Public Git
publication and actual platform route/session qualification remain separate gates.

The workspace's opaque `planningScope` binds the planning envelope to the current
project, actor and SDK session. Retain the scope from before any asynchronous
pre-save work; a different valid login after destination capture cannot acquire
the old form's intent. It conveys no credentials or authorization. A fresh login
by the same actor may inspect and recover the original immutable result using
its newly read scope; scope is validated but not included in the intent digest.
External authenticated hosts still own external session validation. React planning
forms reset when this scope changes, and pending results stay actor-scoped.
