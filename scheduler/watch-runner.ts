import { resumeGoalIfReady, type GoalResumeInput } from "../agent/goal-resume.ts";
import type { Goal } from "../agent/goal-types.ts";

export type SchedulerGoalResult = {
  goalId: string;
  claimed: boolean;
  action: "skipped" | "checked" | "resumed" | "expired" | "failed";
  reason: string;
};

export type SchedulerTickResult = {
  workerId: string;
  checkedAt: string;
  dueGoalCount: number;
  claimedCount: number;
  resumedCount: number;
  results: SchedulerGoalResult[];
};

export type SchedulerTickInput = Omit<GoalResumeInput, "goalId" | "context" | "resumeRequested"> & {
  workerId: string;
  leaseMs?: number;
  limit?: number;
  now?: string;
};

function releaseLease(goal: Goal, now: string, error?: string): Goal {
  if (!goal.watch) return goal;
  const failed = goal.watch.lastCheckOutcome === "permanent_failure";
  return {
    ...goal,
    status: failed ? "blocked" : goal.status,
    updatedAt: now,
    watch: {
      ...goal.watch,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      schedulerLastRunAt: now,
      schedulerFailureCount: error ? (goal.watch.schedulerFailureCount ?? 0) + 1 : goal.watch.schedulerFailureCount,
      schedulerLastErrorSummary: error ? error.slice(0, 300) : goal.watch.schedulerLastErrorSummary,
    },
  };
}

export async function runSchedulerTick(input: SchedulerTickInput): Promise<SchedulerTickResult> {
  const now = input.now ?? new Date().toISOString();
  const leaseExpiresAt = new Date(Date.parse(now) + (input.leaseMs ?? 5 * 60_000)).toISOString();
  const dueGoals = await Promise.resolve(input.repository.findDueGoals(now, input.limit ?? 25));
  const results: SchedulerGoalResult[] = [];
  let claimedCount = 0;
  let resumedCount = 0;

  for (const item of dueGoals) {
    const claimed = await Promise.resolve(input.repository.claimDueGoal(item.context, item.goal.id, input.workerId, leaseExpiresAt, now));
    if (!claimed) {
      results.push({ goalId: item.goal.id, claimed: false, action: "skipped", reason: "Goal was already claimed or is no longer due." });
      continue;
    }
    claimedCount += 1;
    try {
      const resume = await resumeGoalIfReady({
        ...input,
        goalId: claimed.id,
        context: item.context,
        repository: input.repository,
      });
      const latest = resume.goal ?? await Promise.resolve(input.repository.getGoal(item.context, claimed.id)) ?? claimed;
      await Promise.resolve(input.repository.saveGoal(item.context, releaseLease(latest, now)));
      if (resume.decision.action === "RESUME") resumedCount += 1;
      results.push({
        goalId: claimed.id,
        claimed: true,
        action: resume.decision.action === "RESUME" ? "resumed" : resume.decision.action === "EXPIRE" ? "expired" : "checked",
        reason: resume.decision.reason,
      });
    } catch (error) {
      const latest = await Promise.resolve(input.repository.getGoal(item.context, claimed.id)) ?? claimed;
      const message = error instanceof Error ? error.message : "scheduler execution failed";
      await Promise.resolve(input.repository.saveGoal(item.context, releaseLease(latest, now, message)));
      results.push({ goalId: claimed.id, claimed: true, action: "failed", reason: message.slice(0, 300) });
    }
  }

  return {
    workerId: input.workerId,
    checkedAt: now,
    dueGoalCount: dueGoals.length,
    claimedCount,
    resumedCount,
    results,
  };
}
