CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, filter_id, scope_type, scope_value, feedback_type)
);