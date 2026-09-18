import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptDiagnostics,
  qualityAcceptance,
  qualityMarkdown,
  producedEvidenceCountFromResponseData,
  rejectionAccounting,
  runCumulativeDiagnostics,
  actionabilityDiagnostics,
} from "../scripts/signal-map-agent-loop-e2e.mjs";

const trace = [
  {
    phase: "plan_finished",
    round: 1,
    diagnostic: { agentGeneratedQueries: ["discover"], selectedSourceType: "GENERAL_WEB" },
  },
  {
    phase: "search_started",
    round: 1,
    attemptId: "round-1-primary",
    attemptType: "primary",
    diagnostic: {
      agentGeneratedQueries: ["discover"],
      pipelineActualQueries: ["discover"],
      providerPlan: [{ providerId: "public-web", callAttempted: true }],
      retrievalPlanSource: "upstream_agent_plan",
    },
  },
  { phase: "search_finished", round: 1, attemptId: "round-1-primary", attemptType: "primary", itemCount: 12, durationMs: 10, diagnostic: { providerResponseCount: 12, providerOutcomes: [] } },
  { phase: "detail_fetch_finished", round: 1, attemptId: "round-1-primary", attemptType: "primary", itemCount: 5, durationMs: 5, diagnostic: { detailAttempted: 5, detailSucceeded: 5, detailFailed: 0 } },
  { phase: "aggregation_finished", round: 1, attemptId: "round-1-primary", attemptType: "primary", itemCount: 2, durationMs: 1, diagnostic: { inputCount: 5, deduplicatedCount: 2 } },
  { phase: "evidence_preservation_finished", round: 1, attemptId: "round-1-primary", attemptType: "primary", diagnostic: { roundEvidenceCount: 2, cumulativeEvidenceCount: 2, producedEvidenceCount: 2, acceptedEvidenceCount: 0, rejectedEvidenceCount: 2 } },
  { phase: "plan_finished", round: 1, attemptId: "round-1-fallback", attemptType: "fallback", diagnostic: { fallback: true, agentGeneratedQueries: ["verify"], selectedSourceType: "PRIMARY" } },
  { phase: "search_started", round: 1, attemptId: "round-1-fallback", attemptType: "fallback", diagnostic: { pipelineActualQueries: ["verify"], providerPlan: [{ providerId: "primary-web-search", callAttempted: true }] } },
  { phase: "search_finished", round: 1, attemptId: "round-1-fallback", attemptType: "fallback", itemCount: 0, durationMs: 10, diagnostic: { providerResponseCount: 0, providerOutcomes: [], providerErrorCodes: [{ providerName: "Primary", failureCode: "upstream_error" }] } },
  { phase: "evidence_preservation_finished", round: 1, attemptId: "round-1-fallback", attemptType: "fallback", diagnostic: { roundEvidenceCount: 0, cumulativeEvidenceCount: 2, producedEvidenceCount: 0, acceptedEvidenceCount: 0, rejectedEvidenceCount: 2 } },
];

test("quality report groups primary and fallback attempts without mixing counts", () => {
  const attempts = attemptDiagnostics(trace);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].search.returnedCount, 12);
  assert.equal(attempts[0].detailFetch.successCount, 5);
  assert.equal(attempts[0].detailFetch.attemptedCount, 5);
  assert.equal(attempts[0].detailFetch.failedCount, 0);
  assert.equal(attempts[0].aggregation.inputCount, 5);
  assert.equal(attempts[0].aggregation.deduplicatedCount, 2);
  assert.equal(attempts[0].evidence.preservation.cumulativeEvidenceCount, 2);
  assert.equal(attempts[1].search.returnedCount, 0);
  assert.equal(attempts[1].evidence.preservation.cumulativeEvidenceCount, 2);
});

test("quality acceptance requires final evidence and signal output", () => {
  assert.equal(qualityAcceptance({ status: 200, signalCount: 0, evidenceCount: 0 }, {
    evidenceDiagnostics: { producedEvidenceCount: 2, acceptedEvidenceCount: 0, rejectedEvidenceCount: 2, rejectedReason: { insufficientVerification: 2 }, rejectionAccountingComplete: true },
  }).status, "PARTIAL");
  assert.equal(qualityAcceptance({ status: 200, signalCount: 0, evidenceCount: 0 }, {
    evidenceDiagnostics: { producedEvidenceCount: 2, acceptedEvidenceCount: 0, rejectedEvidenceCount: 0, rejectedReason: "unavailable" },
  }).status, "FAIL");
  assert.equal(qualityAcceptance({ status: 200, signalCount: 1, evidenceCount: 1 }, {
    evidenceDiagnostics: { acceptedEvidenceCount: 1 },
  }).status, "PASS");
});

test("quality acceptance fails when rejection reasons do not cover rejected evidence", () => {
  assert.equal(qualityAcceptance({ status: 200, signalCount: 0, evidenceCount: 0 }, {
    evidenceDiagnostics: {
      producedEvidenceCount: 11,
      acceptedEvidenceCount: 0,
      rejectedEvidenceCount: 11,
      rejectedReason: "unavailable",
      rejectionAccountingComplete: false,
    },
  }).status, "FAIL");
});

test("markdown uses the same request and final counts", () => {
  const report = {
    acceptanceStatus: "PARTIAL",
    executionStatus: "PASS",
    qualityStatus: "PARTIAL",
    runCumulative: { retrievedCount: 12, cumulativeEvidenceCount: 2 },
    finalResponse: { displayedCount: 0, signalCount: 0, finalEvidenceCount: 0 },
    query: { original: "discover" },
    inference: { inferredIntent: "PRODUCT_UPDATE", freshnessMentionedByUser: "30d", freshnessInferred: "3d", freshnessTimeRange: "3d", sourcePreference: [], sourceSelection: {}, entitiesTopic: [] },
    retrieval: { retrievedCount: 12, evaluatedCount: 2, clusteredCount: 2, displayedCount: 0, search: { attempts: [], selectedSourceTypes: [], discoveryMode: true, verificationSourceTypes: [], sourceSelectionReason: "discover", resolvedEntities: [], agentGeneratedQueries: ["discover"], pipelineActualQueries: ["discover"], searchProvider: [], providerCallAttempted: [], providerReturnedCount: [], emptyResultReason: "all_results_empty", fallbackUsed: true, retrievalPlanSource: "upstream_agent_plan", fallbackReason: "empty" }, detailFetch: {}, aggregation: {} },
    planning: {}, sources: [], filtered: { summaryText: "none", reasonCounts: {}, evaluation: {}, sampleFilteredResults: [] },
    evidenceDiagnostics: { candidateCount: 2, discoveredCandidateCount: 12, producedEvidenceCount: 2, evaluatedEvidenceCount: 2, cumulativeEvidenceCount: 2, acceptedEvidenceCount: 0, rejectedEvidenceCount: 2, finalEvidenceCount: 0, rejectedReason: { insufficientVerification: 2 }, preservation: { cumulativeEvidenceCount: 2, carriedForwardEvidenceCount: 2, finalEvidenceCount: 0, rejectionReason: { insufficientVerification: 2 } }, run: { cumulativeEvidenceCount: 2 }, final: { finalEvidenceCount: 0 } },
    evidence: [], result: { finalNaturalLanguageConclusion: "unavailable", recommendedUserTests: "unavailable" },
    state: { requestId: "request-1", httpStatus: 200, latencyMs: 10, lastPhase: "response_finished", lastSuccessfulPhase: "response_finished", knowledgeWriteCount: 0, attentionDecision: "unavailable", statefulSecondRun: "unavailable", traceStates: [] },
  };
  const markdown = qualityMarkdown(report);
  assert.match(markdown, /request-1/);
  assert.match(markdown, /executionStatus: `PASS`/);
  assert.match(markdown, /qualityStatus: `PARTIAL`/);
  assert.match(markdown, /runCumulative: .*retrievedCount.*12/);
  assert.match(markdown, /finalResponse: .*finalEvidenceCount.*0/);
  assert.match(markdown, /cumulativeEvidenceCount: 2/);
  assert.match(markdown, /finalEvidenceCount: 0/);
});

test("produced evidence count is sourced only from evidenceRecords", () => {
  assert.equal(producedEvidenceCountFromResponseData({ evidenceRecords: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], evidenceAccounting: { producedEvidenceCount: 12 } }), 4);
  assert.equal(producedEvidenceCountFromResponseData({ evidenceAccounting: { producedEvidenceCount: 12 } }), "unavailable");
});

test("run cumulative retrieval keeps primary attempt results when fallback is empty", () => {
  const attempts = attemptDiagnostics(trace);
  const cumulative = runCumulativeDiagnostics(attempts, {
    producedEvidenceCount: 4,
    cumulativeEvidenceCount: 4,
  });
  assert.equal(cumulative.retrievedCount, 12);
});

test("candidate counts cannot inflate produced Evidence count", () => {
  assert.equal(producedEvidenceCountFromResponseData({
    overview: { scanned: 12, events: 12 },
    evidenceRecords: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    evidenceAccounting: { discoveredCandidateCount: 12, producedEvidenceCount: 12 },
    sourceOutcomes: [{ resultCount: 12, newEvidenceCount: 12 }],
  }), 4);
});

test("partial rejection mapping reports unclassified rejected Evidence", () => {
  assert.deepEqual(rejectionAccounting(12, [{ insufficientVerification: 5 }]), {
    primaryRejectionReasonCounts: { insufficientVerification: 5 },
    rejectionReasonOccurrences: 5,
    evidenceWithMappedPrimaryReasonCount: 5,
    unclassifiedRejectedEvidenceCount: 7,
    rejectionAccountingComplete: false,
  });
});

test("complete rejection mapping is explicitly complete", () => {
  assert.deepEqual(rejectionAccounting(12, [{ insufficientVerification: 5, stale: 7 }]), {
    primaryRejectionReasonCounts: { insufficientVerification: 5, stale: 7 },
    rejectionReasonOccurrences: 12,
    evidenceWithMappedPrimaryReasonCount: 12,
    unclassifiedRejectedEvidenceCount: 0,
    rejectionAccountingComplete: true,
  });
});

test("quality artifact exposes actionability, information gain, and grounded execution entry", () => {
  const diagnostics = actionabilityDiagnostics([{
    title: "Video API release",
    action: "打开公开 API/SDK 文档，用一个最小输入完成一次调用并记录结果。",
    actionabilityStatus: "TEST_NOW",
    informationGainStatus: "NEW_INFORMATION",
    hasExecutableAction: true,
    executionEntry: { type: "API", evidence: "公开 API 文档", sourceUrl: "https://example.com/docs/api" },
  }]);

  assert.deepEqual(diagnostics[0], {
    title: "Video API release",
    action: "打开公开 API/SDK 文档，用一个最小输入完成一次调用并记录结果。",
    actionabilityStatus: "TEST_NOW",
    informationGainStatus: "NEW_INFORMATION",
    hasExecutableAction: true,
    executionEntry: { type: "API", evidence: "公开 API 文档", sourceUrl: "https://example.com/docs/api" },
  });
});
