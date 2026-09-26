ALTER TABLE sessions ADD COLUMN revoked_at TEXT NULL;
CREATE VIEW marketing_known_users AS SELECT id, login AS display_name, disabled FROM users;
CREATE VIEW marketing_known_sessions AS SELECT token_hash, user_id, strftime('%Y-%m-%dT%H:%M:%fZ', expires_at / 1000.0, 'unixepoch') AS expires_at, revoked_at FROM sessions WHERE expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER);
INSERT INTO migrations VALUES(2);
