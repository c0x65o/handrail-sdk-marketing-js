ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at VARCHAR(24) COLLATE utf8mb4_bin NULL;
CREATE OR REPLACE VIEW marketing_known_users AS SELECT id, login AS display_name, disabled FROM users;
CREATE OR REPLACE VIEW marketing_known_sessions AS SELECT token_hash, user_id, TIMESTAMPADD(MICROSECOND, expires_at * 1000, CAST('1970-01-01 00:00:00.000000' AS DATETIME(6))) AS expires_at, revoked_at FROM sessions WHERE expires_at > UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000;
INSERT IGNORE INTO migrations VALUES(2);
