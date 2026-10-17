import assert from "node:assert/strict";
import test from "node:test";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput } from "../research/types.ts";

// Deterministic end-to-end red test: with the GitHub releases LIST injected and
// an empty rest of the network, a "last month releases" question must surface
// MULTIPLE version events, each with its own tag, date and official link.
// Empty results never count as success: an all-empty network must produce zero
// signals and a failed GitHub call must not be reported as retrieved.
// Real-shaped release bodies (multi-section bullet lists) — mirrors the public
// github.com/comfyanonymous/ComfyUI releases sample data.
const RELEASES = [
  {
    id: 3003,
    tag_name: "v0.37.0",
    name: "v0.37.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
    body: [
      "Release Notes",
      "## Frontend",
      "* Add transparent background support for GPT Image 2 partner nodes",
      "* Update clipboard image paste handling for large bitmaps",
      "## Nodes",
      "* Fix sampler node memory leak after long sessions",
      "* Add retry logic for remote model loading",
    ].join("\n"),
    published_at: "2026-09-21T07:35:01Z",
  },
  {
    id: 3002,
    tag_name: "v0.36.0",
    name: "v0.36.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.36.0",
    body: [
      "Release Notes",
      "## Video",
      "* New video preview node for VLM pipelines with frame-accurate scrubbing",
      "* Export metadata into rendered output files",
      "## Core",
      "* Reduce startup time by lazy-loading custom node packs",
    ].join("\n"),
    published_at: "2026-09-15T22:26:17Z",
  },
  {
    id: 3001,
    tag_name: "v0.35.0",
    name: "v0.35.0",
    html_url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0",
    body: [
      "Release Notes",
      "## UI",
      "* Frontend 1.28 with new node search across installed packs",
      "* Keyboard shortcuts for group selection",
      "## Performance",
      "* Faster attention backend switch on launch",
    ].join("\n"),
    published_at: "2026-09-09T19:55:08Z",
  },
];

const input: ResearchInput = {
  identity: "关注这个方向的用户",
  industry: "开源开发与 AI 工具",
  focusAreas: "值得关注的新变化",
  currentQuestions: "ComfyUI 最近一个月在 GitHub 发布了哪些版本？",
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "ComfyUI",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
};

function stubFetch(target: string | URL | Request): Promise<Response> {
  const url = new URL(String(target));
  if (url.hostname === "api.github.com" && url.pathname.startsWith("/repos/") && url.pathname.endsWith("/releases")) {
    return Promise.resolve(Response.json(RELEASES));
  }
  if (url.hostname === "news.google.com") return Promise.resolve(new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/xml" } }));
  if (url.hostname === "www.reddit.com") return Promise.resolve(Response.json({ data: { children: [] } }));
  if (url.hostname === "export.arxiv.org") return Promise.resolve(new Response("<feed></feed>", { headers: { "content-type": "application/xml" } }));
  if (url.hostname === "hn.algolia.com") return Promise.resolve(Response.json({ hits: [] }));
  if (url.hostname === "huggingface.co") return Promise.resolve(Response.json([]));
  if (url.hostname === "html.duckduckgo.com") return Promise.resolve(new Response("<html></html>"));
  if (url.hostname === "www.producthunt.com") return Promise.resolve(new Response("<html></html>"));
  if (url.hostname === "api.deepseek.com") return Promise.reject(new Error("no model calls in this test"));
  return Promise.resolve(new Response("", { status: 404 }));
}

test("a 30d ComfyUI releases question keeps multiple versions as separate dated events", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch as typeof fetch;
  try {
    const result = await runResearchPipeline(input, undefined, undefined, {
      primarySourceType: "OFFICIAL",
      fallbackSourceTypes: ["PRIMARY", "GENERAL_WEB"],
      allowedProviderIds: ["company-registry", "official-update-pages", "github-releases", "primary-web-search", "trusted-media", "industry-media", "public-web", "product-hunt", "hacker-news", "huggingface", "arxiv", "reddit", "reverse-primary", "social-access"],
      reason: "acceptance test",
    });
    const versionSignals = result.signals.filter((s) => /\/releases\/tag\/v\d/.test(s.sourceUrl));
    const tags = versionSignals.map((s) => (/v\d+(?:\.\d+)*$/.test(s.sourceUrl) ? s.sourceUrl.split("/tag/")[1] : ""));
    assert.ok(versionSignals.length >= 2, `at least two version events must survive, got ${versionSignals.length}; signals: ${result.signals.map((s) => s.sourceUrl).join(" , ")}`);
    assert.deepEqual([...new Set(tags)].sort(), ["v0.35.0", "v0.36.0", "v0.37.0"], "each release must keep its own tag");
    for (const s of versionSignals) {
      assert.ok(s.publishedAt, "each version event must carry its published date");
      assert.equal(new URL(s.sourceUrl).hostname, "github.com", "official links must be kept");
      assert.ok((s.claims?.length ?? 0) > 0, "each version event must carry claim content");
    }
  } finally {
    globalThis.fetch = original;
  }
});
