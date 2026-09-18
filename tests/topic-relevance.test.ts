import assert from "node:assert/strict";
import test from "node:test";

import { evaluateEvidence } from "../agent/evaluation.ts";
import { updateKnowledgeFromChanges } from "../agent/knowledge-updater.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { buildFilteringSummary } from "../research/filtering-summary.ts";
import { assessTopicRelevance } from "../research/topic-relevance.ts";
import type { QueryPlan, ResearchSignal } from "../research/types.ts";

const videoPlan: QueryPlan = {
  originalNeed: "AI assisted video editing and automatic rough cut workflows",
  coreKeywords: ["AI", "video", "editing", "rough cut", "batch processing"],
  englishKeywords: ["artificial intelligence"],
  synonyms: ["automatic editing"],
  entities: [],
  industryKeywords: ["video production"],
  changeKeywords: [],
  knowledgeAwareQueries: [],
  searchCombinations: ["AI video editing"],
  retrievalWindows: ["30d"],
  requestedFreshnessWindow: "30d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-1",
    category: "匹配",
    channel: "官方",
    title: "Video editing model selects shots automatically",
    summary: "A primary paper evaluates automatic rough cuts for multi-asset video workflows.",
    time: "1d",
    truth: 92,
    baseUseful: 90,
    lead: 80,
    tags: ["video"],
    action: "review",
    why: "matches the question",
    official: [],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: "https://arxiv.org/abs/1234.5678",
    publisher: "arXiv",
    publishedAt: "2026-09-17T00:00:00.000Z",
    firstSeenAt: "2026-09-17T00:00:00.000Z",
    retrievedAt: "2026-09-17T00:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 92,
    verificationStatus: "verified",
    topicRelevance: { decision: "MATCH", matchedTerms: ["video"], score: 75 },
    relevanceScore: 90,
    reliabilityScore: 92,
    freshnessScore: 90,
    noveltyScore: 80,
    judgementImpactScore: 80,
    gapMatchScore: 80,
    overallScore: 88,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 1,
    claims: [],
    sources: [],
    section: "must_know",
    gapMatches: [],
    questionMatches: ["video editing"],
    entityMatches: [],
    whyItMatters: "It answers the current question.",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]) {
  return {
    signals,
    status: [],
    queryPlan: videoPlan,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-09-17T00:00:00.000Z",
    dataMode: "live" as const,
  };
}

test("medical AI evidence is rejected by topic relevance for a video editing query", () => {
  const relevance = assessTopicRelevance(
    "AI dataset for colorectal polyp detection and medical imaging",
    videoPlan,
  );

  assert.equal(relevance.decision, "TOPIC_MISMATCH");
  assert.deepEqual(relevance.matchedTerms, []);
  assert.equal(relevance.score, 0);
});

test("matching arXiv video editing evidence remains eligible for evaluation", () => {
  const relevance = assessTopicRelevance(
    "Automatic video editing with rough cut and shot selection for multi-asset workflows",
    videoPlan,
  );

  assert.equal(relevance.decision, "MATCH");
  assert.ok(relevance.matchedTerms.includes("video"));
  const evaluation = evaluateEvidence(response([
    signal({ topicRelevance: relevance }),
  ]), 1, 1);
  assert.equal(evaluation.sufficientEvidence, true);
  assert.equal(evaluation.decision, "STOP");
});

test("high reliability cannot override a topic mismatch", () => {
  const evaluation = evaluateEvidence(response([
    signal({
      title: "AI dataset for colorectal polyp detection",
      summary: "A primary medical imaging dataset paper.",
      topicRelevance: {
        decision: "TOPIC_MISMATCH",
        matchedTerms: [],
        score: 0,
      },
      reliabilityScore: 99,
      verificationStatus: "verified",
    }),
  ]), 1, 1);

  assert.equal(evaluation.sufficientEvidence, false);
  assert.equal(evaluation.decision, "STOP");
});

test("topic mismatch is rejected before knowledge persistence", async () => {
  const repository = new InMemorySignalRepository();
  const mismatched = signal({
    title: "AI dataset for colorectal polyp detection",
    topicRelevance: { decision: "TOPIC_MISMATCH", matchedTerms: [], score: 0 },
  });
  const result = await updateKnowledgeFromChanges({
    context: { authenticatedUserId: "user-1", filterId: "filter-1" },
    repository,
    response: response([mismatched]),
    changes: [{
      signalId: mismatched.id,
      classification: "NEW",
      supportingEvidenceIds: [],
      previousRevision: 0,
      currentRevision: 1,
      reason: "verified",
    }],
    runId: "run-1",
    now: "2026-09-17T00:00:00.000Z",
  });

  assert.deepEqual(result.evidenceIds, []);
  assert.deepEqual(result.persistedChanges, []);
  assert.equal(repository.listEvidence().length, 0);
});

test("topic mismatch exposes a stable filtering reason", () => {
  const summary = buildFilteringSummary({
    retrievedCount: 1,
    clusteredCount: 1,
    allSignals: [signal({
      topicRelevance: { decision: "TOPIC_MISMATCH", matchedTerms: [], score: 0 },
      attentionDecision: "IGNORE",
    })],
    displayedSignals: [],
  });

  assert.equal(summary.filteredReasons.topicMismatch, 1);
  assert.equal(summary.filteringDetails?.[0]?.reason, "TOPIC_MISMATCH");
});
