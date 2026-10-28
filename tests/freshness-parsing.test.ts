import assert from "node:assert/strict";
import test from "node:test";
import { planQuery } from "../research/query-planner.ts";
import { resolvePipelinePlan, runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput } from "../research/types.ts";

const input: ResearchInput = {
  identity: "reader", industry: "browser", focusAreas: "security", currentQuestions: "Chrome security updates",
  knownInformation: "", informationGaps: "", trackedEntities: "Chrome", trackedEvents: "",
  userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
};

for (const [raw, expected] of [
  ["过去一个月", "30d"], ["1个月", "30d"], ["14天", "30d"], ["两周", "30d"],
  ["13天", "30d"], ["过去 3 天", "3d"], ["90d", "90d"], ["24小时", "24h"],
  ["7d", "7d"], ["2天", "3d"], ["31天", "90d"], ["3个月", "90d"],
  ["14 days", "30d"], ["2 weeks", "30d"],
] as const) {
  test(`freshness: ${raw} uses the smallest enclosing tier ${expected}`, () => {
    const plan = planQuery({ ...input, freshnessWindow: raw });
    assert.equal(plan.requestedFreshnessWindow, expected);
    const upstream = resolvePipelinePlan({ ...input, freshnessWindow: raw }, { queries: ["Chrome security"], freshnessWindow: raw });
    assert.equal(upstream.plan.requestedFreshnessWindow, expected, "upstream and derived plans agree");
  });
}

test("unrecognized and beyond-supported durations explicitly disclose the actual fallback", () => {
  for (const raw of ["随便看看", "", "120天", "0天", "-3天", "13天以后", "7d or 90d"]) {
    const plan = planQuery({ ...input, freshnessWindow: raw });
    assert.equal(plan.freshnessResolution?.status, "UNRECOGNIZED");
    assert.equal(plan.freshnessResolution?.appliedWindow, plan.requestedFreshnessWindow);
    assert.match(plan.freshnessResolution?.notice ?? "", /未识别.*实际使用.*7d/);
  }
});

test("rounded durations disclose the requested duration and actual tier", () => {
  const plan = planQuery({ ...input, freshnessWindow: "两周" });
  assert.equal(plan.freshnessResolution?.status, "MAPPED");
  assert.equal(plan.freshnessResolution?.requestedHours, 14 * 24);
  assert.match(plan.freshnessResolution?.notice ?? "", /两周.*30d/);
});

test("pipeline result discloses an unrecognized window without network calls", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network"); });
  const result = await runResearchPipeline({ ...input, trackedEntities: "", freshnessWindow: "无法识别" }, undefined,
    { customSourceReader: async () => { throw new Error("unexpected reader"); } },
    { queries: ["browser"], allowedProviderIds: ["offline-no-provider"] });
  assert.equal(result.queryPlan.freshnessResolution?.status, "UNRECOGNIZED");
  assert.match(result.filteringSummary?.summaryText ?? "", /未识别.*实际使用.*7d/);
});
