import type { ProviderSearchFailureCode } from "../social/providers/types.ts";

export type SourceExecutionOutcome = {
  source: string;
  execution:
    | "searched_with_results"
    | "searched_no_results"
    | "not_searched"
    | "not_configured"
    | "unavailable"
    | "failed";
  searched: boolean;
  resultCount: number;
  requestCount?: number;
  failureCode?: ProviderSearchFailureCode;
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
  const names = (execution: SourceExecutionOutcome["execution"]) => outcomes
    .filter((outcome) => outcome.execution === execution)
    .map((outcome) => outcome.source);
  const usedProviders = outcomes
    .filter((outcome) => outcome.execution === "searched_with_results" || outcome.execution === "searched_no_results")
    .map((outcome) => outcome.source);
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
