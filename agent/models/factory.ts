import { createDeepSeekAdapter } from "./deepseek-adapter.ts";
import { createOpenAIAdapter } from "./openai-adapter.ts";
import type { AdapterOptions, ModelAdapter } from "./types.ts";

export type ModelProvider = "openai" | "deepseek";
export function createModelAdapter(options: AdapterOptions = {}): ModelAdapter {
  const provider = (options.env ?? process.env).MODEL_PROVIDER?.trim().toLowerCase();
  if (provider === "deepseek") return createDeepSeekAdapter(options);
  if (!provider || provider === "openai") return createOpenAIAdapter(options);
  return { provider: "none", status: "error", models: { planning: "", synthesis: "" }, async planResearch() { return { status: "error", errorCode: "configuration_error" }; }, async synthesizeEvidence() { return { status: "error", errorCode: "configuration_error" }; } };
}
