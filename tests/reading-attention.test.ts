import assert from "node:assert/strict";
import test from "node:test";
import { assignReadingAttention } from "../research/actionability.ts";
import { buildFilteringSummary } from "../research/filtering-summary.ts";
import type { ResearchSignal } from "../research/types.ts";

function card(id: string, overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return { id, title: "Browser security update released", summary: "This release fixes a security vulnerability.",
    sourceUrl: `https://official.example/releases/${id}`, publisher: "Official", publishedAt: "2026-10-20T08:00:00Z",
    relevanceScore: 75, reliabilityScore: 70, noveltyScore: 60, judgementImpactScore: 48,
    freshnessScore: 15, overallScore: 80, gapMatchScore: 0, entityMatches: ["Browser"],
    topicRelevance: {decision: "MATCH"}, informationGainStatus: "NEW_INFORMATION", contentQuality: "VALID",
    knowledgeStatus: "NOVEL", verificationStatus: "verified", eventStatus: "NEW", timestampStatus: "valid",
    actionabilityStatus: "REVIEW_FIRST", attentionDecision: "LIBRARY_ONLY", section: "all", claims: [], sources: [],
    ...overrides } as ResearchSignal;
}
const options = {hasTrackedEntities: true, withinWindow: (item: ResearchSignal) => item.id !== "outside"};

test("verified in-window official announcement without execution entry is Must Read", () => {
  const item = card("announcement");
  const result = assignReadingAttention([item], options);
  assert.equal(result.mainCount, 1);
  assert.equal(item.attentionDecision, "MUST_READ");
  assert.equal(item.actionabilityStatus, "REVIEW_FIRST");
  assert.equal(item.hasExecutableAction, undefined);
});

test("one main per entity attaches only independently qualified messages newest first", () => {
  const main = card("main", {overallScore: 99});
  const older = card("older", {publishedAt: "2026-10-18T08:00:00Z"});
  const newer = card("newer", {publishedAt: "2026-10-19T08:00:00Z"});
  const ineligible = card("weak", {reliabilityScore: 69});
  const outside = card("outside");
  const items = [older, ineligible, newer, main, outside];
  const result = assignReadingAttention(items, options);
  assert.equal(result.mainCount, 1);
  assert.deepEqual(main.relatedUpdates?.map(item => item.id), ["newer", "older"]);
  assert.deepEqual([...result.attachedIds].sort(), ["newer", "older"]);
  assert.equal(ineligible.attentionDecision, "LIBRARY_ONLY");
  assert.equal(outside.attentionDecision, "LIBRARY_ONLY");
  const summary = buildFilteringSummary({retrievedCount: 5, clusteredCount: 5, allSignals: items, displayedSignals: [main, ineligible]});
  assert.equal(summary.displayedCount, 2, "nested messages do not count as main cards");
  assert.equal(summary.filteringDetails?.filter(row => row.decision === "displayed").length, 4, "nested evidence remains accepted in traces");
});

test("unverified, conflicting, uncertain and out-of-window candidates never enter Must Read", () => {
  for (const overrides of [{verificationStatus: "unverified"}, {verificationStatus: "conflicting"},
    {topicRelevance: {decision: "UNCERTAIN"}}, {topicRelevance: undefined}, {timestampStatus: "future"},
    {relevanceScore: 74}, {noveltyScore: 59}, {judgementImpactScore: 47}, {eventStatus: "SIGNAL"},
    {eventStatus: "BACKGROUND"}, {contentQuality: "INSUFFICIENT_CONTENT"}, {entityMatches: []}]) {
    const item = card("blocked", overrides as Partial<ResearchSignal>);
    assert.equal(assignReadingAttention([item], options).mainCount, 0);
  }
  assert.equal(assignReadingAttention([card("outside")], options).mainCount, 0);
});

test("TEST_NOW ranks first within Must Read without increasing the five-main cap", () => {
  const items = Array.from({length: 7}, (_, i) => card(`item-${i}`, {entityMatches: [`entity-${i}`], overallScore: 90-i}));
  items[6].actionabilityStatus = "TEST_NOW";
  const extra = card("extra", {entityMatches: ["entity-6"]});
  const result = assignReadingAttention([...items, extra], options);
  assert.equal(result.mainCount, 5);
  assert.equal(items[6].attentionDecision, "MUST_READ");
  assert.ok(result.attachedIds.has("extra"));
  assert.equal(items[4].attentionDecision, "LIBRARY_ONLY");
});


test("nested messages count in their own provider diagnostics without becoming main cards", async () => {
  const {buildSourceDiagnostics} = await import("../research/research-pipeline.ts");
  const main = card("main", {sourceUrl: "https://official.example/main"});
  const child = card("child", {sourceUrl: "https://other.example/child"});
  main.relatedUpdates = [child];
  const diagnostics = buildSourceDiagnostics([
    {source: "Official", providerId: "official", searched: true, resultCount: 1, execution: "searched_with_results"},
    {source: "Other", providerId: "other", searched: true, resultCount: 1, execution: "searched_with_results"},
  ], [{url: main.sourceUrl, providerId: "official"}, {url: child.sourceUrl, providerId: "other"}] as import("../research/types.ts").ResearchCandidate[], [main], {});
  assert.equal(diagnostics.find(row => row.providerId === "other")?.displayedCount, 1);
  assert.equal(diagnostics.find(row => row.providerId === "official")?.displayedCount, 1);
});


test("day presentation preserves TEST_NOW priority within the same attention tier", async (t) => {
  t.mock.timers.enable({apis: ["Date"], now: new Date("2026-10-20T09:00:00Z")});
  const {selectTodayPresentation} = await import("../information/today-selection.ts");
  const publishedAt = new Date(Date.now() - 3600000).toISOString();
  const reading = card("read", {publishedAt, attentionDecision: "MUST_READ", overallScore: 99});
  const testable = card("try", {publishedAt, attentionDecision: "MUST_READ", actionabilityStatus: "TEST_NOW", overallScore: 80});
  assert.deepEqual(selectTodayPresentation([reading, testable]).mustRead.map(item => item.id), ["try", "read"]);
});
