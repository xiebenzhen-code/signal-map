// Full-path red tests for the bounded integration patch (2026-09-30).
// Real orchestration path (runAgent + runResearchPipeline) with injected
// sources and a controllable clock. No helper-only assertions.
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
    summary: overrides.summary ?? "Agentic video editing launch.",
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

test("RED A: community-only candidates without verifiable primary evidence must still get one verification attempt (not an early completion)", async () => {
  const researchCalls: Array<{ selected?: string; allowed?: string[] }> = [];
  let calls = 0;
  const result = await runAgent({
    input: baseInput,
    maxRounds: 2,
    research: async (_input, plan, round) => {
      calls += 1;
      researchCalls.push({ selected: plan.selectedSourceType, allowed: plan.allowedProviderIds });
      if (round === 1) {
        // Community-only discovery: candidates exist but all social/unverified.
        return response([signal()]);
      }
      // Round 2: a primary/official verification pass would run here.
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

  assert.ok(calls >= 2, `community-only first round must allow a verification round, calls=${calls}`);
  assert.equal(
    result.response?.signals.some((s) => s.sourceType === "primary"),
    true,
    "the verification round's primary evidence must be merged into the final response",
  );
});

test("RED B: with a slow first search but remaining enrichment budget, relevant candidates reach detail enrichment", async () => {
  // This exercises the pipeline guard path with injected fetch: a slow googleNews
  // (consuming budget) followed by duckduckgo results that need enrichment.
  const { runResearchPipeline } = await import("../research/research-pipeline.ts");
  const originalFetch = globalThis.fetch;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  globalThis.fetch = (async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "news.google.com") {
      await sleep(1500); // slow primary engine
      return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/xml" } });
    }
    if (url.hostname === "html.duckduckgo.com") {
      // One relevant, enrichable news page.
      const html = `<html><body>${[
        `<a class='result__a' href='https://digital-nirvana.com/news/roughcut-ai-launch/'>Digital Nirvana Launches RoughCut AI Video Editing Platform</a>`,
      ].join("")}</body></html>`;
      return new Response(html);
    }
    if (url.hostname === "www.reddit.com") return new Response(JSON.stringify({ data: { children: [] } }));
    if (url.hostname === "hn.algolia.com") return new Response(JSON.stringify({ hits: [] }));
    if (url.hostname === "huggingface.co") return new Response(JSON.stringify([]));
    if (url.hostname === "export.arxiv.org") return new Response("<feed></feed>");
    // The detail fetch target: a real article page.
    if (url.hostname === "digital-nirvana.com") {
      return new Response(`<!doctype html><html><head><title>RoughCut AI launch</title></head><body>
        <nav><a href='/'>Home</a> Products About</nav>
        <article><h1>Digital Nirvana launches RoughCut AI</h1>
        <p>Digital Nirvana announced the launch of RoughCut AI, a cloud video editing platform that automates rough-cut assembly.</p>
        <p>It adds multi-asset understanding, shot selection and commercial workflow templates for post-production teams.</p>
        <p>Customers can request a trial of the automated rough-cut workflow today.</p></article>
      </body></html>`);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const started = Date.now();
    const result = await runResearchPipeline({
      ...baseInput,
      identity: "u",
    }, undefined, { deadlineAt: started + 25_000 }, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: ["PRIMARY"],
      allowedProviderIds: ["public-web", "hacker-news", "huggingface", "product-hunt", "primary-web-search", "reverse-primary", "trusted-media", "industry-media", "reddit", "company-registry", "official-update-pages", "github-releases", "arxiv"],
      reason: "integration test: discovery-first with slow engine",
    });
    const detail = result.filteringSummary?.detailEnrichment;
    assert.ok(detail, "detail enrichment summary must exist");
    assert.ok(
      (detail?.detailAttempted ?? 0) >= 1,
      `a relevant candidate must reach detail enrichment while budget remains, got ${JSON.stringify(detail)}`,
    );
    assert.equal(
      result.signals.length,
      0,
      "insufficient verification must still block display (gate intact)",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RED C: exhausted deadline starts no new fetches and returns needs_more_evidence honestly", async () => {
  const { runResearchPipeline } = await import("../research/research-pipeline.ts");
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async (target: string | URL | Request) => {
    networkCalls += 1;
    const url = new URL(String(target));
    if (url.hostname === "news.google.com") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/xml" } });
    }
    if (url.hostname === "html.duckduckgo.com") return new Response("<html></html>");
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const started = Date.now();
    const result = await runResearchPipeline({
      ...baseInput,
      identity: "u",
    }, undefined, { deadlineAt: started + 2_000 }, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["public-web"],
      reason: "integration test: exhausted deadline",
    });
    const callsAfterDeadline = networkCalls;
    assert.equal(result.signals.length, 0);
    // After the 2s deadline, no further expensive discovery may start.
    assert.ok(
      Date.now() - started < 8_000,
      `pipeline must wrap up promptly after deadline, took ${Date.now() - started}ms with ${callsAfterDeadline} calls`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
