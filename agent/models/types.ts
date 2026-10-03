import type { EvidenceRecord } from "../../information/rag-records.ts";
import type { VerificationStatus } from "../../research/types.ts";
import type { EvidenceBoundSynthesis, EvidenceSynthesisInput } from "../evidence-synthesis.ts";
import type { ResearchPlan } from "../types.ts";

export type ModelStatus = "configured" | "not_configured" | "error";
export type ModelErrorCode = "model_not_configured" | "authentication_error" | "quota_error" | "rate_limit" | "model_unavailable" | "timeout" | "malformed_response" | "schema_validation_error" | "provider_error" | "configuration_error";
export type ResearchPlanningInput = { userQuery: string; relatedKnowledge: string[]; existingEvidence: EvidenceRecord[]; previousQueries: string[]; round: number; signal?: AbortSignal };
export type ModelResearchPlan = { status: ModelStatus; plan?: Pick<ResearchPlan, "objective" | "queries" | "preferredSourceTypes" | "maxQueries">; errorCode?: ModelErrorCode };
export type EvidenceSynthesisResult =
  | { status: "configured"; synthesis: EvidenceBoundSynthesis }
  | { status: "not_configured"; errorCode: "model_not_configured" }
  | { status: "error"; errorCode: ModelErrorCode };
export interface ModelAdapter {
  status: ModelStatus;
  provider: "openai" | "deepseek" | "none";
  models: { planning: string; synthesis: string };
  planResearch(input: ResearchPlanningInput): Promise<ModelResearchPlan>;
  synthesizeEvidence(input: EvidenceSynthesisInput): Promise<EvidenceSynthesisResult>;
}
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type AdapterOptions = { env?: Record<string, string | undefined>; fetch?: FetchLike };
export type ParsedConclusion = { claim: string; evidenceIds: string[]; sourceUrls: string[]; confidence: number; verificationStatus: VerificationStatus; statementType: "FACT" | "INTERPRETATION" | "SIGNAL" };
