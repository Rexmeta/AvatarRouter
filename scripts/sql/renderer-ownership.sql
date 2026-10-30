-- Additive and idempotent. Run before starting any renderer worker.
BEGIN;
ALTER TABLE avatar_sessions
  ADD COLUMN IF NOT EXISTS renderer_state text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_create_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS stop_status text,
  ADD COLUMN IF NOT EXISTS stop_error text,
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS reserved_seconds integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS avatar_sessions_worker_idx ON avatar_sessions (mode, renderer_state, lease_expires_at);
CREATE TABLE IF NOT EXISTS renderer_commands (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES avatar_sessions(id) ON DELETE CASCADE,
  type text NOT NULL,
  object_path text,
  state text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS renderer_commands_session_idx ON renderer_commands (session_id, state, created_at);
CREATE TABLE IF NOT EXISTS renderer_workers (
  id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS avatar_session_reconciliation_audit (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES avatar_sessions(id) ON DELETE CASCADE,
  operator_user_id text NOT NULL,
  action text NOT NULL,
  provider_conversation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS avatar_reconciliation_audit_session_idx
  ON avatar_session_reconciliation_audit (session_id, created_at);
-- Legacy process-local live sessions must NEVER become new queued paid creates.
-- Keep references and force cleanup/reconciliation; charge their bounded reservation too.
UPDATE avatar_sessions SET
  reserved_seconds = 120,
  renderer_state = CASE WHEN status = 'active' OR room_name IS NOT NULL OR provider_conversation_id IS NOT NULL OR error = 'LIVE_CREATE_RECONCILIATION_REQUIRED'
    THEN 'cleanup_pending' ELSE 'closed' END,
  provider_create_state = CASE WHEN provider_conversation_id IS NOT NULL THEN 'known'
    WHEN status = 'active' OR error = 'LIVE_CREATE_RECONCILIATION_REQUIRED' THEN 'unknown' ELSE 'not_started' END
WHERE mode = 'live' AND reserved_seconds = 0;
COMMIT;
