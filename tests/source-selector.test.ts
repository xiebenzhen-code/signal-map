import test from "node:test";
import assert from "node:assert/strict";
import { selectSource } from "../agent/source-selector.ts";
import type { SourceCapability, SourceOutcome } from "../agent/types.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";

const capability = (type: SourceCapability["type"], available = true): SourceCapability => ({
  type,
  available,
  supportsFreshness: true,
  supportsPrimaryDocuments: type === "OFFICIAL" || type === "PRIMARY",
  supportsDomainFilter: true,
  supportsTimeFilter: true,
});

test("strategy maps to the expected primary source", () => {
  assert.equal(selectSource({ strategy: "INITIAL" }).primarySourceType, "GENERAL_WEB");
  assert.equal(selectSource({ strategy: "ESCALATE_SOURCE" }).primarySourceType, "OFFICIAL");
  assert.equal(selectSource({ strategy: "VERIFY_CONFLICT" }).primarySourceType, "PRIMARY");
  assert.equal(selectSource({ strategy: "REFRESH" }).primarySourceType, "OFFICIAL");
  assert.equal(selectSource({ strategy: "BROADEN" }).primarySourceType, "INDEPENDENT_MEDIA");
});

test("selection exposes provider bindings instead of query intent only", () => {
  const selection = selectSource({ strategy: "ESCALATE_SOURCE" });
  assert.deepEqual(selection.allowedProviderIds, ["company-registry", "official-update-pages", "github-releases", "registered-feeds"]);
});

test("broad product update without entity starts with discovery sources instead of official-only", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [],
  });

  assert.equal(selection.discoveryMode, true);
  assert.notEqual(selection.primarySourceType, "OFFICIAL");
  assert.equal(selection.primarySourceType, "GENERAL_WEB");
  assert.ok(selection.allowedProviderIds.some((providerId) =>
    ["public-web", "product-hunt", "hacker-news", "huggingface"].includes(providerId),
  ));
  assert.ok(selection.verificationSourceTypes?.includes("OFFICIAL"));
});

test("explicit product update entity can still prefer official verification sources", () => {
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [{ canonicalEntity: "Runway", aliasesConsidered: ["Runway"] }],
  });

  assert.equal(selection.discoveryMode, false);
  assert.equal(selection.primarySourceType, "OFFICIAL");
  assert.deepEqual(selection.allowedProviderIds, ["company-registry", "official-update-pages", "github-releases", "registered-feeds"]);
});

test("discovered entity can route into official or primary verification", () => {
  const selection = selectSource({
    strategy: "ESCALATE_SOURCE",
    sourceProfile: sourceProfileForIntent("PRODUCT_UPDATE"),
    resolvedEntities: [{ canonicalEntity: "Runway", aliasesConsidered: ["Runway"] }],
  });

  assert.equal(selection.discoveryMode, false);
  assert.ok(["OFFICIAL", "PRIMARY"].includes(selection.primarySourceType ?? ""));
  assert.equal(selection.allowedProviderIds.length > 0, true);
});

test("unavailable preferred source falls back without selecting it", () => {
  const selection = selectSource({
    strategy: "VERIFY_CONFLICT",
    availableSourceCapabilities: [capability("PRIMARY", false), capability("OFFICIAL"), capability("INDEPENDENT_MEDIA")],
  });
  assert.equal(selection.primarySourceType, "OFFICIAL");
  assert.equal(selection.fallbackSourceTypes.includes("PRIMARY"), false);
});

test("memory and social are not selected as conflict confirmation sources", () => {
  const selection = selectSource({
    strategy: "VERIFY_CONFLICT",
    availableSourceCapabilities: [capability("MEMORY"), capability("SOCIAL_SIGNAL")],
  });
  assert.equal(selection.primarySourceType, undefined);
  assert.equal(selection.sourceGap, true);
});

test("low-value source outcomes are not repeated mechanically", () => {
  const outcomes: SourceOutcome[] = [{
    sourceType: "OFFICIAL",
    providerId: "official-update-pages",
    resultCount: 2,
    newEvidenceCount: 0,
    newClaimCount: 0,
    reliabilityGain: 0,
    conflictReduction: 0,
  }];
  const selection = selectSource({
    strategy: "ESCALATE_SOURCE",
    previousSourceOutcomes: outcomes,
    availableSourceCapabilities: [capability("OFFICIAL"), capability("PRIMARY")],
  });
  assert.equal(selection.primarySourceType, "PRIMARY");
});

test("execution plan prevents unselected providers from running", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify({ id: 1, name: "Test", tag_name: "v1", html_url: "https://github.com/openai/codex/releases/tag/v1", body: "release", published_at: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("<title>Official update</title>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  try {
    await runResearchPipeline({
      identity: "builder", industry: "AI developer tools", focusAreas: "Codex",
      currentQuestions: "latest release", knownInformation: "", informationGaps: "",
      trackedEntities: "Codex", trackedEvents: "", userJudgements: "", evidenceHistory: "",
      freshnessWindow: "7d",
    }, undefined, undefined, {
      primarySourceType: "OFFICIAL",
      fallbackSourceTypes: ["PRIMARY"],
      allowedProviderIds: ["official-update-pages", "github-releases"],
      reason: "test",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(urls.length > 0);
  assert.equal(urls.some((url) => url.includes("api.github.com")), true);
  assert.equal(urls.some((url) => url.includes("news.google.com") || url.includes("reddit.com")), false);
});
