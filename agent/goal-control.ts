import { runGoalContinuation, type GoalContinuationInput, type GoalContinuationResult } from "./goal-runner.ts";
import type { Goal, GoalWatchMetadata } from "./goal-types.ts";
import type { AuthenticatedFilterContext, GoalRepository } from "../information/repositories/types.ts";

export type GoalControlResult = {
  status: "updated" | "rejected" | "not_found";
  reason: string;
  goal: Goal | null;
  continuation?: GoalContinuationResult;
};

type GoalControlInput = {
  context: AuthenticatedFilterContext;
  repository: GoalRepository & GoalContinuationInput["repository"];
  goalId: string;
  now?: string;
};

function timestamp(value?: string) {
  return value ?? new Date().toISOString();
}

function terminal(goal: Goal) {
  return goal.status === "completed" || goal.status === "abandoned";
}

function manualWatch(goal: Goal): GoalWatchMetadata {
  return {
    resumeCondition: { type: "MANUAL", reason: "Paused by user.", target: "manual resume" },
    consecutiveNoChangeCount: goal.watch?.consecutiveNoChangeCount ?? 0,
    watchStatus: "waiting",
    lastCheckedAt: goal.watch?.lastCheckedAt,
    nextCheckAt: undefined,
    lastTriggerAt: goal.watch?.lastTriggerAt,
    lastCheckOutcome: "not_checked",
    schedulerFailureCount: goal.watch?.schedulerFailureCount ?? 0,
    schedulerLastRunAt: goal.watch?.schedulerLastRunAt,
    schedulerLastErrorSummary: goal.watch?.schedulerLastErrorSummary,
  };
}

export async function pauseGoal(input: GoalControlInput): Promise<GoalControlResult> {
  const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
  if (!goal) return { status: "not_found", reason: "Goal not found.", goal: null };
  if (terminal(goal)) return { status: "rejected", reason: "Terminal goals cannot be paused.", goal };
  const now = timestamp(input.now);
  const updated: Goal = {
    ...goal,
    status: "waiting",
    updatedAt: now,
    watch: manualWatch(goal),
    lastTransition: {
      goalId: goal.id,
      previousStatus: goal.status,
      newStatus: "waiting",
      completedCriteria: [...goal.completedCriteria],
      remainingCriteria: [...goal.remainingCriteria],
      selectedNextTasks: [],
      blockingReason: "Paused by user.",
      relatedAgentRunIds: [],
      timestamp: now,
    },
  };
  return { status: "updated", reason: "Goal paused.", goal: await Promise.resolve(input.repository.saveGoal(input.context, updated)) };
}

export async function abandonGoal(input: GoalControlInput): Promise<GoalControlResult> {
  const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
  if (!goal) return { status: "not_found", reason: "Goal not found.", goal: null };
  if (goal.status === "completed") return { status: "rejected", reason: "Completed goals cannot be abandoned.", goal };
  if (goal.status === "abandoned") return { status: "updated", reason: "Goal already abandoned.", goal };
  const now = timestamp(input.now);
  const updated: Goal = {
    ...goal,
    status: "abandoned",
    updatedAt: now,
    watch: goal.watch ? { ...goal.watch, watchStatus: "expired", nextCheckAt: undefined } : undefined,
    lastTransition: {
      goalId: goal.id,
      previousStatus: goal.status,
      newStatus: "abandoned",
      completedCriteria: [...goal.completedCriteria],
      remainingCriteria: [...goal.remainingCriteria],
      selectedNextTasks: [],
      blockingReason: "Abandoned by user.",
      relatedAgentRunIds: [],
      timestamp: now,
    },
  };
  return { status: "updated", reason: "Goal abandoned.", goal: await Promise.resolve(input.repository.saveGoal(input.context, updated)) };
}

export async function resumeGoalByUser(input: GoalControlInput & Omit<GoalContinuationInput, "context" | "repository" | "goalId">): Promise<GoalControlResult> {
  const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
  if (!goal) return { status: "not_found", reason: "Goal not found.", goal: null };
  if (terminal(goal)) return { status: "rejected", reason: "Terminal goals cannot be resumed.", goal };
  const continuation = await runGoalContinuation({ ...input, resumeRequested: true });
  return {
    status: continuation.goal ? "updated" : "not_found",
    reason: continuation.goal ? "Goal resumed through continuation flow." : "Goal not found.",
    goal: continuation.goal,
    continuation,
  };
}
