import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanContent, extractClaim } from "../content-processing/index.ts";
import { createResearchPlan } from "../agent/query-planner.ts";
import { toRetrievalPlan } from "../agent/retrieval-plan.ts";
import { enrichDetail, maxDetailFetchesPerRound, shouldEnrichDetail, sourceCapability } from "./fixtures/detail-read.ts";
import { normalizeArxivResults, runResearchPipeline } from "./fixtures/detail-read.ts";
import type { ResearchInput } from "../research/types.ts";

// Fixed reference time: these contract fixtures must remain inside their requested window.
describe("frozen source-enrichment.test.ts", () => {
 beforeEach(t => { if ("mock" in t) t.mock.timers.enable({apis: ["Date"], now: new Date("2026-09-19T12:00:00Z")}); });

const baseInput = (overrides: Partial<ResearchInput> = {}): ResearchInput => ({
  identity: "AI product builder",
  industry: "AI tools",
  focusAreas: "AI tools",
  currentQuestions: "最近有什么新的 AI 工具？",
  knownInformation: "",
  informationGaps: "new product launches",
  trackedEntities: "AI tools",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "7d",
  ...overrides,
});

const arxivFeed = (entries: string[]) => `<feed>${entries.map((entry) => `<entry>${entry}</entry>`).join("")}</feed>`;

const matchingArxivEntry = (overrides = "") => `
  <title>Automated rough cut for multi-asset video editing</title>
  <id>https://arxiv.org/abs/2601.12345</id>
  <summary>A video editing workflow selects shots and creates an automated rough cut from multiple assets.</summary>
  <published>2026-09-01T00:00:00Z</published>
  ${overrides}
`;

const videoRetrievalPlan = {
  queries: ["AI video editing automated rough cut"],
  topicProfile: {
    domainAnchors: ["video editing"],
    taskAnchors: ["automated rough cut", "shot selection"],
    genericTerms: ["ai", "model", "workflow"],
  },
  selectedSourceType: "PRIMARY",
  fallbackSourceTypes: [],
  allowedProviderIds: ["arxiv"],
  reason: "provider normalization fixture",
};

test("normalizeArxivResults admits a valid arXiv result", () => {
  const result = normalizeArxivResults([{
    title: "Automated rough cut for video editing",
    url: "https://arxiv.org/abs/2601.12345",
    snippet: "A method for selecting shots in a video editing workflow.",
    publishedAt: "2026-09-01T00:00:00Z",
  }], "2026-09-19T00:00:00Z");

  assert.equal(result.rawResultCount, 1);
  assert.equal(result.normalizedCandidateCount, 1);
  assert.equal(result.rejectedRawCount, 0);
  assert.deepEqual(result.normalizationRejectionReasons, {});
  assert.equal(result.items[0]?.source, "arXiv");
});

test("normalizeArxivResults reports invalid raw results instead of dropping them silently", () => {
  const result = normalizeArxivResults([
    { url: "https://arxiv.org/abs/2601.1", snippet: "missing title" },
    { title: "Missing URL", snippet: "missing link" },
    { title: "Invalid URL", url: "not-a-url", snippet: "invalid link" },
  ]);

  assert.equal(result.rawResultCount, 3);
  assert.equal(result.normalizedCandidateCount, 0);
  assert.equal(result.rejectedRawCount, 3);
  assert.deepEqual(result.normalizationRejectionReasons, {
    missing_title: 1,
    missing_url: 1,
    invalid_url: 1,
  });
  assert.equal(result.normalizationRejectedSamples.length, 3);
  assert.deepEqual(result.normalizationRejectedSamples.map((sample) => sample.rejectionStage), [
    "normalization",
    "normalization",
    "normalization",
  ]);
  assert.equal(result.normalizationRejectedSamples[0]?.urlPresent, true);
});

test("arXiv fixture exposes normalization failures in the pipeline trace", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    if (new URL(String(target)).hostname === "export.arxiv.org") {
      return new Response(arxivFeed([
        "<summary>entry without title or id</summary>",
        "<title>Entry without a link</title><summary>missing id</summary>",
      ]), { status: 200, headers: { "content-type": "application/atom+xml" } });
    }
    return new Response("", { status: 404 });
  });

  const result = await runResearchPipeline(baseInput({
    industry: "AI video tools",
    focusAreas: "AI video editing",
    currentQuestions: "Which AI video editing tools are worth testing?",
  }), undefined, undefined, videoRetrievalPlan);
  const diagnostics = result.sourceDiagnostics?.find((item) => item.providerId === "arxiv");

  assert.equal(diagnostics?.rawProviderResultCount, 2);
  assert.equal(diagnostics?.normalizedCandidateCount, 0);
  assert.equal(diagnostics?.rejectedRawCount, 2);
  assert.deepEqual(diagnostics?.normalizationRejectionReasons, {
    missing_title: 1,
    missing_url: 1,
  });
  assert.equal(diagnostics?.normalizationRejectedSamples?.length, 2);
  assert.equal(diagnostics?.candidateAdmissionRejectionReasons && Object.keys(diagnostics.candidateAdmissionRejectionReasons).length, 0);
});

test("arXiv normalization and candidate admission remain separate", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    if (new URL(String(target)).hostname === "export.arxiv.org") {
      return new Response(arxivFeed([
        `<title>Medical AI model for endoscopic video observations</title>
         <id>https://arxiv.org/abs/2601.54321</id>
         <summary>A medical imaging model analyzes endoscopic observations.</summary>
         <published>2026-09-01T00:00:00Z</published>`,
      ]), { status: 200, headers: { "content-type": "application/atom+xml" } });
    }
    return new Response("", { status: 404 });
  });

  const result = await runResearchPipeline(baseInput({
    industry: "AI video tools",
    focusAreas: "AI video editing",
    currentQuestions: "Which AI video editing tools are worth testing?",
  }), undefined, undefined, videoRetrievalPlan);
  const diagnostics = result.sourceDiagnostics?.find((item) => item.providerId === "arxiv");

  assert.equal(diagnostics?.rawProviderResultCount, 1);
  assert.equal(diagnostics?.normalizedCandidateCount, 1);
  assert.equal(diagnostics?.rejectedRawCount, 0);
  assert.equal(diagnostics?.admittedCandidateCount, 0);
  assert.deepEqual(diagnostics?.normalizationRejectionReasons, {});
  assert.deepEqual(diagnostics?.candidateAdmissionRejectionReasons, { TOPIC_MISMATCH: 1 });
  assert.equal(diagnostics?.candidateAdmissionRejectedSamples?.[0]?.rejectionStage, "candidate_admission");
  assert.equal(result.signals.length, 0);
});

test("arXiv XML fixture reaches aggregation when normalization and admission pass", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    if (new URL(String(target)).hostname === "export.arxiv.org") {
      return new Response(arxivFeed([matchingArxivEntry()]), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }
    return new Response("", { status: 404 });
  });

  const result = await runResearchPipeline(baseInput({
    industry: "AI video tools",
    focusAreas: "AI video editing",
    currentQuestions: "Which AI video editing tools are worth testing?",
  }), undefined, undefined, videoRetrievalPlan);
  const diagnostics = result.sourceDiagnostics?.find((item) => item.providerId === "arxiv");

  assert.equal(diagnostics?.rawProviderResultCount, 1);
  assert.equal(diagnostics?.normalizedCandidateCount, 1);
  assert.equal(diagnostics?.admittedCandidateCount, 1);
  assert.equal(diagnostics?.candidateAdmissionRejectionReasons && Object.keys(diagnostics.candidateAdmissionRejectionReasons).length, 0);
  assert.ok(result.counts.candidates >= 1);
});

test("P1 controlled E2E admits relevant video editing results and rejects generic neighbors", async (t) => {
  const input = baseInput({
    industry: "AI video tools",
    focusAreas: "AI video editing, automated rough cut, shot selection, multi-asset understanding, batch processing, commercial workflow",
    currentQuestions: "Which new AI video editing tools and workflows are worth testing?",
    informationGaps: "new AI video editing products and workflow updates",
    freshnessWindow: "30d",
  });
  const researchPlan = createResearchPlan(input, 1, 5, [], "INITIAL");
  const retrievalPlan = toRetrievalPlan(researchPlan);
  const entries = [
    `<title>AI-assisted medical endoscopic video observations</title>
     <id>https://arxiv.org/abs/2601.11111</id>
     <summary>A medical AI model studies endoscopic video observations in clinical settings.</summary>
     <published>2026-09-18T00:00:00Z</published>`,
    `<title>Generic multimodal foundation model for observation</title>
     <id>https://arxiv.org/abs/2601.22222</id>
     <summary>A foundation model handles multimodal observations across generic benchmarks.</summary>
     <published>2026-09-17T00:00:00Z</published>`,
    `<title>New AI video editing tool release with automated rough cut</title>
     <id>https://arxiv.org/abs/2601.33333</id>
     <summary>A product update adds automated rough cut generation for an AI video editing workflow and supports testing with creator footage.</summary>
     <published>2026-09-16T00:00:00Z</published>`,
    `<title>Shot selection for multi-asset video editing workflow</title>
     <id>https://arxiv.org/abs/2601.44444</id>
     <summary>This system selects shots across multiple video assets for batch editing workflows and evaluates the resulting edit.</summary>
     <published>2026-09-15T00:00:00Z</published>`,
  ];
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    if (new URL(String(target)).hostname === "export.arxiv.org") {
      return new Response(arxivFeed(entries), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }
    return new Response("", { status: 404 });
  });

  const result = await runResearchPipeline(input, undefined, undefined, {
    ...retrievalPlan,
    selectedSourceType: "PRIMARY",
    fallbackSourceTypes: [],
    allowedProviderIds: ["arxiv"],
    reason: "controlled P1 positive and negative path fixture",
  });
  const diagnostics = result.sourceDiagnostics?.find((item) => item.providerId === "arxiv");
  const rejected = diagnostics?.candidateAdmissionRejectedSamples || [];
  const positiveDetails = result.filteringSummary?.filteringDetails?.filter((detail) =>
    detail.sources.some((source) => /2601\.(33333|44444)/.test(source.sourceUrl)),
  ) || [];

  assert.equal(diagnostics?.rawProviderResultCount, 4);
  assert.equal(diagnostics?.normalizedCandidateCount, 4);
  assert.equal(diagnostics?.rejectedRawCount, 0);
  assert.deepEqual(diagnostics?.candidateAdmissionRejectionReasons, { TOPIC_MISMATCH: 2 });
  assert.equal(Object.values(diagnostics?.candidateAdmissionRejectionReasons || {}).reduce((sum, count) => sum + count, 0), 2);
  assert.equal(diagnostics?.admittedCandidateCount, 2);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((sample) => sample.rejectionReason === "TOPIC_MISMATCH"));
  assert.equal(positiveDetails.length, 2);
  assert.equal(result.evidenceRecords?.length, 2);
  assert.ok(positiveDetails.every((detail) => detail.topicRelevance?.relevanceGateApplied === true));
  assert.ok(positiveDetails.every((detail) => detail.topicRelevance?.relevanceGatePassed === true));
  assert.ok(positiveDetails.every((detail) => (detail.topicRelevance?.matchedDomainAnchors?.length || 0) > 0));
  assert.ok(positiveDetails.every((detail) => (detail.topicRelevance?.matchedTaskAnchors?.length || 0) > 0));
  assert.ok(positiveDetails.every((detail) =>
    detail.topicRelevance?.matchedTaskAnchors?.some((task) => !["ai", "model", "workflow", "video"].includes(task)),
  ));
});

test("discovery sources are marked for detail enrichment while evidence sources are not", () => {
  assert.equal(sourceCapability("product-hunt"), "DISCOVERY");
  assert.equal(sourceCapability("huggingface"), "DISCOVERY");
  assert.equal(sourceCapability("company-registry"), "EVIDENCE");
  assert.equal(maxDetailFetchesPerRound, 5);
  assert.equal(shouldEnrichDetail({
    providerId: "product-hunt",
    title: "Product Hunt signal: Example AI Tool",
    snippet: "Product discovery / startup signal from Product Hunt: Example AI Tool",
    potentialScore: 70,
  }), true);
  assert.equal(shouldEnrichDetail({
    providerId: "company-registry",
    title: "Official changelog announces Example AI Tool",
    snippet: "The official changelog announces Example AI Tool with a detailed body.",
    potentialScore: 70,
  }), false);
});

test("Product Hunt detail enrichment can use the product detail page as rich content", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("producthunt.com/products/neon-video-agent")) {
      return new Response(`
        <html><head>
          <title>Neon Video Agent</title>
          <meta name="description" content="Neon Video Agent launched a browser-based AI video workflow for creators. The product page describes timeline editing, prompt-to-video generation, and export support.">
        </head><body>Neon Video Agent launched a browser-based AI video workflow for creators today.</body></html>
      `);
    }
    return new Response("", { status: 404 });
  });
  const result = await enrichDetail({
    providerId: "product-hunt",
    canonicalId: "product-hunt-/products/neon-video-agent",
    url: "https://www.producthunt.com/products/neon-video-agent",
    title: "Product Hunt signal: Neon Video Agent",
  });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.discoveredBy, "Product Hunt");
  assert.equal(result.evidenceFrom, "Product Hunt detail");
  const cleaned = cleanContent(result.rawContent || "", result.title);
  const claim = extractClaim(cleaned, result.title || "");
  assert.equal(claim.quality, "VALID");
});

test("Hugging Face enrichment reads README content for a candidate", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.endsWith("/raw/main/README.md")) {
      return new Response(`
# Open Video Generator

Open Video Generator released a text-to-video Space for testing short video generation workflows. The README documents model inputs, output formats, and usage limits for creators.
      `);
    }
    return new Response("", { status: 404 });
  });
  const result = await enrichDetail({
    providerId: "huggingface",
    canonicalId: "example/open-video-generator",
    url: "https://huggingface.co/spaces/example/open-video-generator",
    title: "Hugging Face space signal: example/open-video-generator",
  });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.evidenceFrom, "Hugging Face README");
  const cleaned = cleanContent(result.rawContent || "", result.title);
  const claim = extractClaim(cleaned, result.title || "");
  assert.equal(claim.quality, "VALID");
});

test("pipeline detail enrichment improves Product Hunt candidates without creating a fact", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("producthunt.com/search")) {
      return new Response(`<html><body><div class="flex flex-col gap-2"><ul><li><a class=" pr-2 text-sm text-secondary hover:underline" href="/products/neon-canvas/reviews?ref=footer">Neon Canvas</a></li></ul></div></body></html>`);
    }
    if (url.includes("producthunt.com/products/neon-canvas")) {
      return new Response(`
        <html><head>
          <title>Neon Canvas</title>
          <meta name="description" content="Neon Canvas launched a browser-based creative workflow for teams. The product page describes collaborative editing, review, and export support.">
        </head><body>Neon Canvas launched a browser-based creative workflow for teams.</body></html>
      `);
    }
    return new Response("", { status: 404 });
  });
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近有什么新的 AI 视频工具？",
    focusAreas: "AI video tools",
    informationGaps: "new AI video product launches",
    trackedEntities: "AI video tools",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["product-hunt"],
    reason: "test",
  });
  assert.equal(result.filteringSummary?.detailEnrichment?.detailAttempted, 1);
  assert.equal(result.filteringSummary?.detailEnrichment?.detailSucceeded, 1);
  assert.equal(result.filteringSummary?.detailEnrichment?.stillInsufficient, 0);
  assert.equal(result.filteringSummary?.filteredReasons.insufficientContent, 0);
  assert.equal(result.filteringSummary?.strongestHiddenSignal?.signalType, "EARLY_SIGNAL");
  const productHuntDiagnostics = result.sourceDiagnostics?.find((item) => item.providerId === "product-hunt");
  assert.equal(productHuntDiagnostics?.rawProviderResultCount, 1);
  assert.equal(productHuntDiagnostics?.normalizedCandidateCount, 1);
  assert.equal(productHuntDiagnostics?.admittedCandidateCount, 1);
  assert.equal(productHuntDiagnostics?.enrichmentEligibleCount, 1);
  assert.equal(productHuntDiagnostics?.detailAttempted, 1);
  assert.equal(productHuntDiagnostics?.detailSucceeded, 1);
});

test("pipeline detail enrichment improves Hugging Face candidates through README", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("huggingface.co/api/models")) {
      return Response.json([{
        id: "example/open-video-generator",
        lastModified: new Date().toISOString(),
        pipeline_tag: "text-to-video",
        tags: ["video", "space"],
        downloads: 17,
        likes: 3,
      }]);
    }
    if (url.includes("huggingface.co/api/spaces") || url.includes("huggingface.co/api/datasets")) {
      return Response.json([]);
    }
    if (url.endsWith("/raw/main/README.md")) {
      return new Response(`
# Open Video Generator

Open Video Generator released a text-to-video workflow for short video prototyping. The README explains prompt inputs, preview settings, export behavior, and intended creator usage.
      `);
    }
    return new Response("", { status: 404 });
  });
  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近 Hugging Face 有什么值得关注的视频模型？",
    focusAreas: "Hugging Face video model",
    informationGaps: "new model card or README evidence",
    trackedEntities: "Hugging Face",
  }), undefined, undefined, {
    primarySourceType: "PRIMARY",
    fallbackSourceTypes: [],
    allowedProviderIds: ["huggingface"],
    reason: "test",
  });
  assert.equal(result.filteringSummary?.detailEnrichment?.detailAttempted, 1);
  assert.equal(result.filteringSummary?.detailEnrichment?.detailSucceeded, 1);
  assert.equal(result.filteringSummary?.detailEnrichment?.stillInsufficient, 0);
  assert.equal(result.filteringSummary?.filteredReasons.insufficientContent, 0);
  assert.ok(result.filteringSummary?.strongestHiddenSignal);
});

test("Hugging Face retrieval uses topic-specific queries instead of generic variants", async (t) => {
  const searches: string[] = [];
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "huggingface.co" && url.pathname.startsWith("/api/")) {
      searches.push(url.searchParams.get("search") || "");
      return Response.json([]);
    }
    return new Response("", { status: 404 });
  });

  await runResearchPipeline(baseInput({
    industry: "AI video tools",
    focusAreas: "AI assisted video editing, automatic rough cut, shot selection, batch processing",
    currentQuestions: "过去 30 天内有哪些值得测试的 AI 视频剪辑工作流更新？",
    trackedEntities: "",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["huggingface"],
    reason: "query rewrite test",
  });

  assert.equal(searches.length, 3);
  assert.ok(searches.every((query) => /video/i.test(query)));
  assert.ok(searches.some((query) => /rough cut|editing|shot selection/i.test(query)));
  assert.equal(searches.some((query) => query === "video" || query === "text-to-video" || query === "space"), false);
});

test("arXiv fallback query preserves video workflow constraints", async (t) => {
  let searchQuery = "";
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "export.arxiv.org") {
      searchQuery = url.searchParams.get("search_query") || "";
      return new Response("<feed></feed>");
    }
    return new Response("", { status: 404 });
  });

  await runResearchPipeline(baseInput({
    industry: "AI video tools",
    focusAreas: "AI 辅助视频剪辑、自动粗剪、镜头选择",
    currentQuestions: "最近有哪些 AI 视频剪辑工作流论文值得测试？",
    informationGaps: "multi-asset understanding and batch processing",
  }), undefined, undefined, {
    primarySourceType: "PRIMARY",
    fallbackSourceTypes: [],
    allowedProviderIds: ["arxiv"],
    reason: "query rewrite test",
  });

  assert.match(searchQuery, /video/i);
  assert.match(searchQuery, /editing|rough|shot/i);
  assert.doesNotMatch(searchQuery, /最近有哪些.*值得测试/);
});

test("failed external provider responses cancel unread bodies", async (t) => {
  let canceled = 0;
  t.mock.method(globalThis, "fetch", async () =>
    new Response(new ReadableStream({
      cancel() {
        canceled += 1;
      },
    }), { status: 500 }),
  );

  const result = await runResearchPipeline(baseInput({
    currentQuestions: "最近有什么新的 AI 视频工具？",
    focusAreas: "AI video tools",
    trackedEntities: "AI video tools",
  }), undefined, undefined, {
    primarySourceType: "GENERAL_WEB",
    fallbackSourceTypes: [],
    allowedProviderIds: ["product-hunt"],
    reason: "test",
  });

  assert.equal(result.status.some((outcome) => outcome.name === "Product Hunt" && outcome.state === "failed"), true);
  // Product Hunt's 500 body must be cancelled (not leaked). Empty discovery may
  // also spawn the technical fallback providers (arXiv/GitHub/official/company),
  // each of which also cancels its unread failed body, so the invariant is "at
  // least the failing provider's body was cancelled", not "exactly one".
  assert.ok(canceled >= 1);
});

});
