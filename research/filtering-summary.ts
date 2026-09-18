import type { FilteringReason, FilteringSummary, ResearchSignal } from "./types.ts";
import { userFacingLabel } from "../lib/user-facing-labels.ts";

const emptyReasons = (): FilteringSummary["filteredReasons"] => ({
  stale: 0,
  duplicate: 0,
  lowReliability: 0,
  insufficientVerification: 0,
  background: 0,
  lowNovelty: 0,
  unresolvedConflict: 0,
  lowActionability: 0,
  noInformationGain: 0,
  insufficientContent: 0,
  topicMismatch: 0,
});

function primaryFilteringReason(signal: ResearchSignal): FilteringReason | null {
  if (signal.contentQuality === "INSUFFICIENT_CONTENT") return "INSUFFICIENT_CONTENT";
  if (signal.topicRelevance?.decision === "TOPIC_MISMATCH") return "TOPIC_MISMATCH";
  if (signal.verificationStatus === "conflicting" || signal.signalType === "CONFLICT") return "UNRESOLVED_CONFLICT";
  if (signal.knowledgeStatus === "KNOWN" || signal.signalType === "NOISE" || (signal.duplicateRatio ?? 0) >= 0.5) return "DUPLICATE";
  if (signal.timestampStatus !== "valid" || signal.freshnessScore < 25) return "STALE";
  if (signal.eventStatus === "BACKGROUND") return "BACKGROUND_ONLY";
  if (signal.reliabilityScore < 55) return "LOW_RELIABILITY";
  if (signal.verificationStatus === "unverified") return "INSUFFICIENT_VERIFICATION";
  if (signal.noveltyScore < 38) return "LOW_NOVELTY";
  if (signal.relevanceScore < 58 || signal.judgementImpactScore < 34) return "LOW_ACTIONABILITY";
  if (!signal.confirmationGain && signal.noveltyScore < 60) return "NO_INFORMATION_GAIN";
  return null;
}

function increment(reasons: FilteringSummary["filteredReasons"], reason: FilteringReason) {
  if (reason === "STALE") reasons.stale += 1;
  if (reason === "DUPLICATE") reasons.duplicate += 1;
  if (reason === "LOW_RELIABILITY") reasons.lowReliability += 1;
  if (reason === "INSUFFICIENT_VERIFICATION") reasons.insufficientVerification += 1;
  if (reason === "BACKGROUND_ONLY") reasons.background += 1;
  if (reason === "LOW_NOVELTY") reasons.lowNovelty += 1;
  if (reason === "UNRESOLVED_CONFLICT") reasons.unresolvedConflict += 1;
  if (reason === "LOW_ACTIONABILITY") reasons.lowActionability = (reasons.lowActionability ?? 0) + 1;
  if (reason === "NO_INFORMATION_GAIN") reasons.noInformationGain = (reasons.noInformationGain ?? 0) + 1;
  if (reason === "INSUFFICIENT_CONTENT") reasons.insufficientContent = (reasons.insufficientContent ?? 0) + 1;
  if (reason === "TOPIC_MISMATCH") reasons.topicMismatch = (reasons.topicMismatch ?? 0) + 1;
}

function strongestHidden(hidden: ResearchSignal[]): FilteringSummary["strongestHiddenSignal"] {
  const [signal] = [...hidden].sort((left, right) => right.overallScore - left.overallScore);
  if (!signal) return undefined;
  return {
    signalType: signal.signalType ?? (signal.informationType === "SIGNAL" ? "EARLY_SIGNAL" : signal.informationType),
    reason: primaryFilteringReason(signal) ?? "LOW_ACTIONABILITY",
    evidenceCount: signal.claims.length,
    independentSourceCount: signal.independentEvidenceCount,
  };
}

export function buildFilteringSummary(input: {
  retrievedCount: number;
  clusteredCount: number;
  allSignals: ResearchSignal[];
  displayedSignals: ResearchSignal[];
  detailEnrichment?: FilteringSummary["detailEnrichment"];
}): FilteringSummary {
  const displayedIds = new Set(input.displayedSignals.map((signal) => signal.id));
  const hidden = input.allSignals.filter((signal) => !displayedIds.has(signal.id));
  const filteredReasons = emptyReasons();
  for (const signal of hidden) {
    const reason = primaryFilteringReason(signal);
    if (reason) increment(filteredReasons, reason);
  }
  const topReasons = Object.entries(filteredReasons)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([reason, count]) => `${count} 条 ${userFacingLabel(reason)}`);
  const summaryText = input.displayedSignals.length
    ? `共检索 ${input.retrievedCount} 条，聚合为 ${input.clusteredCount} 个信号，最终展示 ${input.displayedSignals.length} 个；其余主要因${topReasons.join("、") || "证据价值不足"}被过滤。`
    : `检索到 ${input.retrievedCount} 条信息，聚合为 ${input.clusteredCount} 个信号；当前主要因${topReasons.join("、") || "缺少可靠新增证据"}，没有达到展示门槛的可靠新信号。`;
  return {
    retrievedCount: input.retrievedCount,
    clusteredCount: input.clusteredCount,
    displayedCount: input.displayedSignals.length,
    filteredReasons,
    detailEnrichment: input.detailEnrichment,
    strongestHiddenSignal: strongestHidden(hidden),
    filteringDetails: input.allSignals.map((signal) => {
      const displayed = displayedIds.has(signal.id);
      const reason = displayed ? undefined : primaryFilteringReason(signal) ?? undefined;
      return {
        id: signal.id,
        title: signal.title,
        decision: displayed ? "displayed" as const : "filtered" as const,
        reason,
        explanation: displayed
          ? signal.why || signal.whyItMatters
          : reason
            ? userFacingLabel(reason)
            : "暂未达到展示条件",
        sources: (signal.sources ?? []).map((source) => ({ publisher: source.publisher, sourceUrl: source.sourceUrl })),
      };
    }),
    summaryText,
  };
}
