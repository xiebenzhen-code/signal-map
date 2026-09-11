import assert from "node:assert/strict";
import test from "node:test";

import { inferNaturalResearchDraft } from "../information/natural-research-intent.ts";

test("natural research prompt becomes the existing research context shape", () => {
  const draft = inferNaturalResearchDraft("最近有哪些值得投递的 AIGC 岗位？");

  assert.equal(draft.currentQuestions[0], "最近有哪些值得投递的 AIGC 岗位？");
  assert.equal(draft.industry, "AI 招聘与职业机会");
  assert.equal(draft.freshnessWindow, "7d");
  assert.equal(draft.sourceScope, "hybrid");
  assert.ok(draft.focusAreas.includes("AIGC"));
  assert.ok(draft.focusAreas.includes("AI 岗位机会"));
});

test("time and source hints are inferred without exposing internal knobs", () => {
  const draft = inferNaturalResearchDraft("最近一个月 DeepSeek 有什么重要变化？", {
    sourcePreference: "official",
    reliabilityPreference: "strict",
  });

  assert.equal(draft.freshnessWindow, "30d");
  assert.equal(draft.sourceScope, "hybrid");
  assert.deepEqual(draft.trackedEntities, ["DeepSeek"]);
  assert.ok(draft.informationGaps.some((gap) => gap.includes("官方")));
  assert.ok(draft.informationGaps.some((gap) => gap.includes("证据更充分")));
  assert.equal(JSON.stringify(draft).includes("ResearchPolicy"), false);
  assert.equal(JSON.stringify(draft).includes("Evidence Count"), false);
});

test("advanced region and exclude hints stay bounded to existing fields", () => {
  const domestic = inferNaturalResearchDraft("最近有什么 AI 视频工具？", {
    region: "中国",
    excludeKeywords: "教程, 课程",
  });
  const global = inferNaturalResearchDraft("最近有什么 AI 视频工具？", { region: "全球" });

  assert.equal(domestic.sourceScope, "domestic");
  assert.equal(global.sourceScope, "global");
  assert.ok(domestic.informationGaps.some((gap) => gap.includes("教程, 课程")));
  assert.deepEqual(domestic.customSources, []);
});
