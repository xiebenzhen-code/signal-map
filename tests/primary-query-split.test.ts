import assert from "node:assert/strict";
import test from "node:test";

import { planQuery } from "../research/query-planner.ts";
import type { QueryPlan } from "../research/types.ts";

// ---- Reproduction of the acceptance run's plan shape (2026-09-30, signals-d5d3097d) ----
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
    informationGaps: "围绕该问题寻找有证据支持的新变化",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
    sourceScope: "hybrid",
    customSources: "",
  });
}

// Mirrors research-pipeline.ts retrievalTopicKeywords for the primary channel.
function retrievalTopicKeywords(plan: QueryPlan): string[] {
  const noise = new Set([
    "a", "an", "and", "artificial intelligence", "change", "changes",
    "official", "latest", "new", "news", "recent", "release notes",
    "research", "the", "today", "update", "updates", "what", "with",
  ]);
  const values = [
    ...(plan.topicAnchors ?? []),
    ...(plan.topicKeywords ?? []),
    ...plan.entities,
    ...plan.coreKeywords,
    ...plan.industryKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
    ...(plan.aliasesConsidered || []),
  ];
  const seen = new Set<string>();
  return values
    .map((value) => String(value).trim().replace(/\s+/g, " "))
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (value.length < 3 || value.length > 90 || noise.has(normalized) || seen.has(normalized)) return false;
      seen.add(normalized);
      return value.split(/\s+/).some((word) => word.replace(/[^\p{L}\p{N}+#.-]/gu, "").length > 2);
    });
}

test("RED: original question produced one over-long primary query (12+ tokens, 0 results in the real run)", () => {
  const plan = planForOriginal();
  const topics = retrievalTopicKeywords(plan);
  // The real run joined the first 4 anchors into ONE query:
  // "AI video editing automated rough cut multi-asset understanding shot selection …" (12+ tokens, 0 results).
  // Contract: the primary channel must have short per-anchor queries available —
  // every standalone task anchor must appear as its own short query variant
  // (≤3 content words), so one over-long AND-bag cannot be the only option.
  const shortVariants = topics.filter((topic) => topic.split(/\s+/).length <= 3);
  assert.ok(
    shortVariants.length >= 4,
    `expected at least 4 short per-anchor topics, got ${JSON.stringify(topics)}`,
  );
});

test("RED: shortening queries must not drop the release/update intent or the official-source condition", () => {
  const plan = planForOriginal();
  const combos = plan.searchCombinations;
  // The release/update intent must survive somewhere in the plan.
  assert.ok(
    combos.some((query) => /release|launch|update|changelog|发布|更新/i.test(query)),
    "release/update intent must remain in search combinations",
  );
  // The official/primary-source condition must survive (official documentation/
  // announcement variant still present).
  assert.ok(
    combos.some((query) => /official|官方/i.test(query)),
    "official-source condition must remain in search combinations",
  );
});

test("RED: each task anchor is retrievable on its own (independent anchors, not one fused bag)", () => {
  const plan = planForOriginal();
  const anchors = plan.topicAnchors ?? [];
  assert.ok(anchors.length >= 4, `expected >=4 anchors, got ${anchors.length}`);
  // Each anchor must be a usable standalone query: short enough for a search
  // engine AND not a fused multi-anchor string (contains at most one anchor's
  // worth of content words, i.e. <=4 words).
  for (const anchor of anchors) {
    assert.ok(
      anchor.split(/\s+/).length <= 4,
      `anchor must stay short: "${anchor}"`,
    );
    assert.ok(
      plan.searchCombinations.some((query) => query.includes(anchor)),
      `anchor "${anchor}" must appear in at least one search combination`,
    );
  }
});
