import assert from "node:assert/strict";
import test from "node:test";

import {
  isPostgresConnectionError,
  PostgresSignalRepository,
  type PostgresClient,
} from "../information/repositories/postgres.ts";
import type { Goal } from "../agent/goal-types.ts";

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

test("Postgres personal knowledge reads are always scoped by authenticated user and filter", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);

  await repository.listPersonalKnowledge({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  });

  assert.match(calls[0].sql, /WHERE user_id = \$1 AND filter_id = \$2/);
  assert.deepEqual(calls[0].values, ["user-a", "filter-a"]);
});

test("Postgres run metadata reads are tenant and filter scoped", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);

  await repository.getLatestRunMetadata({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  });

  assert.match(calls[0].sql, /WHERE user_id = \$1 AND filter_id = \$2/);
  assert.deepEqual(calls[0].values, ["user-a", "filter-a"]);
});

test("Postgres read queries retry once after a connection-class error", async () => {
  const calls: Call[] = [];
  let recovered = false;
  const failingClient: PostgresClient = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      throw new Error("Connection terminated unexpectedly");
    },
  };
  const recoveredClient: PostgresClient = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return { rows: [] as T[] };
    },
  };
  const repository = new PostgresSignalRepository(failingClient, () => {
    recovered = true;
    return recoveredClient;
  });

  const records = await repository.listPersonalKnowledge({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  });

  assert.deepEqual(records, []);
  assert.equal(recovered, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FROM personal_knowledge/);
  assert.equal(calls[1].sql, calls[0].sql);
});

test("Postgres read retry tracing records query name and sanitized retry outcome", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    logs.push(JSON.parse(String(message)));
  };
  try {
    const failingClient: PostgresClient = {
      async query() {
        throw new Error("Connection terminated unexpectedly for postgresql://user:secret@example.test/db");
      },
    };
    const recoveredClient: PostgresClient = {
      async query<T>() {
        return { rows: [] as T[] };
      },
    };
    const repository = new PostgresSignalRepository(failingClient, () => recoveredClient);

    await repository.listPersonalKnowledge({
      authenticatedUserId: "user-a",
      filterId: "filter-a",
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0], {
    phase: "postgres_read_retry_started",
    queryName: "listPersonalKnowledge",
    firstErrorName: "Error",
    firstErrorMessage: "Connection terminated unexpectedly for [redacted-database-url]",
  });
  assert.deepEqual(logs[1], {
    phase: "postgres_read_retry_finished",
    queryName: "listPersonalKnowledge",
    retrySuccess: true,
    recoveredClientChanged: true,
  });
  assert.equal(JSON.stringify(logs).includes("user-a"), false);
  assert.equal(JSON.stringify(logs).includes("filter-a"), false);
  assert.equal(JSON.stringify(logs).includes("SELECT"), false);
});

test("Postgres read retry tracing records sanitized retry failure", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    logs.push(JSON.parse(String(message)));
  };
  try {
    const failingClient: PostgresClient = {
      async query() {
        throw Object.assign(new Error("first"), { code: "08006" });
      },
    };
    const recoveredClient: PostgresClient = {
      async query() {
        throw new Error("Connection terminated unexpectedly token=secret");
      },
    };
    const repository = new PostgresSignalRepository(failingClient, () => recoveredClient);

    await assert.rejects(repository.getLatestRunMetadata({
      authenticatedUserId: "user-a",
      filterId: "filter-a",
    }));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(logs.length, 2);
  assert.equal(logs[0].phase, "postgres_read_retry_started");
  assert.equal(logs[0].queryName, "getLatestRunMetadata");
  assert.equal(logs[1].phase, "postgres_read_retry_finished");
  assert.equal(logs[1].queryName, "getLatestRunMetadata");
  assert.equal(logs[1].retrySuccess, false);
  assert.equal(logs[1].recoveredClientChanged, true);
  assert.equal(logs[1].retryErrorName, "Error");
  assert.equal(logs[1].retryErrorMessage, "Connection terminated unexpectedly token=[redacted]");
});

test("Postgres read retry covers run metadata and research context revision", async () => {
  const failingClient: PostgresClient = {
    async query() {
      throw Object.assign(new Error("read failed"), { code: "08006" });
    },
  };
  const recoveredClient: PostgresClient = {
    async query<T>() {
      return { rows: [] as T[] };
    },
  };
  let recoveries = 0;
  const repository = new PostgresSignalRepository(failingClient, () => {
    recoveries += 1;
    return recoveredClient;
  });
  const context = { authenticatedUserId: "user-a", filterId: "filter-a" };

  assert.equal(await repository.getLatestRunMetadata(context), null);
  assert.equal(await repository.getResearchContextRevision(context), 1);
  assert.equal(recoveries, 1);
});

test("Postgres writes are not retried on connection-class errors", async () => {
  let recoveries = 0;
  const failingClient: PostgresClient = {
    async query() {
      throw Object.assign(new Error("write failed"), { code: "ECONNRESET" });
    },
  };
  const repository = new PostgresSignalRepository(failingClient, () => {
    recoveries += 1;
    return failingClient;
  });

  await assert.rejects(repository.saveRunMetadata({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  }, {
    id: "run-a",
    userQuery: "query",
    startedAt: "2026-09-12T00:00:00.000Z",
    completedAt: "2026-09-12T00:00:01.000Z",
    status: "completed",
    rounds: 1,
    evidenceIds: [],
    knowledgeChanges: [],
    attentionResult: [],
    strategies: [],
    trace: [],
    generatedFromResearchContextRevision: 1,
    dataMode: "live",
    createdAt: "2026-09-12T00:00:01.000Z",
  }));
  assert.equal(recoveries, 0);
});

test("Postgres connection-class detector stays narrow", () => {
  assert.equal(isPostgresConnectionError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isPostgresConnectionError(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
  assert.equal(isPostgresConnectionError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), true);
  assert.equal(isPostgresConnectionError(Object.assign(new Error("sqlstate"), { code: "08006" })), true);
  assert.equal(isPostgresConnectionError(Object.assign(new Error("shutdown"), { code: "57P01" })), true);
  assert.equal(isPostgresConnectionError(Object.assign(new Error("syntax"), { code: "42601" })), false);
});

test("Postgres run metadata list reads trace and stays tenant scoped", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);

  await repository.listRunMetadata({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  });

  assert.match(calls[0].sql, /SELECT id, user_query/);
  assert.match(calls[0].sql, /strategies, trace/);
  assert.match(calls[0].sql, /WHERE user_id = \$1 AND filter_id = \$2/);
  assert.deepEqual(calls[0].values, ["user-a", "filter-a"]);
});

test("Postgres revision increments for research-context knowledge but not notes", async () => {
  const knowledgeRow = {
    id: "pk-1",
    user_id: "user-a",
    filter_id: "filter-a",
    type: "KNOWN_INFORMATION",
    text: "Codex is available",
    normalized_text: "codex is available",
    stable_id: "known",
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
  };
  const { client, calls } = fakeClient([knowledgeRow]);
  const repository = new PostgresSignalRepository(client);

  await repository.addPersonalKnowledge({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  }, {
    type: "KNOWN_INFORMATION",
    text: "Codex is available",
  }, "2026-09-05T00:00:00.000Z");

  assert.ok(calls.some((call) =>
    /research_context_revision = research_context_revisions\.research_context_revision \+ 1/.test(call.sql),
  ));

  calls.length = 0;
  await repository.addPersonalKnowledge({
    authenticatedUserId: "user-a",
    filterId: "filter-a",
  }, {
    type: "NOTE",
    text: "Private note",
  }, "2026-09-05T00:00:00.000Z");

  assert.equal(calls.some((call) =>
    /research_context_revision = research_context_revisions\.research_context_revision \+ 1/.test(call.sql),
  ), false);
});

test("Postgres goals persist continuation state with user and filter isolation", async () => {
  const goal: Goal = {
    id: "goal-1",
    userId: "user-a",
    filterId: "filter-a",
    objective: "Assess Model X",
    status: "active",
    successCriteria: ["release confirmed"],
    openQuestions: ["What changed?"],
    taskIds: ["goal-task-release-confirmed"],
    completedTaskIds: [],
    completedCriteria: [],
    remainingCriteria: ["release confirmed"],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    watch: {
      resumeCondition: { type: "POLL", reason: "Check release", target: "Model X", nextCheckAt: "2026-09-07T01:00:00.000Z" },
      consecutiveNoChangeCount: 0,
      watchStatus: "waiting",
      lastCheckOutcome: "not_checked",
    },
  };
  const row = {
    id: goal.id,
    user_id: goal.userId,
    filter_id: goal.filterId,
    objective: goal.objective,
    status: goal.status,
    success_criteria: goal.successCriteria,
    open_questions: goal.openQuestions,
    task_ids: goal.taskIds,
    completed_task_ids: goal.completedTaskIds,
    completed_criteria: goal.completedCriteria,
    remaining_criteria: goal.remainingCriteria,
    current_summary: null,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
    completed_at: null,
    watch_metadata: goal.watch,
  };
  const { client, calls } = fakeClient([row]);
  const repository = new PostgresSignalRepository(client);

  const saved = await repository.saveGoal({ authenticatedUserId: "user-a", filterId: "filter-a" }, goal);
  assert.equal(saved.id, goal.id);
  assert.match(calls[0]!.sql, /INSERT INTO goals/);
  assert.deepEqual(calls[0]!.values.slice(0, 3), ["goal-1", "user-a", "filter-a"]);

  const loaded = await repository.getGoal({ authenticatedUserId: "user-a", filterId: "filter-a" }, goal.id);
  assert.equal(loaded?.remainingCriteria[0], "release confirmed");
  assert.equal(loaded?.watch?.resumeCondition.target, "Model X");

  await repository.listGoals({ authenticatedUserId: "user-b", filterId: "filter-a" });
  const isolationQuery = calls.at(-1)!;
  assert.match(isolationQuery.sql, /WHERE user_id = \$1 AND filter_id = \$2/);
  assert.deepEqual(isolationQuery.values, ["user-b", "filter-a"]);
});

test("Postgres due goal scheduling is filtered and claimed in SQL", async () => {
  const { client, calls } = fakeClient([]);
  const repository = new PostgresSignalRepository(client);

  await repository.findDueGoals("2026-09-07T10:00:00.000Z", 5);
  assert.match(calls[0]!.sql, /status IN \('waiting', 'blocked'\)/);
  assert.match(calls[0]!.sql, /watch_metadata->'resumeCondition'->>'type' NOT IN \('MANUAL', 'EVENT'\)/);
  assert.match(calls[0]!.sql, /leaseExpiresAt/);
  assert.doesNotMatch(calls[0]!.sql, /SELECT \* FROM goals ORDER BY/);

  await repository.claimDueGoal(
    { authenticatedUserId: "user-a", filterId: "filter-a" },
    "goal-1",
    "worker-a",
    "2026-09-07T10:05:00.000Z",
    "2026-09-07T10:00:00.000Z",
  );
  const claim = calls[1]!;
  assert.match(claim.sql, /UPDATE goals SET/);
  assert.match(claim.sql, /watch_metadata = watch_metadata \|\| \$5::jsonb/);
  assert.match(claim.sql, /WHERE id = \$1\s+AND user_id = \$2\s+AND filter_id = \$3/);
  assert.deepEqual(claim.values.slice(0, 3), ["goal-1", "user-a", "filter-a"]);
});

test("Postgres notifications persist delivery state with dedupe and claim isolation", async () => {
  const row = {
    id: "notification-1",
    notification_key: "key-1",
    user_id: "user-a",
    filter_id: "filter-a",
    goal_id: "goal-1",
    attention: "MUST_READ",
    delivery_action: "IMMEDIATE",
    related_evidence_ids: ["e1"],
    related_revision_id: "rev-1",
    status: "PENDING",
    unread: true,
    read_at: null,
    created_at: "2026-09-07T10:00:00.000Z",
    delivered_at: null,
    failure_summary: null,
    digest_window_id: null,
    lease_owner: null,
    lease_expires_at: null,
  };
  const { client, calls } = fakeClient([row]);
  const repository = new PostgresSignalRepository(client);
  const saved = await repository.saveNotification({ authenticatedUserId: "user-a", filterId: "filter-a" }, {
    id: row.id,
    notificationKey: row.notification_key,
    userId: row.user_id,
    filterId: row.filter_id,
    goalId: row.goal_id,
    attention: "MUST_READ",
    deliveryAction: "IMMEDIATE",
    relatedEvidenceIds: ["e1"],
    relatedRevisionId: "rev-1",
    status: "PENDING",
    createdAt: row.created_at,
  });
  assert.equal(saved.notificationKey, "key-1");
  assert.match(calls[0]!.sql, /INSERT INTO notifications/);
  assert.deepEqual(calls[0]!.values.slice(0, 4), ["notification-1", "key-1", "user-a", "filter-a"]);

  await repository.getNotificationByKey({ authenticatedUserId: "user-a", filterId: "filter-a" }, "key-1");
  assert.match(calls[1]!.sql, /WHERE user_id = \$1 AND filter_id = \$2 AND notification_key = \$3/);

  await repository.claimNotification(
    { authenticatedUserId: "user-a", filterId: "filter-a" },
    "notification-1",
    "worker-a",
    "2026-09-07T10:05:00.000Z",
    "2026-09-07T10:00:00.000Z",
  );
  assert.match(calls[2]!.sql, /UPDATE notifications SET/);
  assert.match(calls[2]!.sql, /AND status = 'PENDING'/);
  assert.match(calls[2]!.sql, /lease_expires_at IS NULL OR lease_expires_at <= \$6::timestamptz/);
});

test("Postgres filters enforce ownership and notification read stays scoped", async () => {
  const filterRow = {
    id: "filter-a",
    user_id: "user-a",
    name: "Alpha filter",
    created_at: "2026-09-07T10:00:00.000Z",
    updated_at: "2026-09-07T10:00:00.000Z",
  };
  const notificationRow = {
    id: "notification-1",
    notification_key: "key-1",
    user_id: "user-a",
    filter_id: "filter-a",
    goal_id: null,
    attention: "MUST_READ",
    delivery_action: "IMMEDIATE",
    related_evidence_ids: [],
    related_revision_id: null,
    status: "DELIVERED",
    unread: false,
    read_at: "2026-09-07T10:00:00.000Z",
    created_at: "2026-09-07T09:00:00.000Z",
    delivered_at: "2026-09-07T09:00:00.000Z",
    failure_summary: null,
    digest_window_id: null,
    lease_owner: null,
    lease_expires_at: null,
  };
  const { client, calls } = fakeClient([filterRow, filterRow, notificationRow]);
  const repository = new PostgresSignalRepository(client);

  await repository.saveFilter({ authenticatedUserId: "user-a", filterId: "filter-a" }, {
    id: "filter-a",
    userId: "user-a",
    name: "Alpha filter",
    createdAt: filterRow.created_at,
    updatedAt: filterRow.updated_at,
  });
  assert.match(calls[0]!.sql, /INSERT INTO filters/);
  assert.match(calls[0]!.sql, /WHERE filters\.user_id = EXCLUDED\.user_id/);

  await repository.getFilter({ authenticatedUserId: "user-a", filterId: "filter-a" });
  assert.match(calls[1]!.sql, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(calls[1]!.values, ["filter-a", "user-a"]);

  await repository.markNotificationRead(
    { authenticatedUserId: "user-a", filterId: "filter-a" },
    "notification-1",
    "2026-09-07T10:00:00.000Z",
  );
  assert.match(calls[2]!.sql, /UPDATE notifications SET unread = false/);
  assert.match(calls[2]!.sql, /WHERE id = \$1 AND user_id = \$2 AND filter_id = \$3/);
  assert.deepEqual(calls[2]!.values.slice(0, 3), ["notification-1", "user-a", "filter-a"]);
});

// Bounded repair 2026-10-04 (requestId signals-f56f937f): the real acceptance run
// extracted the publication date from the Adobe page (CardDate block), but the
// evidence upsert's ON CONFLICT clause did not refresh published_at, so the
// pre-existing evidence row kept published_at = NULL. The contract must backfill
// the date from the new fetch without letting a missing date erase an existing one.
test("Postgres evidence upsert backfills published_at without nulling it", async () => {
  const row = {
    id: "evidence-1",
    claim_id: "claim-1",
    source_url: "https://blog.adobe.com/en/publish/2026/09/08/post",
    canonical_url: "https://blog.adobe.com/en/publish/2026/09/08/post",
    publisher: "用户添加 · blog.adobe.com",
    published_at: "2026-09-08T00:00:00.000Z",
    source_type: "industry_media",
    source_role: "verification",
    source_tier: "B",
    verification_status: "partially_verified",
    evidence_snippet: "Generate and create directly in your timeline",
    data_mode: "live",
    retrieved_at: "2026-10-04T03:43:20.000Z",
    created_at: "2026-10-04T03:43:20.000Z",
  };
  const { client, calls } = fakeClient([row]);
  const repository = new PostgresSignalRepository(client);

  await repository.upsertEvidence({
    id: "evidence-1",
    claimId: "claim-1",
    sourceUrl: "https://blog.adobe.com/en/publish/2026/09/08/post",
    canonicalUrl: "https://blog.adobe.com/en/publish/2026/09/08/post",
    publisher: "用户添加 · blog.adobe.com",
    publishedAt: "2026-09-08T00:00:00.000Z",
    sourceType: "industry_media",
    sourceRole: "verification",
    sourceTier: "B",
    verificationStatus: "partially_verified",
    evidenceSnippet: "Generate and create directly in your timeline",
    dataMode: "live",
    retrievedAt: "2026-10-04T03:43:20.000Z",
    createdAt: "2026-10-04T03:43:20.000Z",
  });

  const upsert = calls[0]!;
  assert.match(upsert.sql, /INSERT INTO evidence/);
  assert.match(upsert.sql, /published_at = COALESCE\(EXCLUDED\.published_at, evidence\.published_at\)/);
});
