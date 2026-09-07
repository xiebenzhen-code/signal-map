import assert from "node:assert/strict";
import test from "node:test";

import { chooseResearchStrategy } from "../agent/research-policy.ts";
import { createResearchPlan } from "../agent/query-planner.ts";
import type { ResearchPolicyInput } from "../agent/types.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "policy-event", category: "匹配", channel: "官方", title: "Model X update", summary: "new detail", time: "1h",
    truth: 90, baseUseful: 90, lead: 80, tags: ["Model X"], action: "read", why: "test", official: [], social: [],
    sourceType: "primary", sourceTier: "S", sourceUrl: "https://example.com", publisher: "Official",
    publishedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(), retrievedAt: new Date().toISOString(),
    timestampStatus: "valid", dataOrigin: "live", confidence: 90, verificationStatus: "verified", relevanceScore: 90,
    reliabilityScore: 90, freshnessScore: 90, noveltyScore: 80, judgementImpactScore: 80, gapMatchScore: 80,
    overallScore: 90, sourceCount: 1, independentEvidenceCount: 1, propagationCount: 0, claims: [{
      claimText: "Model X update", sourceUrl: "https://example.com", publisher: "Official", sourceType: "primary", sourceTier: "S",
      evidenceSnippet: "update", verificationStatus: "verified", contentType: "FACT", evidenceSources: [], independentEvidenceCount: 1,
    }], sources: [], section: "must_know", gapMatches: [], questionMatches: [], entityMatches: ["model x"],
    whyItMatters: "test", eventStatus: "UPDATED", informationType: "FACT", knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return { signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never, overview: {} as never,
    coverage: { level: "Partial", usedProviders: ["x"], zeroResultProviders: [], notSearchedProviders: [], unavailableProviders: [], notConfiguredProviders: [], failedProviders: [], outcomes: [] },
    fetchedAt: new Date().toISOString(), dataMode: "live" };
}

function policy(overrides: Partial<ResearchPolicyInput> = {}): ResearchPolicyInput {
  return {
    currentEvidence: response([signal()]), relatedKnowledge: [], conflictState: {
      decision: "CONTINUE", sufficientEvidence: false, conflictDetected: false, conflictingClaims: [], informationGain: 1, reason: "more",
    }, sourceCoverage: response([]).coverage, freshnessState: "fresh", reliabilityState: "high", informationGain: 1,
    round: 1, maxRounds: 3, previousStrategies: [], ...overrides,
  };
}

test("social-only evidence escalates to a stronger source", () => {
  assert.equal(chooseResearchStrategy(policy({ currentEvidence: response([signal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL" })]), reliabilityState: "low" })).strategy, "ESCALATE_SOURCE");
});

test("conflict has the highest policy priority", () => {
  assert.equal(chooseResearchStrategy(policy({ conflictState: { decision: "CONTINUE", sufficientEvidence: false, conflictDetected: true, conflictingClaims: ["x"], informationGain: 1, reason: "conflict" } })).strategy, "VERIFY_CONFLICT");
});

test("fresh knowledge with stale evidence refreshes", () => {
  assert.equal(chooseResearchStrategy(policy({ relatedKnowledge: ["old state"], freshnessState: "stale" })).strategy, "REFRESH");
});

test("single-source evidence broadens and missing detail deepens", () => {
  assert.equal(chooseResearchStrategy(policy({ sourceCoverage: { ...response([]).coverage, usedProviders: ["github"] } })).strategy, "BROADEN");
  assert.equal(chooseResearchStrategy(policy({ sourceCoverage: { ...response([]).coverage, usedProviders: ["github", "official"] }, currentEvidence: response([signal({ claims: [] })]) })).strategy, "BROADEN");
});

test("high-reliability multi-source agreement stops", () => {
  const second = signal({ id: "second", sourceUrl: "https://official.example" });
  assert.equal(chooseResearchStrategy(policy({ currentEvidence: response([signal(), second]), sourceCoverage: { ...response([]).coverage, usedProviders: ["official", "github"] }, conflictState: { decision: "STOP", sufficientEvidence: true, conflictDetected: false, conflictingClaims: [], informationGain: 1, reason: "enough" } })).strategy, "STOP");
});

test("max rounds and no information gain stop", () => {
  assert.equal(chooseResearchStrategy(policy({ round: 3 })).strategy, "STOP");
  assert.equal(chooseResearchStrategy(policy({ round: 2, informationGain: 0, conflictState: { ...policy().conflictState, informationGain: 0 } })).strategy, "STOP");
});

test("planner changes queries for strategy", () => {
  const input = { identity: "builder", industry: "AI tools", focusAreas: "Codex", currentQuestions: "what changed", knownInformation: "", informationGaps: "", trackedEntities: "Codex", trackedEvents: "", userJudgements: "", evidenceHistory: "", freshnessWindow: "7d" };
  const refresh = createResearchPlan(input, 2, 3, [], "REFRESH");
  const conflict = createResearchPlan(input, 2, 3, [], "VERIFY_CONFLICT");
  assert.ok(refresh.queries.some((query) => query.includes("latest")));
  assert.ok(conflict.queries.some((query) => query.includes("conflicting")));
  assert.notDeepEqual(refresh.queries, conflict.queries);
});

test("policy trace is deterministic without historical strategies", () => {
  const first = chooseResearchStrategy(policy());
  const second = chooseResearchStrategy(policy());
  assert.deepEqual(first, second);
});
