// Wiring-level counterexamples for the software-context gate: the question
// text must flow through the REAL pipeline derivation into the FINAL
// presentation fields. Same injected release materials, different questions —
// only a question with explicit software-release signals may surface
// software-specific wording (upgrade value / license / cost / hardware).
// Generic words like 发布/更新/版本 alone stay neutral.
import assert from "node:assert/strict";
import test from "node:test";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput, ResearchResponse } from "../research/types.ts";

// Real-shaped release bodies (multi-section bullet lists).
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
      "## Core",
      "* Reduce startup time by lazy-loading custom node packs",
    ].join("\n"),
    published_at: "2026-09-15T22:26:17Z",
  },
];

const PLAN_OVERRIDE = {
  primarySourceType: "OFFICIAL",
  fallbackSourceTypes: ["PRIMARY", "GENERAL_WEB"],
  allowedProviderIds: ["company-registry", "official-update-pages", "github-releases", "primary-web-search", "trusted-media", "industry-media", "public-web", "product-hunt", "hacker-news", "huggingface", "arxiv", "reddit", "reverse-primary", "social-access"],
  reason: "context wiring test",
};

function makeInput(currentQuestions: string): ResearchInput {
  return {
    identity: "关注这个方向的用户",
    industry: "开源开发与 AI 工具",
    focusAreas: "值得关注的新变化",
    currentQuestions,
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "ComfyUI",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  };
}

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

async function runWithQuestion(currentQuestions: string) {
  const original = globalThis.fetch;
  globalThis.fetch = stubFetch as typeof fetch;
  try {
    return await runResearchPipeline(makeInput(currentQuestions), undefined, undefined, { ...PLAN_OVERRIDE });
  } finally {
    globalThis.fetch = original;
  }
}

function versionSignals(result: ResearchResponse) {
  return result.signals.filter((s) => /\/releases\/tag\/v\d/.test(s.sourceUrl));
}

// Each version's own bullet, keyed by tag — mixing assertions would defeat
// the per-version contract.
const PHRASE_BY_TAG: Record<string, RegExp> = {
  "v0.37.0": /transparent background/i,
  "v0.36.0": /video preview node/i,
};

// A neutral announcement injected through the Google News RSS parser: direct
// publisher link with no api/sdk/demo/repository/workflow markers, so the
// signal must carry no execution entry.
const ANNOUNCEMENT_RSS = `<rss><channel>
<item>
  <title>ComfyUI 社区例会安排更新：例会时间由周三 14:00 变更为周四 14:00</title>
  <link>https://www.reuters.com/announcements/schedule-change</link>
  <source url="https://www.reuters.com">Reuters</source>
  <description>每周项目例会时间由周三 14:00 变更为周四 14:00，自下周一起生效，会议室不变。</description>
  <pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate>
</item>
</channel></rss>`;

test("an announcement without an execution entry yields a signal advised to check the source", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "news.google.com") return new Response(ANNOUNCEMENT_RSS, { headers: { "content-type": "application/xml" } });
    if (url.hostname === "api.deepseek.com") return Promise.reject(new Error("no model calls in this test"));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const result = await runResearchPipeline(
      { ...makeInput("ComfyUI 社区本周例会安排有哪些更新？"), trackedEntities: "" },
      undefined,
      undefined,
      { ...PLAN_OVERRIDE },
    );
    const noEntrySignals = result.signals.filter((s) => !s.executionEntry);
    assert.ok(
      noEntrySignals.length >= 1,
      `at least one no-entry signal must exist for the guard to be meaningful, got ${noEntrySignals.length} of ${result.signals.length}`,
    );
    for (const s of noEntrySignals) {
      assert.match(s.action, /核查原文/, "no-entry signals must advise checking the original source");
      assert.doesNotMatch(s.action, /触发一次|运行一个|做最小验证/, "no run instructions without an entry");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("explicit software-release question keeps change content and software-specific unknowns", async () => {
  const result = await runWithQuestion("ComfyUI 最近一个月在 GitHub 发布了哪些版本？有哪些值得升级的改动？");
  const signals = versionSignals(result);
  assert.ok(signals.length >= 1, `the software question must still yield version signals, got ${signals.length}`);
  for (const s of signals) {
    const phrase = PHRASE_BY_TAG[s.sourceUrl.split("/tag/")[1]];
    const rendered = JSON.stringify([s.summary, s.whyItMatters]);
    assert.ok(phrase, `unexpected version ${s.sourceUrl}`);
    assert.match(rendered, phrase, "the change must stay visible");
    assert.match(s.whyItMatters || "", /升级价值|商用许可/, "software unknowns stay for explicit software questions");
  }
});

test("RED: a rules question containing 发布 must stay neutral on the same materials", async () => {
  const result = await runWithQuestion("ComfyUI 最近发布了哪些平台规则？");
  const signals = versionSignals(result);
  assert.ok(signals.length >= 1, `the question must still yield the same materials, got ${signals.length}`);
  for (const s of signals) {
    const phrase = PHRASE_BY_TAG[s.sourceUrl.split("/tag/")[1]];
    const rendered = JSON.stringify([s.summary, s.whyItMatters]);
    assert.ok(phrase, `unexpected version ${s.sourceUrl}`);
    assert.match(rendered, phrase, "the change itself must stay visible");
    for (const banned of ["升级价值", "商用许可", "硬件", "兼容"]) {
      assert.doesNotMatch(rendered, new RegExp(banned), `rules question must not contain: ${banned}`);
    }
  }
});

test("RED: a schedule question containing 更新 must stay neutral on the same materials", async () => {
  const result = await runWithQuestion("ComfyUI 本周例会安排有哪些更新？");
  const signals = versionSignals(result);
  assert.ok(signals.length >= 1, `the question must still yield the same materials, got ${signals.length}`);
  for (const s of signals) {
    const rendered = JSON.stringify([s.summary, s.whyItMatters]);
    for (const banned of ["升级价值", "商用许可", "硬件", "兼容"]) {
      assert.doesNotMatch(rendered, new RegExp(banned), `schedule question must not contain: ${banned}`);
    }
  }
});

test("ambiguous questions default to neutral copy", async () => {
  const result = await runWithQuestion("ComfyUI 最近有什么新动态？");
  const signals = versionSignals(result);
  assert.ok(signals.length >= 1, `the question must still yield the same materials, got ${signals.length}`);
  for (const s of signals) {
    const rendered = JSON.stringify([s.summary, s.whyItMatters]);
    assert.doesNotMatch(rendered, /升级价值|商用许可|硬件|兼容/, "ambiguous context defaults to neutral");
  }
});

test("signals without an execution entry never get run instructions", async () => {
  for (const question of [
    "ComfyUI 最近一个月在 GitHub 发布了哪些版本？有哪些值得升级的改动？",
    "ComfyUI 最近发布了哪些平台规则？",
    "ComfyUI 最近有什么新动态？",
  ]) {
    const result = await runWithQuestion(question);
    for (const s of result.signals) {
      if (!s.executionEntry) {
        assert.doesNotMatch(s.action, /触发一次|运行一个|做最小验证/, `no run instruction without an entry: ${question}`);
      }
    }
  }
});
