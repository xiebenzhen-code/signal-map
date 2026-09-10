import assert from "node:assert/strict";
import test from "node:test";
import { signalTypeLabel, userFacingReason, userFacingLabel } from "../lib/user-facing-labels.ts";

test("internal reason codes map to user-readable text", () => {
  assert.equal(userFacingLabel("insufficientContent"), "内容太少，无法验证");
  assert.equal(userFacingLabel("lowReliability"), "来源可信度不足");
  assert.equal(signalTypeLabel("INTERPRETATION"), "观点/解读（非事实）");
  assert.equal(userFacingReason("LOW_RELIABILITY"), "来源可信度不足");
});

test("unknown code-shaped reasons are not exposed in normal views", () => {
  assert.equal(userFacingReason("NEW_INTERNAL_REASON"), "暂未满足展示条件");
  assert.equal(userFacingReason("plain-language explanation"), "plain-language explanation");
});
