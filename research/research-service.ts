import { runResearchPipeline, type ResearchPipelineDebug } from "./research-pipeline.ts";
import type { ResearchInput } from "./types.ts";

type ResearchExecution = {
  identity: { id: string; mode: "anonymous" | "authenticated" };
  input: ResearchInput;
  debug?: ResearchPipelineDebug;
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

export async function executeResearch({ identity, input, debug }: ResearchExecution) {
  enforceBudget(identity);
  return runResearchPipeline(input, undefined, debug);
}
