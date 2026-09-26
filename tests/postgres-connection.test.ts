import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseConfigured,
  readDatabaseConfig,
  readMigration,
  runRagCoreMigration,
} from "../backend/postgres.ts";

test("PostgreSQL configuration is server-only and optional", () => {
  assert.equal(typeof databaseConfigured(), "boolean");
  const config = readDatabaseConfig();
  if (!process.env.DATABASE_URL) {
    assert.equal(config, null);
  } else {
    assert.equal(config?.connectionString, process.env.DATABASE_URL);
  }
});

test("migration runner can load the RAG core migration", async () => {
  const migration = await readMigration("0001_rag_core.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS personal_knowledge/);
});

test("migration runner applies rag core and user preferences migrations in order", async () => {
  const executed: string[] = [];
  const pool = {
    async query(sql: string) { executed.push(sql); return { rows: [] }; },
  };
  await runRagCoreMigration(pool as never);
  assert.equal(executed.length, 2);
  assert.match(executed[0], /CREATE TABLE IF NOT EXISTS events/);
  assert.match(executed[1], /user_preferences/);
});
