import assert from "node:assert/strict";
import test from "node:test";

import { selectTodayPresentation } from "../information/today-selection.ts";
import type { ResearchSignal } from "../research/types.ts";

function releaseSignal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: overrides.id ?? "event-v037",
    category: "匹配",
    channel: "官方",
    title: overrides.title ?? "ComfyUI v0.37.0",
    summary: overrides.summary ?? "Partner nodes: transparent background support for GPT Image 2.",
    time: overrides.time ?? "8天前",
    truth: 92,
    baseUseful: 95,
    lead: 25,
    tags: ["ComfyUI"],
    action: "阅读原文并评估适用范围",
    why: "为未解决问题补充证据：comfyui",
    official: [{ name: "GitHub · comfyanonymous/ComfyUI", url: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0", kind: "原文" }],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: overrides.sourceUrl ?? "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
    publisher: "GitHub · comfyanonymous/ComfyUI",
    publishedAt: overrides.publishedAt ?? "2026-09-21T07:35:01.000Z",
    eventOccurredAt: overrides.eventOccurredAt ?? "2026-09-21T07:35:01.000Z",
    firstSeenAt: "2026-09-29T14:31:42.000Z",
    retrievedAt: "2026-09-29T14:31:42.000Z",
    originalOccurredAt: "2026-09-21T07:35:01.000Z",
    lastUpdatedAt: undefined,
    retrievedAtSource: undefined,
    originalOccurredAtSource: undefined,
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 92,
    verificationStatus: "verified",
    relevanceScore: 95,
    reliabilityScore: 92,
    freshnessScore: overrides.freshnessScore ?? 25,
    noveltyScore: 86,
    judgementImpactScore: 84,
    gapMatchScore: 100,
    overallScore: 85,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 1,
    signalType: "FACT",
    signalCluster: undefined,
    sourceRoles: {},
    sourceRoleDiversity: 0,
    duplicateRatio: 0,
    confirmationGain: 0,
    primaryEvidenceIds: [],
    claims: [{
      claimText: "ComfyUI v0.37.0 adds transparent background support for GPT Image 2.",
      sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
      publisher: "GitHub · comfyanonymous/ComfyUI",
      publishedAt: "2026-09-21T07:35:01.000Z",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: "add transparent background support for GPT Image 2",
      verificationStatus: "verified",
      contentType: "FACT",
      evidenceSources: [],
      independentEvidenceCount: 1,
    }],
    sources: [{
      sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0",
      publisher: "GitHub · comfyanonymous/ComfyUI",
      publishedAt: "2026-09-21T07:35:01.000Z",
      sourceType: "primary",
      sourceTier: "S",
    }],
    section: "gap_update",
    gapMatches: ["comfyui 版本"],
    questionMatches: ["ComfyUI 最近一个月在 GitHub 发布了哪些版本？"],
    entityMatches: ["ComfyUI"],
    whyItMatters: "这直接回应了你正在核对的 ComfyUI 版本问题。",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    actionabilityStatus: "REVIEW_FIRST",
    informationGainStatus: "NEW_INFORMATION",
    hasExecutableAction: true,
    executionEntry: { type: "REPOSITORY", evidence: "github.com/Comfy-Org/ComfyUI", sourceUrl: "https://github.com/Comfy-Org/ComfyUI" },
    attentionDecision: "LIBRARY_ONLY",
    ...overrides,
  } as ResearchSignal;
}

// "now" of the acceptance scenario: 2026-09-29. The release is 8 days old —
// inside a requested 30d window but far beyond the old fixed 72h gate.
test("a verified in-window official release (8 days old) reaches 今日可用更新 under a 30d window", () => {
  const presentation = selectTodayPresentation([releaseSignal()], "30d");
  assert.equal(presentation.kind, "usable_updates", `expected usable_updates, got ${presentation.kind}`);
  assert.equal(presentation.usableUpdates.length, 1);
  assert.equal(presentation.usableUpdates[0].sourceUrl, "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0");
});

test("gates other than freshness are preserved: unverified or low-relevance releases stay out", () => {
  const unverified = releaseSignal({ id: "event-unv", verificationStatus: "unverified" });
  const lowRelevance = releaseSignal({ id: "event-lowrel", relevanceScore: 40 });
  const social = releaseSignal({ id: "event-social", sourceTier: "C", sourceType: "social" });
  const background = releaseSignal({ id: "event-bg", eventStatus: "BACKGROUND" });
  const known = releaseSignal({ id: "event-known", knowledgeStatus: "KNOWN" });
  const presentation = selectTodayPresentation([unverified, lowRelevance, social, background, known]);
  assert.equal(presentation.kind, "caught_up");
  assert.equal(presentation.usableUpdates.length, 0);
});

test("an out-of-window stale release does not surface just because a window exists", () => {
  // publishedAt one year old, freshnessScore 15 → outside even a 30d window.
  const stale = releaseSignal({
    id: "event-stale",
    publishedAt: "2025-09-21T07:35:01.000Z",
    eventOccurredAt: "2025-09-21T07:35:01.000Z",
    freshnessScore: 15,
  });
  const presentation = selectTodayPresentation([stale]);
  assert.equal(presentation.kind, "caught_up");
  assert.equal(presentation.usableUpdates.length, 0);
});
