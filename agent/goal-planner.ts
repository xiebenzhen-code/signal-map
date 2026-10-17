import type { ResearchTask } from "./task-runner.ts";
import type { Goal, GoalStatus, GoalTaskMetadata } from "./goal-types.ts";
export type { Goal, GoalStatus } from "./goal-types.ts";

export type GoalPlan = {
  goalStatus: GoalStatus | "none";
  nextTasks: ResearchTask[];
  remainingQuestions: string[];
  completedCriteria: string[];
  remainingCriteria: string[];
  reason: string;
};

export type GoalPlannerInput = {
  goal?: Goal;
  relatedKnowledge: string[];
  staleKnowledge?: string[];
  completedTasks: ResearchTask[];
  unresolvedItems: string[];
  latestAgentRun?: { id?: string; status?: string };
  resumeRequested?: boolean;
  userQuery: string;
};

function words(value: string) {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2);
}

function criterionCovered(criterion: string, task: ResearchTask) {
  const tokens = words(criterion);
  const result = task.result as { status?: string; response?: { signals?: Array<{ title?: string; summary?: string; verificationStatus?: string; eventStatus?: string; timestampStatus?: string; claims?: Array<{ verificationStatus?: string; sourceUrl?: string; evidenceSnippet?: string }> }> } } | undefined;
  const hasVerifiedEvidence = result?.status === "completed" && result.response?.signals?.some((signal) =>
    signal.verificationStatus === "verified" &&
    signal.eventStatus !== "BACKGROUND" &&
    signal.timestampStatus !== "invalid" &&
    signal.claims?.some((claim) => claim.verificationStatus === "verified" && Boolean(claim.sourceUrl) && Boolean(claim.evidenceSnippet)),
  );
  const haystack = `${task.objective} ${result?.response?.signals?.map((signal) => `${signal.title ?? ""} ${signal.summary ?? ""}`).join(" ") ?? ""}`.toLowerCase();
  return Boolean(hasVerifiedEvidence) && tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function taskFingerprint(objective: string, type: string) {
  return `${words(objective).join(" ")}::${type}`;
}

function metadataFingerprint(task: GoalTaskMetadata | ResearchTask) {
  return taskFingerprint(task.objective, task.type);
}

function metadataCoversCriterion(criterion: string, metadata: GoalTaskMetadata) {
  const tokens = words(criterion);
  const objective = metadata.objective.toLowerCase();
  return metadata.status === "completed" && Boolean(metadata.supportingEvidenceIds?.length) && tokens.length > 0 && tokens.every((token) => objective.includes(token));
}

function taskIdForCriterion(criterion: string) {
  return `goal-task-${words(criterion).join("-")}`;
}

export function planGoal(input: GoalPlannerInput): GoalPlan {
  if (!input.goal) return { goalStatus: "none", nextTasks: [], remainingQuestions: [], completedCriteria: [], remainingCriteria: [], reason: "No persistent goal requested." };
  const goal = input.goal;
  if (goal.status === "abandoned") return { goalStatus: "abandoned", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria: goal.completedCriteria, remainingCriteria: goal.remainingCriteria, reason: "Goal was abandoned by the user." };
  const normalizedCriteria = Array.from(new Set(goal.successCriteria.map((criterion) => criterion.trim()).filter(Boolean)));
  const storedCompletedCriteria = Array.from(new Set(goal.completedCriteria.filter((criterion) => normalizedCriteria.includes(criterion) && (goal.taskMetadata ?? []).some((metadata) => metadataCoversCriterion(criterion, metadata)))));
  if (goal.status === "completed" && storedCompletedCriteria.length === normalizedCriteria.length) return { goalStatus: "completed", nextTasks: [], remainingQuestions: [], completedCriteria: storedCompletedCriteria, remainingCriteria: [], reason: "All success criteria are already complete." };

  const completedTasks = input.completedTasks.filter((task) => task.status === "completed");
  const failedTask = input.completedTasks.some((task) => task.status === "failed" || task.status === "blocked");
  const completedCriteria = Array.from(new Set([...storedCompletedCriteria, ...normalizedCriteria.filter((criterion) => completedTasks.some((task) => criterionCovered(criterion, task)))]));
  const remainingCriteria = normalizedCriteria.filter((criterion) => !completedCriteria.includes(criterion));
  if (remainingCriteria.length === 0) return { goalStatus: "completed", nextTasks: [], remainingQuestions: [], completedCriteria, remainingCriteria: [], reason: "All success criteria are satisfied." };
  if (failedTask) return { goalStatus: "blocked", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "A prerequisite task failed or is blocked." };
  const canResume = Boolean(input.resumeRequested || completedTasks.length > 0);
  if (goal.status === "waiting" && !canResume) return { goalStatus: "waiting", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "Goal is waiting for new evidence or an explicit resume request." };
  if (goal.status === "blocked" && !canResume) return { goalStatus: "blocked", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "Goal remains blocked until its failed dependency is resolved." };
  if (input.latestAgentRun?.status === "failed" && completedTasks.length === 0) return { goalStatus: "blocked", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "The latest AgentRun failed before completing a task." };
  if (input.latestAgentRun?.status === "needs_more_evidence" && input.unresolvedItems.length === 0) return { goalStatus: "waiting", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "The latest AgentRun requires more evidence before continuation." };
  const unresolvedConflict = input.unresolvedItems.some((item) => /conflict|conflicting|contradict|冲突|矛盾/i.test(item));
  if (input.unresolvedItems.length > 0 && !unresolvedConflict && completedTasks.length === 0) return { goalStatus: "waiting", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "Required information is currently unavailable." };

  const existingTaskIds = new Set([...goal.taskIds, ...goal.completedTaskIds, ...input.completedTasks.map((task) => task.id)]);
  const existingFingerprints = new Set([...(goal.taskMetadata ?? []), ...input.completedTasks].map(metadataFingerprint));
  const canRetry = (objective: string, type: string, retryable: boolean) => !existingFingerprints.has(taskFingerprint(objective, type)) || retryable;
  const nextTasks = remainingCriteria.filter((criterion) => {
    const id = taskIdForCriterion(criterion);
    const objective = `Research and verify: ${criterion}`;
    return !existingTaskIds.has(id) && canRetry(objective, "FACT_FINDING", false);
  }).map((criterion): ResearchTask => ({ id: taskIdForCriterion(criterion), objective: `Research and verify: ${criterion}`, type: "FACT_FINDING", dependencies: [], status: "ready" }));
  if (unresolvedConflict && (!existingTaskIds.has("goal-task-verify-conflict") || input.resumeRequested)) {
    nextTasks.unshift({ id: "goal-task-verify-conflict", objective: `Verify unresolved conflict for: ${goal.objective}`, type: "VERIFICATION", dependencies: [], status: "ready" });
  }
  for (const item of input.staleKnowledge ?? []) {
    const id = `goal-task-refresh-${words(item).slice(0, 5).join("-")}`;
    const objective = `Refresh stale knowledge: ${item}`;
    if ((!existingTaskIds.has(id) || input.resumeRequested) && canRetry(objective, "VERIFICATION", Boolean(input.resumeRequested)) && !nextTasks.some((task) => task.id === id)) nextTasks.unshift({ id, objective, type: "VERIFICATION", dependencies: [], status: "ready" });
  }
  if (nextTasks.length === 0) return { goalStatus: unresolvedConflict ? "waiting" : "waiting", nextTasks: [], remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "No executable task is currently available." };
  return { goalStatus: "active", nextTasks, remainingQuestions: goal.openQuestions, completedCriteria, remainingCriteria, reason: "Some success criteria remain; continue with the next uncompleted research tasks." };
}
