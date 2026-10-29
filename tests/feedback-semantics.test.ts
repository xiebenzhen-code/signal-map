// Feedback semantics differentiation: not_useful (negative) vs changed_view
// (judgment update, no "useless" penalty) vs JUDGEMENT records never entering
// knownInformation. Covers the REAL runner assembly (runAgent with a seeded
// repository and captured research input) and the pipeline consumption path
// (runResearchPipeline with injected fetchers, no model, no real DB).
import assert from "node:assert/strict";
import test from "node:test";
// Freeze the historical fixture clock; never reinterpret its dates using wall time.

import { runAgent } from "../agent/runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const baseInput = {
  identity: "builder", industry: "AI developer tools", focusAreas: "Codex",
  currentQuestions: "latest release", knownInformation: "", informationGaps: "new workflow",
  trackedEntities: "Codex", trackedEvents: "", userJudgements: "", evidenceHistory: "",
  freshnessWindow: "7d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "event-1", category: "匹配", channel: "官方", title: "Codex update",
    summary: "New workflow", time: "1h", truth: 90, baseUseful: 90, lead: 80,
    tags: ["Codex"], action: "read", why: "new", official: [], social: [],
    sourceType: "primary", sourceTier: "S", sourceUrl: "https://example.com/update",
    publisher: "Official", publishedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(), timestampStatus: "valid", dataOrigin: "live", confidence: 90,
    verificationStatus: "verified", relevanceScore: 90, reliabilityScore: 90, freshnessScore: 90,
    noveltyScore: 80, judgementImpactScore: 80, gapMatchScore: 80, overallScore: 88,
    sourceCount: 1, independentEvidenceCount: 1, propagationCount: 0, claims: [], sources: [],
    section: "must_know", gapMatches: ["new workflow"], questionMatches: ["latest release"],
    entityMatches: ["codex"], whyItMatters: "new", eventStatus: "NEW", informationType: "FACT",
    knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ", ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: new Date().toISOString(), dataMode: "live",
  };
}

// ---- 1. 纯函数：负向判定词只来自 Not useful 行（changed_view/手写不产生无用扣分） ----
test("RED: real runner assembly keeps KNOWN_INFORMATION in knownInformation and excludes JUDGEMENT", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
  const repository = new InMemorySignalRepository();
  const ctx = { authenticatedUserId: "sem-user-a", filterId: "account-sem-user-a" };
  await repository.upsertPersonalKnowledge(ctx, { type: "KNOWN_INFORMATION", text: "已知事实 Codex 2.0 已发布" }, new Date().toISOString());
  await repository.upsertPersonalKnowledge(ctx, { type: "JUDGEMENT", text: "Changed after evidence: 独家爆料内容" }, new Date().toISOString());

  let capturedKnownInformation: string | undefined;
  const result = await runAgent({
    memoryParticipation: true,
    input: { ...baseInput, trackedEntities: "Codex" },
    context: ctx,
    repository,
    maxRounds: 1,
    research: async (input) => {
      capturedKnownInformation = String(input.knownInformation ?? "");
      return response([
        signal({ title: "Codex 2.0 已发布", summary: "已知事实 Codex 2.0 已发布", entityMatches: ["codex"] }),
        signal({ id: "event-unrelated", title: "完全不相关的其它内容", summary: "unrelated content", entityMatches: [], questionMatches: [], gapMatches: [] }),
      ]);
    },
  });
  assert.equal(result.status, "completed");
  assert.ok(capturedKnownInformation?.includes("已知事实"), "KNOWN_INFORMATION enters knownInformation");
  assert.ok(!capturedKnownInformation?.includes("Changed after evidence"), "JUDGEMENT must not enter knownInformation (it is a user judgment, not a verified fact)");
});

// ---- 3. 真实 runner：账号隔离（A 的记录不进入 B 的组装） ----
test("RED: runner assembly is scoped by account (A's records never enter B's research input)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
  const repository = new InMemorySignalRepository();
  await repository.upsertPersonalKnowledge(
    { authenticatedUserId: "sem-user-b", filterId: "account-sem-user-b" },
    { type: "KNOWN_INFORMATION", text: "用户B的私有已知事实" },
    new Date().toISOString(),
  );
  let capturedKnownInformation: string | undefined;
  await runAgent({
    // This file pins the auto-memory participation contract; the production
    // default is isolated (bounded closeout cycle 2026-10-20).
    memoryParticipation: true,
    input: { ...baseInput, trackedEntities: "Codex" },
    context: { authenticatedUserId: "sem-user-a", filterId: "account-sem-user-a" },
    repository,
    maxRounds: 1,
    research: async (input) => {
      capturedKnownInformation = String(input.knownInformation ?? "");
      return response([signal()]);
    },
  });
  assert.ok(!capturedKnownInformation?.includes("用户B的私有已知事实"), "user A's assembly must not include user B's records");
});

// ---- 4. 管线消费：not_useful 只影响匹配内容（注入 fetchers，无模型/无真实库） ----
const RELEASES = [
  {
    id: 4001, tag_name: "v0.39.0", name: "v0.39.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.39.0",
    body: "Release Notes\n## Core\n* Improve qwen KV cache location logic for large workflows\n* Reduce memory usage during sampling",
    published_at: "2026-09-28T10:00:00Z",
  },
  {
    id: 4002, tag_name: "v0.38.5", name: "v0.38.5",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.38.5",
    body: "Release Notes\n## UI\n* Add new node search across installed packs",
    published_at: "2026-09-20T10:00:00Z",
  },
];

function stubFetch(target: string | URL | Request): Promise<Response> {
  const url = new URL(String(target));
  if (url.hostname === "api.github.com" && url.pathname.endsWith("/releases")) return Promise.resolve(Response.json(RELEASES));
  if (url.hostname === "api.deepseek.com") return Promise.reject(new Error("no model calls in this test"));
  return Promise.resolve(new Response("", { status: 404 }));
}

const PLAN_OVERRIDE = {
  primarySourceType: "OFFICIAL",
  fallbackSourceTypes: ["PRIMARY", "GENERAL_WEB"],
  allowedProviderIds: ["company-registry", "official-update-pages", "github-releases", "primary-web-search", "trusted-media", "industry-media", "public-web", "product-hunt", "hacker-news", "huggingface", "arxiv", "reddit", "reverse-primary", "social-access"],
  reason: "feedback semantics test",
};

async function pipelineRun(userJudgements: string) {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch as typeof fetch;
  try {
    return await runResearchPipeline(
      {
        identity: "builder", industry: "开源开发与 AI 工具", focusAreas: "值得关注的新变化",
        currentQuestions: "ComfyUI 最近一个月在 GitHub 发布了哪些版本？",
        knownInformation: "", informationGaps: "", trackedEntities: "ComfyUI", trackedEvents: "",
        userJudgements, evidenceHistory: "", freshnessWindow: "30d",
      },
      undefined, undefined, { ...PLAN_OVERRIDE },
    );
  } finally {
    globalThis.fetch = original;
  }
}

test("RED: pipeline consumption — not_useful penalizes only the matching signal", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
  const withJudgement = await pipelineRun("Not useful: qwen KV cache location logic");
  const judged = withJudgement.signals.flatMap(signal => [signal, ...(signal.relatedUpdates ?? [])]).find((s) => s.sourceUrl.includes("v0.39.0"));
  const other = withJudgement.signals.flatMap(signal => [signal, ...(signal.relatedUpdates ?? [])]).find((s) => s.sourceUrl.includes("v0.38.5"));
  assert.ok(judged, "the matching signal must exist");
  assert.ok(other, "the other signal must exist");
  assert.ok(
    (judged.noveltyScore ?? 100) < (other.noveltyScore ?? 100),
    `the not_useful-matched signal must be penalized: judged=${judged.noveltyScore} other=${other.noveltyScore}`,
  );
});

test("pipeline consumption — changed_view does not add a useless penalty", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
  const withChanged = await pipelineRun("Changed after evidence: qwen KV cache location logic");
  const judged = withChanged.signals.flatMap(signal => [signal, ...(signal.relatedUpdates ?? [])]).find((s) => s.sourceUrl.includes("v0.39.0"));
  const baseline = await pipelineRun("");
  const baseJudged = baseline.signals.flatMap(signal => [signal, ...(signal.relatedUpdates ?? [])]).find((s) => s.sourceUrl.includes("v0.39.0"));
  assert.equal(
    judged?.noveltyScore, baseJudged?.noveltyScore,
    `changed_view must not change the novelty score: changed=${judged?.noveltyScore} baseline=${baseJudged?.noveltyScore}`,
  );
});
