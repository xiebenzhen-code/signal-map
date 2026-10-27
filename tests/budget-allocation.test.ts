import assert from "node:assert/strict";
import test from "node:test";

import { runResearchPipeline } from "./fixtures/detail-read.ts";
import type { ResearchInput, ResearchResponse } from "../research/types.ts";

const LONG_QUERY =
  "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？" +
  "重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。";

function coverageInput(): ResearchInput {
  return {
    identity: "AI product builder",
    industry: "AI 视频与创作者工具",
    focusAreas: "AI video editing, video automation",
    currentQuestions: LONG_QUERY,
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  };
}

function defaultResponse(url: string): Response {
  if (url.includes("hn.algolia.com")) return new Response('{"hits":[]}', { status: 200 });
  if (url.includes("news.google.com")) return new Response("<rss><channel></channel></rss>", { status: 200 });
  if (url.includes("huggingface.co")) return new Response("[]", { status: 200 });
  return new Response("", { status: 200 });
}

const HN_RELEVANT =
  '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
  '"url":"https://example.com/palmier-pro","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"}]}';

const CANONICAL_BODY =
  "<html><head><title>Palmier Pro</title><meta name=\"description\" content=\"Palmier Pro launches an open-source AI video editor for macOS with automated rough cut and shot selection.\"/></head>" +
  "<body>Palmier Pro launches as an open-source AI video editor for macOS. It automates rough cut and shot selection for multi-asset workflows.</body></html>";

function installFetch(overrides: Record<string, () => Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, handler] of Object.entries(overrides)) {
      if (url.includes(needle)) return handler();
    }
    return defaultResponse(url);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function hnOutcome(result: ResearchResponse) {
  return (result.sourceDiagnostics || []).find((entry) => entry.providerId === "hacker-news");
}

function generalWebOutcome(result: ResearchResponse) {
  return result.coverage.outcomes.find((entry) => entry.source === "General Web");
}

function run(input: ResearchInput, deadlineAt?: number) {
  return runResearchPipeline(input, undefined, deadlineAt ? { deadlineAt } : undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["public-web", "hacker-news"],
    reason: "budget allocation regression",
  });
}

test("A. eligible candidate with ample budget is actually detail-enriched", async () => {
  const restore = installFetch({
    "hn.algolia.com": () => new Response(HN_RELEVANT, { status: 200 }),
    "example.com": () => new Response(CANONICAL_BODY, { status: 200 }),
  });
  try {
    const result = await run(coverageInput());
    const hn = hnOutcome(result);
    assert.ok((hn?.detailAttempted ?? 0) >= 1);
    assert.equal(hn?.detailSucceeded, 1);
  } finally {
    restore();
  }
});

test("B. near the budget boundary, luxury discovery yields and enrichment still runs", async () => {
  const restore = installFetch({
    "hn.algolia.com": () => new Response(HN_RELEVANT, { status: 200 }),
    "example.com": () => new Response(CANONICAL_BODY, { status: 200 }),
  });
  try {
    // ~5s remaining: below the luxury-web reservation, so general web is not
    // started, but enough remains to complete at least one detail fetch.
    const result = await run(coverageInput(), Date.now() + 5000);
    const generalWeb = generalWebOutcome(result);
    assert.equal(generalWeb?.execution, "not_searched", "general web must yield under tight budget");
    const hn = hnOutcome(result);
    assert.ok((hn?.detailAttempted ?? 0) >= 1, "enrichment must still get an execution window");
  } finally {
    restore();
  }
});

test("C. no eligible candidate does not force a detail reservation when budget is ample", async () => {
  const restore = installFetch({
    "hn.algolia.com": () => new Response('{"hits":[]}', { status: 200 }),
  });
  try {
    const result = await run(coverageInput());
    // Ample budget -> general web is not held back by the reservation guard.
    const generalWeb = generalWebOutcome(result);
    assert.equal(generalWeb?.searched, true, "retrieval must stay as-is when no eligible candidate under ample budget");
    assert.equal(hnOutcome(result)?.detailAttempted ?? 0, 0);
  } finally {
    restore();
  }
});

test("D. a detail fetch failure is fail-soft and does not crash the pipeline", async () => {
  const restore = installFetch({
    "hn.algolia.com": () => new Response(HN_RELEVANT, { status: 200 }),
    "example.com": () => { throw new TypeError("canonical fetch failed"); },
  });
  try {
    const result = await run(coverageInput());
    const hn = hnOutcome(result);
    assert.ok((hn?.detailAttempted ?? 0) >= 1);
    assert.equal(hn?.detailSucceeded, 0);
    assert.ok(Array.isArray(result.signals), "pipeline must still return normally");
  } finally {
    restore();
  }
});