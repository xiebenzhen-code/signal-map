import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalCluster } from "../signal-fusion/cluster.ts";
import { fuseSignal } from "../signal-fusion/fusion.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { FusionEvidence } from "../signal-fusion/types.ts";
import type { ResearchInput } from "../research/types.ts";

const baseEvidence = (overrides: Partial<FusionEvidence> = {}): FusionEvidence => ({
  evidenceId: overrides.evidenceId ?? "e1",
  entity: "Claude Code",
  topic: "product update",
  claim: "Claude Code released a new planning feature",
  sourceUrl: overrides.sourceUrl ?? "https://docs.anthropic.com/claude-code/changelog",
  publisher: overrides.publisher ?? "Anthropic Docs",
  publishedAt: overrides.publishedAt ?? "2026-09-08T00:00:00.000Z",
  sourceType: overrides.sourceType ?? "primary",
  sourceTier: overrides.sourceTier ?? "S",
  verificationStatus: overrides.verificationStatus ?? "verified",
  reliabilityScore: overrides.reliabilityScore ?? 90,
  noveltyScore: overrides.noveltyScore ?? 80,
  upstreamSource: overrides.upstreamSource,
});

test("duplicate media URLs do not inflate independent source count", () => {
  const cluster = buildSignalCluster([
    baseEvidence({ evidenceId: "e1", sourceUrl: "https://news.example.com/a", publisher: "Example News", sourceType: "industry_media", sourceTier: "B", upstreamSource: "wire-a" }),
    baseEvidence({ evidenceId: "e2", sourceUrl: "https://news.example.com/b", publisher: "Example News", sourceType: "industry_media", sourceTier: "B", upstreamSource: "wire-a" }),
    baseEvidence({ evidenceId: "e3", sourceUrl: "https://another.example.com/c", publisher: "Another News", sourceType: "industry_media", sourceTier: "B", upstreamSource: "wire-a" }),
  ]);
  assert.equal(cluster.independentSourceCount, 1);
  assert.equal(cluster.duplicateCount, 2);
});

test("primary verified evidence can be classified as FACT", () => {
  const result = fuseSignal([baseEvidence()]);
  assert.equal(result.signalType, "FACT");
  assert.deepEqual(result.primaryEvidenceIds, ["e1"]);
});

test("single social signal remains EARLY_SIGNAL", () => {
  const result = fuseSignal([
    baseEvidence({ sourceUrl: "https://reddit.com/r/ai/comments/1", publisher: "Reddit", sourceType: "social", sourceTier: "C", verificationStatus: "unverified", reliabilityScore: 35 }),
  ]);
  assert.equal(result.signalType, "EARLY_SIGNAL");
});

test("multi-role repeated independent evidence can be TREND", () => {
  const result = fuseSignal([
    baseEvidence({ evidenceId: "e1", sourceUrl: "https://docs.vendor.com/changelog", publisher: "Vendor Docs", publishedAt: "2026-09-05T00:00:00.000Z" }),
    baseEvidence({ evidenceId: "e2", sourceUrl: "https://reuters.com/a", publisher: "Reuters", sourceType: "trusted_media", sourceTier: "A", publishedAt: "2026-09-07T00:00:00.000Z", reliabilityScore: 78 }),
    baseEvidence({ evidenceId: "e3", sourceUrl: "https://news.ycombinator.com/item?id=1", publisher: "Hacker News", sourceType: "social", sourceTier: "C", publishedAt: "2026-09-08T00:00:00.000Z", reliabilityScore: 58 }),
  ]);
  assert.equal(result.signalType, "TREND");
  assert.equal(result.independentSourceCount, 3);
  assert.equal(result.sourceRoleDiversity >= 2, true);
});

test("conflicting evidence keeps CONFLICT instead of choosing a side", () => {
  const result = fuseSignal([
    baseEvidence({ evidenceId: "e1", claim: "Model X is available", verificationStatus: "conflicting" }),
    baseEvidence({ evidenceId: "e2", claim: "Model X is not available", sourceUrl: "https://official.example.com/deny", verificationStatus: "conflicting" }),
  ]);
  assert.equal(result.signalType, "CONFLICT");
  assert.equal(result.cluster.conflictState, "conflicting");
});

test("same source duplicate with no independent value is NOISE", () => {
  const result = fuseSignal([
    baseEvidence({ evidenceId: "e1", sourceUrl: "https://same.example/a", publisher: "Same Source", sourceType: "industry_media", sourceTier: "B", upstreamSource: "same-wire" }),
    baseEvidence({ evidenceId: "e2", sourceUrl: "https://same.example/b", publisher: "Same Source", sourceType: "industry_media", sourceTier: "B", upstreamSource: "same-wire" }),
  ]);
  assert.equal(result.signalType, "NOISE");
  assert.equal(result.confirmationGain, false);
});

test("pipeline output carries fusion context and direct provider candidates", async (t) => {
  const published = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("hn.algolia.com")) {
      return Response.json({ hits: [{
        objectID: "42",
        title: "Claude Code released a new planning feature",
        url: "https://news.ycombinator.com/item?id=42",
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        points: 25,
        author: "tester",
      }] });
    }
    if (url.includes("news.google.com")) {
      return new Response(`<rss><channel><item><title>Claude Code released a new planning feature</title><link>https://blog.example.com/claude-code-planning</link><description>Claude Code new planning feature update for AI developer tools</description><source url="https://blog.example.com">Independent Blog</source><pubDate>${published}</pubDate></item></channel></rss>`);
    }
    if (url.includes("api.github.com")) return Response.json({ message: "not found" }, { status: 404 });
    return new Response("<feed></feed>");
  });
  const input: ResearchInput = {
    identity: "AI product builder",
    industry: "AI developer tools",
    focusAreas: "Claude Code",
    currentQuestions: "Claude Code planning feature update",
    knownInformation: "",
    informationGaps: "new planning feature",
    trackedEntities: "Claude Code",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "7d",
  };
  const result = await runResearchPipeline(input, undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["public-web", "hacker-news"],
    reason: "test",
  });
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "hacker-news" && outcome.executed), true);
  assert.equal(result.signals.length > 0, true);
  assert.equal(typeof result.signals[0].signalType, "string");
  assert.ok(result.signals[0].signalCluster);
  assert.equal(result.signals[0].independentEvidenceCount >= 1, true);
});
