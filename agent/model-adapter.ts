export type { AdapterOptions, EvidenceSynthesisResult, FetchLike, ModelAdapter, ModelErrorCode, ModelResearchPlan, ModelStatus, ResearchPlanningInput } from "./models/types.ts";
export { createModelAdapter } from "./models/factory.ts";
import { createModelAdapter } from "./models/factory.ts";
import type { AdapterOptions } from "./models/types.ts";

/** Backward-compatible server entry point. */
export function createEnvironmentModelAdapter(options: AdapterOptions = {}) {
  return createModelAdapter(options);
}
