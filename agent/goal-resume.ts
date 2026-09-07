import { runGoalContinuation, type GoalContinuationInput, type GoalContinuationResult } from "./goal-runner.ts";
import type { Goal, GoalWatchMetadata } from "./goal-types.ts";
import { decideWatch, type WatchDecision } from "./watch-policy.ts";

export type TriggerEvent = {
  type: string;
  goalId: string;
  source: string;
  occurredAt: string;
  payloadSummary: string;
};

export type ResumeCheckOutcome = "no_change" | "condition_met" | "temporary_failure" | "permanent_failure";

export type GoalResumeInput = GoalContinuationInput & {
  trigger?: TriggerEvent;
  checkCondition?: (goal: Goal) => Promise<ResumeCheckOutcome> | ResumeCheckOutcome;
};

export type GoalResumeResult = {
  goal: Goal | null;
  decision: WatchDecision;
  continuation?: GoalContinuationResult;
};

function matchesTrigger(goal: Goal, trigger?: TriggerEvent) {
  if (!trigger || trigger.goalId !== goal.id || goal.watch?.resumeCondition.type !== "EVENT") return false;
  const target = goal.watch.resumeCondition.target.toLowerCase();
  return [trigger.type, trigger.source, trigger.payloadSummary].some((value) => value.toLowerCase().includes(target));
}

function updateWatch(goal: Goal, patch: Partial<GoalWatchMetadata>, now: string): Goal {
  if (!goal.watch) return goal;
  return {
    ...goal,
    updatedAt: now,
    watch: { ...goal.watch, ...patch },
  };
}

export async function resumeGoalIfReady(input: GoalResumeInput): Promise<GoalResumeResult> {
  const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
  const now = input.now ?? new Date().toISOString();
  if (!goal) return { goal: null, decision: { action: "WAIT", reason: "Goal not found." } };
  if (goal.status === "completed" || goal.status === "abandoned") return { goal, decision: { action: "WAIT", reason: "Terminal goals do not resume automatically." } };
  if (!goal.watch) return { goal, decision: { action: "WAIT", reason: "Goal has no resume condition." } };

  if (goal.watch.resumeCondition.type === "EVENT") {
    if (!matchesTrigger(goal, input.trigger)) {
      const updated = updateWatch(goal, { lastTriggerAt: input.trigger?.occurredAt ?? goal.watch.lastTriggerAt, lastCheckOutcome: "event_ignored", watchStatus: "waiting" }, now);
      await Promise.resolve(input.repository.saveGoal(input.context, updated));
      return { goal: updated, decision: { action: "WAIT", reason: "Trigger did not match resume condition." } };
    }
    const updated = updateWatch(goal, { lastTriggerAt: input.trigger!.occurredAt, lastCheckOutcome: "condition_met", watchStatus: "ready" }, now);
    await Promise.resolve(input.repository.saveGoal(input.context, updated));
    const continuation = await runGoalContinuation({ ...input, resumeRequested: true });
    return { goal: continuation.goal, decision: { action: "RESUME", reason: "Matching trigger satisfied resume condition." }, continuation };
  }

  let decision = decideWatch({
    goalStatus: goal.status,
    resumeCondition: goal.watch.resumeCondition,
    lastCheckedAt: goal.watch.lastCheckedAt,
    consecutiveNoChangeCount: goal.watch.consecutiveNoChangeCount,
    previousCheckOutcome: goal.watch.lastCheckOutcome,
    now,
  });

  if (decision.action === "CHECK") {
    const outcome = input.checkCondition ? await input.checkCondition(goal) : "no_change";
    decision = decideWatch({
      goalStatus: goal.status,
      resumeCondition: goal.watch.resumeCondition,
      lastCheckedAt: now,
      consecutiveNoChangeCount: outcome === "no_change" || outcome === "temporary_failure" ? goal.watch.consecutiveNoChangeCount + 1 : 0,
      previousCheckOutcome: outcome,
      now,
    });
    if (decision.action !== "RESUME") {
      const updated = updateWatch(goal, {
        lastCheckedAt: now,
        nextCheckAt: decision.nextCheckAt,
        consecutiveNoChangeCount: outcome === "no_change" || outcome === "temporary_failure" ? goal.watch.consecutiveNoChangeCount + 1 : goal.watch.consecutiveNoChangeCount,
        lastCheckOutcome: outcome,
        watchStatus: outcome === "permanent_failure" ? "error" : "waiting",
      }, now);
      await Promise.resolve(input.repository.saveGoal(input.context, updated));
      return { goal: updated, decision };
    }
  }

  if (decision.action === "EXPIRE") {
    const updated = updateWatch(goal, { lastCheckedAt: now, lastCheckOutcome: "expired", watchStatus: "expired" }, now);
    await Promise.resolve(input.repository.saveGoal(input.context, { ...updated, status: "blocked" }));
    return { goal: { ...updated, status: "blocked" }, decision };
  }
  if (decision.action === "RESUME") {
    const updated = updateWatch(goal, { lastCheckedAt: now, lastCheckOutcome: "condition_met", watchStatus: "ready", consecutiveNoChangeCount: 0 }, now);
    await Promise.resolve(input.repository.saveGoal(input.context, updated));
    const continuation = await runGoalContinuation({ ...input, resumeRequested: true });
    return { goal: continuation.goal, decision, continuation };
  }
  const updated = updateWatch(goal, { nextCheckAt: decision.nextCheckAt ?? goal.watch.nextCheckAt, watchStatus: "waiting" }, now);
  await Promise.resolve(input.repository.saveGoal(input.context, updated));
  return { goal: updated, decision };
}
