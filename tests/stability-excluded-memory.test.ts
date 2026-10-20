import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { ResearchInput, ResearchResponse, ResearchSignal } from "../research/types.ts";

// Defect 4 acceptance: an excluded server-side memory must not influence the
// research context, the initial plan/queries, the model-planning input, the
// fallback or later rounds, or the INITIAL/REFRESH strategy. Runs the real
// runAgent with the in-memory repository and deterministic research/model
// stubs — no external service, no paid model.

const MARKER = "MARKER-UNRELATED-9F3K";
const context = { authenticatedUserId: "user-x", filterId: "filter-x" };

function baseInput(overrides: Partial<ResearchInput> = {}): ResearchInput {
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
    ...overrides,
  } as ResearchInput;
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: "2026-10-19T00:00:00.000Z", dataMode: "live",
  } as never;
}

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const publishedAt = new Date().toISOString();
  return {
    id: "event-1", category: "匹配", channel: "官方", title: "Shopify checkout adds Shop Pay installments",
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
    knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ", ...overrides,
  } as unknown as ResearchSignal;
}

function seed(repository: InMemorySignalRepository, text: string) {
  return repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text,
    structuredPayload: { verificationStatus: "verified" },
  } as never, "2026-10-14T00:00:00.000Z");
}

// --- A. Off-task same-entity memory never reaches any planning consumer ------

test("A: an off-task same-entity memory stays out of context, queries, and model input", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, `Shopify 安全扫描功能上线 ${MARKER}`);
  const captured: { contexts: string[]; queries: string[]; modelInputs: string[][] } =
    { contexts: [], queries: [], modelInputs: [] };
  const result = await runAgent({
    memoryParticipation: true,
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 1,
    modelAdapter: {
      status: "configured",
      planResearch: async ({ relatedKnowledge }) => {
        captured.modelInputs.push(relatedKnowledge);
        return { status: "configured", plan: { objective: "probe", queries: ["model-probe"], preferredSourceTypes: [], maxQueries: 1 } };
      },
    },
    onPlan: (plan) => captured.queries.push(...(plan.queries ?? [])),
    research: async (input) => {
      captured.contexts.push(input.knownInformation ?? "");
      return response([]);
    },
  });
  assert.ok(captured.contexts.length > 0, "the research callback must run");
  for (const known of captured.contexts) {
    assert.equal(known.includes(MARKER), false, "excluded memory must not enter the research context");
    assert.equal(known.includes("安全扫描"), false, "excluded memory text must not enter knownInformation");
  }
  for (const query of captured.queries) assert.equal(query.includes(MARKER), false, "excluded memory must not shape plan queries");
  for (const model of captured.modelInputs) {
    assert.equal(model.some((entry) => entry.includes(MARKER)), false, "excluded memory must not reach the model planner");
    assert.equal(model.some((entry) => entry.includes("安全扫描")), false);
  }
  // With no related memory, the repository being non-empty must not force REFRESH.
  assert.equal(result.plan.strategy, "INITIAL", "no related memory -> INITIAL strategy, not REFRESH");
});

// --- B. Related memory genuinely enters the consumers ------------------------

test("B: a genuinely related memory is selected and consumed everywhere", async () => {
  const repository = new InMemorySignalRepository();
  const relatedText = `Shopify checkout adds support for Shop Pay installments ${MARKER}`;
  seed(repository, relatedText);
  const captured: { contexts: string[]; modelInputs: string[][]; strategies: string[] } =
    { contexts: [], modelInputs: [], strategies: [] };
  const result = await runAgent({
    memoryParticipation: true,
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 1,
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
  const anyContext = captured.contexts.some((known) => known.includes(MARKER));
  assert.equal(anyContext, true, "the related memory must enter the research context");
  const anyModel = captured.modelInputs.some((model) => model.some((entry) => entry.includes(MARKER)));
  assert.equal(anyModel, true, "the related memory must reach the model planner");
  assert.ok(captured.strategies.includes("REFRESH"), "a related memory present -> REFRESH strategy");
  assert.equal(result.plan.strategy, "REFRESH");
});

// --- C. Fallback and later-round paths keep the exclusion --------------------

test("C: a fallback attempt still receives only the final selection", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, `Shopify 安全扫描功能上线 ${MARKER}`);
  let calls = 0;
  const contexts: string[] = [];
  const result = await runAgent({
    memoryParticipation: true,
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 1,
    research: async (input) => {
      calls += 1;
      contexts.push(input.knownInformation ?? "");
      // Empty primary triggers an ordered fallback; the fallback yields evidence.
      return calls === 1 ? response([]) : response([signal()]);
    },
  });
  assert.ok(calls >= 2, "empty primary must trigger a fallback attempt (two research calls)");
  assert.equal(result.status, "completed");
  for (const known of contexts) assert.equal(known.includes(MARKER), false, "fallback context must not carry the excluded memory");
});

test("C2: a later round's plan is rebuilt from the final selection only", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, `Shopify 安全扫描功能上线 ${MARKER}`);
  let round = 0;
  const contexts: string[] = [];
  const queries: string[] = [];
  const strategies: string[] = [];
  const result = await runAgent({
    memoryParticipation: true,
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 2,
    onPlan: (plan) => {
      queries.push(...(plan.queries ?? []));
      strategies.push(plan.strategy ?? "");
    },
    research: async (input, _plan, currentRound) => {
      round = currentRound;
      contexts.push(input.knownInformation ?? "");
      return currentRound === 1
        ? response([signal({ id: "r1", sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified" })])
        : response([]);
    },
  });
  assert.ok(round >= 2, "a second round must actually run");
  assert.ok(contexts.length >= 2, "the research callback must run in both rounds");
  for (const known of contexts) assert.equal(known.includes(MARKER), false, "later-round context must not carry the excluded memory");
  for (const query of queries) assert.equal(query.includes(MARKER), false, "any round's queries must not carry the excluded memory");
  // First round starts from INITIAL (no related memory survived selection);
  // later rounds legitimately switch strategy via policy — that is not a
  // memory leak, so only round 1 is pinned to INITIAL.
  assert.equal(strategies[0], "INITIAL", "round 1 starts INITIAL without related memory");
  assert.equal(result.plan.strategy, "ESCALATE_SOURCE");
});

// --- D. Persisted trace reflects the final selection -------------------------

test("D: the persisted RETRIEVE trace matches the final selection, not a snapshot", async () => {
  const repository = new InMemorySignalRepository();
  const excluded = seed(repository, `Shopify 安全扫描功能上线 ${MARKER}`);
  const related = seed(repository, "Shopify checkout adds support for Shop Pay installments");
  const result = await runAgent({
    memoryParticipation: true,
    input: baseInput(),
    userQuery: "Shopify checkout payment changes",
    context, repository, maxRounds: 1,
    research: async () => response([signal()]),
  });
  assert.notEqual(result.status, "failed");
  const metadata = repository.listRunMetadata(context)?.[0];
  assert.ok(metadata, "run metadata must be persisted");
  const retrieve = metadata.trace?.find((entry) => entry.state === "RETRIEVE");
  assert.ok(retrieve, "the RETRIEVE trace must be persisted");
  const inputSummary = String(retrieve.inputSummary ?? "");
  const outputSummary = String(retrieve.outputSummary ?? "");
  // The task-level exclusion (id + reason) is captured at add time.
  assert.equal(inputSummary.includes(excluded.id), true, "the excluded record id appears in the persisted trace input");
  assert.equal(inputSummary.includes("task_concepts_disjoint"), true, "the exclusion reason is recorded");
  // The selected record is present, the excluded one is absent from the final output summary.
  assert.equal(outputSummary.includes(related.text), true, "the final context contains the related record");
  assert.equal(outputSummary.includes(excluded.text), false, "the excluded record text is not in the final context");
  // The excluded text never appears in the final context at all.
  assert.equal(outputSummary.includes(MARKER), false, "the marker never reaches the final context");
});