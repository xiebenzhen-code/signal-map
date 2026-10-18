import type { ModelAdapter, AdapterOptions } from "./types.ts";
import { asStringArray, callJsonEndpoint, modelTimeoutMs, normalizeModelError, parseJsonObject, parseSynthesis } from "./protocol.ts";

const DEFAULT_PLANNING_MODEL = "gpt-5.6-sol";
const DEFAULT_SYNTHESIS_MODEL = "gpt-6-astra";

export function createOpenAIAdapter(options: AdapterOptions = {}): ModelAdapter {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim();
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = modelTimeoutMs(env);
  const models = { planning: env.OPENAI_MODEL?.trim() || DEFAULT_PLANNING_MODEL, synthesis: env.OPENAI_SYNTHESIS_MODEL?.trim() || DEFAULT_SYNTHESIS_MODEL };
  const status = apiKey ? "configured" : "not_configured" as const;
  return {
    provider: "openai", status, models,
    async planResearch(input) {
      if (!apiKey) return { status: "not_configured", errorCode: "model_not_configured" };
      const { signal, ...planningInput } = input;
      try {
        const text = await callJsonEndpoint(fetchImpl, "https://api.openai.com/v1/responses", apiKey, { model: models.planning, input: JSON.stringify({ task: "Return a compact JSON research plan. Do not invent sources or evidence.", input: planningInput }), text: { format: { type: "json_object" } } }, timeoutMs, signal, { provider: "openai", model: models.planning, stage: "planning", onCall: options.onCall });
        const parsed = parseJsonObject(text);
        return { status: "configured", plan: { objective: typeof parsed.objective === "string" ? parsed.objective : input.userQuery, queries: asStringArray(parsed.queries).slice(0, 5), preferredSourceTypes: asStringArray(parsed.preferredSourceTypes), maxQueries: typeof parsed.maxQueries === "number" ? parsed.maxQueries : 5 } };
      } catch (error) { return { status: "error", errorCode: normalizeModelError(error) }; }
    },
    async synthesizeEvidence(input) {
      if (!apiKey) return { status: "not_configured", errorCode: "model_not_configured" };
      try {
        const text = await callJsonEndpoint(fetchImpl, "https://api.openai.com/v1/responses", apiKey, { model: models.synthesis, input: JSON.stringify({ task: input.synthesisInstruction ?? "Return EvidenceBoundSynthesis JSON. Every FACT must cite existing evidenceIds. Do not create evidence.", input }), text: { format: { type: "json_object" } } }, timeoutMs, undefined, { provider: "openai", model: models.synthesis, stage: "synthesis", onCall: options.onCall });
        return { status: "configured", synthesis: parseSynthesis(text) };
      } catch (error) { return { status: "error", errorCode: normalizeModelError(error) }; }
    },
  };
}
