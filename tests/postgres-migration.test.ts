import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(process.cwd(), "migrations", "0001_rag_core.sql"),
  "utf8",
);

const preferenceMigration = readFileSync(
  join(process.cwd(), "migrations", "0002_user_preferences.sql"),
  "utf8",
);

test("preference migration persists user-scoped LOWER_ATTENTION preferences", () => {
  assert.match(preferenceMigration, /CREATE TABLE IF NOT EXISTS user_preferences/);
  assert.match(preferenceMigration, /user_id TEXT NOT NULL/);
  assert.match(preferenceMigration, /filter_id TEXT NOT NULL/);
  assert.match(preferenceMigration, /scope_type TEXT NOT NULL/);
  assert.match(preferenceMigration, /scope_value TEXT NOT NULL/);
  assert.match(preferenceMigration, /feedback_type TEXT NOT NULL/);
  assert.match(preferenceMigration, /UNIQUE \(user_id, filter_id, scope_type, scope_value, feedback_type\)/);
});

test("RAG migration models Event, Claim, Evidence, and Personal Knowledge", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS claims/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS evidence/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS personal_knowledge/);
  assert.match(migration, /claim_id TEXT NOT NULL REFERENCES claims\(id\)/);
  assert.match(migration, /event_id TEXT NOT NULL REFERENCES events\(id\)/);
});

test("RAG migration enforces filter-scoped private knowledge and revision state", () => {
  assert.match(migration, /user_id TEXT NOT NULL/);
  assert.match(migration, /filter_id TEXT NOT NULL/);
  assert.match(migration, /UNIQUE \(user_id, filter_id, stable_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS filters/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS filters_user_id_idx/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_context_revisions/);
  assert.match(migration, /PRIMARY KEY \(user_id, filter_id\)/);
});

test("RAG migration keeps vector retrieval optional", () => {
  assert.match(migration, /embedding_model TEXT/);
  assert.match(migration, /embedding_payload JSONB/);
  assert.doesNotMatch(migration, /embedding_vector vector/i);
  assert.doesNotMatch(migration, /CREATE INDEX.*hnsw/i);
  assert.doesNotMatch(migration, /CREATE INDEX.*ivfflat/i);
});

test("RAG migration persists filter-scoped goals for continuation", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS goals/);
  assert.match(migration, /completed_task_ids JSONB NOT NULL/);
  assert.match(migration, /completed_criteria JSONB NOT NULL/);
  assert.match(migration, /remaining_criteria JSONB NOT NULL/);
  assert.match(migration, /last_transition JSONB/);
  assert.match(migration, /task_metadata JSONB NOT NULL/);
  assert.match(migration, /watch_metadata JSONB/);
  assert.match(migration, /goals_user_filter_updated_idx/);
});

test("RAG migration persists filter-scoped notifications for delivery dedupe", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notifications/);
  assert.match(migration, /notification_key TEXT NOT NULL/);
  assert.match(migration, /related_evidence_ids JSONB NOT NULL/);
  assert.match(migration, /unread BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /read_at TIMESTAMPTZ/);
  assert.match(migration, /notifications_dedupe_idx/);
  assert.match(migration, /WHERE status <> 'SUPPRESSED'/);
});

test("RAG migration persists structured AgentRun trace", () => {
  assert.match(migration, /trace JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(migration, /ALTER TABLE research_run_metadata ADD COLUMN IF NOT EXISTS trace JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
});
