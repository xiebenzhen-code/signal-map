import assert from "node:assert/strict";
import test from "node:test";

import { providerQueryFor } from "../research/research-pipeline.ts";
import { planQuery } from "../research/query-planner.ts";
import type { QueryPlan } from "../research/types.ts";

const ORIGINAL_QUESTION =
  "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？\n" +
  "重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。\n" +
  "优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。\n" +
  "告诉我发生了什么、为什么值得关注，以及我现在能具体测试什么。";

function planForOriginal(): QueryPlan {
  return planQuery({
    identity: "关注这个方向的用户",
    industry: "AI 视频与创作者工具",
    focusAreas: "AI 视频工具",
    currentQuestions: ORIGINAL_QUESTION,
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
    sourceScope: "hybrid",
    customSources: "",
  });
}

test("RED: primary-web-search must not fuse all anchors into one over-long query", () => {
  const plan = planForOriginal();
  const query = providerQueryFor(plan, "primary-web-search");
  // The real run produced: "AI video editing automated rough cut multi-asset
  // understanding shot selection official technical" (10+ tokens → 0 results).
  const words = query.split(/\s+/).length;
  assert.ok(words <= 6, `primary query must stay short (<=6 words), got ${words}: "${query}"`);
});

test("RED: primary channel gets per-anchor short queries instead of one fused bag", () => {
  const plan = planForOriginal();
  const queries = providerQueryFor.all(plan, "primary-web-search");
  assert.ok(Array.isArray(queries) && queries.length >= 2, "must produce multiple query variants");
  for (const query of queries) {
    const words = query.split(/\s+/).length;
    assert.ok(words <= 6, `every primary query must stay short, got ${words}: "${query}"`);
  }
  // The fused 4-anchor bag from the real run must never reappear.
  const fused = "AI video editing automated rough cut multi-asset understanding shot selection";
  assert.equal(
    queries.some((query) => query.replace(/\s+/g, " ").toLowerCase() === fused.toLowerCase()),
    false,
    "the over-long fused query must be gone",
  );
  // Release intent + official condition must survive across the variants.
  assert.ok(
    queries.some((query) => /release|launch|update|changelog/i.test(query)) ||
      queries.some((query) => /official/i.test(query)),
    "release intent or official condition must survive in the variant set",
  );
});

test("RED: other providers keep their existing query shapes", () => {
  const plan = planForOriginal();
  // hacker-news/huggingface keep the short-query behaviour (2 concept words + modifier).
  const hn = providerQueryFor(plan, "hacker-news");
  assert.ok(hn.split(/\s+/).length <= 6, `hacker-news query must stay short, got "${hn}"`);
  // arxiv keeps its modifier.
  const arxiv = providerQueryFor(plan, "arxiv");
  assert.match(arxiv, /research|paper|method/i);
});
