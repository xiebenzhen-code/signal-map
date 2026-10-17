import assert from "node:assert/strict";
import test from "node:test";

import type { Goal } from "../agent/goal-types.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { runSchedulerTick } from "../scheduler/watch-runner.ts";

const context = { authenticatedUserId: "scheduler-user", filterId: "scheduler-filter" };
const now = "2026-09-07T10:00:00.000Z";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "scheduler-goal",
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    objective: "Watch Model X",
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
      resumeCondition: { type: "POLL", reason: "Check release", target: "Model X", nextCheckAt: now },
      consecutiveNoChangeCount: 0,
      watchStatus: "waiting",
      lastCheckOutcome: "not_checked",
    },
    ...overrides,
  };
}

test("due query skips future goals and includes due goals only", () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ id: "future", watch: { resumeCondition: { type: "POLL", reason: "Later", target: "Model X", nextCheckAt: "2026-09-07T11:00:00.000Z" }, consecutiveNoChangeCount: 0, watchStatus: "waiting" } }));
  repository.saveGoal(context, goal({ id: "due" }));
  const due = repository.findDueGoals(now);
  assert.deepEqual(due.map((item) => item.goal.id), ["due"]);
});

test("MANUAL and EVENT goals do not enter ordinary scheduler polling", () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ id: "manual", watch: { resumeCondition: { type: "MANUAL", reason: "User only", target: "user", nextCheckAt: now }, consecutiveNoChangeCount: 0, watchStatus: "waiting" } }));
  repository.saveGoal(context, goal({ id: "event", watch: { resumeCondition: { type: "EVENT", reason: "Event only", target: "release", nextCheckAt: now }, consecutiveNoChangeCount: 0, watchStatus: "waiting" } }));
  assert.equal(repository.findDueGoals(now).length, 0);
});

test("lease claim prevents another worker from claiming until it expires", () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  assert.ok(repository.claimDueGoal(context, saved.id, "worker-a", "2026-09-07T10:05:00.000Z", now));
  assert.equal(repository.claimDueGoal(context, saved.id, "worker-b", "2026-09-07T10:06:00.000Z", now), null);
  assert.ok(repository.claimDueGoal(context, saved.id, "worker-b", "2026-09-07T10:11:00.000Z", "2026-09-07T10:06:00.000Z"));
});

test("no-change scheduler check keeps goal waiting and moves nextCheckAt", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal());
  let ran = false;
  const result = await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "no_change",
    runTask: async () => {
      ran = true;
      return { status: "completed" } as never;
    },
  });
  const persisted = repository.getGoal(context, "scheduler-goal");
  assert.equal(result.claimedCount, 1);
  assert.equal(result.results[0]?.action, "checked");
  assert.equal(ran, false);
  assert.equal(persisted?.status, "waiting");
  assert.equal(persisted?.watch?.lastCheckOutcome, "no_change");
  assert.ok(Date.parse(persisted?.watch?.nextCheckAt ?? "") > Date.parse(now));
  assert.equal(persisted?.watch?.leaseOwner, undefined);
});

test("condition-met scheduler check resumes the same goal", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal());
  let runCount = 0;
  const result = await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "condition_met",
    runTask: async () => {
      runCount += 1;
      return { status: "completed" } as never;
    },
  });
  assert.equal(result.resumedCount, 1);
  assert.equal(result.results[0]?.action, "resumed");
  assert.equal(runCount, 1);
  assert.equal(repository.getGoal(context, "scheduler-goal")?.id, "scheduler-goal");
});

test("completed and abandoned goals are never scheduled", () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ id: "completed", status: "completed" }));
  repository.saveGoal(context, goal({ id: "abandoned", status: "abandoned" }));
  assert.equal(repository.findDueGoals(now).length, 0);
});

test("temporary check failure backs off without marking the goal failed", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal());
  const result = await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "temporary_failure",
    runTask: async () => ({ status: "completed" } as never),
  });
  const persisted = repository.getGoal(context, "scheduler-goal");
  assert.equal(result.results[0]?.action, "checked");
  assert.equal(persisted?.status, "waiting");
  assert.equal(persisted?.watch?.lastCheckOutcome, "temporary_failure");
  assert.ok(persisted?.watch?.nextCheckAt);
});

test("blocked goals are not resumed by no-change polling", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ status: "blocked" }));
  const result = await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "no_change",
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(result.results[0]?.action, "checked");
  assert.equal(repository.getGoal(context, "scheduler-goal")?.status, "blocked");
});

test("expired lease lets a later worker recover a crashed run", () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  assert.ok(repository.claimDueGoal(context, saved.id, "crashed-worker", "2026-09-07T10:01:00.000Z", now));
  const recovered = repository.findDueGoals("2026-09-07T10:02:00.000Z");
  assert.deepEqual(recovered.map((item) => item.goal.id), [saved.id]);
});

test("repeated scheduler ticks do not re-execute completed work", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({
    taskIds: ["goal-task-release-confirmed"],
    completedTaskIds: ["goal-task-release-confirmed"],
    taskMetadata: [{ taskId: "goal-task-release-confirmed", objective: "Research and verify: release confirmed", type: "FACT_FINDING", status: "completed", supportingEvidenceIds: ["e1"] }],
  }));
  let runCount = 0;
  await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "condition_met",
    runTask: async () => {
      runCount += 1;
      return { status: "completed" } as never;
    },
  });
  await runSchedulerTick({
    workerId: "worker-b",
    repository,
    input: {} as never,
    now: "2026-09-07T10:01:00.000Z",
    checkCondition: () => "condition_met",
    runTask: async () => {
      runCount += 1;
      return { status: "completed" } as never;
    },
  });
  assert.equal(runCount, 0);
  assert.equal(repository.findDueGoals("2026-09-07T10:01:00.000Z").length, 0);
  assert.equal(repository.getGoal(context, "scheduler-goal")?.watch?.watchStatus, "ready");
});

test("due query preserves authenticated user and filter isolation", () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ id: "a" }));
  repository.saveGoal({ authenticatedUserId: "other", filterId: "other-filter" }, goal({ id: "b", userId: "other", filterId: "other-filter" }));
  const due = repository.findDueGoals(now);
  assert.deepEqual(due.map((item) => `${item.context.authenticatedUserId}:${item.context.filterId}:${item.goal.id}`).sort(), [
    "other:other-filter:b",
    "scheduler-user:scheduler-filter:a",
  ]);
});
