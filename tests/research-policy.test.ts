import assert from "node:assert/strict";
import test from "node:test";

import { chooseResearchStrategy } from "../agent/research-policy.ts";
import { createResearchPlan } from "../agent/query-planner.ts";
import { assessSignalActionability } from "../research/actionability.ts";
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

test("high-relevance academic evidence stays library-only without an executable action", () => {
  const result = assessSignalActionability({
    title: "A video editing research paper proposes a new shot selection method",
    summary: "The arXiv manuscript evaluates the method on a benchmark dataset.",
    sourceUrl: "https://arxiv.org/abs/1234.5678",
    tags: ["AI video editing", "shot selection"],
    sourceType: "primary",
    sourceTier: "S",
    eventStatus: "NEW",
    knowledgeStatus: "NOVEL",
    noveltyScore: 90,
    relevanceScore: 92,
    reliabilityScore: 92,
    freshnessScore: 90,
    verificationStatus: "verified",
    informationType: "FACT",
  });

  assert.equal(result.actionabilityStatus, "LIBRARY_ONLY");
  assert.equal(result.hasExecutableAction, false);
  assert.match(result.action, /研究资料|立即测试/);
  assert.doesNotMatch(result.action, /Demo|Model Card|代码入口|运行一个最小样例/);
  assert.equal(result.executionEntry, undefined);
});

test("a public API or workflow entry creates a test-now candidate", () => {
  const result = assessSignalActionability({
    title: "New batch video editing API release",
    summary: "The public API and quickstart support automated rough cuts and export.",
    sourceUrl: "https://example.com/docs/video-api",
    tags: ["AI video editing", "batch processing"],
    sourceType: "primary",
    sourceTier: "S",
    eventStatus: "NEW",
    knowledgeStatus: "NOVEL",
    noveltyScore: 90,
    relevanceScore: 92,
    reliabilityScore: 92,
    freshnessScore: 90,
    verificationStatus: "verified",
    informationType: "FACT",
  });

  assert.equal(result.actionabilityStatus, "TEST_NOW");
  assert.equal(result.hasExecutableAction, true);
  assert.match(result.action, /API|最小/);
  assert.equal(result.executionEntry?.type, "API");
  assert.match(result.executionEntry?.evidence ?? "", /API|api/);
});

test("an explicit repository URL is the only code entry that can ground a test action", () => {
  const result = assessSignalActionability({
    title: "Video editing research implementation",
    summary: "The paper links to the source code repository for reproduction.",
    sourceUrl: "https://github.com/example/video-editing",
    tags: ["AI video editing"],
    sourceType: "primary",
    sourceTier: "S",
    eventStatus: "NEW",
    knowledgeStatus: "NOVEL",
    noveltyScore: 90,
    relevanceScore: 92,
    reliabilityScore: 92,
    freshnessScore: 90,
    verificationStatus: "verified",
    informationType: "FACT",
  });

  assert.equal(result.actionabilityStatus, "TEST_NOW");
  assert.equal(result.executionEntry?.type, "REPOSITORY");
  assert.match(result.action, /代码仓库/);
});

test("known evidence is explicitly marked as having no information gain", () => {
  const result = assessSignalActionability({
    title: "Known video workflow release",
    summary: "The same workflow capability is already documented in Knowledge.",
    sourceUrl: "https://example.com/release",
    tags: ["workflow"],
    sourceType: "primary",
    sourceTier: "S",
    eventStatus: "UPDATED",
    knowledgeStatus: "KNOWN",
    knownMatches: ["Known video workflow release"],
    noveltyScore: 30,
    relevanceScore: 92,
    reliabilityScore: 92,
    freshnessScore: 90,
    verificationStatus: "verified",
    informationType: "FACT",
  });

  assert.equal(result.informationGainStatus, "NO_INFORMATION_GAIN");
  assert.equal(result.actionabilityStatus, "LIBRARY_ONLY");
});

test("background evidence is separated from current actionability", () => {
  const result = assessSignalActionability({
    title: "Archived video editing workflow paper",
    summary: "A prior study describes a historical editing workflow.",
    sourceUrl: "https://example.com/archive",
    tags: ["research"],
    sourceType: "primary",
    sourceTier: "S",
    eventStatus: "BACKGROUND",
    knowledgeStatus: "NOVEL",
    noveltyScore: 80,
    relevanceScore: 90,
    reliabilityScore: 90,
    freshnessScore: 20,
    verificationStatus: "verified",
    informationType: "FACT",
  });

  assert.equal(result.actionabilityStatus, "BACKGROUND");
});
