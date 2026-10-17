import assert from "node:assert/strict";
import test from "node:test";
import { BudgetManager } from "../agent/budget-manager.ts";

test("BudgetManager reports remaining time and guards without changing deadlines", () => {
  let now = 1_000;
  const budget = new BudgetManager({ deadlineAt: 11_000, now: () => now });

  assert.equal(budget.remainingMs(), 10_000);
  assert.equal(budget.canStartModelPlanning(), true);
  assert.equal(budget.canStartRetrieval(), true);
  assert.equal(budget.shouldGracefullyStop(1), false);

  now = 3_000;
  assert.equal(budget.remainingMs(), 8_000);
  assert.equal(budget.canStartModelPlanning(), false);
  assert.equal(budget.canStartRetrieval(), true);
  assert.equal(budget.shouldGracefullyStop(1), true);
  assert.equal(budget.shouldGracefullyStop(0), false);
});

test("BudgetManager snapshot exposes deterministic guard decisions", () => {
  const budget = new BudgetManager({ deadlineAt: 5_500, now: () => 1_000 });
  assert.deepEqual(budget.snapshot(), {
    remainingDeadlineMs: 4_500,
    canStartModelPlanning: false,
    canStartRetrieval: true,
    modelPlanningGuardMs: 9000,
    retrievalGuardMs: 4000,
  });
});

 test("planning cap reserves retrieval time inside unchanged deadline", () => {
  let clock = 0;
  const budget = new BudgetManager({deadlineAt: 21089, now: () => clock});
  assert.equal(budget.modelPlanningTimeoutMs(), 8000);
  clock = 11589;
  assert.equal(budget.modelPlanningTimeoutMs(), 500);
  clock = 12500;
  assert.equal(budget.modelPlanningTimeoutMs(), 0);
});
