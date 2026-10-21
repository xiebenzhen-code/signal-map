import type { ProviderSearchFailureCode } from "../social/providers/types.ts";

export type ProviderRejectionSample = {
  title: string;
  urlPresent: boolean;
  rejectionStage: "normalization" | "candidate_admission";
  rejectionReason: string;
};

/**
 * Why a source stayed `not_searched`. `not_searched` alone is ambiguous: it can
 * mean "the run chose not to spend a request here", or "this provider was never
 * allowed to execute at all". Only the first is a real remaining opportunity,
 * so the reason must travel with the outcome instead of being inferred.
 */
export type SourceNotSearchedReason =
  | "source_selection"
  | "budget"
  | "no_candidate_source"
  | "not_required";

export type SourceExecutionOutcome = {
  source: string;
  providerId?: string;
  /** Concrete source identity within a provider (for example a registered feed). */
  sourceId?: string;
  execution:
    | "searched_with_results"
    | "searched_no_results"
    | "not_searched"
    | "not_configured"
    | "unavailable"
    | "failed";
  /** Only meaningful while `execution === "not_searched"`. */
  blockedBy?: SourceNotSearchedReason;
  searched: boolean;
  resultCount: number;
  rawResultCount?: number;
  normalizedCandidateCount?: number;
  rejectedRawCount?: number;
  normalizationRejectionReasons?: Record<string, number>;
  normalizationRejectedSamples?: ProviderRejectionSample[];
  candidateAdmissionRejectionReasons?: Record<string, number>;
  candidateAdmissionRejectedSamples?: ProviderRejectionSample[];
  requestCount?: number;
  failureCode?: ProviderSearchFailureCode;
  detailFailureCode?: string;
  engine?: string;
  fallbackAttempted?: boolean;
};

export type SourceCoverage = {
  level: "Broad" | "Partial" | "Limited";
  usedProviders: string[];
  zeroResultProviders: string[];
  notSearchedProviders: string[];
  unavailableProviders: string[];
  notConfiguredProviders: string[];
  failedProviders: string[];
  outcomes: SourceExecutionOutcome[];
};

export function buildSourceCoverage(outcomes: SourceExecutionOutcome[]): SourceCoverage {
  // Keep every slice outcome as history. Summary labels describe cumulative
  // execution; a later skip cannot undo an actual attempt at the same source.
  const attempted = outcomes.filter(outcome => outcome.execution !== "not_searched");
  const summaryOutcomes = outcomes.filter(outcome => outcome.execution !== "not_searched" || !attempted.some(prior =>
    prior.providerId === outcome.providerId && (prior.source === outcome.source ||
      Boolean(outcome.providerId && !outcome.sourceId && prior.sourceId)),
  ));
  const names = (execution: SourceExecutionOutcome["execution"]) => [...new Set(summaryOutcomes
    .filter(outcome => outcome.execution === execution)
    .map(outcome => outcome.source))];
  const usedProviders = [...new Set(summaryOutcomes
    .filter(outcome => outcome.execution === "searched_with_results" || outcome.execution === "searched_no_results")
    .map(outcome => outcome.source))];
  return {
    level: usedProviders.length >= 2 ? "Broad" : usedProviders.length === 1 ? "Partial" : "Limited",
    usedProviders,
    zeroResultProviders: names("searched_no_results"),
    notSearchedProviders: names("not_searched"),
    unavailableProviders: names("unavailable"),
    notConfiguredProviders: names("not_configured"),
    failedProviders: names("failed"),
    outcomes,
  };
}
