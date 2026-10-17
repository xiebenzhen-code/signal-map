import assert from "node:assert/strict";
import test from "node:test";

import { discoverOfficialGithubReleases } from "../research/github-discovery.ts";
import { resolveResearchEntities } from "../research/entity-resolution.ts";
import { companySourceRegistry } from "../source-registry/company-registry.ts";
import { normalizeRetrievalFreshness } from "../research/research-pipeline.ts";
import { planQuery } from "../research/query-planner.ts";
import { inferNaturalResearchDraft } from "../information/natural-research-intent.ts";
import { selectSource } from "../agent/source-selector.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import type { LiveItem } from "../social/providers/types.ts";

const ORIGINAL_QUESTION = "ComfyUI 最近一个月在 GitHub 发布了哪些版本？\n有哪些值得升级的改动？";

// Fixed public release sample (shape mirrors the GitHub releases list API).
// Injected through the existing fetcher seam so the test stays deterministic.
const RELEASE_SAMPLE = [
  {
    id: 3003,
    tag_name: "v0.37.0",
    name: "v0.37.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
    body: "## Changes\n* Partner nodes: add transparent background support for GPT Image 2\n* Fix sampler node memory leak",
    published_at: "2026-09-21T07:35:01Z",
    created_at: "2026-09-21T07:30:00Z",
  },
  {
    id: 3002,
    tag_name: "v0.36.0",
    name: "v0.36.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.36.0",
    body: "## Changes\n* New video preview node for VLM pipelines\n* Save workflow metadata into rendered output",
    published_at: "2026-09-15T22:26:17Z",
    created_at: "2026-09-15T22:20:00Z",
  },
  {
    id: 3001,
    tag_name: "v0.35.0",
    name: "v0.35.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0",
    body: "## Changes\n* Frontend 1.28 with new node search\n* Faster attention backend switch",
    published_at: "2026-09-09T19:55:08Z",
    created_at: "2026-09-09T19:50:00Z",
  },
];

function injectedFetcher(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("ComfyUI is matched by the GitHub releases discovery", async () => {
  const result = await discoverOfficialGithubReleases(["ComfyUI"]);
  assert.equal(result.outcome.searched, true, "ComfyUI must be searched on GitHub");
});

test("GitHub Releases discovery returns every release in the injected sample, preserving version, date, official link and content", async () => {
  const result = await discoverOfficialGithubReleases(["ComfyUI"], injectedFetcher(RELEASE_SAMPLE));
  assert.equal(result.outcome.searched, true);
  assert.equal(result.outcome.execution, "searched_with_results");
  assert.equal(result.outcome.resultCount, 3, "all three sample releases must be discovered, not just the latest");

  const byTag = new Map(result.items.map((item) => [
    /v\d+(?:\.\d+)*$/.exec(item.title)?.[0] ?? item.title,
    item,
  ] as const));
  for (const release of RELEASE_SAMPLE) {
    const item = byTag.get(release.tag_name);
    assert.ok(item, `release ${release.tag_name} must be preserved as its own signal`);
    assert.equal(item.url, release.html_url, "official release link must be preserved");
    assert.ok(item.publishedAt && new Date(item.publishedAt).toISOString().startsWith(release.published_at.slice(0, 10)), `published date of ${release.tag_name} must be preserved`);
    const bodyText = `${item.snippet} ${item.eventOccurredAt ?? ""}`;
    assert.ok(
      item.snippet.includes("transparent background") ||
        item.snippet.includes("video preview") ||
        item.snippet.includes("node search"),
      "release body content must be preserved in the snippet",
    );
    assert.equal(item.dataOrigin, "live");
    assert.ok(bodyText.length > 0);
  }
});

test("empty result or access failure is never counted as successful retrieval", async () => {
  const empty = await discoverOfficialGithubReleases(["ComfyUI"], injectedFetcher([]));
  assert.equal(empty.outcome.execution, "searched_no_results");
  assert.equal(empty.outcome.resultCount, 0);
  assert.equal(empty.items.length, 0);

  const failing = await discoverOfficialGithubReleases(["ComfyUI"], injectedFetcher({ message: "rate limited" }, 403));
  assert.equal(failing.outcome.execution, "failed");
  assert.equal(failing.outcome.resultCount, 0);
  assert.ok(failing.failure, "a failed upstream request must be surfaced as a failure");
});

test("requested 30d freshness window is not truncated to 3d", () => {
  assert.equal(normalizeRetrievalFreshness("30d"), "30d");
  assert.equal(normalizeRetrievalFreshness("3d"), "3d");
  assert.equal(normalizeRetrievalFreshness("24h"), "24h");
  assert.equal(normalizeRetrievalFreshness("7d"), "7d");
});

test("source platforms like GitHub are not extracted as research entities", () => {
  const planned = planQuery({
    identity: "关注这个方向的用户",
    industry: "个人关注方向",
    focusAreas: "值得关注的新变化",
    currentQuestions: ORIGINAL_QUESTION,
    knownInformation: "",
    informationGaps: `围绕“${ORIGINAL_QUESTION}”寻找有证据支持的新变化`,
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
    sourceScope: "hybrid",
    customSources: "",
  });
  assert.deepEqual(planned.entities, ["ComfyUI"], "only the real subject entity must remain");
  assert.equal(planned.requestedFreshnessWindow, "30d");
  for (const query of planned.searchCombinations) {
    assert.equal(/\bGitHub GitHub\b/i.test(query), false, `no duplicated platform-entity query: ${query}`);
    assert.equal(/GitHub Investor Relations/i.test(query), false, "platform entity must not generate investor queries");
  }
});

test("planner keywords exclude instruction fragments from the homepage gap sentence", () => {
  const planned = planQuery({
    identity: "关注这个方向的用户",
    industry: "个人关注方向",
    focusAreas: "值得关注的新变化",
    currentQuestions: ORIGINAL_QUESTION,
    knownInformation: "",
    informationGaps: `围绕“${ORIGINAL_QUESTION}”寻找有证据支持的新变化`,
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
    sourceScope: "hybrid",
    customSources: "",
  });
  for (const keyword of planned.topicKeywords ?? []) {
    assert.equal(/寻找有证据支持的新变化/.test(keyword), false, `instruction fragment must not become a keyword: ${keyword}`);
    assert.equal(/^”/.test(keyword), false, `dangling quote fragment must not become a keyword: ${keyword}`);
  }
  for (const query of planned.searchCombinations) {
    assert.equal(query.includes("寻找有证据支持的新变化"), false, `instruction fragment must not become a query: ${query}`);
  }
});

test("homepage draft recognizes ComfyUI and maps the github release question to a research industry", () => {
  const draft = inferNaturalResearchDraft(ORIGINAL_QUESTION);
  assert.deepEqual(draft.trackedEntities, ["ComfyUI"]);
  assert.equal(draft.freshnessWindow, "30d");
  assert.notEqual(draft.industry, "个人关注方向");
  assert.match(draft.industry, /开源|开发|工具|GitHub|人工智能/);
});

test("ComfyUI as a resolved entity must make GitHub Releases reachable through source selection", () => {
  const profile = sourceProfileForIntent("PRODUCT_UPDATE");
  const selection = selectSource({
    strategy: "INITIAL",
    sourceProfile: profile,
    resolvedEntities: [{ canonicalEntity: "ComfyUI", aliasesConsidered: ["comfyui", "comfyanonymous"] }],
  });
  assert.ok(
    selection.allowedProviderIds.includes("github-releases"),
    `allowedProviderIds must include github-releases, got ${JSON.stringify(selection.allowedProviderIds)}`,
  );
  assert.ok(
    selection.allowedProviderIds.includes("company-registry") && selection.allowedProviderIds.includes("official-update-pages"),
    "OFFICIAL update providers must be reachable for a tracked GitHub project",
  );
});

test("entity resolution maps ComfyUI with GitHub org aliases", () => {
  const resolved = resolveResearchEntities({ entities: ["ComfyUI"] });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].canonicalEntity, "ComfyUI");
  assert.ok(
    resolved[0].aliasesConsidered.some((alias) => /comfyui/i.test(alias)),
    "aliases must include ComfyUI",
  );
});

test("ComfyUI exists in companySourceRegistry with GitHub org mapping", () => {
  const entry = companySourceRegistry.find(
    (entry) => entry.aliases.some((alias) => /comfyui/i.test(alias)),
  );
  assert.ok(entry, "ComfyUI must exist in companySourceRegistry");
  assert.ok(entry.githubOrgs?.length, "ComfyUI must have a githubOrgs mapping");
  assert.equal(entry.company, "ComfyUI");
});

test("live sample type stays compatible with the discovery item contract", () => {
  const sample: LiveItem = {
    id: "smoke",
    title: "t",
    url: "https://example.com",
    snippet: "s",
    source: "src",
    firstSeenAt: "2026-09-29T00:00:00Z",
    retrievedAt: "2026-09-29T00:00:00Z",
    dataOrigin: "live",
    channel: "官方",
    authority: 90,
    origin: "github",
  };
  assert.ok(sample);
});

test("broad coding discovery can search known GitHub targets when the subject supports it", async () => {
  // Use an injected fetcher so we don't depend on real GitHub API availability.
  const fakeFetcher = (async (url: string | URL | Request) => {
    const u = String(url);
    if (!u.includes("api.github.com/repos/")) return new Response("[]", { status: 200 });
    const repo = u.match(/repos\/([^/]+\/[^/]+)\/releases/)?.[1] ?? "unknown/repo";
    return new Response(JSON.stringify([{
      id: 1, tag_name: "v1.0.0", name: "v1.0.0",
      html_url: `https://github.com/${repo}/releases/tag/v1.0.0`,
      body: "## Changes\n* test change",
      published_at: "2026-09-29T00:00:00Z",
      created_at: "2026-09-29T00:00:00Z",
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await discoverOfficialGithubReleases([], fakeFetcher, "new AI coding tools and CLI agents");
  assert.equal(result.outcome.searched, true, "broad discovery must search known repos");
  assert.ok(result.items.length > 0, `broad discovery must return items, got ${result.items.length}`);
  // Verify it tried more than one repo (broad fallback)
  assert.ok(result.items.length >= 2, `should search multiple default repos, got ${result.items.length}`);
});

test("unknown non-coding entities do not fetch unrelated default AI repositories", async () => {
  let requests = 0;
  const result = await discoverOfficialGithubReleases(["Shopify"], (async () => {
    requests += 1;
    return Response.json([]);
  }) as typeof fetch, "Shopify checkout payments changes");
  assert.equal(requests, 0);
  assert.equal(result.outcome.searched, false);
  assert.deepEqual(result.items, []);
});
