import { runResearchPipeline, type ResearchPipelineDebug } from "./research-pipeline.ts";
import type { ResearchInput } from "./types.ts";
import { runAgent } from "../agent/runner.ts";
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

export async function executeResearch({ identity, input, debug, context, repository, modelAdapter, onPhase, deadlineAt }: ResearchExecution) {
  enforceBudget(identity);
  onPhase?.({ phase: "agent_started" });
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
        {
          primarySourceType: plan.selectedSourceType,
          fallbackSourceTypes: plan.fallbackSourceTypes,
          allowedProviderIds: plan.allowedProviderIds,
          reason: plan.sourceSelectionReason,
        },
      ),
    });
    onPhase?.({ phase: "agent_finished", success: result.status !== "failed", itemCount: result.response?.signals.length });
    if (!result.response) throw new Error("Agent research produced no response");
    return result.response;
  } catch (error) {
    onPhase?.({ phase: "agent_finished", success: false, errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE" });
    throw error;
  }
}
