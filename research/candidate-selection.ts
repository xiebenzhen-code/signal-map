import type { NoveltyAuditTrace } from "./novelty-attribution.ts";

export type ProtectedReason =
  | "tracked_entity"
  | "tracked_event"
  | "current_question"
  | "information_gap"
  | "focus_area";

type SelectionReason = "overall_score" | "context_protected" | "not_selected";

type ThresholdAudit = {
  actual: number;
  threshold: number;
  pass: boolean;
};

type StatusAudit = {
  actual: string;
  expected: string;
  pass: boolean;
};

export type PreliminaryEligibilityFailure =
  | "library_reliability_below_55"
  | "library_relevance_below_58"
  | "library_novelty_below_38"
  | "signal_event_status_not_signal"
  | "signal_relevance_below_70"
  | "signal_freshness_below_80"
  | "signal_novelty_below_65"
  | "topic_mismatch";

export type CandidateEligibilityAudit = {
  scores: {
    relevance: number;
    reliability: number;
    novelty: number;
    freshness: number;
    eventStatus: string;
  };
  canEnterLibrary: {
    value: boolean;
    libraryBranch: {
      reliability: ThresholdAudit;
      relevance: ThresholdAudit;
      novelty: ThresholdAudit;
    };
    signalBranch: {
      eventStatus: StatusAudit;
      relevance: ThresholdAudit;
      freshness: ThresholdAudit;
      novelty: ThresholdAudit;
    };
    failedConditions: PreliminaryEligibilityFailure[];
  };
  contextMatches: {
    topicMatches?: string[];
    entityMatches: string[];
    trackedEventMatches: string[];
    questionMatches: string[];
    gapMatches: string[];
    focusAreaMatches: string[];
  };
  noveltyAttribution?: NoveltyAuditTrace;
};

export type CandidateSelectionInput<T> = {
  id: string;
  overallScore: number;
  preliminaryEligible: boolean;
  freshnessEligible: boolean;
  timestampValid: boolean;
  isBackground: boolean;
  isKnown: boolean;
  protectedReasons: ProtectedReason[];
  eligibilityAudit?: CandidateEligibilityAudit;
  value: T;
};

export type CandidateSelectionAudit = {
  id: string;
  preTruncationRank: number;
  selected: boolean;
  selectionReason: SelectionReason;
  protectedReason: ProtectedReason[];
  eligibilityAudit?: CandidateEligibilityAudit;
  eligibility: {
    preliminaryEligible: boolean;
    freshnessEligible: boolean;
    timestampValid: boolean;
    isBackground: boolean;
    isKnown: boolean;
    duplicate: boolean;
  };
};

export type CandidateSelectionResult<T> = {
  selected: CandidateSelectionInput<T>[];
  audit: CandidateSelectionAudit[];
};

const DEFAULT_LIMIT = 50;

function uniqueReasons(reasons: ProtectedReason[]) {
  return Array.from(new Set(reasons));
}

function isProtected<T>(candidate: CandidateSelectionInput<T>, duplicate: boolean) {
  return (
    !duplicate &&
    candidate.preliminaryEligible &&
    candidate.freshnessEligible &&
    candidate.timestampValid &&
    !candidate.isBackground &&
    !candidate.isKnown &&
    candidate.protectedReasons.length > 0
  );
}

export function selectBoundedCandidates<T>(
  candidates: CandidateSelectionInput<T>[],
  limit = DEFAULT_LIMIT,
): CandidateSelectionResult<T> {
  const boundedLimit = Math.max(0, limit);
  const ranked = [...candidates]
    .sort((left, right) => right.overallScore - left.overallScore)
    .map((candidate, index) => ({ candidate, preTruncationRank: index + 1 }));
  const seenIds = new Set<string>();
  const evaluated = ranked.map((entry) => {
    const duplicate = seenIds.has(entry.candidate.id);
    seenIds.add(entry.candidate.id);
    const protectedReasons = isProtected(entry.candidate, duplicate)
      ? uniqueReasons(entry.candidate.protectedReasons)
      : [];
    return { ...entry, duplicate, protectedReasons };
  });
  const protectedCandidates = evaluated.filter((entry) => entry.protectedReasons.length > 0);
  const selectedProtected = protectedCandidates.slice(0, boundedLimit);
  const selectedIds = new Set(selectedProtected.map((entry) => entry.candidate.id));
  const remaining = Math.max(0, boundedLimit - selectedProtected.length);
  const selectedGeneral = evaluated
    .filter(
      (entry) =>
        !entry.duplicate &&
        !selectedIds.has(entry.candidate.id),
    )
    .slice(0, remaining);
  const selected = [...selectedProtected, ...selectedGeneral];
  const selectedById = new Map(
    selected.map((entry) => [
      entry.candidate.id,
      entry.protectedReasons.length ? "context_protected" : "overall_score",
    ] as const),
  );

  return {
    selected: selected.map((entry) => entry.candidate),
    audit: evaluated.map((entry) => {
      const selectionReason = selectedById.get(entry.candidate.id);
      return {
        id: entry.candidate.id,
        preTruncationRank: entry.preTruncationRank,
        selected: !entry.duplicate && selectionReason !== undefined,
        selectionReason: entry.duplicate ? "not_selected" : selectionReason || "not_selected",
        protectedReason: entry.protectedReasons,
        eligibilityAudit: entry.candidate.eligibilityAudit,
        eligibility: {
          preliminaryEligible: entry.candidate.preliminaryEligible,
          freshnessEligible: entry.candidate.freshnessEligible,
          timestampValid: entry.candidate.timestampValid,
          isBackground: entry.candidate.isBackground,
          isKnown: entry.candidate.isKnown,
          duplicate: entry.duplicate,
        },
      };
    }),
  };
}
