import assert from "node:assert/strict";
import test from "node:test";

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
    id: overrides.id ?? "event-community",
    category: "匹配",
    channel: "社区",
    title: overrides.title ?? "Launch HN: Mosaic (YC W25) – Agentic Video Editing",
    summary: overrides.summary ?? "Agentic video editing launch discussion.",
    time: "1h",
    truth: 58,
    baseUseful: 70,
    lead: 60,
    tags: ["video editing"],
    action: "read",
    why: "matches",
    official: [],
    social: [],
    sourceType: overrides.sourceType ?? "social",
    sourceTier: overrides.sourceTier ?? "C",
    sourceUrl: overrides.sourceUrl ?? "https://news.ycombinator.com/item?id=1",
    publisher: overrides.publisher ?? "Hacker News",
    publishedAt: overrides.publishedAt ?? new Date(Date.now() - 3600_000).toISOString(),
    eventOccurredAt: overrides.eventOccurredAt ?? new Date(Date.now() - 3600_000).toISOString(),
    firstSeenAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 58,
    verificationStatus: overrides.verificationStatus ?? "unverified",
    relevanceScore: 80,
    reliabilityScore: 55,
    freshnessScore: 90,
    noveltyScore: 70,
    judgementImpactScore: 60,
    gapMatchScore: 60,
    overallScore: 66,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 1,
    claims: [],
    sources: [],
    section: "emerging",
    gapMatches: [],
    questionMatches: [],
    entityMatches: [],
    whyItMatters: "w",
    eventStatus: "NEW",
    informationType: "SIGNAL",
    knowledgeStatus: "NOVEL",
    actionabilityStatus: "REVIEW_FIRST",
    informationGainStatus: "NEW_INFORMATION",
    hasExecutableAction: false,
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

// Mirrors the REAL run's budget consumption: model planning ~10.7s, then the
// pipeline spends ~12.2s in discovery (simulated with real sleeps inside the
// injected research callback), leaving ~2s — the exact shape of run5 where the
// verification round was structurally impossible.
test("RED A2 (budget shape): with real-run budget consumption, the verification round must still be attempted (planning guard must not swallow the whole budget)", async () => {
  const attempts: Array<{ round: number; selected?: string; remainingAtCall: number }> = [];
  const started = Date.now();
  const deadline = started + 25_000;
  const modelPlanningCalls = { count: 0 };
  const result = await runAgent({
    input: baseInput,
    maxRounds: 3,
    deadlineAt: deadline,
    modelAdapter: {
      status: "configured",
      planResearch: async () => {
        modelPlanningCalls.count += 1;
        // Real DeepSeek planning latency (~10.7s in run5); capped here so the
        // test stays fast while preserving the budget shape (planning + search
        // together consume nearly the whole deadline).
        await new Promise((resolve) => setTimeout(resolve, 10_500));
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
      attempts.push({
        round,
        selected: plan.selectedSourceType,
        remainingAtCall: deadline - Date.now(),
      });
      if (round === 1) {
        // Real run's discovery latency: ~12s inside the pipeline.
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        return response([signal()]);
      }
      return response([signal({
        id: "event-primary",
        sourceType: "primary",
        sourceTier: "S",
        verificationStatus: "verified",
        publisher: "Official",
        sourceUrl: "https://example.com/official-release",
        title: "Official: video editing suite release notes update",
      })]);
    },
  });

  // The verification round (round 2) must actually run its retrieval.
  assert.ok(modelPlanningCalls.count >= 1, "model planning must have run");
  const round2 = attempts.find((attempt) => attempt.round === 2);
  assert.ok(round2, `a second verification attempt must be made, attempts=${JSON.stringify(attempts)}`);
  assert.ok(
    (round2?.remainingAtCall ?? 0) > 1_500,
    `round-2 retrieval must retain executable budget, got ${round2?.remainingAtCall}ms`,
  );
  assert.ok(
    result.response?.signals.some((s) => s.sourceType === "primary"),
    "verification evidence must reach the final response",
  );
});
