import test from "node:test";
import assert from "node:assert/strict";
import { cleanContent, extractClaim } from "../content-processing/index.ts";
import { enrichDetail, maxDetailFetchesPerRound, shouldEnrichDetail, sourceCapability } from "../source-enrichment/index.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput } from "../research/types.ts";

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
  assert.equal(canceled, 1);
});
