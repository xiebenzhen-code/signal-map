import { runResearchPipeline, type ResearchPipelineDebug } from "./research-pipeline.ts";
import type { ResearchInput } from "./types.ts";
import { runAgent } from "../agent/runner.ts";
import { toRetrievalPlan } from "../agent/retrieval-plan.ts";
import type { AgentRunOptions } from "../agent/types.ts";

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
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\b(token|token_hash|apikey|api_key|authorization|cookie|password)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function topStackFrame(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frame = error.stack.split("\n").slice(1).map((line) => line.trim()).find(Boolean);
  return frame ? sanitizeTraceText(frame) : undefined;
}

export function summarizeAgentFailure(error: unknown, failureKind: "throw_exception" | "failure_result" | "empty_response") {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
  return {
    phase: "agent_failed_before_source_selection",
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
  try {
    const result = await runAgent({
      input,
      context,
      repository,
      modelAdapter,
      onPhase,
      deadlineAt,
      maxExecutionTimeMs: deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : undefined,
      userQuery: input.currentQuestions || input.industry,
      research: (researchInput, plan) => runResearchPipeline(
        researchInput,
        undefined,
        { ...debug, onPhase, deadlineAt },
        toRetrievalPlan(plan),
      ),
    });
    onPhase?.({ phase: "agent_finished", success: result.status !== "failed", itemCount: result.response?.signals.length });
    if (result.status === "failed") {
      onPhase?.(summarizeAgentFailure(new Error("Agent returned failure result"), "failure_result"));
      tracedAgentFailure = true;
    }
    if (!result.response) {
      const error = new Error("Agent research produced no response");
      if (!tracedAgentFailure) {
        onPhase?.(summarizeAgentFailure(error, "empty_response"));
        tracedAgentFailure = true;
      }
      throw error;
    }
    return result.response;
  } catch (error) {
    if (!tracedAgentFailure) onPhase?.(summarizeAgentFailure(error, "throw_exception"));
    onPhase?.({ phase: "agent_finished", success: false, errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE" });
    throw error;
  }
}
