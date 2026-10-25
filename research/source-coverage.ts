import type { ProviderSearchFailureCode } from "../social/providers/types.ts";

export type ProviderRejectionSample = {
  title: string;
  urlPresent: boolean;
  rejectionStage: "normalization" | "candidate_admission";
  rejectionReason: string;
  /** 原始候选链接（观察层展示用；未知时缺省，不用抓取时间或推断值替代）。 */
  url?: string;
  /** 原始发布日期（未知时缺省）。 */
  publishedAt?: string;
  /** 原始摘要片段（截断后；缺失时缺省）。 */
  summary?: string;
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
  /**
   * Per-source observation window (P2-N). Counts are deduplicated: returnedCount
   * counts unique entry URLs (never summed across attempts), requestCount stays
   * the raw request count. Dates describe observed entries only — an earliest
   * date later than the requested window start means the route returned just the
   * most recent slice, never "full window coverage".
   */
  coverage?: {
    returnedCount: number;
    routeLimit?: number;
    undatedCount: number;
    observedEarliest?: string;
    observedLatest?: string;
    notice: string;
  };
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

export type CoverageObservationInput = {
  execution: SourceExecutionOutcome["execution"];
  searched?: boolean;
  requestCount?: number;
  resultCount?: number;
  failureCode?: ProviderSearchFailureCode;
  detailFailureCode?: string;
  blockedBy?: SourceNotSearchedReason;
  observedEarliest?: string;
  observedLatest?: string;
  undatedCount?: number;
  routeLimit?: number;
};

/**
 * Builds the honest per-source coverage notice (P2-N). Counts are already
 * deduplicated upstream: returnedCount = unique entry URLs, requestCount = raw
 * requests. Four distinct shapes: read failure, empty result, entries without
 * dates, and a dated slice. The text never claims "coverage" — a slice that
 * reaches before the window start is still only the most recent N entries the
 * route returned.
 */
export function formatCoverageNotice(input: CoverageObservationInput, windowStart?: string): string {
  if (input.searched === false || input.execution === "not_searched") {
    return input.blockedBy
      ? `本次未搜索该来源（原因：${input.blockedBy}）。`
      : "本次未搜索该来源。";
  }
  if (input.execution === "failed" || input.execution === "unavailable") {
    const code = input.detailFailureCode || input.failureCode || "未知原因";
    return `本次读取失败（${code}），未取得该来源条目。`;
  }
  const count = input.resultCount ?? 0;
  if (count === 0) {
    return "本次读取成功，但该来源没有返回条目。";
  }
  const dates = [input.observedEarliest, input.observedLatest].filter(Boolean) as string[];
  if (dates.length < 2) {
    return `本次取得该来源最近 ${count} 条，条目无有效发布日期，无法判断时间范围。`;
  }
  const base = `本次取得该来源最近 ${count} 条，发布时间 ${dates.sort()[0]} 至 ${dates.sort().at(-1)}。`;
  if (input.routeLimit !== undefined && count >= input.routeLimit) {
    return base + (windowStart && input.observedEarliest && Date.parse(input.observedEarliest) > Date.parse(windowStart)
      ? "仅覆盖最近一段时间，早于该时间的条目本次未取得。"
      : "该路由按数量截断，不代表该来源窗口内全部内容。");
  }
  return base;
}
