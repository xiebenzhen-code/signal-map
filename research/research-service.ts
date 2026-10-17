import { runResearchPipeline, type ResearchPipelineDebug } from "./research-pipeline.ts";
import type { ResearchInput } from "./types.ts";
import { runAgent } from "../agent/runner.ts";
import { toRetrievalPlan } from "../agent/retrieval-plan.ts";
import type { AgentRunOptions } from "../agent/types.ts";
import { safeFailureText } from "../agent/failure.ts";

type ResearchExecution = {
  identity: { id: string; mode: "anonymous" | "authenticated" };
  input: ResearchInput;
  debug?: ResearchPipelineDebug;
  context?: AgentRunOptions["context"];
  repository?: AgentRunOptions["repository"];
  modelAdapter?: AgentRunOptions["modelAdapter"];
  onPhase?: AgentRunOptions["onPhase"];
  deadlineAt?: number;
};

const attempts = new Map<string, number[]>();

function enforceBudget(identity: ResearchExecution["identity"]) {
  const now = Date.now();
  const recent = (attempts.get(identity.id) || []).filter((at) => now - at < 60_000);
  const limit = identity.mode === "anonymous" ? 4 : 12;
  if (recent.length >= limit) throw Object.assign(new Error("Research rate limit exceeded"), { status: 429 });
  recent.push(now);
  attempts.set(identity.id, recent);
}

function sanitizeTraceText(value: unknown) {
  return safeFailureText(value);
}

function topStackFrame(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frame = error.stack.split("\n").slice(1).map((line) => line.trim()).find(Boolean);
  return frame ? sanitizeTraceText(frame) : undefined;
}

export function summarizeAgentFailure(
  error: unknown,
  failureKind: "throw_exception" | "failure_result" | "empty_response",
  phase: "agent_failed_before_source_selection" | "agent_failed" = "agent_failed_before_source_selection",
) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
  return {
    phase,
    success: false,
    errorCode: code,
    errorName: error instanceof Error ? sanitizeTraceText(error.name || "Error") : typeof error,
    errorMessage: error instanceof Error ? sanitizeTraceText(error.message) : sanitizeTraceText(error),
    topStackFrame: topStackFrame(error),
    failureKind,
  } as const;
}

export async function executeResearch({ identity, input, debug, context, repository, modelAdapter, onPhase, deadlineAt }: ResearchExecution) {
  enforceBudget(identity);
  onPhase?.({ phase: "agent_started" });
  let tracedAgentFailure = false;
  let progressedPastSourceSelection = false;
  const attemptsByRound = new Map<number, number>();
  const tracePhase: AgentRunOptions["onPhase"] = (event) => {
    if ([
      "source_selection_finished",
      "search_started",
      "search_finished",
      "detail_fetch_started",
      "detail_fetch_finished",
      "aggregation_started",
      "aggregation_finished",
      "evidence_started",
      "evidence_finished",
      "plan_finished",
    ].includes(event.phase)) {
      progressedPastSourceSelection = true;
    }
    onPhase?.(event);
  };
  const agentFailurePhase = () => progressedPastSourceSelection ? "agent_failed" : "agent_failed_before_source_selection";
  try {
    const result = await runAgent({
      input,
      context,
      repository,
      modelAdapter,
      onPhase: tracePhase,
      deadlineAt,
      maxExecutionTimeMs: deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : undefined,
      userQuery: input.currentQuestions || input.industry,
      research: (researchInput, plan, round) => {
        const attemptNumber = (attemptsByRound.get(round) ?? 0) + 1;
        attemptsByRound.set(round, attemptNumber);
        const attemptType = attemptNumber === 1 ? "primary" : "fallback";
        const attemptId = `round-${round}-${attemptType}`;
        const pipelinePhase: NonNullable<AgentRunOptions["onPhase"]> = (event) => tracePhase({
          ...event,
          round,
          attemptId,
          attemptType,
        });
        return runResearchPipeline(
          researchInput,
          undefined,
          { ...debug, onPhase: pipelinePhase, deadlineAt },
          toRetrievalPlan(plan),
        );
      },
    });
    onPhase?.({ phase: "agent_finished", success: result.status !== "failed", itemCount: result.response?.signals.length });
    if (result.status === "failed") {
      const cause = result.failure
        ? Object.assign(new Error(result.failure.message), { code: result.failure.code })
        : new Error("Agent returned failure result");
      onPhase?.(summarizeAgentFailure(cause, "failure_result", agentFailurePhase()));
      tracedAgentFailure = true;
    }
    if (!result.response) {
      const error = result.failure
        ? Object.assign(new Error(result.failure.message), { code: result.failure.code })
        : new Error("Agent research produced no response");
      if (!tracedAgentFailure) {
        onPhase?.(summarizeAgentFailure(error, "empty_response", agentFailurePhase()));
        tracedAgentFailure = true;
      }
      throw error;
    }
    const { status: sourceStatus, ...response } = result.response;
    return {
      ...response,
      status: result.status,
      sourceStatus,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  } catch (error) {
    if (!tracedAgentFailure) onPhase?.(summarizeAgentFailure(error, "throw_exception", agentFailurePhase()));
    onPhase?.({ phase: "agent_finished", success: false, errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE" });
    throw error;
  }
}
