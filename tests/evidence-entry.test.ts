import assert from "node:assert/strict";
import test from "node:test";

import { runResearchPipeline } from "../research/research-pipeline.ts";
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

test("Evidence Entry: a fresh, claim-valid candidate reaches Evidence evaluation", async () => {
  // Relative, not a fixed calendar date: the fixture must stay inside the 30-day
  // window the test declares, otherwise it silently starts testing a stale-record
  // path and the assertion about the Evidence gate becomes meaningless.
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  const restore = installFetch({
    // Fresh (within the 30-day window) + topically relevant + carries a canonical URL.
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          `"url":"https://example.com/palmier-pro","created_at":"${threeDaysAgo}","points":5,"author":"x"}]}`,
        { status: 200 },
      ),
    // Canonical body carries a body-level event fact ("launches") so the claim is VALID.
    "example.com": () =>
      new Response(
        "<html><head><title>Palmier Pro</title><meta name=\"description\" content=\"Palmier Pro launches an open-source AI video editor for macOS with automated rough cut and shot selection.\"/></head>" +
          "<body>Palmier Pro launches as an open-source AI video editor for macOS. It automates rough cut and shot selection for multi-asset workflows.</body></html>",
        { status: 200 },
      ),
  });
  try {
    const result: ResearchResponse = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "GENERAL_WEB",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news"],
      reason: "evidence entry trace",
    });

    // A candidate that passes content + claim + freshness must enter Evidence evaluation.
    const accounting = result.evidenceAccounting;
    assert.ok(accounting, "evidence accounting present");
    assert.ok((result.evidenceRecords?.length ?? 0) >= 1, "evidence record constructed (entry achieved)");
    assert.ok((accounting.evaluatedEvidenceCount ?? 0) >= 1, "evidence entered evaluation");

    // The candidate is a single, unverified HN social source, so it is expected to be
    // rejected at the Evidence Quality gate by reliability — not at an earlier stage.
    const rejection = accounting.rejectionReasons;
    assert.equal(rejection?.insufficientContent, 0);
    assert.equal(rejection?.stale, 0);
    assert.ok(
      (rejection?.lowReliability ?? 0) >= 1 || (rejection?.insufficientVerification ?? 0) >= 1,
      "qualified evidence reaches a Reliability/Verification decision, not an earlier gate",
    );
  } finally {
    restore();
  }
});