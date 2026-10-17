import assert from "node:assert/strict";
import test from "node:test";
import { planGoal, type Goal } from "../agent/goal-planner.ts";
import { runGoalContinuation } from "../agent/goal-runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";

const context = { authenticatedUserId: "goal-user", filterId: "goal-filter" };
const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "goal-1", userId: context.authenticatedUserId, filterId: context.filterId,
  objective: "Assess Model X", status: "active",
  successCriteria: ["capability confirmed", "price confirmed"], openQuestions: ["What is the price?"],
  taskIds: [], completedTaskIds: [], currentSummary: undefined,
  completedCriteria: [], remainingCriteria: ["capability confirmed", "price confirmed"],
  createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", ...overrides,
});

test("simple one-shot question does not create a long-lived goal", () => {
  assert.equal(planGoal({ goal: undefined, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "What is Model X?" }).goalStatus, "none");
});

test("partial task completion keeps goal active and creates only remaining tasks", () => {
  const result = planGoal({ goal: goal({ completedCriteria: ["capability confirmed"], remainingCriteria: ["price confirmed"], taskMetadata: [{ taskId: "task-capability", objective: "capability confirmed", type: "FACT_FINDING", status: "completed", supportingEvidenceIds: ["e1"] }] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(result.goalStatus, "active");
  assert.equal(result.nextTasks.length, 1);
  assert.match(result.nextTasks[0]!.objective, /price/i);
});

test("all success criteria completed marks goal completed", () => {
  const result = planGoal({ goal: goal({ completedCriteria: ["capability confirmed", "price confirmed"], remainingCriteria: [], taskMetadata: [{ taskId: "cap", objective: "capability confirmed", type: "FACT_FINDING", status: "completed", supportingEvidenceIds: ["e1"] }, { taskId: "price", objective: "price confirmed", type: "FACT_FINDING", status: "completed", supportingEvidenceIds: ["e2"] }] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(result.goalStatus, "completed");
  assert.deepEqual(result.nextTasks, []);
});

test("failed prerequisite blocks and unavailable information waits", () => {
  const blocked = planGoal({ goal: goal(), relatedKnowledge: [], completedTasks: [{ id: "task-1", objective: "Confirm capability", type: "FACT_FINDING", dependencies: [], status: "failed" }], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(blocked.goalStatus, "blocked");
  const waiting = planGoal({ goal: goal({ remainingCriteria: ["price confirmed"] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: ["price source unavailable"], userQuery: "Assess Model X" });
  assert.equal(waiting.goalStatus, "waiting");
});

test("unresolved conflicts create verification work and stale knowledge creates refresh work", () => {
  const result = planGoal({
    goal: goal(),
    relatedKnowledge: ["Model X existed"],
    staleKnowledge: ["Model X release status"],
    completedTasks: [],
    unresolvedItems: ["conflicting release claims"],
    userQuery: "Assess Model X",
  });
  assert.equal(result.goalStatus, "active");
  assert.equal(result.nextTasks.some((task) => task.type === "VERIFICATION" && /conflict/i.test(task.objective)), true);
  assert.equal(result.nextTasks.some((task) => task.type === "VERIFICATION" && /refresh stale/i.test(task.objective)), true);
});

test("goal persistence is filter and user scoped across repository instances", () => {
  const repository = new InMemorySignalRepository();
  const saved = goal();
  repository.saveGoal(context, saved);
  const rebuilt = repository;
  assert.equal(rebuilt.getGoal(context, saved.id)?.objective, "Assess Model X");
  assert.equal(rebuilt.getGoal({ authenticatedUserId: "other", filterId: context.filterId }, saved.id), null);
});

test("completed task ids prevent duplicate continuation work", () => {
  const current = goal({ successCriteria: ["price confirmed"], taskIds: ["goal-task-price-confirmed"], completedTaskIds: ["goal-task-price-confirmed"], completedCriteria: [], remainingCriteria: ["price confirmed"] });
  const result = planGoal({ goal: current, relatedKnowledge: [], completedTasks: [{ id: "goal-task-price-confirmed", objective: "Confirm price", type: "FACT_FINDING", dependencies: [], status: "completed" }], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(result.nextTasks.length, 0);
});

test("goal continuation reuses the existing task runner and persists progress", async () => {
  const repository = new InMemorySignalRepository();
  const saved = goal({ successCriteria: ["release confirmed"], remainingCriteria: ["release confirmed"] });
  repository.saveGoal(context, saved);
  const result = await runGoalContinuation({
    goalId: saved.id,
    context,
    repository,
    input: {} as never,
    runTask: async () => ({ status: "completed" } as never),
    now: "2026-09-07T01:00:00.000Z",
  });
  assert.equal(result.taskResults.length, 1);
  assert.equal(result.taskResults[0]?.taskId, "goal-task-release-confirmed");
  assert.deepEqual(repository.getGoal(context, saved.id)?.taskIds, ["goal-task-release-confirmed"]);
  assert.equal(repository.getGoal(context, saved.id)?.taskMetadata?.[0]?.status, "completed");
  assert.equal(repository.getGoal(context, saved.id)?.lastTransition?.goalId, saved.id);
});

test("completed status is revalidated and criteria are normalized", () => {
  const result = planGoal({ goal: goal({ status: "completed", completedCriteria: ["not a criterion"], remainingCriteria: [] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.notEqual(result.goalStatus, "completed");
  assert.deepEqual(result.completedCriteria, []);
  assert.deepEqual(result.remainingCriteria, ["capability confirmed", "price confirmed"]);
});

test("unverified or stale task evidence cannot satisfy a criterion", () => {
  const task = (verificationStatus: string, eventStatus = "NEW") => ({
    id: `task-${verificationStatus}-${eventStatus}`,
    objective: "capability confirmed",
    type: "FACT_FINDING" as const,
    dependencies: [],
    status: "completed" as const,
    result: {
      status: "completed",
      response: { signals: [{ title: "capability confirmed", summary: "capability confirmed", verificationStatus, eventStatus, timestampStatus: "valid", reliabilityScore: 90 }] },
    } as never,
  });
  for (const candidate of [task("unverified"), task("verified", "BACKGROUND")]) {
    const result = planGoal({ goal: goal({ successCriteria: ["capability confirmed"], remainingCriteria: ["capability confirmed"] }), relatedKnowledge: [], completedTasks: [candidate], unresolvedItems: [], userQuery: "Assess Model X" });
    assert.deepEqual(result.completedCriteria, []);
  }
});

test("verified evidence-backed task can satisfy a criterion", () => {
  const result = planGoal({
    goal: goal({ successCriteria: ["capability confirmed"], remainingCriteria: ["capability confirmed"] }),
    relatedKnowledge: [],
    completedTasks: [{ id: "verified-task", objective: "capability confirmed", type: "FACT_FINDING", dependencies: [], status: "completed", result: { status: "completed", response: { signals: [{ title: "capability confirmed", summary: "capability confirmed", verificationStatus: "verified", eventStatus: "NEW", timestampStatus: "valid", claims: [{ verificationStatus: "verified", sourceUrl: "https://example.com", evidenceSnippet: "confirmed" }] }] } } as never }],
    unresolvedItems: [],
    userQuery: "Assess Model X",
  });
  assert.deepEqual(result.completedCriteria, ["capability confirmed"]);
  assert.equal(result.goalStatus, "completed");
});

test("active goal with no executable next task becomes waiting", () => {
  const result = planGoal({ goal: goal({ taskIds: ["goal-task-capability-confirmed", "goal-task-price-confirmed"] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(result.goalStatus, "waiting");
});

test("waiting and blocked goals require an explicit resume signal", () => {
  const waiting = goal({ status: "waiting" });
  const blocked = goal({ status: "blocked" });
  assert.equal(planGoal({ goal: waiting, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" }).goalStatus, "waiting");
  assert.equal(planGoal({ goal: blocked, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" }).goalStatus, "blocked");
  assert.equal(planGoal({ goal: waiting, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], resumeRequested: true, userQuery: "Assess Model X" }).goalStatus, "active");
  assert.equal(planGoal({ goal: blocked, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], resumeRequested: true, userQuery: "Assess Model X" }).goalStatus, "active");
});

test("same normalized objective and task type are not scheduled twice", () => {
  const result = planGoal({ goal: goal({ taskMetadata: [{ taskId: "old-id", objective: "Research and verify: capability confirmed", type: "FACT_FINDING", status: "completed" }] }), relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: "Assess Model X" });
  assert.equal(result.nextTasks.some((task) => /capability confirmed/i.test(task.objective)), false);
});
