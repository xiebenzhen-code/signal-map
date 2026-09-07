import { runAgent as runSingleAgent } from "./runner.ts";
import { analyzeTask, type TaskAnalysis } from "./task-analyzer.ts";
import type { AgentRunOptions, AgentRunResult } from "./types.ts";
import type { ModelAdapter } from "./model-adapter.ts";
import {
  synthesizeEvidenceWithModel,
  type EvidenceBoundSynthesis,
} from "./evidence-synthesis.ts";
import { recordsFromSignal, type EvidenceRecord } from "../information/rag-records.ts";

export { analyzeTask } from "./task-analyzer.ts";

export type ResearchTaskType = "FACT_FINDING" | "COMPARISON_INPUT" | "VERIFICATION" | "SYNTHESIS";
export type ResearchTaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "blocked";

export type ResearchTask = {
  id: string;
  objective: string;
  type: ResearchTaskType;
  dependencies: string[];
  status: ResearchTaskStatus;
  result?: AgentRunResult | SynthesisResult;
};

export type ResearchTaskPlan = {
  rootObjective: string;
  tasks: ResearchTask[];
  finalTaskId: string;
};

export type SynthesisResult = {
  summary: string;
  conclusions: string[];
  supportingTaskIds: string[];
  supportingEvidenceIds: string[];
  knowledgeReferences: string[];
  unresolvedItems: string[];
  createdEvidenceIds: string[];
  evidenceBound?: EvidenceBoundSynthesis;
};

export type TaskRunResult = {
  analysis: TaskAnalysis;
  singleResult?: AgentRunResult;
  taskPlan?: ResearchTaskPlan;
  taskResults: Array<{ taskId: string; result?: AgentRunResult; error?: string }>;
  synthesis?: SynthesisResult;
};

type TaskPlannerInput = {
  userQuery: string;
  relatedKnowledge: string[];
  maxTasks?: number;
};

type TaskExecutionInput = Omit<AgentRunOptions, "userQuery"> & {
  userQuery: string;
  plan?: ResearchTaskPlan;
  relatedKnowledge?: string[];
  modelAdapter?: ModelAdapter;
  runAgent?: (input: AgentRunOptions & { task: ResearchTask }) => Promise<AgentRunResult>;
};

const MAX_TASKS = 6;

function task(id: number, objective: string, type: ResearchTaskType, dependencies: string[] = []): ResearchTask {
  return {
    id: `task-${id}`,
    objective,
    type,
    dependencies,
    status: dependencies.length ? "pending" : "ready",
  };
}

function compact(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function extractComparisonSubjects(query: string) {
  const cleaned = query
    .replace(/^\s*(compare|comparison of|对比|比较)\s+/i, "")
    .replace(/\b(recent release limitations|recent releases|limitations|updates|changes)\b/gi, "")
    .trim();
  const parts = compact(cleaned.split(/\s+(?:vs|versus|and)\s+|和|与/i));
  return parts.length >= 2 ? parts.slice(0, 2) : [];
}

function hasRelevantKnowledge(subject: string, relatedKnowledge: string[]) {
  const normalizedSubject = subject.toLowerCase();
  return relatedKnowledge.some((item) => item.toLowerCase().includes(normalizedSubject));
}

export function createResearchTaskPlan(input: TaskPlannerInput): ResearchTaskPlan {
  const maxTasks = Math.min(Math.max(input.maxTasks ?? MAX_TASKS, 1), MAX_TASKS);
  const tasks: ResearchTask[] = [];
  const subjects = extractComparisonSubjects(input.userQuery);

  if (subjects.length >= 2) {
    subjects.forEach((subject, index) => {
      const prefix = hasRelevantKnowledge(subject, input.relatedKnowledge) ? "Refresh" : "Research";
      tasks.push(task(index + 1, `${prefix} ${subject}. Verify with external evidence.`, "COMPARISON_INPUT"));
    });
    tasks.push(task(tasks.length + 1, `Synthesize comparison for: ${input.userQuery}`, "SYNTHESIS", tasks.map((item) => item.id)));
  } else {
    const fact = task(1, `Find facts for: ${input.userQuery}`, "FACT_FINDING");
    const verification = task(2, `Verify with external evidence: ${input.userQuery}`, "VERIFICATION", [fact.id]);
    const synthesis = task(3, `Synthesize answer for: ${input.userQuery}`, "SYNTHESIS", [verification.id]);
    tasks.push(fact, verification, synthesis);
  }

  const bounded = tasks.slice(0, maxTasks);
  if (!bounded.some((item) => item.type === "SYNTHESIS")) {
    const deps = bounded.map((item) => item.id);
    bounded[bounded.length - 1] = task(bounded.length, `Synthesize answer for: ${input.userQuery}`, "SYNTHESIS", deps.slice(0, -1));
  }
  const plan = {
    rootObjective: input.userQuery,
    tasks: bounded,
    finalTaskId: bounded[bounded.length - 1].id,
  };
  validateTaskPlan(plan);
  return plan;
}

export function validateTaskPlan(plan: ResearchTaskPlan) {
  const ids = new Set(plan.tasks.map((item) => item.id));
  if (!ids.has(plan.finalTaskId)) throw new Error("finalTaskId references unknown task");
  for (const item of plan.tasks) {
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) throw new Error(`task ${item.id} has unknown dependency ${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.tasks.map((item) => [item.id, item]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`task graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  plan.tasks.forEach((item) => visit(item.id));
}

function evidenceFromTaskResults(taskResults: Array<{ taskId: string; result?: AgentRunResult }>): EvidenceRecord[] {
  return taskResults.flatMap((item) =>
    item.result?.response?.signals.flatMap((signal) => recordsFromSignal(signal).evidence) ?? [],
  );
}

export function synthesizeTaskResults(
  taskResults: Array<{ taskId: string; result?: AgentRunResult }>,
  evidenceBound?: EvidenceBoundSynthesis,
): SynthesisResult {
  const completed = taskResults.filter((item) => item.result?.status === "completed");
  const supportingEvidenceIds = Array.from(new Set(completed.flatMap((item) =>
    item.result?.knowledgeChanges.flatMap((change) => change.supportingEvidenceIds) ?? [],
  )));
  const conclusions = completed.flatMap((item) =>
    item.result?.response?.signals.map((signal) => `${signal.title}: ${signal.whyItMatters || signal.summary}`) ?? [],
  );
  const unresolvedItems = taskResults
    .filter((item) => item.result && item.result.status !== "completed")
    .map((item) => item.taskId);
  return {
    summary: conclusions.length ? conclusions.join("\n") : "No complete conclusion could be synthesized from completed tasks.",
    conclusions,
    supportingTaskIds: completed.map((item) => item.taskId),
    supportingEvidenceIds,
    knowledgeReferences: completed.flatMap((item) => item.result?.knowledgeChanges.map((change) => change.signalId) ?? []),
    unresolvedItems,
    createdEvidenceIds: [],
    evidenceBound,
  };
}

function dependenciesCompleted(taskItem: ResearchTask, tasks: ResearchTask[]) {
  return taskItem.dependencies.every((dependency) => tasks.find((item) => item.id === dependency)?.status === "completed");
}

function dependencyFailed(taskItem: ResearchTask, tasks: ResearchTask[]) {
  return taskItem.dependencies.some((dependency) => {
    const status = tasks.find((item) => item.id === dependency)?.status;
    return status === "failed" || status === "blocked";
  });
}

export async function runTaskPlannedAgent(input: TaskExecutionInput): Promise<TaskRunResult> {
  const relatedKnowledge = input.relatedKnowledge ?? (input.repository && input.context
    ? (await Promise.resolve(input.repository.listPersonalKnowledge(input.context))).map((record) => record.text)
    : []);
  const analysis = analyzeTask({ userQuery: input.userQuery, relatedKnowledge });
  if (analysis.mode === "SINGLE_TASK" && !input.plan) {
    const result = await (input.runAgent ?? ((options) => runSingleAgent(options)))({ ...input, userQuery: input.userQuery, task: task(1, input.userQuery, "FACT_FINDING") });
    return { analysis, singleResult: result, taskResults: [{ taskId: "single-task", result }] };
  }

  const plan = input.plan ?? createResearchTaskPlan({ userQuery: input.userQuery, relatedKnowledge });
  validateTaskPlan(plan);
  const tasks = plan.tasks.map((item) => ({ ...item }));
  const taskResults: TaskRunResult["taskResults"] = [];
  let synthesis: SynthesisResult | undefined;
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (const item of tasks) {
      if (item.status === "pending" && dependencyFailed(item, tasks)) {
        item.status = "blocked";
        progressed = true;
      }
      if (item.status === "pending" && dependenciesCompleted(item, tasks)) {
        item.status = "ready";
        progressed = true;
      }
      if (item.status !== "ready") continue;
      item.status = "running";
      progressed = true;
      if (item.type === "SYNTHESIS") {
        const dependencyResults = taskResults.filter((result) => item.dependencies.includes(result.taskId));
        const fallback = () => synthesizeTaskResults(dependencyResults).evidenceBound ?? {
          summary: synthesizeTaskResults(dependencyResults).summary,
          conclusions: synthesizeTaskResults(dependencyResults).conclusions.map((claim) => ({
            claim,
            evidenceIds: [],
            sourceUrls: [],
            confidence: 0,
            verificationStatus: "unverified" as const,
            statementType: "INTERPRETATION" as const,
          })),
          unresolvedItems: synthesizeTaskResults(dependencyResults).unresolvedItems,
        };
        const evidenceBound = input.modelAdapter
          ? await synthesizeEvidenceWithModel({
              adapter: input.modelAdapter,
              input: {
                objective: item.objective,
                evidence: evidenceFromTaskResults(dependencyResults),
                taskResults: dependencyResults,
                unresolvedConflicts: dependencyResults.flatMap((result) => result.result?.evaluation.conflictingClaims ?? []),
              },
              fallback,
            })
          : undefined;
        synthesis = synthesizeTaskResults(dependencyResults, evidenceBound);
        item.result = synthesis;
        item.status = synthesis.unresolvedItems.length ? "blocked" : "completed";
        continue;
      }
      try {
        const result = await (input.runAgent ?? ((options) => runSingleAgent(options)))({
          ...input,
          userQuery: item.objective,
          task: item,
        });
        item.result = result;
        item.status = result.status === "failed" ? "failed" : "completed";
        taskResults.push({ taskId: item.id, result });
      } catch (error) {
        item.status = "failed";
        taskResults.push({ taskId: item.id, error: error instanceof Error ? error.message : "task failed" });
      }
    }
  }

  return {
    analysis,
    taskPlan: { ...plan, tasks },
    taskResults,
    synthesis,
  };
}
