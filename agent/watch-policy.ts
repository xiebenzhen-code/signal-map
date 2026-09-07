import type { GoalStatus, ResumeCondition } from "./goal-types.ts";

export type WatchDecisionAction = "WAIT" | "CHECK" | "RESUME" | "EXPIRE";

export type WatchPolicyInput = {
  goalStatus: GoalStatus;
  resumeCondition?: ResumeCondition;
  urgency?: "low" | "medium" | "high";
  expectedChangeRate?: "low" | "medium" | "high";
  lastCheckedAt?: string;
  consecutiveNoChangeCount?: number;
  previousCheckOutcome?: "not_checked" | "no_change" | "condition_met" | "temporary_failure" | "permanent_failure" | "expired" | "event_ignored";
  now?: string;
};

export type WatchDecision = {
  action: WatchDecisionAction;
  nextCheckAt?: string;
  reason: string;
};

function time(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function intervalMinutes(input: WatchPolicyInput) {
  const base = input.urgency === "high" || input.expectedChangeRate === "high"
    ? 15
    : input.urgency === "low" || input.expectedChangeRate === "low"
      ? 240
      : 60;
  const backoff = Math.min(input.consecutiveNoChangeCount ?? 0, 5);
  return base * Math.max(1, 2 ** backoff);
}

function addMinutes(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function decideWatch(input: WatchPolicyInput): WatchDecision {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const condition = input.resumeCondition;
  if (!condition) return { action: "WAIT", reason: "No resume condition is configured." };
  const expiresAt = time(condition.expiresAt);
  if (expiresAt !== undefined && nowMs >= expiresAt) return { action: "EXPIRE", reason: "Resume condition expired." };
  if (input.goalStatus === "completed" || input.goalStatus === "abandoned") return { action: "WAIT", reason: "Terminal goals do not resume automatically." };
  if (condition.type === "MANUAL") return { action: "WAIT", reason: "Manual resume requires an explicit user action." };
  if (condition.type === "EVENT") return { action: "WAIT", reason: "Event resume waits for a matching trigger." };
  if (condition.type === "TIME") {
    const nextCheckAt = time(condition.nextCheckAt);
    if (nextCheckAt !== undefined && nowMs >= nextCheckAt) return { action: "RESUME", reason: "Scheduled resume time has arrived." };
    return { action: "WAIT", nextCheckAt: condition.nextCheckAt, reason: "Scheduled resume time has not arrived." };
  }
  if (condition.type === "POLL") {
    if (input.previousCheckOutcome === "condition_met") return { action: "RESUME", reason: "Polling condition is satisfied." };
    if (input.previousCheckOutcome === "permanent_failure") return { action: "WAIT", nextCheckAt: addMinutes(now, intervalMinutes({ ...input, consecutiveNoChangeCount: (input.consecutiveNoChangeCount ?? 0) + 1 })), reason: "Polling condition is blocked by a permanent failure." };
    if (input.previousCheckOutcome === "temporary_failure" || input.previousCheckOutcome === "no_change") return { action: "WAIT", nextCheckAt: addMinutes(now, intervalMinutes({ ...input, consecutiveNoChangeCount: (input.consecutiveNoChangeCount ?? 0) + 1 })), reason: "No resume signal found; next check is backed off." };
    const dueAt = time(condition.nextCheckAt);
    if (dueAt === undefined || nowMs >= dueAt) return { action: "CHECK", reason: "Polling condition is due for a lightweight check." };
    return { action: "WAIT", nextCheckAt: condition.nextCheckAt, reason: "Polling condition is not due yet." };
  }
  return { action: "WAIT", reason: "Resume condition is not actionable." };
}
