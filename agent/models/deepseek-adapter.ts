import type { ModelAdapter, AdapterOptions } from "./types.ts";
import { asStringArray, callJsonEndpoint, modelTimeoutMs, normalizeModelError, parseJsonObject, parseSynthesis } from "./protocol.ts";

const DEFAULT_PLANNING_MODEL = "deepseek-chat";
const DEFAULT_SYNTHESIS_MODEL = "deepseek-reasoner";

export function createDeepSeekAdapter(options: AdapterOptions = {}): ModelAdapter {
  const env = options.env ?? process.env;
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = modelTimeoutMs(env);
  const models = { planning: env.DEEPSEEK_MODEL?.trim() || DEFAULT_PLANNING_MODEL, synthesis: env.DEEPSEEK_SYNTHESIS_MODEL?.trim() || DEFAULT_SYNTHESIS_MODEL };
  const status = apiKey ? "configured" : "not_configured" as const;
  const request = (model: string, prompt: string, stage: "planning" | "synthesis", signal?: AbortSignal) => callJsonEndpoint(fetchImpl, "https://api.deepseek.com/chat/completions", apiKey as string, { model, messages: [{ role: "system", content: "Return JSON only. Never invent evidence or sources. If eligible reliable evidence is provided and unresolvedConflict is false, produce a FACT citing only eligibleEvidenceIds. If unresolvedConflict is true, preserve unresolved/conflicting state and never produce a confirmed FACT." }, { role: "user", content: prompt }], response_format: { type: "json_object" } }, timeoutMs, signal, { provider: "deepseek", model, stage, onCall: options.onCall });
  return {
    provider: "deepseek", status, models,
    async planResearch(input) {
      if (!apiKey) return { status: "not_configured", errorCode: "model_not_configured" };
      const { signal, ...planningInput } = input;
      try { const parsed = parseJsonObject(await request(models.planning, JSON.stringify({ task: "Return a compact JSON research plan.", input: planningInput }), "planning", signal)); return { status: "configured", plan: { objective: typeof parsed.objective === "string" ? parsed.objective : input.userQuery, queries: asStringArray(parsed.queries).slice(0, 5), preferredSourceTypes: asStringArray(parsed.preferredSourceTypes), maxQueries: typeof parsed.maxQueries === "number" ? parsed.maxQueries : 5 } }; }
      catch (error) { return { status: "error", errorCode: normalizeModelError(error) }; }
    },
    async synthesizeEvidence(input) {
      if (!apiKey) return { status: "not_configured", errorCode: "model_not_configured" };
      try { return { status: "configured", synthesis: parseSynthesis(await request(models.synthesis, JSON.stringify({ task: input.synthesisInstruction ?? "Return EvidenceBoundSynthesis JSON.", input }), "synthesis"))}; }
      catch (error) { return { status: "error", errorCode: normalizeModelError(error) }; }
    },
  };
}
