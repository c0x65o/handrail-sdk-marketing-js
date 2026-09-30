# Session schema 2

Opening a Store applies schema 1 then additive migration 2 under the existing
MariaDB schema lock (SQLite uses a transaction). PostgreSQL uses a schema-scoped
transaction advisory lock and transactional DDL, with its own schema 1 and
`002-sessions.postgres.sql`; both fresh initialization and upgrades roll back
atomically on failure. MariaDB steps are idempotent
because DDL commits implicitly; the migration marker is written last. Back up
before host upgrades. Stop the old executor, migrate with the new package, and
start only the new executor. Do not run old code after migration: old positional
session inserts and delete-on-logout do not support the added column. Rollback
requires a forward-compatible code rollback or an isolated pre-upgrade restore,
not dropping revocation state from a live database.

Existing `users.id` UUIDs, session hashes and numeric `expires_at` milliseconds
remain unchanged. `sessions.revoked_at` stores UTC ISO-8601 text, initially NULL.
Logout retains the digest row and sets revocation once. `revokeUserSessions` is
available only to trusted host code for password resets/account disablement.
Authentication rejects missing, expired, revoked and disabled/missing-user rows.
Primary keys prevent ambiguous digest matches. No raw token is persisted.

After inspecting the actual environment schema, map Known Users to these views:

| Setting | Value |
| --- | --- |
| User table | marketing_known_users |
| Immutable ID | id |
| Display | display_name (login, never identity proof) |
| Status / active values | disabled / 0 |
| Email | unset; this host does not collect notification email |
| Session table | marketing_known_sessions |
| Digest / transform | token_hash / sha256 |
| User foreign key | user_id |
| Expiration | expires_at (PostgreSQL timestamptz, MariaDB UTC DATETIME(6), SQLite ISO-8601; milliseconds preserved) |
| Revocation | revoked_at; no second boolean mapping |

The session view excludes expired rows using the database clock, so a reader with
a mismatched local timezone cannot extend session authority. Keep application and
database clocks synchronized. Bind UTC dates when comparing the MariaDB expiry
column (mysql2 `timezone: "Z"`); verify the native reader timezone before enabling
the mapping. The SDK database adapter uses UTC.

The session view converts epoch milliseconds to UTC datetime (ISO text on SQLite) without copying raw
sessions or depending on the database timezone. Live authorization reads the
same base rows and numeric expiry. Views convey no extra project membership.
Use the correct resource/database in each environment; schema names and mapping
configuration remain host-owned. Never infer email from a login/display label.
The browser keeps its HttpOnly cookie; same-origin server handlers resolve each
current session separately. Mapping readiness must be verified on the deployed
host before enabling Handrail authenticated integrations.
