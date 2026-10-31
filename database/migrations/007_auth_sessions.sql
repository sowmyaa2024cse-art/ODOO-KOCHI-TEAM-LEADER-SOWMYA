ALTER TABLE users
  ADD CONSTRAINT users_password_hash_scrypt_format CHECK (
    password_hash ~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$'
  );

CREATE TABLE auth_sessions (
  session_id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_sessions_expiry_after_create CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);
