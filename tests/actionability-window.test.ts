import assert from "node:assert/strict";
import test from "node:test";

import { assessSignalActionability } from "../research/actionability.ts";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "comfyanonymous/ComfyUI v0.37.0",
    summary: "Transparent background support for GPT Image 2.",
    sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
    tags: ["ComfyUI"],
    sourceType: "primary" as const,
    sourceTier: "S" as const,
    eventStatus: "NEW" as const,
    knowledgeStatus: "NOVEL" as const,
    noveltyScore: 86,
    relevanceScore: 95,
    reliabilityScore: 92,
    freshnessScore: 25,
    verificationStatus: "verified" as const,
    informationType: "FACT" as const,
    ...overrides,
  };
}

test("an 8-day-old verified official release reaches TEST_NOW when the user asked for a 30d window", () => {
  const result = assessSignalActionability(baseInput({
    eventAgeHours: 199,
    requestedFreshnessHours: 720,
  }));
  assert.equal(result.actionabilityStatus, "TEST_NOW", `expected TEST_NOW, got ${result.actionabilityStatus}: ${result.reason}`);
});

test("without window context the absolute freshness bar is unchanged", () => {
  const result = assessSignalActionability(baseInput());
  assert.notEqual(result.actionabilityStatus, "TEST_NOW");
  assert.equal(result.actionabilityStatus, "REVIEW_FIRST");
});

test("an out-of-window old release still fails the quality gate even with window context", () => {
  const result = assessSignalActionability(baseInput({
    eventAgeHours: 24 * 40, // 40 days old
    requestedFreshnessHours: 720, // 30d window
  }));
  assert.notEqual(result.actionabilityStatus, "TEST_NOW");
});
