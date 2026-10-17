CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  normalized_claim TEXT NOT NULL,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (event_id, normalized_claim)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  source_type TEXT NOT NULL,
  source_role TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL,
  data_mode TEXT NOT NULL,
  social_chain_id TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  embedding_model TEXT,
  embedding_payload JSONB,
  UNIQUE (claim_id, canonical_url)
);

CREATE TABLE IF NOT EXISTS personal_knowledge (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  structured_payload JSONB,
  normalized_text TEXT NOT NULL,
  stable_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, filter_id, stable_id)
);

CREATE TABLE IF NOT EXISTS research_context_revisions (
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  research_context_revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, filter_id)
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS research_run_metadata (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  user_query TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT,
  rounds INTEGER,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  knowledge_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  attention_result JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategies JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_from_research_context_revision INTEGER NOT NULL,
  data_mode TEXT NOT NULL,
  fallback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  remaining_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  last_transition JSONB,
  watch_metadata JSONB
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  notification_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  goal_id TEXT,
  attention TEXT NOT NULL,
  delivery_action TEXT NOT NULL,
  related_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_revision_id TEXT,
  status TEXT NOT NULL,
  unread BOOLEAN NOT NULL DEFAULT TRUE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  failure_summary TEXT,
  digest_window_id TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ
);

ALTER TABLE goals ADD COLUMN IF NOT EXISTS last_transition JSONB;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS task_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS watch_metadata JSONB;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS user_query TEXT;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS rounds INTEGER;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS knowledge_changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS attention_result JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS strategies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS trace JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS claims_event_id_idx ON claims(event_id);
CREATE INDEX IF NOT EXISTS evidence_claim_id_idx ON evidence(claim_id);
CREATE INDEX IF NOT EXISTS evidence_canonical_url_idx ON evidence(canonical_url);
CREATE INDEX IF NOT EXISTS personal_knowledge_user_filter_idx ON personal_knowledge(user_id, filter_id);
CREATE INDEX IF NOT EXISTS personal_knowledge_lexical_idx ON personal_knowledge USING gin(to_tsvector('simple', normalized_text));
CREATE INDEX IF NOT EXISTS research_run_metadata_user_filter_created_idx ON research_run_metadata(user_id, filter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS filters_user_id_idx ON filters(user_id);
CREATE INDEX IF NOT EXISTS goals_user_filter_updated_idx ON goals(user_id, filter_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_filter_created_idx ON notifications(user_id, filter_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(user_id, filter_id, notification_key) WHERE status <> 'SUPPRESSED';

-- Supabase Auth tenant protection. Backend service-role connections remain trusted;
-- PostgREST clients are restricted to auth.uid() for user-owned records.
ALTER TABLE filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_context_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_run_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS filters_tenant_policy ON filters;
CREATE POLICY filters_tenant_policy ON filters USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
DROP POLICY IF EXISTS knowledge_tenant_policy ON personal_knowledge;
CREATE POLICY knowledge_tenant_policy ON personal_knowledge USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
DROP POLICY IF EXISTS context_revision_tenant_policy ON research_context_revisions;
CREATE POLICY context_revision_tenant_policy ON research_context_revisions USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
DROP POLICY IF EXISTS run_metadata_tenant_policy ON research_run_metadata;
CREATE POLICY run_metadata_tenant_policy ON research_run_metadata USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
DROP POLICY IF EXISTS goals_tenant_policy ON goals;
CREATE POLICY goals_tenant_policy ON goals USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
DROP POLICY IF EXISTS notifications_tenant_policy ON notifications;
CREATE POLICY notifications_tenant_policy ON notifications USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
