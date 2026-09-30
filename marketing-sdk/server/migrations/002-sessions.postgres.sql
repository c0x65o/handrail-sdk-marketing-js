ALTER TABLE sessions ADD COLUMN revoked_at TEXT NULL;
CREATE VIEW marketing_known_users AS SELECT id, login AS display_name, disabled FROM users;
CREATE VIEW marketing_known_sessions AS SELECT token_hash, user_id, to_timestamp(expires_at / 1000.0) AS expires_at, revoked_at FROM sessions WHERE expires_at > extract(epoch FROM clock_timestamp()) * 1000;
INSERT INTO migrations VALUES(2);
