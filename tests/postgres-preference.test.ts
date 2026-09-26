import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresRepository,
  databaseConfigured,
  getPostgresPool,
  readMigration,
  runRagCoreMigration,
  closePostgresPool,
} from "../backend/postgres.ts";
import {
  PostgresSignalRepository,
  type PostgresClient,
} from "../information/repositories/postgres.ts";
import { runAgent } from "../agent/runner.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

type Call = { sql: string; values: unknown[] };

function fakeClient(rows: unknown[] = []) {
  const calls: Call[] = [];
  const client: PostgresClient = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return { rows: rows as T[] };
    },
  };
  return { client, calls };
}

const input = {
  identity: "builder", industry: "AI developer tools", focusAreas: "Codex",
  currentQuestions: "latest release", knownInformation: "Codex exists",
  informationGaps: "new workflow", trackedEntities: "Codex", trackedEvents: "",
  userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const publishedAt = new Date().toISOString();
  return {
    id: "pref-event-1", category: "匹配", channel: "官方", title: "Palmier Pro added team workspaces",
    summary: "Palmier Pro added team workspaces", time: "1h", truth: 90, baseUseful: 90, lead: 80,
    tags: ["Palmier Pro"], action: "read", why: "new", official: [], social: [], sourceType: "primary",
    sourceTier: "S", sourceUrl: "https://example.com/palmier-pro", publisher: "Official",
    publishedAt, firstSeenAt: publishedAt, retrievedAt: publishedAt, timestampStatus: "valid",
    dataOrigin: "live", confidence: 90, verificationStatus: "verified", relevanceScore: 90,
    reliabilityScore: 92, freshnessScore: 90, noveltyScore: 86, judgementImpactScore: 60,
    gapMatchScore: 80, overallScore: 90, sourceCount: 1, independentEvidenceCount: 1,
    propagationCount: 0, claims: [{
      claimText: "Palmier Pro added team workspaces", sourceUrl: "https://example.com/palmier-pro",
      publisher: "Official", publishedAt, sourceType: "primary", sourceTier: "S",
      evidenceSnippet: "Palmier Pro added team workspaces", verificationStatus: "verified",
      contentType: "FACT", independentEvidenceCount: 1, evidenceSources: [],
    }], sources: [], section: "must_know", gapMatches: ["new workflow"],
    questionMatches: ["latest release"], entityMatches: ["Palmier Pro", "codex"],
    whyItMatters: "new", eventStatus: "NEW", informationType: "FACT", knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ", actionabilityStatus: "TEST_NOW", informationGainStatus: "NEW_INFORMATION",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: new Date().toISOString(), dataMode: "live",
  };
}

const localCtx = { authenticatedUserId: "user-a", filterId: "filter-a" };

test("Postgres preference reads are scoped by authenticated user and filter", async () => {
  const { client, calls } = fakeClient([{
    id: "pref-1", user_id: "user-a", filter_id: "filter-a",
    scope_type: "entity", scope_value: "Palmier Pro", feedback_type: "LOWER_ATTENTION",
    created_at: "2026-09-22T00:00:00.000Z", updated_at: "2026-09-22T00:00:00.000Z",
  }]);
  const repository = new PostgresSignalRepository(client);

  await repository.savePreference(localCtx, {
    scopeType: "entity",
    scopeValue: "Palmier Pro",
    feedbackType: "LOWER_ATTENTION",
  }, "2026-09-22T00:00:00.000Z");
  await repository.listPreferences({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  });

  assert.match(calls[0].sql, /INSERT INTO user_preferences/);
  assert.match(calls[1].sql, /WHERE user_id = \$1 AND filter_id = \$2/);
  assert.deepEqual(calls[1].values, ["user-a", "filter-a"]);
});

test("Postgres preference persistence is skipped unless DATABASE_URL is configured", {
  skip: databaseConfigured() ? undefined : "DATABASE_URL not configured",
}, async () => {
  const pool = getPostgresPool();
  await pool.query(await readMigration("0002_user_preferences.sql"));
  const repository = createPostgresRepository(pool);
  const runc = { authenticatedUserId: `pref-user-${Date.now()}`, filterId: "pref-filter" };

  const saved = await repository.savePreference(runc, {
    scopeType: "entity",
    scopeValue: "Palmier Pro",
    feedbackType: "LOWER_ATTENTION",
  }, new Date().toISOString());
  const listed = await repository.listPreferences(runc);

  assert.equal(listed.length, 1);
  assert.equal(listed[0].scopeValue, "Palmier Pro");
  assert.equal(listed[0].feedbackType, "LOWER_ATTENTION");
  assert.equal(saved.id, listed[0].id);

  const other = await repository.listPreferences({ authenticatedUserId: runc.authenticatedUserId, filterId: "other-filter" });
  assert.equal(other.length, 0);

  await closePostgresPool();
});

test("A persisted postgres preference is read by the agent and lowers final attention", {
  skip: databaseConfigured() ? undefined : "DATABASE_URL not configured",
}, async () => {
  const pool = getPostgresPool();
  await runRagCoreMigration(pool);
  await pool.query(await readMigration("0002_user_preferences.sql"));
  const repository = createPostgresRepository(pool);
  const runc = { authenticatedUserId: `pref-agent-${Date.now()}`, filterId: "pref-agent-filter" };

  await repository.savePreference(runc, {
    scopeType: "entity",
    scopeValue: "Palmier Pro",
    feedbackType: "LOWER_ATTENTION",
  }, new Date().toISOString());
  assert.equal((await repository.listPreferences(runc)).length, 1);

  const result = await runAgent({
    input: {
      identity: "builder", industry: "AI developer tools", focusAreas: "Codex",
      currentQuestions: "latest release", knownInformation: "Codex exists",
      informationGaps: "new workflow", trackedEntities: "Codex", trackedEvents: "",
      userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
    },
    context: runc,
    repository,
    maxRounds: 1,
    research: async () => response([signal()]),
  });
  assert.equal(result.attention.includes("MUST_READ"), false);
  assert.equal(result.attention.includes("WORTH_WATCHING"), false);

  await closePostgresPool();
});