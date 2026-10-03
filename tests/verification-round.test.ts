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

test("RED A (full path): community-only round 1 must still produce a verification round via fallback, not stop with candidates", async () => {
  const attempts: Array<{ selected?: string; fallback?: boolean; at: number }> = [];
  let calls = 0;
  const started = Date.now();
  const result = await runAgent({
    input: baseInput,
    maxRounds: 2,
    // deadline leaves ~22s: enough for the fallback planning + retrieval gates
    // (this test targets the fallback trigger itself, not the deadline).
    deadlineAt: started + 22_000,
    research: async (_input, plan, round) => {
      calls += 1;
      attempts.push({ selected: plan.selectedSourceType, fallback: plan.reason?.includes("fallback") ?? false, at: Date.now() - started });
      if (round === 1) {
        // Round 1: community candidates exist, but zero primary/official evidence
        // and zero verified signals — the response has signals, so the current
        // trigger (signals.length === 0) will NOT fire. This is the defect under
        // test: verification never happens despite no first-hand evidence.
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

  assert.ok(calls >= 2, `community-only round without primary evidence must still get a verification round, calls=${calls}`);
  assert.ok(
    result.response?.signals.some((s) => s.sourceType === "primary"),
    "verification round's primary evidence must reach the final response",
  );
});
