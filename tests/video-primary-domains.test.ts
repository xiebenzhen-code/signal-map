// Red test for the video-domain primary whitelist: a video-editing question's
// primary queries must not carry the AI-vendor whitelist.
import assert from "node:assert/strict";
import test from "node:test";

const VIDEO_QUESTION =
  "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？" +
  "重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。" +
  "优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。" +
  "告诉我发生了什么、为什么值得关注，以及我现在能具体测试什么。";


test("RED: video-editing primary queries must not be constrained to the AI-vendor domain whitelist", async () => {
  const { runResearchPipeline } = await import("../research/research-pipeline.ts");
  const originalFetch = globalThis.fetch;
  const seenQueries: string[] = [];
  globalThis.fetch = (async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "news.google.com") {
      seenQueries.push(decodeURIComponent(url.searchParams.get("q") || ""));
      return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/xml" } });
    }
    if (url.hostname === "html.duckduckgo.com") {
      seenQueries.push(decodeURIComponent(new URLSearchParams(url.searchParams.get("q") || "").get("q") || url.searchParams.get("q") || ""));
      return new Response("<html></html>");
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    await runResearchPipeline({
      identity: "u",
      industry: "AI 视频与创作者工具",
      focusAreas: "AI 视频工具",
      currentQuestions: VIDEO_QUESTION,
      knownInformation: "",
      informationGaps: "",
      trackedEntities: "",
      trackedEvents: "",
      userJudgements: "",
      evidenceHistory: "",
      freshnessWindow: "30d",
    }, undefined, undefined, {
      primarySourceType: "PRIMARY",
      fallbackSourceTypes: [],
      allowedProviderIds: ["primary-web-search"],
      reason: "video primary whitelist test",
    });
    assert.ok(seenQueries.length > 0, `primary queries must be issued, got ${seenQueries.length}`);
    for (const q of seenQueries) {
      assert.equal(
        /site:openai\.com/.test(q),
        false,
        `video-editing primary query must not carry the AI-vendor whitelist: ${q}`,
      );
      assert.equal(
        /site:adobe\.com|site:blackmagicdesign\.com|site:apple\.com|site:runway\.com|site:topazlabs\.com|site:pika\.art/.test(q),
        true,
        `video-editing primary query should target the editing industry's first-hand domains: ${q}`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
