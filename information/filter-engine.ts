import type {
  Claim,
  ResearchOverview,
  ResearchSignal,
  SourceTier,
  VerificationStatus,
} from "../research/types.ts";
import { demoDataset } from "./demo-dataset.ts";
import type {
  DemoSource,
  InformationFilter,
  InformationRun,
  KnowledgeState,
  ProviderCoverage,
  ProviderContext,
} from "./types.ts";

const coverage: ProviderCoverage = {
  level: "Limited",
  usedProviders: ["DemoProvider"],
  unavailableProviders: ["ImportedDataProvider"],
  notConfiguredProviders: ["WebProvider", "XProvider", "XiaohongshuProvider"],
  failedProviders: [],
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

function sourceAllowed(source: DemoSource, scope: InformationFilter["sourceScope"]) {
  if (scope === "official") return source.sourceTier === "S";
  if (scope === "verified") return source.sourceTier !== "C";
  return true;
}

export function validateFactEvidence(source: DemoSource) {
  return Boolean(
    source.sourceUrl.trim() &&
      source.publisher.trim() &&
      Number.isFinite(source.ageHours) &&
      source.evidenceSnippet?.trim(),
  );
}

export function deduplicateSources(sources: DemoSource[]) {
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

function publishedAt(ageHours: number) {
  return new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
}

function freshness(ageHours: number) {
  if (ageHours <= 0.5) return { label: "Just now", score: 100 };
  if (ageHours <= 1) return { label: "1h", score: 96 };
  if (ageHours <= 6) return { label: "6h", score: 90 };
  if (ageHours <= 24) return { label: "24h", score: 80 };
  if (ageHours <= 72) return { label: "3d", score: 65 };
  if (ageHours <= 168) return { label: "7d", score: 48 };
  return { label: "7d", score: 15 };
}

function freshnessWindowHours(value: string) {
  const amount = Number.parseInt(value, 10);
  if (!Number.isFinite(amount)) return 24 * 7;
  return value.endsWith("h") ? amount : amount * 24;
}

function verificationFor(sources: DemoSource[]): VerificationStatus {
  if (sources.some((source) => source.conflict)) return "conflicting";
  if (sources.some((source) => source.sourceTier === "S" && validateFactEvidence(source))) {
    return "verified";
  }
  if (sources.some((source) => source.sourceTier !== "C" && validateFactEvidence(source))) {
    return "partially_verified";
  }
  return "unverified";
}

function scoreEvent(
  sources: DemoSource[],
  filter: InformationFilter,
  knowledge: KnowledgeState,
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
  const focusMatches = matchesAny(corpus, [...filter.focusAreas, ...knowledge.focusAreas]);
  const gapMatches = matchesAny(corpus, [
    ...filter.informationGaps,
    ...knowledge.informationGaps,
  ]);
  const questionMatches = matchesAny(corpus, [
    ...filter.currentQuestions,
    ...knowledge.currentQuestions,
  ]);
  const entityMatches = matchesAny(corpus, knowledge.trackedEntities);
  const identityMatch = matchesAny(corpus, [filter.identity, knowledge.identity]).length > 0;
  const industryMatch = matchesAny(corpus, [filter.industry, knowledge.industry]).length > 0;
  const knownMatches = matchesAny(corpus, [
    ...filter.knownInformation,
    ...knowledge.knownInformation,
  ]);
  const trackedEvent = matchesAny(corpus, knowledge.trackedEvents).length > 0;
  const ageHours = Math.min(...sources.map((source) => source.ageHours));
  const fresh = freshness(ageHours);
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
  knowledge: KnowledgeState,
): ResearchSignal {
  const scored = scoreEvent(sources, filter, knowledge);
  const verificationStatus = verificationFor(sources);
  const validFacts = sources.filter(
    (source) => source.sourceTier !== "C" && validateFactEvidence(source),
  );
  const claims: Claim[] = sources
    .filter((source) => source.sourceTier === "C" || validateFactEvidence(source))
    .map((source) => ({
      claimText: source.claimText,
      sourceUrl: source.sourceUrl,
      publisher: source.publisher,
      publishedAt: publishedAt(source.ageHours),
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      evidenceSnippet: source.evidenceSnippet || "该线索没有可验证的独立证据。",
      verificationStatus:
        source.conflict
          ? "conflicting"
          : source.sourceTier === "S"
            ? "verified"
            : source.sourceTier === "C"
              ? "unverified"
              : "partially_verified",
      contentType: source.sourceTier === "C" ? "SIGNAL" : "FACT",
    }));
  const isSignal = validFacts.length === 0;
  const reliableEnough =
    scored.reliabilityScore >= 70 &&
    scored.relevanceScore >= 75 &&
    scored.noveltyScore >= 60;
  const canBeMustRead =
    reliableEnough &&
    !isSignal &&
    verificationStatus !== "conflicting" &&
    scored.ageHours <= freshnessWindowHours(filter.freshnessWindow);
  const outsideFreshnessWindow =
    scored.ageHours > freshnessWindowHours(filter.freshnessWindow);
  const attentionDecision: ResearchSignal["attentionDecision"] = outsideFreshnessWindow
    ? "IGNORE"
    : canBeMustRead
      ? "MUST_READ"
      : scored.overallScore >= 48 && scored.noveltyScore >= 35
        ? "LIBRARY_ONLY"
        : "IGNORE";
  const eventStatus: ResearchSignal["eventStatus"] = isSignal
    ? "SIGNAL"
    : scored.trackedEvent
      ? "FOLLOW_UP"
      : scored.knownMatches.length
        ? "UPDATED"
        : "NEW";
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
        ? "这是较早的社区线索，尚未获得独立来源支持，只进入信息库观察。"
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
    time: scored.fresh.label,
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
    publishedAt: publishedAt(scored.ageHours),
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
    claims,
    sources: sources
      .filter((source) => source.sourceUrl)
      .map((source) => ({
        sourceUrl: source.sourceUrl,
        publisher: source.publisher,
        publishedAt: publishedAt(source.ageHours),
        sourceType: source.sourceType,
        sourceTier: source.sourceTier,
      })),
    section:
      attentionDecision === "MUST_READ"
        ? "must_know"
        : isSignal
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

export function runFilterEngine(
  context: ProviderContext,
  dataset: DemoSource[] = demoDataset,
): InformationRun {
  const scoped = dataset.filter((source) => sourceAllowed(source, context.filter.sourceScope));
  const deduplicated = deduplicateSources(scoped);
  const clusters = new Map<string, DemoSource[]>();
  for (const source of deduplicated) {
    const current = clusters.get(source.eventKey) || [];
    current.push(source);
    clusters.set(source.eventKey, current);
  }
  const allSignals = [...clusters.entries()].map(([eventKey, sources]) =>
    toSignal(eventKey, sources, context.filter, context.knowledge),
  );
  const mustReadIds = new Set(
    allSignals
      .filter((signal) => signal.attentionDecision === "MUST_READ")
      .sort((left, right) => right.overallScore - left.overallScore)
      .slice(0, 5)
      .map((signal) => signal.id),
  );
  const normalizedSignals = allSignals.map((signal) =>
    signal.attentionDecision === "MUST_READ" && !mustReadIds.has(signal.id)
      ? { ...signal, attentionDecision: "LIBRARY_ONLY" as const, section: "all" as const }
      : signal,
  );
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
    fetchedAt: new Date().toISOString(),
  };
}

export const sourceCoverageExplanation =
  "未搜索或未配置某个来源，不代表该来源没有信息；本次结果只反映实际运行的 Provider。";

export function createEmptyKnowledge(filter: InformationFilter): KnowledgeState {
  return {
    identity: filter.identity,
    industry: filter.industry,
    focusAreas: filter.focusAreas,
    currentQuestions: filter.currentQuestions,
    knownInformation: filter.knownInformation,
    informationGaps: filter.informationGaps,
    trackedEntities: [],
    trackedEvents: [],
    userJudgements: [],
    evidenceHistory: [],
    freshnessWindow: filter.freshnessWindow,
  };
}
