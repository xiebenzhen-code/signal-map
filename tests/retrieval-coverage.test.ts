import assert from "node:assert/strict";
import test from "node:test";

import { planQuery } from "../research/query-planner.ts";
import { providerQuery, runResearchPipeline } from "../research/research-pipeline.ts";
import type { SourceExecutionOutcome } from "../research/source-coverage.ts";
import type { ResearchInput, ResearchResponse } from "../research/types.ts";

const LONG_AI_VIDEO_QUERY =
  "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？" +
  "重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。" +
  "优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。";

const GENERAL_WEB_PROVIDERS = ["public-web", "product-hunt", "hacker-news", "huggingface"];

function coverageInput(): ResearchInput {
  return {
    identity: "AI product builder",
    industry: "AI 视频与创作者工具",
    focusAreas: "AI video editing, video automation",
    currentQuestions: LONG_AI_VIDEO_QUERY,
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
  if (url.includes("news.google.com")) {
    return new Response("<rss><channel></channel></rss>", { status: 200 });
  }
  if (url.includes("hn.algolia.com")) return new Response('{"hits":[]}', { status: 200 });
  if (url.includes("huggingface.co")) return new Response("[]", { status: 200 });
  if (url.includes("export.arxiv.org")) {
    return new Response(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><updated>2026-09-01T00:00:00Z</updated></feed>',
      { status: 200 },
    );
  }
  return new Response("", { status: 200 });
}

type FetchOverride = (url: string) => Response;

function installProviderFetch(overrides: Record<string, FetchOverride>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, handler] of Object.entries(overrides)) {
      if (url.includes(needle)) return handler(url);
    }
    return emptyResponse(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function outcomeOf(result: ResearchResponse, source: string): SourceExecutionOutcome {
  const outcome = result.coverage.outcomes.find((entry) => entry.source === source);
  assert.ok(outcome, `expected a coverage outcome for ${source}`);
  return outcome;
}

function run(input: ResearchInput, allowedProviderIds: string[]) {
  return runResearchPipeline(input, undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds,
    reason: "retrieval coverage regression",
  });
}

test("A. General Web primary engine failure falls back to the secondary broad engine", async () => {
  const restore = installProviderFetch({
    "news.google.com": () => {
      throw new TypeError("fetch failed: news.google.com unreachable");
    },
    "html.duckduckgo.com": () =>
      new Response(
        '<html><body><a class="result__a" href="https://example.com/ai-video-tool-release">AI video editing tool release</a></body></html>',
        { status: 200 },
      ),
  });
  try {
    const result = await run(coverageInput(), GENERAL_WEB_PROVIDERS);
    const general = outcomeOf(result, "General Web");
    assert.notEqual(general.execution, "failed");
    assert.equal(general.engine, "duckduckgo");
    assert.equal(general.fallbackAttempted, true);
    assert.ok(result.overview.scanned > 0, "raw scanned must survive a primary engine outage");
  } finally {
    restore();
  }
});

test("B. Hacker News and Hugging Face receive short topic queries, not the full prompt", () => {
  const plan = planQuery(coverageInput());
  const longCombination =
    "AI video editing automated rough cut multi-asset understanding shot selection " +
    "open roles careers apply posted last 30d company careers application";
  for (const providerId of ["hacker-news", "huggingface"] as const) {
    const query = providerQuery(plan, providerId, longCombination);
    assert.ok(query.length > 0, `${providerId} query must not be empty`);
    assert.ok(query.split(/\s+/).length <= 8, `${providerId} query too long: ${query}`);
    assert.ok(query.length < 90, `${providerId} query too long: ${query}`);
    assert.equal(query.includes("过去 30 天内"), false);
    assert.equal(query.includes("重点关注"), false);
    assert.equal(query.includes(longCombination), false);
  }
});

test("C. empty primary discovery executes the gated technical fallback sources", async () => {
  const restore = installProviderFetch({
    "export.arxiv.org": () =>
      new Response(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>feed</id>' +
          '<updated>2026-09-01T00:00:00Z</updated><entry><id>http://arxiv.org/abs/2609.01234</id>' +
          '<title>Automated rough cut and multi-asset understanding for AI video editing</title>' +
          '<link href="http://arxiv.org/abs/2609.01234"/><published>2026-09-01T00:00:00Z</published>' +
          '<summary>AI video editing automation with shot selection and rough cut tooling.</summary></entry></feed>',
        { status: 200 },
      ),
    "api.github.com": () => new Response("", { status: 404 }),
  });
  try {
    const result = await run(coverageInput(), GENERAL_WEB_PROVIDERS);
    const arxiv = outcomeOf(result, "arXiv");
    assert.notEqual(arxiv.execution, "not_searched");
    assert.equal(arxiv.searched, true);
    assert.ok((arxiv.rawResultCount ?? 0) >= 1, "arXiv raw results must be attempted via fallback");
    assert.ok(result.overview.scanned > 0, "technical fallback must contribute scanned raw results");
  } finally {
    restore();
  }
});

test("D. non-empty primary discovery does not open the technical fallback", async () => {
  const restore = installProviderFetch({
    "producthunt.com": () =>
      new Response('<html><body><a href="/products/ai-video-tool">Ai video tool</a></body></html>', { status: 200 }),
  });
  try {
    const result = await run(coverageInput(), GENERAL_WEB_PROVIDERS);
    const arxiv = outcomeOf(result, "arXiv");
    assert.equal(arxiv.execution, "not_searched");
    assert.equal(arxiv.searched, false);
  } finally {
    restore();
  }
});

test("E. Product Hunt 403 fails softly with a forbidden code and the pipeline continues", async () => {
  const restore = installProviderFetch({
    "producthunt.com": () => new Response("", { status: 403 }),
    "huggingface.co": () =>
      new Response(
        JSON.stringify([{ id: "org/ai-video-model", lastModified: "2026-09-01T00:00:00Z", pipeline_tag: "text-to-video" }]),
        { status: 200 },
      ),
  });
  try {
    const result = await run(coverageInput(), GENERAL_WEB_PROVIDERS);
    const ph = outcomeOf(result, "Product Hunt");
    assert.equal(ph.execution, "failed");
    assert.equal(ph.failureCode, "forbidden");
    const hf = outcomeOf(result, "Hugging Face");
    assert.equal(hf.searched, true);
    assert.ok(Array.isArray(result.signals), "pipeline must still return signals");
  } finally {
    restore();
  }
});

test("F. candidate admission still rejects off-topic raw results", async () => {
  const restore = installProviderFetch({
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"why cats sleep 20 hours a day","url":"https://example.com/cats",' +
          '"created_at":"2026-09-15T00:00:00Z","points":5,"author":"x"}]}',
        { status: 200 },
      ),
  });
  try {
    const result = await run(coverageInput(), ["hacker-news"]);
    const hn = outcomeOf(result, "Hacker News");
    assert.ok(
      (hn.candidateAdmissionRejectionReasons?.TOPIC_MISMATCH ?? 0) >= 1,
      "off-topic raw must still be rejected by candidate admission",
    );
    assert.equal(result.signals.length, 0);
  } finally {
    restore();
  }
});
