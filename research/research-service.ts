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

export async function executeResearch({ identity, input, debug, context, repository, modelAdapter }: ResearchExecution) {
  enforceBudget(identity);
  const result = await runAgent({
    input,
    context,
    repository,
    modelAdapter,
    userQuery: input.currentQuestions || input.industry,
    research: (researchInput, plan) => runResearchPipeline(
      researchInput,
      undefined,
      debug,
      {
        primarySourceType: plan.selectedSourceType,
        fallbackSourceTypes: plan.fallbackSourceTypes,
        allowedProviderIds: plan.allowedProviderIds,
        reason: plan.sourceSelectionReason,
      },
    ),
  });
  if (!result.response) throw new Error("Agent research produced no response");
  return result.response;
}
