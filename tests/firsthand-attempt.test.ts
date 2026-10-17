import assert from "node:assert/strict";
import test from "node:test";

// Full-path red test (real runner orchestration): the original question —
// entity-less PRODUCT_UPDATE with "prefer official/first-hand sources" — must
// give the OFFICIAL (first-hand) providers an executable chance inside the same
// deadline. Today attempt-1 only allows GENERAL_WEB discovery providers and the
// OFFICIAL/PRIMARY pass is deferred to a fallback that is structurally starved
// (runs e5f91d07: remaining 1150ms; 7dd4694e: 1984ms — both WORKER_DEADLINE).
import { runAgent } from "../agent/runner.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const ORIGINAL_QUESTION =
  "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？\n" +
  "重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。\n" +
  "优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。\n" +
  "告诉我发生了什么、为什么值得关注，以及我现在能具体测试什么。";

const baseInput = {
  identity: "关注这个方向的用户",
  industry: "AI 视频与创作者工具",
  focusAreas: "AI 视频工具",
  currentQuestions: ORIGINAL_QUESTION,
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: overrides.id ?? "event-official",
    category: "匹配",
    channel: "官方",
    title: overrides.title ?? "Official release notes: video editing suite update",
    summary: overrides.summary ?? "Official changelog entry with verifiable features.",
    time: "1h",
    truth: 90,
    baseUseful: 85,
    lead: 80,
    tags: ["video editing"],
    action: "read",
    why: "official",
    official: [],
    social: [],
    sourceType: overrides.sourceType ?? "primary",
    sourceTier: overrides.sourceTier ?? "S",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/changelog",
    publisher: overrides.publisher ?? "Official",
    publishedAt: overrides.publishedAt ?? new Date(Date.now() - 3600_000).toISOString(),
    eventOccurredAt: overrides.eventOccurredAt ?? new Date(Date.now() - 3600_000).toISOString(),
    firstSeenAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 90,
    verificationStatus: overrides.verificationStatus ?? "verified",
    relevanceScore: 85,
    reliabilityScore: 90,
    freshnessScore: 88,
    noveltyScore: 75,
    judgementImpactScore: 70,
    gapMatchScore: 70,
    overallScore: 80,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 1,
    claims: [],
    sources: [],
    section: "must_know",
    gapMatches: [],
    questionMatches: [],
    entityMatches: [],
    whyItMatters: "w",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    actionabilityStatus: "REVIEW_FIRST",
    informationGainStatus: "NEW_INFORMATION",
    hasExecutableAction: true,
    attentionDecision: "LIBRARY_ONLY",
    ...overrides,
  } as ResearchSignal;
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: new Date().toISOString(),
    dataMode: "live",
  };
}

test("RED: entity-less 'prefer official' question must give OFFICIAL providers an executable attempt inside the deadline", async () => {
  const executedProviders = new Set<string>();
  const attempts: Array<{ round: number; allowed?: string[]; remainingAtCall: number }> = [];
  const started = Date.now();
  const deadline = started + 25_000;

  const result = await runAgent({
    input: baseInput,
    maxRounds: 3,
    deadlineAt: deadline,
    modelAdapter: {
      status: "configured",
      planResearch: async () => {
        // Real model-planning latency (run5/6: ~8.5-10.7s).
        await new Promise((resolve) => setTimeout(resolve, 8_500));
        return {
          status: "configured",
          plan: {
            objective: "test objective",
            queries: ["AI video editing release update"],
            preferredSourceTypes: [],
            maxQueries: 5,
          },
        };
      },
    } as never,
    research: async (_input, plan, round) => {
      attempts.push({ round, allowed: plan.allowedProviderIds, remainingAtCall: deadline - Date.now() });
      for (const providerId of plan.allowedProviderIds ?? []) executedProviders.add(providerId);
      if (round === 1) {
        // Real shape: discovery + enrichment spend most of the remaining
        // budget (run e5f91d07: search ~9.8s + detail enrichment ~5.6s), leaving
        // ~1.2s — no second round is possible, so first-hand retrieval must
        // happen inside THIS attempt (official providers in the allowed list).
        await new Promise((resolve) => setTimeout(resolve, 15_400));
        const officialProviders = ["company-registry", "official-update-pages", "github-releases"];
        const primaryProviders = ["primary-web-search", "reverse-primary", "arxiv"];
        const hasFirstHand = (plan.allowedProviderIds ?? []).some((p) => officialProviders.includes(p) || primaryProviders.includes(p));
        if (!hasFirstHand) {
          return response([signal({
            sourceType: "social",
            sourceTier: "C",
            verificationStatus: "unverified",
            publisher: "Hacker News",
            sourceUrl: "https://news.ycombinator.com/item?id=1",
            title: "Launch HN: video editing discussion",
          })]);
        }
        // First-hand providers executed in this attempt: official evidence arrives.
        return response([
          signal({
            sourceType: "social",
            sourceTier: "C",
            verificationStatus: "unverified",
            publisher: "Hacker News",
            sourceUrl: "https://news.ycombinator.com/item?id=1",
            title: "Launch HN: video editing discussion",
          }),
          signal(),
        ]);
      }
      // Later rounds (if budget allows) also produce first-hand evidence.
      return response([signal()]);
    },
  });

  // The OFFICIAL first-hand providers must have been executable in SOME attempt:
  // either attempt-1 included them, or a later attempt with enough budget did.
  const officialProviders = ["company-registry", "official-update-pages", "github-releases"];
  const primaryProviders = ["primary-web-search", "reverse-primary", "arxiv"];
  const officialRan = officialProviders.some((p) => executedProviders.has(p));
  const primaryRan = primaryProviders.some((p) => executedProviders.has(p));
  assert.ok(
    officialRan || primaryRan,
    `first-hand providers (OFFICIAL/PRIMARY) must get an executable attempt, executed=${JSON.stringify([...executedProviders])}, attempts=${JSON.stringify(attempts.map((a) => ({ round: a.round, remaining: a.remainingAtCall })))}`,
  );

  assert.ok(
    result.response?.signals.some((s) => s.sourceType === "primary"),
    "first-hand evidence must reach the final response",
  );
});
