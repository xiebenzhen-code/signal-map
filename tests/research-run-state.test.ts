import assert from "node:assert/strict";
import test from "node:test";

import { ResearchRunState, mergeRoundAttempts } from "../agent/research-run-state.ts";
import { buildSourceCoverage } from "../research/source-coverage.ts";
import { recordsFromSignal } from "../information/rag-records.ts";
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

test("empty fallback keeps the non-empty filtering summary", () => {
  const state = new ResearchRunState();
  const overview = {
    scanned: 12, deduplicated: 5, events: 5, verified: 0, relevant: 5, mustKnow: 0,
    worthWatching: 0, libraryOnly: 5, ignored: 0, noiseReductionRate: 0, novelInformationRate: 0,
  };
  const summary = {
    retrievedCount: 12, clusteredCount: 5, displayedCount: 0,
    filteredReasons: { stale: 0, duplicate: 1, lowReliability: 1, insufficientVerification: 0, background: 0, lowNovelty: 0, unresolvedConflict: 0, lowActionability: 0, noInformationGain: 0, insufficientContent: 3 },
    summaryText: "discovered", filteringDetails: [],
  } as never;
  state.mergeRoundResponse(response([signal()], { overview, filteringSummary: summary }));
  const emptySummary = { retrievedCount: 0, clusteredCount: 0, displayedCount: 0, filteredReasons: (summary as { filteredReasons: unknown }).filteredReasons, summaryText: "empty", filteringDetails: [] } as never;
  state.mergeRoundResponse(response([], { overview: { scanned: 0, deduplicated: 0, events: 0, verified: 0, relevant: 0, mustKnow: 0, worthWatching: 0, libraryOnly: 0, ignored: 0, noiseReductionRate: 0, novelInformationRate: 0 }, filteringSummary: emptySummary }));
  assert.equal(state.cumulativeResponse?.filteringSummary?.retrievedCount, 12);
  assert.equal(state.cumulativeResponse?.overview.scanned, 12);
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

test("source outcome candidate counts do not count as cumulative evidence", () => {
  const state = new ResearchRunState();
  const snapshot = state.mergeRoundResponse(response([], {
    sourceOutcomes: [{
      sourceType: "GENERAL_WEB",
      providerId: "public-web",
      executed: true,
      resultCount: 12,
      requestCount: 1,
      newEvidenceCount: 12,
      newClaimCount: 12,
      reliabilityGain: 40,
      conflictReduction: 0,
    }],
  }));

  assert.equal(snapshot.roundEvidenceCount, 0);
  assert.equal(snapshot.cumulativeEvidenceCount, 0);
  assert.equal(state.cumulativeEvidenceCount, 0);
});

test("produced evidence accounting counts as cumulative evidence before displayed signals exist", () => {
  const state = new ResearchRunState();
  const hiddenEvidence = [
    signal({ id: "hidden-1", sourceUrl: "https://example.com/hidden-1" }),
    signal({ id: "hidden-2", sourceUrl: "https://example.com/hidden-2" }),
  ].flatMap((item) => recordsFromSignal(item).evidence);
  const snapshot = state.mergeRoundResponse(response([], {
    evidenceRecords: hiddenEvidence,
    evidenceAccounting: {
      discoveredCandidateCount: 12,
      producedEvidenceCount: 2,
      evaluatedEvidenceCount: 2,
      acceptedEvidenceCount: 0,
      rejectedEvidenceCount: 2,
      finalEvidenceCount: 0,
      rejectionReasons: {
        stale: 0,
        duplicate: 0,
        lowReliability: 0,
        insufficientVerification: 2,
        background: 0,
        lowNovelty: 0,
        unresolvedConflict: 0,
      },
    },
    sourceOutcomes: [{
      sourceType: "GENERAL_WEB",
      providerId: "public-web",
      executed: true,
      resultCount: 12,
      requestCount: 1,
      newEvidenceCount: 12,
      newClaimCount: 12,
      reliabilityGain: 40,
      conflictReduction: 0,
    }],
  }));

  assert.equal(snapshot.roundEvidenceCount, 2);
  assert.equal(snapshot.producedEvidenceCount, 2);
  assert.equal(snapshot.cumulativeEvidenceCount, 2);
  assert.equal(snapshot.acceptedEvidenceCount, 0);
  assert.equal(snapshot.rejectedEvidenceCount, 2);
  assert.equal(snapshot.finalEvidenceCount, 0);
  assert.deepEqual(snapshot.rejectionReason, {
    stale: 0,
    duplicate: 0,
    lowReliability: 0,
    insufficientVerification: 2,
    background: 0,
    lowNovelty: 0,
    unresolvedConflict: 0,
  });
  assert.equal(state.cumulativeEvidenceCount, 2);
});

test("cumulative produced evidence counts distinct signals across rounds", () => {
  const state = new ResearchRunState();
  state.mergeRoundResponse(response([signal()]));
  const snapshot = state.mergeRoundResponse(response([signal({
    id: "signal-2",
    sourceUrl: "https://example.com/evidence-2",
  })]));

  assert.equal(snapshot.cumulativeEvidenceCount, 2);
  assert.equal(state.cumulativeResponse?.evidenceAccounting?.producedEvidenceCount, 2);
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


test("coverage preserves concrete source history across skipped and failed slices", () => {
  const success = {source: "Official Feed · Krita News", sourceId: "krita", providerId: "registered-feeds", execution: "searched_with_results" as const, searched: true, resultCount: 20, requestCount: 1};
  const failure = {...success, source: "Official Feed · Chrome Releases", sourceId: "chrome", execution: "failed" as const, resultCount: 0, failureCode: "upstream_error" as const};
  const skipped = {...success, source: "Registered Feeds", sourceId: undefined, execution: "not_searched" as const, searched: false, resultCount: 0, requestCount: 0};
  const merged = mergeRoundAttempts(response([], {coverage: buildSourceCoverage([success, failure])}), response([], {coverage: buildSourceCoverage([skipped])}));
  assert.deepEqual(merged.coverage.usedProviders, [success.source]);
  assert.deepEqual(merged.coverage.failedProviders, [failure.source]);
  assert.deepEqual(merged.coverage.notSearchedProviders, []);
  assert.equal(merged.coverage.outcomes.length, 3);
  const retried = mergeRoundAttempts(merged, response([], {coverage: buildSourceCoverage([{...failure, source: success.source}])}));
  assert.deepEqual(retried.coverage.usedProviders, [success.source]);
  assert.ok(retried.coverage.failedProviders.includes(success.source));
});
