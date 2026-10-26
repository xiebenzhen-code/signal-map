import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalCluster, sourceRoleForEvidence } from "../signal-fusion/cluster.ts";
import { fuseSignal } from "../signal-fusion/fusion.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import { buildFilteringSummary } from "../research/filtering-summary.ts";
import type { FusionEvidence } from "../signal-fusion/types.ts";
import type { ResearchInput, ResearchSignal } from "../research/types.ts";

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

test("Product Hunt is treated as an early signal source", () => {
  const evidence = baseEvidence({
    sourceUrl: "https://www.producthunt.com/products/example-ai-video-tool",
    publisher: "Product Hunt",
    sourceType: "social",
    sourceTier: "C",
    verificationStatus: "unverified",
    reliabilityScore: 45,
  });
  assert.equal(sourceRoleForEvidence(evidence), "EARLY_SIGNAL");
  assert.equal(fuseSignal([evidence]).signalType, "EARLY_SIGNAL");
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
      return new Response(`<rss><channel><item><title>Claude Code released a new planning feature</title><link>https://blog.example.com/claude-code-planning</link><description>Independent Blog reports that Claude Code released a new planning feature for AI developer tools today. The update adds plan review steps and cites the product changelog as supporting evidence.</description><source url="https://blog.example.com">Independent Blog</source><pubDate>${published}</pubDate></item></channel></rss>`);
    }
    if (url.includes("api.github.com")) return Response.json({ message: "not found" }, { status: 404 });
    return new Response("<feed></feed>");
  });
  const input: ResearchInput = {
    identity: "AI product builder",
    industry: "AI developer tools",
    focusAreas: "Claude Code",
    // Keep this a positive fusion test with an explicit, matched task. The old
    // long task was UNCERTAIN and must now stay in possibleRelated (N4).
    currentQuestions: "planning feature",
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
  assert.equal(result.signals[0].topicRelevance?.decision, "MATCH");
  assert.equal(typeof result.signals[0].signalType, "string");
  assert.ok(result.signals[0].signalCluster);
  assert.equal(result.signals[0].independentEvidenceCount >= 1, true);
});

test("original long task stays in possibleRelated and never becomes a formal signal", async (t) => {
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
      return new Response(`<rss><channel><item><title>Claude Code released a new planning feature</title><link>https://blog.example.com/claude-code-planning</link><description>Independent Blog reports that Claude Code released a new planning feature for AI developer tools today. The update adds plan review steps and cites the product changelog as supporting evidence.</description><source url="https://blog.example.com">Independent Blog</source><pubDate>${published}</pubDate></item></channel></rss>`);
    }
    if (url.includes("api.github.com")) return Response.json({ message: "not found" }, { status: 404 });
    return new Response("<feed></feed>");
  });
  // Verbatim original input of the fusion test above, before it was narrowed to
  // "planning feature" for N4. This is the regression guard: the long task must
  // stay a possible lead, not disappear and not become a confirmed conclusion.
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
  const possible = result.filteringSummary?.possibleRelated ?? [];
  assert.equal(result.signals.length, 0);
  assert.equal(possible.length, 1);
  assert.equal(possible[0].reason, "UNCERTAIN_TASK_CONSTRAINT");
  assert.match(possible[0].title, /planning feature/i);
  assert.equal(
    result.filteringSummary?.uncertainCount,
    possible.length,
  );
});

test("Product Hunt adapter enters the pipeline but does not create a standalone FACT", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("producthunt.com")) {
      return new Response(`<html><body><a href="/products/neon-video-agent">Neon Video Agent</a></body></html>`);
    }
    return new Response("", { status: 404 });
  });
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近有什么新的 AI 视频工具？",
    focusAreas: "AI video tools",
    informationGaps: "new product discovery",
    trackedEntities: "AI video tools",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["product-hunt"],
    reason: "test",
  });
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "product-hunt" && outcome.executed && outcome.resultCount > 0), true);
  assert.equal(result.filteringSummary?.retrievedCount, 1);
  const signalType = result.signals[0]?.signalType ?? result.filteringSummary?.strongestHiddenSignal?.signalType;
  assert.equal(signalType, "EARLY_SIGNAL");
});

test("Hugging Face native adapter retrieves models, spaces, and datasets", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.pathname === "/api/models") {
      return Response.json([{ id: "video/model-a", author: "video", lastModified: new Date().toISOString(), pipeline_tag: "text-to-video", tags: ["video"], downloads: 120, likes: 8 }]);
    }
    if (url.pathname === "/api/spaces") {
      return Response.json([{ id: "video/space-a", author: "video", lastModified: new Date().toISOString(), tags: ["video"], likes: 5 }]);
    }
    if (url.pathname === "/api/datasets") {
      return Response.json([{ id: "video/dataset-a", author: "video", lastModified: new Date().toISOString(), tags: ["video"], downloads: 50 }]);
    }
    return new Response("", { status: 404 });
  });
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近 Hugging Face 有什么值得关注的视频模型或 Space？",
    focusAreas: "Hugging Face video model Space",
    informationGaps: "native Hugging Face activity",
    trackedEntities: "Hugging Face",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["huggingface"],
    reason: "test",
  });
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "huggingface" && outcome.executed && outcome.resultCount >= 3), true);
  assert.equal(result.filteringSummary?.retrievedCount, 3);
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "arxiv" && outcome.executed), false);
});

test("Company Source Registry executes official company sources before general web", async (t) => {
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    fetched.push(url);
    if (url.includes("docs.anthropic.com") || url.includes("anthropic.com")) {
      return new Response(`<html><head><title>Claude Code changelog</title><meta property="article:published_time" content="${new Date().toISOString()}"></head><body>Claude Code release notes and product updates</body></html>`);
    }
    return new Response("", { status: 404 });
  });
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "Claude Code 最近有什么变化？",
    focusAreas: "Claude Code",
    informationGaps: "official changelog",
    trackedEntities: "Claude Code, Anthropic",
  }), undefined, undefined, {
    primarySourceType: "OFFICIAL",
    fallbackSourceTypes: ["GENERAL_WEB"],
    allowedProviderIds: ["company-registry"],
    reason: "test",
  });
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "company-registry" && outcome.executed), true);
  assert.equal(result.sourceOutcomes?.some((outcome) => outcome.providerId === "primary-web-search" && outcome.executed), false);
  assert.equal(fetched.some((url) => url.includes("news.google.com")), false);
});

const baseSignal = (overrides: Partial<ResearchSignal> = {}): ResearchSignal => ({
  id: overrides.id ?? "signal-1",
  category: "匹配",
  channel: overrides.channel ?? "混合",
  title: overrides.title ?? "Signal",
  summary: overrides.summary ?? "Signal summary",
  time: overrides.time ?? "1小时前",
  truth: overrides.truth ?? 70,
  baseUseful: overrides.baseUseful ?? 60,
  lead: overrides.lead ?? 60,
  tags: overrides.tags ?? [],
  action: overrides.action ?? "review",
  why: overrides.why ?? "why",
  official: overrides.official ?? [],
  social: overrides.social ?? [],
  sourceType: overrides.sourceType ?? "industry_media",
  sourceTier: overrides.sourceTier ?? "B",
  sourceUrl: overrides.sourceUrl ?? "https://example.com/signal",
  publisher: overrides.publisher ?? "Example",
  publishedAt: overrides.publishedAt ?? new Date().toISOString(),
  firstSeenAt: overrides.firstSeenAt ?? new Date().toISOString(),
  retrievedAt: overrides.retrievedAt ?? new Date().toISOString(),
  timestampStatus: overrides.timestampStatus ?? "valid",
  dataOrigin: "live",
  confidence: overrides.confidence ?? 0.7,
  verificationStatus: overrides.verificationStatus ?? "verified",
  relevanceScore: overrides.relevanceScore ?? 75,
  reliabilityScore: overrides.reliabilityScore ?? 75,
  freshnessScore: overrides.freshnessScore ?? 75,
  noveltyScore: overrides.noveltyScore ?? 75,
  judgementImpactScore: overrides.judgementImpactScore ?? 60,
  gapMatchScore: overrides.gapMatchScore ?? 60,
  overallScore: overrides.overallScore ?? 70,
  sourceCount: overrides.sourceCount ?? 1,
  independentEvidenceCount: overrides.independentEvidenceCount ?? 1,
  propagationCount: overrides.propagationCount ?? 1,
  signalType: overrides.signalType ?? "FACT",
  duplicateRatio: overrides.duplicateRatio,
  confirmationGain: overrides.confirmationGain ?? true,
  claims: overrides.claims ?? [],
  sources: overrides.sources ?? [],
  section: overrides.section ?? "all",
  gapMatches: overrides.gapMatches ?? [],
  questionMatches: overrides.questionMatches ?? [],
  entityMatches: overrides.entityMatches ?? [],
  whyItMatters: overrides.whyItMatters ?? "matters",
  eventStatus: overrides.eventStatus ?? "NEW",
  informationType: overrides.informationType ?? "FACT",
  knowledgeStatus: overrides.knowledgeStatus ?? "NOVEL",
  attentionDecision: overrides.attentionDecision ?? "LIBRARY_ONLY",
});

test("FilteringSummary explains zero-result filtering and strongest hidden early signal", () => {
  const summary = buildFilteringSummary({
    retrievedCount: 12,
    clusteredCount: 3,
    allSignals: [
      baseSignal({
        id: "hidden-social",
        signalType: "EARLY_SIGNAL",
        informationType: "SIGNAL",
        reliabilityScore: 35,
        verificationStatus: "unverified",
        independentEvidenceCount: 1,
        overallScore: 68,
        sources: [{ publisher: "Example", sourceUrl: "https://example.com/social", sourceType: "social", sourceTier: "C" }],
      }),
      baseSignal({ id: "stale", timestampStatus: "missing", freshnessScore: 0, overallScore: 20 }),
    ],
    displayedSignals: [],
  });
  assert.equal(summary.retrievedCount, 12);
  assert.equal(summary.displayedCount, 0);
  assert.equal(summary.filteredReasons.lowReliability, 1);
  assert.equal(summary.filteredReasons.stale, 1);
  assert.equal(summary.strongestHiddenSignal?.signalType, "EARLY_SIGNAL");
  assert.match(summary.summaryText, /检索到 12 条信息/);
  assert.equal(summary.filteringDetails?.length, 2);
  assert.equal(summary.filteringDetails?.[0]?.decision, "filtered");
  assert.equal(summary.filteringDetails?.[0]?.reason, "LOW_RELIABILITY");
  assert.equal(summary.filteringDetails?.[0]?.sources.length, 1);
});

test("insufficient content cannot be displayed as a normal signal", async (t) => {
  const published = new Date().toUTCString();
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <rss><channel><item>
      <title>OpenAI News | OpenAI</title>
      <link>https://example.com/template</link>
      <description>Newsroom Related Recommended Login Sign up Privacy Terms</description>
      <source url="https://example.com">Example</source>
      <pubDate>${published}</pubDate>
    </item></channel></rss>
  `));
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近 OpenAI 有什么值得关注的更新？",
    focusAreas: "OpenAI",
    informationGaps: "official update",
    trackedEntities: "OpenAI",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["public-web"],
    reason: "test",
  });
  assert.equal(result.signals.some((signal) => signal.contentQuality === "INSUFFICIENT_CONTENT"), false);
  assert.equal((result.filteringSummary?.filteredReasons.insufficientContent ?? 0) > 0, true);
});

test("FilteringSummary reports duplicate, low verification, and non-zero displayed counts without chain-of-thought", () => {
  const visible = baseSignal({ id: "visible" });
  const summary = buildFilteringSummary({
    retrievedCount: 4,
    clusteredCount: 3,
    allSignals: [
      visible,
      baseSignal({ id: "known", knowledgeStatus: "KNOWN" }),
      baseSignal({ id: "unverified", verificationStatus: "unverified", reliabilityScore: 70 }),
      baseSignal({ id: "conflict", verificationStatus: "conflicting", signalType: "CONFLICT" }),
    ],
    displayedSignals: [visible],
  });
  assert.equal(summary.displayedCount, 1);
  assert.equal(summary.filteredReasons.duplicate, 1);
  assert.equal(summary.filteredReasons.insufficientVerification, 1);
  assert.equal(summary.filteredReasons.unresolvedConflict, 1);
  assert.doesNotMatch(JSON.stringify(summary), /chain[- ]?of[- ]?thought|internal thought/i);
});

const baseInput = (overrides: Partial<ResearchInput> = {}): ResearchInput => ({
  identity: "AI product builder",
  industry: "AI developer tools",
  focusAreas: "AI tools",
  currentQuestions: "AI tools updates",
  knownInformation: "",
  informationGaps: "new evidence",
  trackedEntities: "AI tools",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "7d",
  ...overrides,
});
