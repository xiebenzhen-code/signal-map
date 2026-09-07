import { planGoal, type GoalPlan } from "./goal-planner.ts";
import { runTaskPlannedAgent, type ResearchTask, type TaskRunResult } from "./task-runner.ts";
import type { AgentRunOptions, AgentRunResult } from "./types.ts";
import type { ModelAdapter } from "./model-adapter.ts";
import type { Goal } from "./goal-types.ts";
import type { GoalRepository } from "../information/repositories/types.ts";

export type GoalContinuationInput = Omit<AgentRunOptions, "userQuery" | "repository" | "context" | "modelAdapter"> & {
  goalId: string;
  context: NonNullable<AgentRunOptions["context"]>;
  repository: GoalRepository & NonNullable<AgentRunOptions["repository"]>;
  userQuery?: string;
  unresolvedItems?: string[];
  staleKnowledge?: string[];
  completedTasks?: ResearchTask[];
  runTask?: (input: AgentRunOptions & { task: ResearchTask }) => Promise<AgentRunResult>;
  modelAdapter?: ModelAdapter;
  now?: string;
  latestAgentRunId?: string;
  resumeRequested?: boolean;
};

export type GoalContinuationResult = {
  goal: Goal | null;
  plan: GoalPlan;
  taskResults: Array<{ taskId: string; result?: TaskRunResult; error?: string }>;
};

function mergeUnique(values: string[]) {
  return Array.from(new Set(values));
}

function applyPlan(goal: Goal, plan: GoalPlan, tasks: ResearchTask[], now: string, relatedAgentRunIds: string[] = []): Goal {
  const completedTaskIds = mergeUnique([
    ...goal.completedTaskIds,
    ...tasks.filter((task) => task.status === "completed").map((task) => task.id),
  ]);
  const nextStatus = plan.goalStatus === "none" ? goal.status : plan.goalStatus;
  const metadata = new Map((goal.taskMetadata ?? []).map((task) => [task.taskId, task]));
  for (const task of plan.nextTasks) metadata.set(task.id, { taskId: task.id, objective: task.objective, type: task.type, status: task.status });
  for (const task of tasks) {
    const result = task.result as { response?: { signals?: Array<{ title?: string; summary?: string }> }; knowledgeChanges?: Array<{ supportingEvidenceIds?: string[] }> } | undefined;
    metadata.set(task.id, {
      taskId: task.id,
      objective: task.objective,
      type: task.type,
      status: task.status,
      resultSummary: result?.response?.signals?.map((signal) => `${signal.title ?? ""}: ${signal.summary ?? ""}`).join("\n").slice(0, 2000),
      failureReason: task.status === "failed" || task.status === "blocked" ? "Task execution failed or was blocked." : undefined,
      supportingEvidenceIds: result?.knowledgeChanges?.flatMap((change) => change.supportingEvidenceIds ?? []),
    });
  }
  return {
    ...goal,
    status: nextStatus,
    taskIds: mergeUnique([...goal.taskIds, ...plan.nextTasks.map((task) => task.id)]),
    completedTaskIds,
    taskMetadata: Array.from(metadata.values()),
    completedCriteria: plan.completedCriteria,
    remainingCriteria: plan.remainingCriteria,
    currentSummary: plan.reason,
    updatedAt: now,
    completedAt: plan.goalStatus === "completed" ? (goal.completedAt ?? now) : undefined,
    lastTransition: {
      goalId: goal.id,
      previousStatus: goal.status,
      newStatus: nextStatus,
      completedCriteria: plan.completedCriteria,
      remainingCriteria: plan.remainingCriteria,
      selectedNextTasks: plan.nextTasks.map((task) => task.id),
      blockingReason: plan.goalStatus === "blocked" || plan.goalStatus === "waiting" ? plan.reason : undefined,
      relatedAgentRunIds,
      timestamp: now,
    },
  };
}

export async function runGoalContinuation(input: GoalContinuationInput): Promise<GoalContinuationResult> {
  const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
  if (!goal) {
    return {
      goal: null,
      plan: planGoal({ goal: undefined, relatedKnowledge: [], completedTasks: [], unresolvedItems: [], userQuery: input.userQuery ?? "" }),
      taskResults: [],
    };
  }

  const relatedKnowledge = (await Promise.resolve(input.repository.listPersonalKnowledge(input.context))).map((record) => record.text);
  const latestRun = input.repository.getLatestRunMetadata
    ? await Promise.resolve(input.repository.getLatestRunMetadata(input.context))
    : null;
  const completedTasks = input.completedTasks ?? [];
  const unresolvedItems = input.unresolvedItems ?? [];
  const now = input.now ?? new Date().toISOString();
  let plan = planGoal({ goal, relatedKnowledge, staleKnowledge: input.staleKnowledge, completedTasks, unresolvedItems, resumeRequested: input.resumeRequested, latestAgentRun: latestRun ? { id: latestRun.id, status: latestRun.status } : undefined, userQuery: input.userQuery ?? goal.objective });
  let currentGoal = applyPlan(goal, plan, [], now, input.latestAgentRunId ? [input.latestAgentRunId] : []);
  await Promise.resolve(input.repository.saveGoal(input.context, currentGoal));

  const taskResults: GoalContinuationResult["taskResults"] = [];
  for (const nextTask of plan.nextTasks) {
    try {
      const result = await runTaskPlannedAgent({
        ...input,
        context: input.context,
        repository: input.repository,
        userQuery: nextTask.objective,
        plan: { rootObjective: goal.objective, tasks: [nextTask], finalTaskId: nextTask.id },
        relatedKnowledge,
        runAgent: input.runTask,
      });
      taskResults.push({ taskId: nextTask.id, result });
      const failed = result.singleResult?.status === "failed" || result.taskPlan?.tasks.some((task) => task.status === "failed" || task.status === "blocked") || result.taskResults.some((item) => item.error || item.result?.status === "failed");
      const completedTask: ResearchTask = {
        ...nextTask,
        status: failed ? "failed" : "completed",
        result: result.singleResult,
      };
      plan = planGoal({ goal: currentGoal, relatedKnowledge, staleKnowledge: input.staleKnowledge, completedTasks: [...completedTasks, completedTask], unresolvedItems, resumeRequested: input.resumeRequested, latestAgentRun: latestRun ? { id: latestRun.id, status: latestRun.status } : undefined, userQuery: input.userQuery ?? goal.objective });
      currentGoal = applyPlan(currentGoal, plan, [completedTask], new Date().toISOString(), input.latestAgentRunId ? [input.latestAgentRunId] : []);
      await Promise.resolve(input.repository.saveGoal(input.context, currentGoal));
    } catch (error) {
      taskResults.push({ taskId: nextTask.id, error: error instanceof Error ? error.message : "goal task failed" });
      const failedTask = { ...nextTask, status: "failed" as const };
      plan = planGoal({ goal: currentGoal, relatedKnowledge, staleKnowledge: input.staleKnowledge, completedTasks: [...completedTasks, failedTask], unresolvedItems, resumeRequested: input.resumeRequested, latestAgentRun: latestRun ? { id: latestRun.id, status: latestRun.status } : undefined, userQuery: input.userQuery ?? goal.objective });
      currentGoal = applyPlan(currentGoal, plan, [failedTask], new Date().toISOString(), input.latestAgentRunId ? [input.latestAgentRunId] : []);
      await Promise.resolve(input.repository.saveGoal(input.context, currentGoal));
    }
  }

  return { goal: currentGoal, plan, taskResults };
}
