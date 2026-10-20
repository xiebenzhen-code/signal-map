import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { ResearchInput, ResearchResponse, ResearchSignal } from "../research/types.ts";

// Bounded closeout cycle (2026-10-20): auto-memory participation in research
// is isolated by default. These tests pin the isolation contract and the
// write/read-back preservation — using the real runAgent with an in-memory
// repository and deterministic stubs (no external service, no paid model).

const MARKER = "MARKER-MEMORY-7Q2L";
const context = { authenticatedUserId: "user-iso", filterId: "filter-iso" };

function baseInput(): ResearchInput {
  return {
    identity: "builder",
    industry: "software",
    focusAreas: "",
    currentQuestions: "Shopify checkout payment changes",
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "Shopify",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  } as ResearchInput;
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: "2026-10-20T00:00:00.000Z", dataMode: "live",
  } as never;
}

function signal(): ResearchSignal {
  const publishedAt = new Date().toISOString();
  return {
    id: "event-1", category: "matching", channel: "official", title: "Shopify checkout adds Shop Pay installments",
    summary: "Shopify checkout now supports Shop Pay installments.", time: "1h", truth: 90, baseUseful: 90, lead: 80,
    tags: ["Shopify"], action: "read", why: "new", official: [], social: [],
    sourceType: "primary", sourceTier: "S", sourceUrl: "https://example.com/update",
    publisher: "Official", publishedAt, firstSeenAt: publishedAt, retrievedAt: publishedAt,
    timestampStatus: "valid", dataOrigin: "live", confidence: 90,
    verificationStatus: "verified", relevanceScore: 90, reliabilityScore: 90, freshnessScore: 90,
    noveltyScore: 80, judgementImpactScore: 80, gapMatchScore: 80, overallScore: 88,
    sourceCount: 1, independentEvidenceCount: 1, propagationCount: 0, claims: [], sources: [],
    topicRelevance: {
      decision: "MATCH", reason: "LEGACY_QUERY_TERM_MATCH", matchedTerms: ["shopify"],
      matchedQueryTerms: ["shopify"], matchedTaskConstraints: [], relevanceGateApplied: false,
      relevanceGatePassed: true, score: 75,
    },
    section: "must_know", gapMatches: ["checkout"], questionMatches: ["payment changes"],
    entityMatches: ["shopify"], whyItMatters: "new", eventStatus: "NEW", informationType: "FACT",
    knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ",
  } as unknown as ResearchSignal;
}

function seedRelatedKnowledge(repository: InMemorySignalRepository) {
  return repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: `Shopify checkout adds support for Shop Pay installments ${MARKER}`,
    structuredPayload: { verificationStatus: "verified" },
  } as never, "2026-10-14T00:00:00.000Z");
}

type Captured = { contexts: string[]; modelInputs: string[][]; strategies: string[] };

function captureRun(repository: InMemorySignalRepository, overrides: { memoryParticipation?: boolean } = {}): { captured: Captured; result: Promise<Awaited<ReturnType<typeof runAgent>>> } {
  const captured: Captured = { contexts: [], modelInputs: [], strategies: [] };
  const result = runAgent({
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 1,
    ...overrides,
    modelAdapter: {
      status: "configured",
      planResearch: async ({ relatedKnowledge }) => {
        captured.modelInputs.push(relatedKnowledge);
        return { status: "configured", plan: { objective: "probe", queries: ["model-probe"], preferredSourceTypes: [], maxQueries: 1 } };
      },
    },
    onPlan: (plan) => captured.strategies.push(plan.strategy ?? ""),
    research: async (input) => {
      captured.contexts.push(input.knownInformation ?? "");
      return response([signal()]);
    },
  });
  return { captured, result };
}

test("isolated by default: stored memory never shapes planning, model input or strategy", async () => {
  const repository = new InMemorySignalRepository();
  seedRelatedKnowledge(repository);
  const { captured, result } = captureRun(repository);
  const agentResult = await result;
  for (const known of captured.contexts) {
    assert.equal(known.includes(MARKER), false, "stored memory must not enter the research context");
  }
  for (const model of captured.modelInputs) {
    assert.equal(model.some((entry) => entry.includes(MARKER)), false, "stored memory must not reach the model planner");
  }
  assert.equal(agentResult.plan.strategy, "INITIAL", "isolated runs bootstrap INITIAL even with related memory stored");
});

test("isolated by default: cross-run strategies and attention preferences stay out", async () => {
  const repository = new InMemorySignalRepository();
  seedRelatedKnowledge(repository);
  repository.saveRunMetadata(context, {
    strategies: ["DEEPEN", "BROADEN"],
  } as never);
  repository.savePreference(context, {
    scopeType: "entity",
    scopeValue: "Shopify",
    feedbackType: "LOWER_ATTENTION",
  }, "2026-10-14T00:00:00.000Z");
  const { captured, result } = captureRun(repository);
  await result;
  assert.equal(captured.strategies.includes("DEEPEN"), false, "previous-run strategies must not carry over");
  assert.equal(captured.strategies.includes("BROADEN"), false, "previous-run strategies must not carry over");
});

test("isolated by default: writes and read-back still work", async () => {
  const repository = new InMemorySignalRepository();
  const { result } = captureRun(repository);
  const agentResult = await result;
  assert.ok(agentResult.knowledgeChanges.length > 0, "research results must still be saved under isolation");
  const stored = await Promise.resolve(repository.listPersonalKnowledge(context));
  assert.ok(
    stored.some((record) => record.text.includes("Shop Pay installments")),
    "saved knowledge must be readable back under isolation",
  );
});

test("explicit participation restores memory-shaped planning", async () => {
  const repository = new InMemorySignalRepository();
  seedRelatedKnowledge(repository);
  const { captured, result } = captureRun(repository, { memoryParticipation: true });
  const agentResult = await result;
  assert.equal(captured.contexts.some((known) => known.includes(MARKER)), true, "participating run must enter the research context");
  assert.equal(captured.modelInputs.some((model) => model.some((entry) => entry.includes(MARKER))), true, "participating run must reach the model planner");
  assert.equal(agentResult.plan.strategy, "REFRESH", "related memory present -> REFRESESH when participating");
});

test("the env switch re-enables participation and is revertible", async () => {
  const previous = process.env.SIGNAL_MAP_MEMORY_ISOLATION;
  try {
    delete process.env.SIGNAL_MAP_MEMORY_ISOLATION;
    const { memoryParticipates } = await import("../agent/memory-isolation.ts");
    assert.equal(memoryParticipates(), false, "unset env isolates by default");
    process.env.SIGNAL_MAP_MEMORY_ISOLATION = "participate";
    assert.equal(memoryParticipates(), true, "participate restores auto-memory");
    process.env.SIGNAL_MAP_MEMORY_ISOLATION = "anything-else";
    assert.equal(memoryParticipates(), false, "unknown values stay isolated");
    assert.equal(memoryParticipates({ memoryParticipation: true }), true, "explicit option wins over env");
  } finally {
    if (previous === undefined) delete process.env.SIGNAL_MAP_MEMORY_ISOLATION;
    else process.env.SIGNAL_MAP_MEMORY_ISOLATION = previous;
  }
});
