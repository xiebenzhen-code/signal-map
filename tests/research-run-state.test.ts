import assert from "node:assert/strict";
import test from "node:test";

import { ResearchRunState, mergeRoundAttempts } from "../agent/research-run-state.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const sourceUrl = overrides.sourceUrl ?? "https://example.com/evidence";
  const title = overrides.title ?? "Codex update";
  const summary = overrides.summary ?? "Codex added a workflow update.";
  const verificationStatus = overrides.verificationStatus ?? "unverified";
  const sourceType = overrides.sourceType ?? "social";
  const sourceTier = overrides.sourceTier ?? "C";
  const informationType = overrides.informationType ?? "SIGNAL";
  return {
    id: overrides.id ?? "signal-1",
    category: "匹配",
    channel: "社区",
    title,
    summary,
    time: "1h",
    truth: overrides.truth ?? 40,
    baseUseful: 80,
    lead: 80,
    tags: ["Codex"],
    action: "read",
    why: "new",
    official: [],
    social: [],
    sourceType,
    sourceTier,
    sourceUrl,
    publisher: overrides.publisher ?? "Example",
    publishedAt: "2026-09-14T00:00:00.000Z",
    firstSeenAt: "2026-09-14T00:00:00.000Z",
    retrievedAt: "2026-09-14T00:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: overrides.confidence ?? 40,
    verificationStatus,
    relevanceScore: 80,
    reliabilityScore: overrides.reliabilityScore ?? 35,
    freshnessScore: 80,
    noveltyScore: 80,
    judgementImpactScore: 70,
    gapMatchScore: 70,
    overallScore: 75,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 0,
    claims: overrides.claims ?? [{
      claimText: title,
      sourceUrl,
      publisher: overrides.publisher ?? "Example",
      publishedAt: "2026-09-14T00:00:00.000Z",
      sourceType,
      sourceTier,
      evidenceSnippet: summary,
      verificationStatus,
      contentType: informationType === "SIGNAL" ? "SIGNAL" : "FACT",
      evidenceSources: [],
      independentEvidenceCount: 1,
    }],
    sources: overrides.sources ?? [{
      sourceUrl,
      publisher: overrides.publisher ?? "Example",
      publishedAt: "2026-09-14T00:00:00.000Z",
      sourceType,
      sourceTier,
    }],
    section: "emerging",
    gapMatches: [],
    questionMatches: [],
    entityMatches: ["Codex"],
    whyItMatters: "It may affect the user workflow.",
    eventStatus: "NEW",
    informationType,
    knowledgeStatus: "NOVEL",
    attentionDecision: "WORTH_WATCHING",
    ...overrides,
  };
}

function response(signals: ResearchSignal[], overrides: Partial<ResearchResponse> = {}): ResearchResponse {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-09-14T00:00:00.000Z",
    dataMode: "live",
    ...overrides,
  };
}

test("mergeRoundResponse carries evidence forward across empty later rounds", () => {
  const state = new ResearchRunState();
  const first = state.mergeRoundResponse(response([signal()]));
  const second = state.mergeRoundResponse(response([]));

  assert.equal(first.roundEvidenceCount, 1);
  assert.equal(first.cumulativeEvidenceCount, 1);
  assert.equal(second.roundEvidenceCount, 0);
  assert.equal(second.cumulativeEvidenceCount, 1);
  assert.equal(second.carriedForwardEvidenceCount, 1);
  assert.equal(second.verificationOutcome, "carried_forward_without_new_verification");
  assert.equal(state.cumulativeResponse?.signals.length, 1);
});

test("providerFailureSnapshot preserves existing cumulative evidence", () => {
  const state = new ResearchRunState();
  state.mergeRoundResponse(response([signal()]));
  const snapshot = state.providerFailureSnapshot();

  assert.equal(snapshot.roundEvidenceCount, 0);
  assert.equal(snapshot.cumulativeEvidenceCount, 1);
  assert.equal(snapshot.carriedForwardEvidenceCount, 1);
  assert.equal(snapshot.verificationOutcome, "provider_failure_carried_forward");
});

test("same evidence is not duplicated and stronger verification metadata wins", () => {
  const state = new ResearchRunState();
  const sourceUrl = "https://example.com/same";
  state.mergeRoundResponse(response([signal({ sourceUrl, verificationStatus: "unverified", reliabilityScore: 35, confidence: 40 })]));
  const snapshot = state.mergeRoundResponse(response([signal({
    id: "signal-verified",
    sourceUrl,
    sourceType: "primary",
    sourceTier: "S",
    informationType: "FACT",
    verificationStatus: "verified",
    reliabilityScore: 92,
    confidence: 92,
  })]));

  assert.equal(snapshot.roundEvidenceCount, 1);
  assert.equal(snapshot.cumulativeEvidenceCount, 1);
  assert.equal(state.cumulativeResponse?.signals.length, 1);
  assert.equal(state.cumulativeResponse?.signals[0]?.verificationStatus, "verified");
  assert.equal(state.cumulativeResponse?.signals[0]?.claims.length, 1);
  assert.equal(state.cumulativeResponse?.signals[0]?.claims[0]?.verificationStatus, "verified");
  assert.equal(state.cumulativeResponse?.signals[0]?.reliabilityScore, 92);
});

test("round attempt merge preserves source outcome counts before cumulative merge", () => {
  const first = response([], {
    sourceOutcomes: [{
      sourceType: "GENERAL_WEB",
      providerId: "public-web",
      executed: true,
      resultCount: 0,
      requestCount: 1,
      newEvidenceCount: 0,
      newClaimCount: 0,
      reliabilityGain: 0,
      conflictReduction: 0,
    }],
  });
  const second = response([signal()], {
    sourceOutcomes: [{
      sourceType: "GENERAL_WEB",
      providerId: "public-web",
      executed: true,
      resultCount: 1,
      requestCount: 1,
      newEvidenceCount: 1,
      newClaimCount: 1,
      reliabilityGain: 35,
      conflictReduction: 0,
    }],
  });
  const merged = mergeRoundAttempts(first, second);

  assert.equal(merged.sourceOutcomes?.[0]?.resultCount, 1);
  assert.equal(merged.sourceOutcomes?.[0]?.requestCount, 2);
  assert.equal(merged.sourceOutcomes?.[0]?.newEvidenceCount, 1);
});
