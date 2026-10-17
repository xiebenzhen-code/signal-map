// Feedback persistence contract tests (hermetic: fake pg client, no real DB).
// Covers: feedback→record mapping, repository dedup + scoping, save-scope
// semantics, and hard-failure on invalid input.
import assert from "node:assert/strict";
import test from "node:test";

import { feedbackKnowledgeRecord, feedbackScope } from "../backend/feedback-records.ts";
import { PostgresSignalRepository } from "../information/repositories/postgres.ts";

type Call = { sql: string; values: unknown[] };

function fakeClient() {
  const calls: Call[] = [];
  const client = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes("INSERT INTO personal_knowledge")) {
        const row = {
          id: values[0],
          user_id: values[1],
          filter_id: values[2],
          type: values[3],
          text: values[4],
          structured_payload: values[5],
          normalized_text: values[6],
          stable_id: values[7],
          created_at: values[8],
          updated_at: values[9],
          created: true,
        };
        return { rows: [row as T] };
      }
      return { rows: [] as T[] };
    },
  };
  return { client: client as never, calls };
}

test("RED: 已知/读过 maps to KNOWN_INFORMATION with the source title (not a not-interested claim)", () => {
  const record = feedbackKnowledgeRecord("already_knew", "ComfyUI 发布 v0.38.0");
  assert.deepEqual(record, { type: "KNOWN_INFORMATION", text: "ComfyUI 发布 v0.38.0" });
});

test("RED: 对我没用 maps to a JUDGEMENT record (user judgement, not a trust claim)", () => {
  const record = feedbackKnowledgeRecord("not_useful", "某公告");
  assert.deepEqual(record, { type: "JUDGEMENT", text: "Not useful: 某公告" });
});

test("RED: 改变了我的看法 maps to a JUDGEMENT record", () => {
  const record = feedbackKnowledgeRecord("changed_view", "某研究");
  assert.deepEqual(record, { type: "JUDGEMENT", text: "Changed after evidence: 某研究" });
});

test("feedback title line breaks cannot create unlabelled judgement lines", () => {
  assert.deepEqual(feedbackKnowledgeRecord("changed_view", "某研究\r\n新增能力"), {
    type: "JUDGEMENT", text: "Changed after evidence: 某研究 新增能力",
  });
});

test("RED: 关注 maps to TRACKED_EVENT", () => {
  const record = feedbackKnowledgeRecord("monitor", "某事件");
  assert.deepEqual(record, { type: "TRACKED_EVENT", text: "某事件" });
});

test("RED: unknown feedback kind is rejected", () => {
  assert.throws(() => feedbackKnowledgeRecord("make_me_rich" as never, "x"), /UNKNOWN_FEEDBACK_KIND/);
});

test("RED: empty source title is rejected", () => {
  assert.throws(() => feedbackKnowledgeRecord("already_knew", "   "), /EMPTY_SOURCE_TITLE/);
});

test("RED: repository persists feedback scoped by user and filter, with stable-id dedup", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);
  const now = "2026-10-02T00:00:00.000Z";
  await repository.upsertPersonalKnowledge(
    { authenticatedUserId: "user-a", filterId: "account-user-a" },
    feedbackKnowledgeRecord("already_knew", "某发布"),
    now,
  );
  const call = calls.find((c) => c.sql.includes("personal_knowledge"));
  assert.ok(call, "personal_knowledge upsert must be issued");
  assert.match(call.sql, /ON CONFLICT \(user_id, filter_id, stable_id\)/, "stable-id dedup must be in the statement");
  assert.equal(call.values[1], "user-a", "scoped by authenticated user");
  assert.equal(call.values[2], "account-user-a", "scoped by filter");
});

test("RED: the same feedback twice hits the same stable id (no duplicate rows)", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);
  const record = feedbackKnowledgeRecord("not_useful", "某公告");
  await repository.upsertPersonalKnowledge({ authenticatedUserId: "user-a", filterId: "account-user-a" }, record, "2026-10-02T00:00:00.000Z");
  await repository.upsertPersonalKnowledge({ authenticatedUserId: "user-a", filterId: "account-user-a" }, record, "2026-10-02T00:00:01.000Z");
  const upserts = calls.filter((c) => c.sql.includes("personal_knowledge"));
  const stableIds = upserts.map((c) => c.values[7]);
  assert.equal(new Set(stableIds).size, 1, `same stable id for repeated feedback: ${stableIds.join(",")}`);
});

test("RED: user B's feedback uses B's scope (isolation)", async () => {
  const { client, calls } = fakeClient();
  const repository = new PostgresSignalRepository(client);
  await repository.upsertPersonalKnowledge(
    { authenticatedUserId: "user-b", filterId: "account-user-b" },
    feedbackKnowledgeRecord("monitor", "某事件"),
    "2026-10-02T00:00:00.000Z",
  );
  const call = calls.find((c) => c.sql.includes("personal_knowledge"));
  assert.equal(call?.values[1], "user-b");
  assert.equal(call?.values[2], "account-user-b");
});

test("RED: save scope distinguishes account from anonymous session", () => {
  assert.equal(feedbackScope("authenticated"), "account");
  assert.equal(feedbackScope("anonymous"), "anonymous-session");
});
