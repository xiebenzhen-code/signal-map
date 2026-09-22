import assert from "node:assert/strict";
import test from "node:test";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput, ResearchResponse } from "../research/types.ts";

function coverageInput(): ResearchInput {
  return {
    identity: "AI product builder",
    industry: "AI 视频与创作者工具",
    focusAreas: "AI video editing, video automation",
    currentQuestions: "最近 30 天内哪些 AI 视频剪辑工具发布了？",
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

test("Reliability TRUE POSITIVE: an independent primary corroboration raises a discovery out of LOW_RELIABILITY", async () => {
  const restore = installFetch({
    // Social discovery (HN), fresh, topically relevant, carrying a canonical product page.
    "hn.algolia.com": () =>
      new Response(
        '{"hits":[{"objectID":"1","title":"Show HN: Palmier Pro - Open-source macOS video editor built for AI",' +
          '"url":"https://example.com/palmier-pro","created_at":"2026-09-15T00:00:00Z","points":5,"author":"x"}]}',
        { status: 200 },
      ),
    // Canonical product page: body-level event fact -> content VALID + claim VALID.
    "example.com": () =>
      new Response(
        "<html><head><title>Palmier Pro</title><meta name=\"description\" content=\"Palmier Pro launches an open-source AI video editor for macOS with automated rough cut and shot selection.\"/></head>" +
          "<body>Palmier Pro launches as an open-source AI video editor for macOS. It automates rough cut and shot selection for multi-asset workflows.</body></html>",
        { status: 200 },
      ),
    // Independent technical PRIMARY source corroborating the same event (related terms).
    "export.arxiv.org": () =>
      new Response(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>feed</id>' +
          '<updated>2026-09-10T00:00:00Z</updated><entry><id>http://arxiv.org/abs/2609.01234</id>' +
          '<title>Palmier Pro launches open-source AI video editing with automated rough cut</title>' +
          '<link href="http://arxiv.org/abs/2609.01234"/><published>2026-09-10T00:00:00Z</published>' +
          '<summary>Study of AI video editing workflow with automated rough cut and shot selection.</summary></entry></feed>',
        { status: 200 },
      ),
  });
  try {
    const result: ResearchResponse = await runResearchPipeline(coverageInput(), undefined, undefined, {
      primarySourceType: "OFFICIAL",
      fallbackSourceTypes: [],
      allowedProviderIds: ["hacker-news", "arxiv"],
      reason: "reliability true positive",
    });

    // The discovery + independent primary cluster is verified (not unverified).
    const signals = result.signals || [];
    assert.ok(signals.length >= 1, "a mixed discovery+primary cluster must form a signal");
    const signal = signals[0];
    assert.notEqual(signal.verificationStatus, "unverified");
    assert.equal(signal.verificationStatus, "verified");
    assert.ok(signal.reliabilityScore >= 55, `reliability must clear threshold, got ${signal.reliabilityScore}`);

    // Reliability / Verification must NOT reject the cluster.
    const rejection = (result.evidenceAccounting?.rejectionReasons ?? {}) as Record<string, number>;
    assert.equal(rejection.lowReliability ?? 0, 0);
    assert.equal(rejection.insufficientVerification ?? 0, 0);

    // Two independent-source records are carried (primary verification + social discovery).
    const records = result.evidenceRecords ?? [];
    assert.ok(records.some((record) => record.sourceType === "primary" && record.sourceRole === "verification"));
    assert.ok(records.some((record) => record.sourceType === "social" && record.sourceRole === "discovery"));
  } finally {
    restore();
  }
});