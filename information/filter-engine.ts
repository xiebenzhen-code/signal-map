import type {
  Claim,
  ResearchOverview,
  ResearchSignal,
  SourceTier,
  VerificationStatus,
} from "../research/types.ts";
import { demoDataset } from "./demo-dataset.ts";
import {
  earliestValidTimestamp,
  freshnessWindowHours,
  latestValidTimestamp,
  resolveFreshness,
  validateTimestamp,
} from "./freshness.ts";
import type {
  ActiveKnowledgeContext,
  DemoSource,
  InformationFilter,
  InformationRunPayload,
  ProviderCoverage,
  ProviderContext,
} from "./types.ts";

const coverage: ProviderCoverage = {
  level: "Limited",
  usedProviders: ["DemoProvider"],
  zeroResultProviders: [],
  notSearchedProviders: [],
  unavailableProviders: ["ImportedDataProvider"],
  notConfiguredProviders: ["WebProvider", "XProvider", "XiaohongshuProvider"],
  failedProviders: [],
  outcomes: [],
};

const tierRank: Record<SourceTier, number> = { S: 4, A: 3, B: 2, C: 1 };

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function containsMeaningfulMatch(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const fragments = right
    .toLowerCase()
    .split(/[\s,，。；;、/|]+/)
    .map(normalize)
    .filter((item) => item.length >= 3);
  return fragments.some((item) => a.includes(item));
}

function matchesAny(haystack: string, needles: string[]) {
  return needles.filter((needle) => containsMeaningfulMatch(haystack, needle));
}

function sourceAllowed(source: DemoSource, filter: InformationFilter) {
  if (filter.sourceScope === "custom") {
    return (filter.customSources ?? []).some((prefix) => source.sourceUrl.startsWith(prefix));
  }
  return true;
}

export function validateFactEvidence(source: DemoSource, now = new Date()) {
  return Boolean(
    source.sourceUrl.trim() &&
      source.publisher.trim() &&
      source.evidenceSnippet?.trim() &&
      validateTimestamp(source, now) === "valid",
  );
}

function deduplicateSources(sources: DemoSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = [source.eventKey, source.publisher, source.sourceUrl, source.claimText]
      .map(normalize)
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verificationFor(sources: DemoSource[], now: Date): VerificationStatus {
  if (sources.some((source) => source.conflict)) return "conflicting";
  if (sources.some((source) => source.sourceTier === "S" && validateFactEvidence(source, now))) {
    return "verified";
  }
  if (sources.some((source) => source.sourceTier !== "C" && validateFactEvidence(source, now))) {
    return "partially_verified";
  }
  return "unverified";
}

function scoreEvent(
  sources: DemoSource[],
  filter: InformationFilter,
  knowledge: ActiveKnowledgeContext,
  now: Date,
) {
  const primary = [...sources].sort((a, b) => {
    const rank = tierRank[b.sourceTier] - tierRank[a.sourceTier];
    return rank || b.reliability - a.reliability;
  })[0];
  const corpus = [
    primary.title,
    primary.summary,
    ...sources.flatMap((source) => [...source.tags, ...source.entities, source.claimText]),
  ].join(" ");
  const focusMatches = matchesAny(corpus, filter.focusAreas);
  const gapMatches = matchesAny(corpus, knowledge.informationGaps);
  const questionMatches = matchesAny(corpus, knowledge.currentQuestions);
  const entityMatches = matchesAny(corpus, knowledge.trackedEntities);
  const identityMatch = matchesAny(corpus, [knowledge.identity]).length > 0;
  const industryMatch = matchesAny(corpus, [filter.industry, knowledge.industry]).length > 0;
  const knownMatches = matchesAny(corpus, knowledge.knownInformation);
  const trackedEvent = matchesAny(corpus, knowledge.trackedEvents).length > 0;
  const validSources = sources.filter((source) => validateTimestamp(source, now) === "valid");
  const originalOccurredAt = earliestValidTimestamp(
    validSources.map((source) => source.eventOccurredAt || source.publishedAt),
    now,
  );
  const newestPublishedAt = latestValidTimestamp(
    validSources.map((source) => source.publishedAt),
    now,
  );
  const explicitLatestUpdateAt = latestValidTimestamp(
    validSources.map((source) => source.lastUpdatedAt),
    now,
  );
  const originalTime = originalOccurredAt ? new Date(originalOccurredAt).getTime() : undefined;
  const newestTime = newestPublishedAt ? new Date(newestPublishedAt).getTime() : undefined;
  const inferredLatestUpdateAt =
    originalTime !== undefined && newestTime !== undefined && newestTime - originalTime > 24 * 60 * 60 * 1000
      ? newestPublishedAt
      : undefined;
  const latestUpdateAt = explicitLatestUpdateAt || inferredLatestUpdateAt;
  const fresh = resolveFreshness(
    latestUpdateAt
      ? { eventOccurredAt: latestUpdateAt }
      : { eventOccurredAt: originalOccurredAt, publishedAt: newestPublishedAt },
    now,
  );
  const ageHours = fresh.ageHours ?? Number.POSITIVE_INFINITY;
  const reliabilityScore = clamp(
    Math.max(...sources.map((source) => source.reliability)) +
      (sources.length > 1 ? 4 : 0) -
      (sources.some((source) => source.conflict) ? 18 : 0),
  );
  const relevanceScore = clamp(
    32 +
      Math.min(30, focusMatches.length * 15) +
      Math.min(24, gapMatches.length * 18) +
      Math.min(18, questionMatches.length * 12) +
      Math.min(12, entityMatches.length * 8) +
      (industryMatch ? 10 : 0) +
      (identityMatch ? 6 : 0),
  );
  const noveltyScore = clamp(
    (knownMatches.length ? 24 : 82) +
      (sources.length > 1 ? 5 : 0) +
      (trackedEvent ? 4 : 0) -
      (ageHours > 168 ? 35 : 0),
  );
  const gapMatchScore = clamp(
    gapMatches.length * 35 + questionMatches.length * 25 + (trackedEvent ? 15 : 0),
  );
  const judgementImpactScore = clamp(
    38 + gapMatches.length * 18 + questionMatches.length * 14 + entityMatches.length * 8,
  );
  const overallScore = clamp(
    relevanceScore * 0.3 +
      reliabilityScore * 0.25 +
      noveltyScore * 0.15 +
      fresh.score * 0.1 +
      judgementImpactScore * 0.1 +
      gapMatchScore * 0.1,
  );

  return {
    primary,
    ageHours,
    fresh,
    originalOccurredAt,
    latestUpdateAt,
    focusMatches,
    gapMatches,
    questionMatches,
    entityMatches,
    knownMatches,
    trackedEvent,
    reliabilityScore,
    relevanceScore,
    noveltyScore,
    gapMatchScore,
    judgementImpactScore,
    overallScore,
  };
}

function toSignal(
  eventKey: string,
  sources: DemoSource[],
  filter: InformationFilter,
  knowledge: ActiveKnowledgeContext,
  now: Date,
): ResearchSignal {
  const scored = scoreEvent(sources, filter, knowledge, now);
  const verificationStatus = verificationFor(sources, now);
  const validFacts = sources.filter(
    (source) => source.sourceTier !== "C" && validateFactEvidence(source, now),
  );
  const claimSources = sources.filter(
    (source) => source.sourceTier === "C" || validateFactEvidence(source, now),
  );
  const claims: Claim[] = [...new Set(claimSources.map((source) => source.claimText))].map(
    (claimText) => {
      const matches = claimSources.filter((source) => source.claimText === claimText);
      const primary = [...matches].sort(
        (left, right) => tierRank[right.sourceTier] - tierRank[left.sourceTier],
      )[0];
      const evidenceSources = matches.map((source) => {
        const sourceVerification = source.conflict
          ? "conflicting" as const
          : source.sourceTier === "S"
            ? "verified" as const
            : source.sourceTier === "C"
              ? "unverified" as const
              : "partially_verified" as const;
        return {
          sourceUrl: source.sourceUrl,
          publisher: source.publisher,
          publishedAt: validateTimestamp(source, now) === "valid" ? source.publishedAt : undefined,
          sourceType: source.sourceType,
          sourceTier: source.sourceTier,
          evidenceSnippet: source.evidenceSnippet || "该线索没有可验证的独立证据。",
          sourceRole: source.sourceTier === "C" ? "discovery" as const : "verification" as const,
          verificationStatus: sourceVerification,
        };
      });
      const bestEvidence = evidenceSources.find(
        (evidence) => evidence.sourceUrl === primary.sourceUrl,
      ) ?? evidenceSources[0];
      return {
        claimText,
        sourceUrl: bestEvidence.sourceUrl,
        publisher: bestEvidence.publisher,
        publishedAt: bestEvidence.publishedAt,
        sourceType: bestEvidence.sourceType,
        sourceTier: bestEvidence.sourceTier,
        evidenceSnippet: bestEvidence.evidenceSnippet,
        verificationStatus: bestEvidence.verificationStatus,
        contentType: primary.sourceTier === "C" ? "SIGNAL" as const : "FACT" as const,
        evidenceSources,
        independentEvidenceCount: evidenceSources.length,
      };
    },
  );
  const isSignal = validFacts.length === 0;
  const windowHours = freshnessWindowHours(filter.freshnessWindow);
  const hasRecentUpdate = Boolean(scored.latestUpdateAt && scored.ageHours <= windowHours);
  const originalFreshness = resolveFreshness(
    { eventOccurredAt: scored.originalOccurredAt },
    now,
  );
  const originalIsRecent =
    originalFreshness.ageHours !== undefined && originalFreshness.ageHours <= windowHours;
  const eventStatus: ResearchSignal["eventStatus"] = isSignal
    ? "SIGNAL"
    : scored.trackedEvent && hasRecentUpdate
      ? "FOLLOW_UP"
      : hasRecentUpdate && !originalIsRecent
        ? "UPDATED"
        : originalIsRecent
          ? "NEW"
          : "BACKGROUND";
  const reliableEnough =
    scored.reliabilityScore >= 70 &&
    scored.relevanceScore >= 75 &&
    scored.noveltyScore >= 60;
  const criticalBackgroundEvidence =
    eventStatus === "BACKGROUND" &&
    scored.gapMatchScore >= 80 &&
    scored.judgementImpactScore >= 80;
  const canBeMustRead =
    reliableEnough &&
    !isSignal &&
    verificationStatus !== "conflicting" &&
    scored.fresh.timestampStatus === "valid" &&
    (eventStatus !== "BACKGROUND" || criticalBackgroundEvidence);
  const canBeWorthWatching =
    isSignal &&
    scored.fresh.timestampStatus === "valid" &&
    scored.fresh.score >= 80 &&
    scored.relevanceScore >= 70 &&
    scored.noveltyScore >= 60 &&
    !scored.knownMatches.length;
  const attentionDecision: ResearchSignal["attentionDecision"] = canBeMustRead
      ? "MUST_READ"
      : canBeWorthWatching
        ? "WORTH_WATCHING"
      : scored.overallScore >= 48 &&
          scored.noveltyScore >= 35 &&
          (eventStatus !== "BACKGROUND" ||
            scored.gapMatches.length > 0 ||
            scored.questionMatches.length > 0)
        ? "LIBRARY_ONLY"
        : "IGNORE";
  const knowledgeStatus: ResearchSignal["knowledgeStatus"] = scored.knownMatches.length
    ? scored.noveltyScore >= 45
      ? "UPDATED"
      : "KNOWN"
    : "NOVEL";
  const matchedNeed = scored.questionMatches[0] || scored.gapMatches[0];
  const whyItMatters = matchedNeed
    ? `这为你正在追踪的“${matchedNeed}”补充了${verificationStatus === "verified" ? "已验证证据" : "新的可核查线索"}。`
    : scored.knownMatches.length
      ? "这与已知信息高度重合，信息增量有限，因此不会优先占用注意力。"
        : isSignal
        ? "这是近期出现、但尚未获得独立来源支持的线索，只进入 Worth Watching。"
        : "这是一项与你的过滤条件相关、且存在可核查原始证据的新变化。";
  const bestSource = scored.primary;

  return {
    id: `demo-${eventKey}`,
    category: "匹配",
    channel: sources.some((source) => source.sourceTier === "C")
      ? validFacts.length
        ? "混合"
        : "社区"
      : "官方",
    title: bestSource.title,
    summary: bestSource.summary,
    translationStatus: "not_needed",
    time:
      (eventStatus === "UPDATED" || eventStatus === "FOLLOW_UP") && scored.latestUpdateAt
        ? `有更新 · ${scored.fresh.label}`
        : scored.fresh.label,
    truth: scored.reliabilityScore,
    baseUseful: scored.relevanceScore,
    lead: scored.noveltyScore,
    tags: [...new Set(sources.flatMap((source) => source.tags))],
    action: attentionDecision === "MUST_READ" ? "查看证据并更新判断" : "保存或继续观察",
    why: whyItMatters,
    official: sources
      .filter((source) => source.sourceTier !== "C" && source.sourceUrl)
      .map((source) => ({ name: source.publisher, url: source.sourceUrl, kind: "原文" as const })),
    social: sources
      .filter((source) => source.sourceTier === "C" && source.sourceUrl)
      .map((source) => ({ name: source.publisher, url: source.sourceUrl, kind: "讨论" as const })),
    sourceType: bestSource.sourceType,
    sourceTier: bestSource.sourceTier,
    sourceUrl: bestSource.sourceUrl,
    publisher: bestSource.publisher,
    publishedAt:
      validateTimestamp(bestSource, now) === "valid" ? bestSource.publishedAt : undefined,
    eventOccurredAt: scored.originalOccurredAt,
    firstSeenAt:
      earliestValidTimestamp(sources.map((source) => source.firstSeenAt), now) || now.toISOString(),
    lastUpdatedAt: scored.latestUpdateAt,
    retrievedAt:
      latestValidTimestamp(sources.map((source) => source.retrievedAt), now) || now.toISOString(),
    originalOccurredAt: scored.originalOccurredAt,
    latestUpdateAt: scored.latestUpdateAt,
    timestampStatus: scored.fresh.timestampStatus,
    dataOrigin: "demo",
    confidence: scored.reliabilityScore,
    verificationStatus,
    relevanceScore: scored.relevanceScore,
    reliabilityScore: scored.reliabilityScore,
    freshnessScore: scored.fresh.score,
    noveltyScore: scored.noveltyScore,
    judgementImpactScore: scored.judgementImpactScore,
    gapMatchScore: scored.gapMatchScore,
    overallScore: scored.overallScore,
    sourceCount: sources.length,
    independentEvidenceCount: sources.length,
    propagationCount: sources.filter((source) => source.sourceTier === "C").length,
    claims,
    sources: sources
      .filter((source) => source.sourceUrl)
      .map((source) => ({
        sourceUrl: source.sourceUrl,
        publisher: source.publisher,
        publishedAt:
          validateTimestamp(source, now) === "valid" ? source.publishedAt : undefined,
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
      })),
    section:
      attentionDecision === "MUST_READ"
        ? "must_know"
        : attentionDecision === "WORTH_WATCHING" || isSignal
          ? "emerging"
          : scored.gapMatches.length || scored.questionMatches.length
            ? "gap_update"
            : "all",
    gapMatches: scored.gapMatches,
    questionMatches: scored.questionMatches,
    entityMatches: scored.entityMatches,
    whyItMatters,
    eventStatus,
    informationType: isSignal ? "SIGNAL" : "FACT",
    knowledgeStatus,
    attentionDecision,
  };
}

export function evaluateDemoEvent(
  context: ProviderContext,
  sources: DemoSource[],
  now = new Date(),
) {
  if (!sources.length) throw new Error("At least one source is required");
  return toSignal(sources[0].eventKey, sources, context.filter, context.knowledge, now);
}

export function runFilterEngine(
  context: ProviderContext,
  dataset: DemoSource[] = demoDataset,
  now = new Date(),
): InformationRunPayload {
  const scoped = dataset.filter((source) => sourceAllowed(source, context.filter));
  const deduplicated = deduplicateSources(scoped);
  const clusters = new Map<string, DemoSource[]>();
  for (const source of deduplicated) {
    const current = clusters.get(source.eventKey) || [];
    current.push(source);
    clusters.set(source.eventKey, current);
  }
  const allSignals = [...clusters.entries()].map(([eventKey, sources]) =>
    toSignal(eventKey, sources, context.filter, context.knowledge, now),
  );
  const mustReadIds = new Set(
    allSignals
      .filter((signal) => signal.attentionDecision === "MUST_READ")
      .sort((left, right) => right.overallScore - left.overallScore)
      .slice(0, 5)
      .map((signal) => signal.id),
  );
  const worthWatchingIds = new Set(
    allSignals
      .filter((signal) => signal.attentionDecision === "WORTH_WATCHING")
      .sort((left, right) => right.overallScore - left.overallScore)
      .slice(0, 3)
      .map((signal) => signal.id),
  );
  const normalizedSignals = allSignals.map((signal) => {
    if (signal.attentionDecision === "MUST_READ" && !mustReadIds.has(signal.id)) {
      return { ...signal, attentionDecision: "LIBRARY_ONLY" as const, section: "all" as const };
    }
    if (signal.attentionDecision === "WORTH_WATCHING" && !worthWatchingIds.has(signal.id)) {
      return { ...signal, attentionDecision: "LIBRARY_ONLY" as const, section: "emerging" as const };
    }
    return signal;
  });
  const visibleSignals = normalizedSignals
    .filter((signal) => signal.attentionDecision !== "IGNORE")
    .sort((left, right) => right.overallScore - left.overallScore);
  const overview: ResearchOverview = {
    scanned: scoped.length,
    deduplicated: deduplicated.length,
    events: clusters.size,
    verified: normalizedSignals.filter((signal) => signal.verificationStatus === "verified").length,
    relevant: visibleSignals.length,
    mustKnow: normalizedSignals.filter((signal) => signal.attentionDecision === "MUST_READ").length,
    worthWatching: normalizedSignals.filter((signal) => signal.attentionDecision === "WORTH_WATCHING").length,
    libraryOnly: normalizedSignals.filter((signal) => signal.attentionDecision === "LIBRARY_ONLY").length,
    ignored: normalizedSignals.filter((signal) => signal.attentionDecision === "IGNORE").length,
    noiseReductionRate: clamp(
      scoped.length ? ((scoped.length - visibleSignals.length) / scoped.length) * 100 : 100,
    ),
    novelInformationRate: clamp(
      normalizedSignals.length
        ? (normalizedSignals.filter((signal) => signal.noveltyScore >= 60).length /
            normalizedSignals.length) *
            100
        : 0,
    ),
  };

  return {
    signals: visibleSignals,
    overview,
    coverage,
    failures: [],
    fetchedAt: now.toISOString(),
    dataMode: "demo",
  };
}

export const sourceCoverageExplanation =
  "未搜索或未配置某个来源，不代表该来源没有信息；本次结果只反映实际运行的 Provider。";
