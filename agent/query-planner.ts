import { buildDiversifiedQueries, planQuery } from "../research/query-planner.ts";
import type { ResearchInput } from "../research/types.ts";
import type { ResearchPlan, ResearchStrategy } from "./types.ts";
import type { SourceSelection } from "./source-selector.ts";
import type { IntentClassification, SourceProfile } from "../intent/types.ts";
import { deduplicateQueries } from "../research/entity-resolution.ts";

function appendLines(existing: string, values: string[]) {
  return [existing, ...values].map((value) => value.trim()).filter(Boolean).join("\n");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function joinDistinctSegments(values: string[]) {
  const segments: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (segments.some((segment) => {
      const existing = normalizeText(segment);
      return existing === normalized || existing.includes(normalized) || normalized.includes(existing);
    })) continue;
    segments.push(value);
  }
  return segments.join(" ");
}

export function createResearchPlan(
  input: ResearchInput,
  round: number,
  maxQueries: number,
  relatedKnowledge: string[] = [],
  strategy?: ResearchStrategy,
  sourceSelection?: SourceSelection,
  intent?: IntentClassification,
  sourceProfile?: SourceProfile,
): ResearchPlan {
  const planned = planQuery({
    ...input,
    knownInformation: appendLines(input.knownInformation, relatedKnowledge),
  });
  const base = planned.searchCombinations;
  const canonicalSubject = planned.resolvedEntities?.map((entity) => entity.canonicalEntity).join(" ") || "";
  const question = input.currentQuestions?.trim() || "";
  const conciseTopic = joinDistinctSegments([
    canonicalSubject,
    ...(planned.topicKeywords ?? []).slice(0, 4),
  ]);
  const subject = (
    conciseTopic ||
    joinDistinctSegments([input.focusAreas, input.trackedEntities]) ||
    question
  ).trim();
  const diversifiedQueries = buildDiversifiedQueries(
    planned.topicAnchors,
    planned.topicKeywords,
    subject,
    maxQueries,
  );
  const strategyQueries: Record<Exclude<ResearchStrategy, "STOP">, string[]> = {
    INITIAL: diversifiedQueries,
    REFRESH: diversifiedQueries.map((query) => `${query} latest update`),
    DEEPEN: diversifiedQueries.map((query) => `${query} technical details`),
    BROADEN: diversifiedQueries.map((query) => `${query} independent coverage`),
    ESCALATE_SOURCE: diversifiedQueries.map((query) => `${query} official source`),
    VERIFY_CONFLICT: diversifiedQueries.map((query) => `${query} conflicting claim`),
  };
  const intentQueries: Partial<Record<IntentClassification["primaryIntent"], string[]>> = {
    JOB_SEARCH: [
      `${subject} open roles careers apply posted last ${input.freshnessWindow}`,
      `${subject} job board remote onsite skills`,
      `${subject} company careers application`,
    ],
    AIGC_OPPORTUNITY: [
      `${subject} product launch startup funding hiring open source creator adoption`,
      `${subject} commercial use case AIGC video new opportunity`,
      `${subject} independent signals funding GitHub jobs community`,
    ],
    PRODUCT_UPDATE: [
      `${subject} official changelog release notes latest`,
      `${subject} GitHub releases official announcement`,
      `${subject} product update documentation`,
    ],
    TECH_RESEARCH: [
      `${subject} primary documentation production limitations`,
      `${subject} technical specification benchmark GitHub issues`,
      `${subject} reproducibility implementation docs`,
    ],
    POLICY_REGULATION: [
      `${subject} government regulator primary document effective date scope jurisdiction`,
      `${subject} official policy regulation`,
      `${subject} legal text implementation date`,
    ],
  };
  const queries = deduplicateQueries((strategy && strategy !== "STOP"
    ? [...(intent ? intentQueries[intent.primaryIntent] ?? [] : []), ...strategyQueries[strategy], ...base]
    : base), planned.resolvedEntities ?? [], maxQueries);
  return {
    objective: round === 1 ? planned.originalNeed : `${planned.originalNeed} · 补充验证第 ${round} 轮`,
    queries,
    preferredSourceTypes: sourceProfile?.preferredSourceTypes ?? (round === 1
      ? ["primary", "trusted_media", "social"]
      : ["primary", "trusted_media"]),
    maxQueries,
    strategy,
    selectedSourceType: sourceSelection?.primarySourceType,
    fallbackSourceTypes: sourceSelection?.fallbackSourceTypes,
    allowedProviderIds: sourceSelection?.allowedProviderIds,
    reason: sourceSelection?.reason,
    sourceSelectionReason: sourceSelection?.reason,
    resolvedEntities: planned.resolvedEntities,
    topicAnchors: planned.topicAnchors,
    topicKeywords: planned.topicKeywords,
    intent,
    freshnessWindow: planned.requestedFreshnessWindow,
    retrievalWindows: planned.retrievalWindows,
  };
}
