import assert from "node:assert/strict";
import test from "node:test";
import { selectTodayPresentation } from "../information/today-selection.ts";
import type { ResearchSignal } from "../research/types.ts";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "event-1",
    title: "Recent developer update",
    summary: "A short summary.",
    attentionDecision: "LIBRARY_ONLY",
    eventStatus: "NEW",
    informationType: "INTERPRETATION",
    verificationStatus: "partially_verified",
    timestampStatus: "valid",
    knowledgeStatus: "NOVEL",
    relevanceScore: 62,
    reliabilityScore: 72,
    freshnessScore: 96,
    noveltyScore: 92,
    overallScore: 65,
    judgementImpactScore: 40,
    gapMatchScore: 24,
    propagationCount: 1,
    sourceTier: "S",
    sourceType: "primary",
    // Relative to "now" so the default 7d window keeps this fixture in-window
    // regardless of when the suite runs; the gate under test is the candidate
    // quality gates, not calendar drift.
    publishedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  } as ResearchSignal;
}

test("an early signal remains Worth Watching without becoming a usable update", () => {
  const result = selectTodayPresentation([
    signal({ attentionDecision: "WORTH_WATCHING", informationType: "SIGNAL", eventStatus: "SIGNAL" }),
  ]);
  assert.equal(result.kind, "worth_watching");
  assert.equal(result.worthWatching.length, 1);
  assert.equal(result.usableUpdates.length, 0);
});

test("a recent official Library event remains available when it is not Must Read", () => {
  const result = selectTodayPresentation([signal()]);
  assert.equal(result.kind, "usable_updates");
  assert.equal(result.usableUpdates.length, 1);
});

test("very fresh but very low relevance content is not presented as an update", () => {
  const result = selectTodayPresentation([signal({ relevanceScore: 20 })]);
  assert.equal(result.kind, "caught_up");
});

test("social propagation alone cannot promote a usable update", () => {
  const result = selectTodayPresentation([signal({ relevanceScore: 38, propagationCount: 999 })]);
  assert.equal(result.kind, "caught_up");
});

test("known or duplicate knowledge cannot enter usable updates", () => {
  const result = selectTodayPresentation([
    signal({ id: "known", knowledgeStatus: "KNOWN", noveltyScore: 90 }),
    signal({ id: "duplicate", knowledgeStatus: "UPDATED", noveltyScore: 42 }),
  ]);
  assert.equal(result.kind, "caught_up");
});

test("IGNORE candidates cannot be resurrected by the presentation fallback", () => {
  const result = selectTodayPresentation([
    signal({ attentionDecision: "IGNORE", relevanceScore: 90, freshnessScore: 100, noveltyScore: 100 }),
  ]);
  assert.equal(result.kind, "caught_up");
});

test("empty buckets show caught-up rather than an artificial quota", () => {
  const result = selectTodayPresentation([]);
  assert.equal(result.kind, "caught_up");
  assert.equal(result.items.length, 0);
});

test("Must Read remains primary while official usable updates remain available", () => {
  const mustRead = Array.from({ length: 7 }, (_, index) =>
    signal({ id: `must-${index}`, attentionDecision: "MUST_READ" }),
  );
  const result = selectTodayPresentation([
    ...mustRead,
    signal({ id: "watch", attentionDecision: "WORTH_WATCHING", eventStatus: "SIGNAL" }),
    signal({ id: "official-update" }),
  ]);
  assert.equal(result.kind, "must_read");
  assert.equal(result.mustRead.length, 5);
  assert.equal(result.worthWatching.length, 1);
  assert.equal(result.usableUpdates.length, 1);
  assert.equal(result.items.length, 5);
});

test("usable updates prioritize official evidence and are capped without filling a quota", () => {
  const result = selectTodayPresentation([
    signal({ id: "one", freshnessScore: 98 }),
    signal({ id: "two", freshnessScore: 97 }),
    signal({ id: "three", freshnessScore: 96 }),
    signal({ id: "four", freshnessScore: 95 }),
    signal({ id: "social", sourceTier: "C", sourceType: "social", verificationStatus: "unverified" }),
  ]);
  assert.equal(result.kind, "usable_updates");
  assert.equal(result.usableUpdates.length, 3);
  assert.equal(result.usableUpdates.some((event) => event.id === "social"), false);
  assert.equal(result.items.length, 3);
});

// --- Bounded repair 2026-10-04 (requestId signals-baa5d0df): the Adobe item was
// preserved in the library but never surfaced because its extracted page had no
// publication date → timestampStatus ≠ valid → ageHours undefined. Prove the
// timestamp condition is the real gate (a verified in-window item with a date
// surfaces; the identical item without one does not). Other gates unchanged. ---
test("usable-update candidacy requires a valid timestamp; missing dates stay out", () => {
  const withDate = signal({
    id: "adobe-with-date",
    title: "Generate and create directly in your timeline",
    sourceTier: "B",
    sourceType: "industry_media",
    reliabilityScore: 76,
    relevanceScore: 62,
    noveltyScore: 86,
    eventOccurredAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  });
  const noDate = signal({
    ...withDate,
    id: "adobe-no-date",
    publishedAt: undefined,
    eventOccurredAt: undefined,
    timestampStatus: "missing",
  });
  const result = selectTodayPresentation([withDate, noDate]);
  assert.equal(result.kind, "usable_updates");
  assert.deepEqual(result.usableUpdates.map((event) => event.id), ["adobe-with-date"]);
});
