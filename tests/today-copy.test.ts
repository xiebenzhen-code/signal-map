import assert from "node:assert/strict";
import test from "node:test";
import { todayResultCopy } from "../information/today-copy.ts";

test("zero attention with accepted evidence does not claim all evidence failed", () => {
  const copy = (todayResultCopy as (...args: number[]) => ReturnType<typeof todayResultCopy>)(0, 12, 12);
  assert.doesNotMatch(copy.supporting, /都未通过验证|可信度不够/);
  assert.match(copy.supporting, /12 条通过筛选/);
});

test("today copy keeps the reading count when results exist", () => {
  assert.deepEqual(todayResultCopy(3, 12), {
    headline: "今天只需阅读 3 条。",
    supporting: "只保留可能改变你判断、且有证据支持的新变化。",
  });
});

test("zero results explain that filtering completed", () => {
  assert.deepEqual(todayResultCopy(0, 12), {
    headline: "今天没有需要你关注的新变化。",
    supporting: "检索到 12 条，但都未通过验证（内容不足 / 可信度不够）。",
  });
});

test("zero candidates do not imply a broken system", () => {
  assert.deepEqual(todayResultCopy(0, 0), {
    headline: "今天没有需要你关注的新变化。",
    supporting: "本次已完成来源检查，暂未找到足够证据支持的新变化。",
  });
});

// A successful empty check and an interrupted zero-evidence run share counts,
// but must never share a completion claim.
for (const [label, state] of [
  ["deadline", { status: "needs_more_evidence", reason: "deadline_exhausted_no_evidence" }],
  ["provider failure", { status: "completed", coverage: { failedProviders: ["feed"] } }],
  ["legacy source failure", { sourceStatus: [{ name: "feed", ok: false, state: "failed" }] }],
] as const) {
  test(label + " is not presented as a quiet completed day", () => {
    const copy = (todayResultCopy as (...args: unknown[]) => ReturnType<typeof todayResultCopy>)(0, 0, 0, state);
    assert.match(copy.headline, /未完成/);
    assert.doesNotMatch(copy.headline + copy.supporting, /已完成来源检查|没有需要你关注的新变化/);
  });
}

test("partial evidence remains readable without claiming research completed", () => {
  const copy = (todayResultCopy as (...args: unknown[]) => ReturnType<typeof todayResultCopy>)(2, 8, 3, { status: "needs_more_evidence" });
  assert.match(copy.headline, /2/);
  assert.match(copy.supporting, /未完成|不完整/);
});

test("completed source checks with no candidates retain the quiet-day copy", () => {
  const copy = (todayResultCopy as (...args: unknown[]) => ReturnType<typeof todayResultCopy>)(0, 0, 0, { status: "completed", sourceStatus: [{ name: "feed", ok: true, state: "searched_no_results" }] });
  assert.match(copy.supporting, /已完成来源检查/);
});
