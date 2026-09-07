import assert from "node:assert/strict";
import test from "node:test";

import { resumeGoalIfReady } from "../agent/goal-resume.ts";
import type { Goal } from "../agent/goal-types.ts";
import { decideWatch } from "../agent/watch-policy.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";

const context = { authenticatedUserId: "watch-user", filterId: "watch-filter" };
const now = "2026-09-07T10:00:00.000Z";

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "goal-watch-1",
  userId: context.authenticatedUserId,
  filterId: context.filterId,
  objective: "Watch Model X release status",
  status: "waiting",
  successCriteria: ["release confirmed"],
  openQuestions: ["Did Model X ship?"],
  taskIds: [],
  completedTaskIds: [],
  taskMetadata: [],
  completedCriteria: [],
  remainingCriteria: ["release confirmed"],
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  watch: {
    resumeCondition: { type: "POLL", reason: "Check release status", target: "Model X", nextCheckAt: now },
    consecutiveNoChangeCount: 0,
    watchStatus: "waiting",
    lastCheckOutcome: "not_checked",
  },
  ...overrides,
});

test("TIME resume waits before its target and resumes when due", () => {
  const condition = { type: "TIME" as const, reason: "Wait until embargo lifts", target: "embargo", nextCheckAt: "2026-09-07T12:00:00.000Z" };
  assert.equal(decideWatch({ goalStatus: "waiting", resumeCondition: condition, now }).action, "WAIT");
  assert.equal(decideWatch({ goalStatus: "waiting", resumeCondition: condition, now: "2026-09-07T12:00:00.000Z" }).action, "RESUME");
});

test("POLL no-change updates waiting metadata and backs off without running research", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  let ran = false;
  const result = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    checkCondition: () => "no_change",
    runTask: async () => {
      ran = true;
      return { status: "completed" } as never;
    },
  });
  assert.equal(result.decision.action, "WAIT");
  assert.equal(ran, false);
  const persisted = repository.getGoal(context, saved.id);
  assert.equal(persisted?.status, "waiting");
  assert.equal(persisted?.watch?.lastCheckOutcome, "no_change");
  assert.equal(persisted?.watch?.consecutiveNoChangeCount, 1);
  assert.ok(persisted?.watch?.nextCheckAt);
});

test("consecutive no-change polling backs off future checks", () => {
  const first = decideWatch({
    goalStatus: "waiting",
    resumeCondition: { type: "POLL", reason: "Check", target: "release", nextCheckAt: now },
    previousCheckOutcome: "no_change",
    consecutiveNoChangeCount: 0,
    now,
  });
  const backedOff = decideWatch({
    goalStatus: "waiting",
    resumeCondition: { type: "POLL", reason: "Check", target: "release", nextCheckAt: now },
    previousCheckOutcome: "no_change",
    consecutiveNoChangeCount: 3,
    now,
  });
  assert.ok(Date.parse(backedOff.nextCheckAt!) > Date.parse(first.nextCheckAt!));
});

test("POLL condition met resumes the same goal and skips completed tasks", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal({
    taskIds: ["goal-task-release-confirmed"],
    completedTaskIds: ["goal-task-release-confirmed"],
    taskMetadata: [{ taskId: "goal-task-release-confirmed", objective: "Research and verify: release confirmed", type: "FACT_FINDING", status: "completed", supportingEvidenceIds: ["e1"] }],
    completedCriteria: [],
  });
  repository.saveGoal(context, saved);
  let runCount = 0;
  const result = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    checkCondition: () => "condition_met",
    runTask: async () => {
      runCount += 1;
      return { status: "completed" } as never;
    },
  });
  assert.equal(result.decision.action, "RESUME");
  assert.equal(runCount, 0);
  assert.equal(result.goal?.id, saved.id);
  assert.equal(result.goal?.remainingCriteria[0], "release confirmed");
});

test("EVENT trigger only resumes when it matches the resume target", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal({ watch: { resumeCondition: { type: "EVENT", reason: "Wait for release event", target: "release", expiresAt: "2026-09-08T00:00:00.000Z" }, consecutiveNoChangeCount: 0, watchStatus: "waiting" } });
  repository.saveGoal(context, saved);
  const ignored = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    trigger: { type: "comment", goalId: saved.id, source: "test", occurredAt: now, payloadSummary: "pricing mention" },
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(ignored.decision.action, "WAIT");
  assert.equal(repository.getGoal(context, saved.id)?.status, "waiting");

  let ran = false;
  const resumed = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    trigger: { type: "release", goalId: saved.id, source: "official", occurredAt: now, payloadSummary: "Model X release update" },
    runTask: async () => {
      ran = true;
      return { status: "completed" } as never;
    },
  });
  assert.equal(resumed.decision.action, "RESUME");
  assert.equal(ran, true);
});

test("MANUAL resume does not auto-check", () => {
  assert.equal(decideWatch({
    goalStatus: "waiting",
    resumeCondition: { type: "MANUAL", reason: "Needs user approval", target: "user" },
    now,
  }).action, "WAIT");
});

test("blocked goals do not resume from ordinary polling unless the condition is met", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal({ status: "blocked" });
  repository.saveGoal(context, saved);
  const result = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    checkCondition: () => "no_change",
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(result.decision.action, "WAIT");
  assert.equal(result.goal?.status, "blocked");
});

test("watch metadata survives repository access and stays user/filter scoped", () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  assert.equal(repository.getGoal(context, saved.id)?.watch?.resumeCondition.target, "Model X");
  assert.equal(repository.getGoal({ authenticatedUserId: "watch-user", filterId: "other-filter" }, saved.id), null);
  assert.equal(repository.getGoal({ authenticatedUserId: "other-user", filterId: "watch-filter" }, saved.id), null);
});

test("temporary failures keep the goal waiting and record failure metadata", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  const result = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    checkCondition: () => "temporary_failure",
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(result.decision.action, "WAIT");
  assert.equal(result.goal?.status, "waiting");
  assert.equal(result.goal?.watch?.lastCheckOutcome, "temporary_failure");
});

test("expiresAt blocks the goal without pretending it completed", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal({ watch: { resumeCondition: { type: "POLL", reason: "Check until deadline", target: "release", nextCheckAt: now, expiresAt: "2026-09-07T09:00:00.000Z" }, consecutiveNoChangeCount: 0, watchStatus: "waiting" } });
  repository.saveGoal(context, saved);
  const result = await resumeGoalIfReady({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    now,
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(result.decision.action, "EXPIRE");
  assert.equal(result.goal?.status, "blocked");
  assert.equal(result.goal?.completedAt, undefined);
  assert.equal(result.goal?.watch?.watchStatus, "expired");
});
