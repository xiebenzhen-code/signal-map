import assert from "node:assert/strict";
import test from "node:test";

import { isSafeDetailUrl } from "../source-enrichment/safe-url.ts";
import { shouldEnrichDetail } from "../source-enrichment/detail-enricher.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput } from "../research/types.ts";

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

function emptyResponse(url: string): Response {
  if (url.includes("hn.algolia.com")) return new Response('{"hits":[]}', { status: 200 });
  if (url.includes("news.google.com")) return new Response("<rss><channel></channel></rss>", { status: 200 });
  if (url.includes("huggingface.co")) return new Response("[]", { status: 200 });
  if (url.includes("export.arxiv.org")) {
    return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id></feed>', { status: 200 });
  }
  return new Response("", { status: 200 });
}

function installFetch(overrides: Record<string, (url: string) => Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, handler] of Object.entries(overrides)) {
      if (url.includes(needle)) return handler(url);
    }
    return emptyResponse(url);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function outcome(result: Awaited<ReturnType<typeof runResearchPipeline>>, providerId: string) {
  return (result.sourceDiagnostics || []).find((entry) => entry.providerId === providerId);
}

// ---- shouldEnrichDetail unit contract ----

test("A. relevant HN candidate with a safe canonicalUrl and thin content is eligible for detail enrichment", () => {
  const eligible = shouldEnrichDetail({
    providerId: "hacker-news",
    title: "Show HN: Palmier Pro - Open-source macOS video editor built for AI",
    snippet: "",
    potentialScore: 80,
    url: "https://example.com/palmier-pro",
    isRelevant: true,
  });
  assert.equal(eligible, true);
});

test("D. HN candidate that failed topic relevance must not be detail-enriched even with a canonicalUrl", () => {
  const eligible = shouldEnrichDetail({
    providerId: "hacker-news",
    title: "robotic manipulation memory model",
    snippet: "",
    potentialScore: 80,
    url: "https://example.com/robot",
    isRelevant: false,
  });
  assert.equal(eligible, false);
});

test("F. HN candidate without a canonicalUrl is not eligible for detail enrichment", () => {
  const eligible = shouldEnrichDetail({
    providerId: "hacker-news",
    title: "Show HN: Some tool",
    snippet: "",
    potentialScore: 80,
    isRelevant: true,
  });
  assert.equal(eligible, false);
});

test("E. existing DISCOVERY providers (Product Hunt) keep enrichment eligibility", () => {
  const eligible = shouldEnrichDetail({
    providerId: "product-hunt",
    title: "AI video tool",
    snippet: "",
    potentialScore: 80,
  });
  assert.equal(eligible, true);
});

test("E2. single detail attempt per candidate URL is not double counted (fetch happens once)", async () => {
  let canonicalFetches = 0;
  const restore = installFetch({
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          '"url":"https://example.com/palmier-pro","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"}]}',
        { status: 200 },
      ),
    "example.com": () => {
      canonicalFetches += 1;
      return new Response(
        "<html><head><title>Palmier Pro</title><meta name=\"description\" content=\"Open-source AI video editor for macOS with automated rough cut and shot selection.\"/></head>" +
          "<body>Palmier Pro is an open-source macOS video editor built for AI. It automates rough cut and shot selection for multi-asset workflows.</body></html>",
        { status: 200 },
      );
    },
  });
  try {
    const result = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news"],
      reason: "detail enrichment single fetch",
    });
    assert.equal(canonicalFetches, 1, "canonical URL must be fetched exactly once");
    const hn = outcome(result, "hacker-news");
    assert.equal(hn?.detailAttempted, 1);
    assert.equal(hn?.detailSucceeded, 1);
  } finally {
    restore();
  }
});

// ---- URL safety ----

test("URL safety rejects localhost / private / link-local / non-http schemes for detail fetch", () => {
  const bad = [
    "http://127.0.0.1/whatever",
    "http://localhost/path",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/x",
    "http://192.168.1.10/x",
    "http://172.16.0.1/x",
    "http://[::1]/x",
    "file:///etc/passwd",
    "data:text/html,hello",
  ];
  for (const url of bad) assert.equal(isSafeDetailUrl(url), false, url);
  const good = [
    "https://example.com/palmier-pro",
    "http://www.producthunt.com/launch",
    "https://github.com/palmier-io/palmier-pro",
  ];
  for (const url of good) assert.equal(isSafeDetailUrl(url), true, url);
});

// ---- pipeline fail-soft on detail fetch failure ----

test("C. detail fetch failure is fail-soft and does not turn into a fabricated body or crash", async () => {
  const restore = installFetch({
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          '"url":"https://example.com/palmier-pro","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"}]}',
        { status: 200 },
      ),
    "example.com": () => new Response("", { status: 500 }),
  });
  try {
    const result = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news"],
      reason: "detail fetch fail-soft",
    });
    const hn = outcome(result, "hacker-news");
    assert.equal(hn?.detailSucceeded, 0);
    assert.equal((result.filteringSummary?.filteredReasons.insufficientContent ?? 0) >= 1, true);
    assert.ok(Array.isArray(result.signals), "pipeline must still return normally");
  } finally {
    restore();
  }
});

test("B. successful canonical detail fetch moves a relevant HN candidate past INSUFFICIENT_CONTENT", async () => {
  const restore = installFetch({
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          '"url":"https://example.com/palmier-pro","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"}]}',
        { status: 200 },
      ),
    "example.com": () =>
      new Response(
        "<html><head><title>Palmier Pro</title><meta name=\"description\" content=\"Palmier Pro launches an open-source AI video editor for macOS with automated rough cut and shot selection.\"/></head>" +
          "<body>Palmier Pro launches as an open-source AI video editor for macOS. It automates rough cut and shot selection for multi-asset workflows.</body></html>",
        { status: 200 },
      ),
  });
  try {
    const result = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news"],
      reason: "detail success",
    });
    const hn = outcome(result, "hacker-news");
    assert.equal(hn?.detailSucceeded, 1);
    // Content is now sufficient; the signal must not be killed by INSUFFICIENT_CONTENT
    assert.equal(result.filteringSummary?.filteredReasons.insufficientContent ?? 0, 0);
  } finally {
    restore();
  }
});

test("B2. bounded parallel enrichment attempts all eligible candidates and records a reachable success", async () => {
  const restore = installFetch({
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[' +
          '{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          '"url":"https://example.com/unreachable","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"},' +
          '{"objectID":"2","title":"Launch HN: Mosaic - Agentic Video Editing",' +
          '"url":"https://example.com/reachable","created_at":"2026-08-01T00:00:00Z","points":5,"author":"x"}' +
          "]}",
        { status: 200 },
      ),
    "example.com/unreachable": () => {
      throw new TypeError("canonical unreachable");
    },
    "example.com/reachable": () =>
      new Response(
        "<html><head><title>Mosaic</title><meta name=\"description\" content=\"Mosaic launches an agentic video editing tool.\"/></head>" +
          "<body>Mosaic launches agentic video editing with automated rough cut.</body></html>",
        { status: 200 },
      ),
  });
  try {
    const result = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news"],
      reason: "bounded parallel enrich",
    });
    const hn = outcome(result, "hacker-news");
    // A hung/unreachable canonical must not monopolize the budget; a reachable one still completes.
    assert.equal(hn?.detailAttempted, 2);
    assert.ok((hn?.detailSucceeded ?? 0) >= 1, "reachable candidate must be enriched despite the unreachable one");
  } finally {
    restore();
  }
});