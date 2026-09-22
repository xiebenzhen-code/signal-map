import assert from "node:assert/strict";
import test from "node:test";
import { runAgent } from "../agent/runner.ts";
import { updateKnowledgeFromChanges } from "../agent/knowledge-updater.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { recordsFromSignal } from "../information/rag-records.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const input = {
  identity: "builder", industry: "AI developer tools", focusAreas: "Codex",
  currentQuestions: "latest release", knownInformation: "Codex exists",
  informationGaps: "new workflow", trackedEntities: "Codex", trackedEvents: "",
  userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "event-1", category: "匹配", channel: "官方", title: "Codex update",
    summary: "New workflow", time: "1h", truth: 90, baseUseful: 90, lead: 80,
    tags: ["Codex"], action: "read", why: "new", official: [], social: [],
    sourceType: "primary", sourceTier: "S", sourceUrl: "https://example.com/update",
    publisher: "Official", publishedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(), timestampStatus: "valid", dataOrigin: "live", confidence: 90,
    verificationStatus: "verified", relevanceScore: 90, reliabilityScore: 90, freshnessScore: 90,
    noveltyScore: 80, judgementImpactScore: 80, gapMatchScore: 80, overallScore: 88,
    sourceCount: 1, independentEvidenceCount: 1, propagationCount: 0, claims: [], sources: [],
    section: "must_know", gapMatches: ["new workflow"], questionMatches: ["latest release"],
    entityMatches: ["codex"], whyItMatters: "new", eventStatus: "NEW", informationType: "FACT",
    knowledgeStatus: "NOVEL", attentionDecision: "MUST_READ", ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: new Date().toISOString(), dataMode: "live",
  };
}

function accountedEvidenceResponse(options: {
  discoveredCandidateCount: number;
  producedEvidenceCount: number;
  acceptedEvidenceCount?: number;
  providerId?: string;
  sourceUrl?: string;
}): ResearchResponse {
  const acceptedEvidenceCount = options.acceptedEvidenceCount ?? 0;
  const producedSignals = Array.from({ length: options.producedEvidenceCount }, (_, index) =>
    evidenceSignal({
      id: `accounted-${index}`,
      sourceUrl: index === 0 && options.sourceUrl ? options.sourceUrl : `https://example.com/accounted-${index}`,
      title: `Accounted evidence ${index}`,
      summary: `Evidence ${index} supports the research result.`,
      verificationStatus: acceptedEvidenceCount > index ? "verified" : "unverified",
    }),
  );
  const acceptedSignals = producedSignals.slice(0, acceptedEvidenceCount);
  return {
    ...response(acceptedSignals),
    evidenceRecords: producedSignals.flatMap((signal) => recordsFromSignal(signal).evidence),
    evidenceAccounting: {
      discoveredCandidateCount: options.discoveredCandidateCount,
      producedEvidenceCount: options.producedEvidenceCount,
      evaluatedEvidenceCount: options.producedEvidenceCount,
      acceptedEvidenceCount,
      rejectedEvidenceCount: Math.max(0, options.producedEvidenceCount - acceptedEvidenceCount),
      finalEvidenceCount: acceptedEvidenceCount,
      rejectionReasons: acceptedEvidenceCount < options.producedEvidenceCount
        ? { stale: 0, duplicate: 0, lowReliability: 0, insufficientVerification: options.producedEvidenceCount - acceptedEvidenceCount, background: 0, lowNovelty: 0, unresolvedConflict: 0 }
        : undefined,
    },
    sourceOutcomes: [{
      sourceType: "GENERAL_WEB",
      providerId: options.providerId ?? "public-web",
      executed: true,
      resultCount: options.discoveredCandidateCount,
      requestCount: 1,
      newEvidenceCount: options.discoveredCandidateCount,
      newClaimCount: 0,
      reliabilityGain: options.discoveredCandidateCount > 0 ? 40 : 0,
      conflictReduction: 0,
    }],
  };
}

function evidenceSignal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const base = signal(overrides);
  return {
    ...base,
    claims: overrides.claims ?? [{
      claimText: base.title,
      sourceUrl: base.sourceUrl,
      publisher: base.publisher,
      publishedAt: base.publishedAt,
      sourceType: base.sourceType,
      sourceTier: base.sourceTier,
      evidenceSnippet: base.summary,
      verificationStatus: base.verificationStatus,
      contentType: base.informationType === "SIGNAL" ? "SIGNAL" : "FACT",
      independentEvidenceCount: base.independentEvidenceCount,
      evidenceSources: [],
    }],
    sources: overrides.sources ?? [{
      sourceUrl: base.sourceUrl,
      publisher: base.publisher,
      publishedAt: base.publishedAt,
      sourceType: base.sourceType,
      sourceTier: base.sourceTier,
    }],
  };
}

const context = { authenticatedUserId: "guest-alpha", filterId: "filter-agent" };

test("stops after one round when reliable evidence is sufficient", async () => {
  let calls = 0;
  const result = await runAgent({ input, research: async () => { calls += 1; return response([signal()]); } });
  assert.equal(calls, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.evaluation.decision, "STOP");
});

test("continues from social-only evidence and caps at maxRounds", async () => {
  let calls = 0;
  const result = await runAgent({
    input, maxRounds: 3,
    research: async () => { calls += 1; return response([signal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified", attentionDecision: "WORTH_WATCHING" })]); },
  });
  assert.equal(calls, 3);
  assert.equal(result.rounds, 3);
  assert.equal(result.status, "needs_more_evidence");
});

test("CONTINUE persists evidence only and delays formal attention", async () => {
  const repository = new InMemorySignalRepository();
  let round = 0;
  const result = await runAgent({
    input, context, repository, maxRounds: 2,
    research: async () => {
      round += 1;
      return round === 1
        ? response([signal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified", attentionDecision: "MUST_READ" })])
        : response([]);
    },
  });
  assert.equal(repository.listPersonalKnowledge(context).length, 0);
  assert.equal(result.steps.filter((step) => step.state === "ATTENTION").length, 1);
  assert.deepEqual(result.attention, []);
});

test("multi-round research preserves round one evidence when round two has zero results", async () => {
  let round = 0;
  const result = await runAgent({
    input,
    maxRounds: 2,
    research: async () => {
      round += 1;
      return round === 1
        ? response([evidenceSignal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified", attentionDecision: "WORTH_WATCHING" })])
        : response([]);
    },
  });

  assert.equal(result.response?.signals.length, 1);
  assert.equal(result.response?.signals.flatMap((item) => item.claims).length, 1);
  assert.equal(result.evaluation.informationGain, 1);
});

test("multi-round research preserves evidence when later provider throws", async () => {
  let round = 0;
  const result = await runAgent({
    input,
    maxRounds: 2,
    research: async () => {
      round += 1;
      if (round === 1) {
        return response([evidenceSignal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified", attentionDecision: "WORTH_WATCHING" })]);
      }
      throw Object.assign(new Error("provider unavailable"), { code: "PROVIDER_UNAVAILABLE" });
    },
  });

  assert.notEqual(result.status, "failed");
  assert.equal(result.response?.signals.length, 1);
  assert.equal(result.response?.signals.flatMap((item) => item.claims).length, 1);
});

test("cumulative evidence completes gracefully when next round planning budget is unsafe", async () => {
  let calls = 0;
  const phases: Array<Parameters<NonNullable<Parameters<typeof runAgent>[0]["onPhase"]>>[0]> = [];
  const result = await runAgent({
    input,
    maxRounds: 2,
    deadlineAt: Date.now() + 8500,
    onPhase: (event) => phases.push(event),
    research: async () => {
      calls += 1;
      return response([evidenceSignal({
        sourceType: "social",
        sourceTier: "C",
        informationType: "SIGNAL",
        verificationStatus: "unverified",
        attentionDecision: "WORTH_WATCHING",
      })]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "needs_more_evidence");
  assert.equal(result.response?.signals.flatMap((item) => item.claims).length, 1);
  assert.ok(phases.some((event) =>
    event.phase === "budget_checked" &&
    event.diagnostic?.skippedNextRoundDueToBudget === true &&
    event.diagnostic?.cumulativeEvidenceCount === 1));
});

test("planning WORKER_DEADLINE after evidence returns cumulative result", async () => {
  let calls = 0;
  const result = await runAgent({
    input,
    maxRounds: 2,
    deadlineAt: Date.now() + 30000,
    modelAdapter: {
      status: "configured",
      async planResearch(request) {
        if (request.round === 2) throw Object.assign(new Error("planning deadline"), { code: "WORKER_DEADLINE" });
        return { status: "not_configured" };
      },
    },
    research: async () => {
      calls += 1;
      return response([evidenceSignal({
        sourceType: "social",
        sourceTier: "C",
        informationType: "SIGNAL",
        verificationStatus: "unverified",
        attentionDecision: "WORTH_WATCHING",
      })]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "needs_more_evidence");
  assert.equal(result.response?.signals.length, 1);
  assert.equal(result.response?.signals.flatMap((item) => item.claims).length, 1);
});

test("deadline after an empty research response returns needs_more_evidence with the deadline reason", async (t) => {
  let currentTime = 1_000_000;
  let calls = 0;
  const phases: Array<Parameters<NonNullable<Parameters<typeof runAgent>[0]["onPhase"]>>[0]> = [];
  t.mock.method(Date, "now", () => currentTime);

  const result = await runAgent({
    input,
    maxRounds: 2,
    deadlineAt: currentTime + 10_000,
    onPhase: (event) => phases.push(event),
    research: async () => {
      calls += 1;
      currentTime += 10_000;
      return response([]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "needs_more_evidence");
  assert.equal(result.reason, "deadline_exhausted_no_evidence");
  assert.deepEqual(result.response?.signals, []);
  assert.ok(phases.some((event) => event.errorCode === "WORKER_DEADLINE"));
  assert.equal(phases.some((event) => event.errorCode === "UNKNOWN_RESEARCH_FAILURE"), false);
});

test("unexpected exception with no evidence remains failed", async () => {
  const result = await runAgent({
    input,
    research: async () => {
      throw Object.assign(new Error("unexpected provider defect"), { code: "UNEXPECTED_TEST_FAILURE" });
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.response, undefined);
  assert.equal(result.reason, undefined);
});

test("primary attempt source evidence is merged before empty fallback", async () => {
  let calls = 0;
  const phases: Array<Parameters<NonNullable<Parameters<typeof runAgent>[0]["onPhase"]>>[0]> = [];
  const result = await runAgent({
    input,
    maxRounds: 1,
    onPhase: (event) => phases.push(event),
    research: async () => {
      calls += 1;
      return calls === 1
        ? accountedEvidenceResponse({ discoveredCandidateCount: 12, producedEvidenceCount: 2 })
        : accountedEvidenceResponse({ discoveredCandidateCount: 0, producedEvidenceCount: 0, providerId: "primary-web-search" });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, "needs_more_evidence");
  assert.equal(result.response?.sourceOutcomes?.reduce((count, outcome) => count + outcome.newEvidenceCount, 0), 12);
  assert.equal(result.response?.evidenceAccounting?.producedEvidenceCount, 2);
  assert.equal(result.response?.evidenceAccounting?.finalEvidenceCount, 0);
  assert.equal(result.response?.evidenceAccounting?.rejectedEvidenceCount, 2);
  assert.ok(result.response?.evidenceAccounting?.rejectionReasons);
  assert.ok(phases.some((event) =>
    event.phase === "evidence_preservation_finished" &&
    event.diagnostic?.attemptType === "primary" &&
    event.diagnostic?.cumulativeEvidenceCount === 2));
  assert.ok(phases.some((event) =>
    event.phase === "evidence_preservation_finished" &&
    event.diagnostic?.attemptType === "fallback" &&
    event.diagnostic?.cumulativeEvidenceCount === 2));
});

test("primary attempt source evidence survives fallback provider error", async () => {
  let calls = 0;
  const result = await runAgent({
    input,
    maxRounds: 1,
    research: async () => {
      calls += 1;
      if (calls === 1) return accountedEvidenceResponse({ discoveredCandidateCount: 12, producedEvidenceCount: 1 });
      throw Object.assign(new Error("fallback provider unavailable"), { code: "PROVIDER_UNAVAILABLE" });
    },
  });

  assert.equal(calls, 2);
  assert.notEqual(result.status, "failed");
  assert.equal(result.response?.evidenceAccounting?.producedEvidenceCount, 1);
});

test("fallback attempt can add verified evidence without duplicating primary source evidence count", async () => {
  let calls = 0;
  const result = await runAgent({
    input,
    maxRounds: 1,
    research: async () => {
      calls += 1;
      return calls === 1
        ? accountedEvidenceResponse({ discoveredCandidateCount: 12, producedEvidenceCount: 1, sourceUrl: "https://example.com/update" })
        : response([evidenceSignal({
            id: "verified-fallback",
            sourceUrl: "https://example.com/update",
            title: "Accounted evidence 0",
            summary: "Evidence 0 supports the research result.",
            sourceType: "primary",
            sourceTier: "S",
            verificationStatus: "verified",
            reliabilityScore: 92,
            confidence: 92,
          })]);
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.response?.signals.length, 1);
  assert.equal(result.response?.signals[0]?.verificationStatus, "verified");
  assert.equal(result.response?.signals.flatMap((item) => item.claims).length, 1);
  assert.equal(result.response?.evidenceAccounting?.producedEvidenceCount, 1);
  assert.equal(result.response?.evidenceAccounting?.acceptedEvidenceCount, 1);
  assert.equal(result.response?.evidenceAccounting?.finalEvidenceCount, 1);
});

test("STOP after fallback reports produced and final evidence separately", async () => {
  let calls = 0;
  const phases: Array<Parameters<NonNullable<Parameters<typeof runAgent>[0]["onPhase"]>>[0]> = [];
  await runAgent({
    input,
    maxRounds: 1,
    onPhase: (event) => phases.push(event),
    research: async () => {
      calls += 1;
      return calls === 1
        ? accountedEvidenceResponse({ discoveredCandidateCount: 12, producedEvidenceCount: 2 })
        : accountedEvidenceResponse({ discoveredCandidateCount: 0, producedEvidenceCount: 0, providerId: "primary-web-search" });
    },
  });

  const finalPreservation = phases.filter((event) => event.phase === "evidence_preservation_finished").at(-1);
  assert.equal(finalPreservation?.diagnostic?.producedEvidenceCount, 0);
  assert.equal(finalPreservation?.diagnostic?.cumulativeEvidenceCount, 2);
  assert.equal(finalPreservation?.diagnostic?.acceptedEvidenceCount, 0);
  assert.equal(finalPreservation?.diagnostic?.rejectedEvidenceCount, 2);
  assert.equal(finalPreservation?.diagnostic?.finalEvidenceCount, 0);
  assert.ok(finalPreservation?.diagnostic?.rejectionReason);
});

test("deadline without cumulative evidence does not fabricate a response", async () => {
  let calls = 0;
  const result = await runAgent({
    input,
    maxRounds: 2,
    deadlineAt: Date.now() + 1000,
    research: async () => {
      calls += 1;
      return response([evidenceSignal()]);
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.response, undefined);
});

test("verification of the same evidence updates metadata without duplicate accumulation", async () => {
  let round = 0;
  const sameSource = "https://example.com/same-evidence";
  const result = await runAgent({
    input,
    maxRounds: 2,
    research: async () => {
      round += 1;
      return round === 1
        ? response([evidenceSignal({
            id: "same-signal",
            sourceUrl: sameSource,
            sourceType: "social",
            sourceTier: "C",
            informationType: "SIGNAL",
            verificationStatus: "unverified",
            reliabilityScore: 35,
            confidence: 40,
            attentionDecision: "WORTH_WATCHING",
          })])
        : response([evidenceSignal({
            id: "same-signal-verified",
            sourceUrl: sameSource,
            sourceType: "primary",
            sourceTier: "S",
            informationType: "FACT",
            verificationStatus: "verified",
            reliabilityScore: 92,
            confidence: 92,
          })]);
    },
  });

  assert.equal(result.response?.signals.length, 1);
  assert.equal(result.response?.signals[0]?.claims.length, 1);
  assert.equal(result.response?.signals[0]?.verificationStatus, "verified");
  assert.equal(result.response?.signals[0]?.claims[0]?.verificationStatus, "verified");
  assert.equal(result.response?.signals[0]?.reliabilityScore, 92);
});

test("partially verified evidence is not committed while policy continues", async () => {
  const repository = new InMemorySignalRepository();
  let round = 0;
  await runAgent({
    input, context, repository, maxRounds: 3,
    research: async () => {
      round += 1;
      if (round === 2) assert.equal(repository.listPersonalKnowledge(context).length, 0);
      return response([signal({ verificationStatus: round === 1 ? "partially_verified" : "verified" })]);
    },
  });
  assert.equal(round, 2);
  assert.equal(repository.listPersonalKnowledge(context).length, 1);
});

test("unresolved conflict at maxRounds preserves old knowledge", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, { type: "KNOWN_INFORMATION", text: "Model X is available" }, "2026-09-05T00:00:00.000Z");
  const result = await runAgent({
    input, context, repository, maxRounds: 2,
    research: async () => response([signal({ title: "Model X is unavailable", verificationStatus: "conflicting" })]),
  });
  assert.equal(result.status, "needs_more_evidence");
  assert.deepEqual(result.attention, []);
  assert.deepEqual(repository.listPersonalKnowledge(context).map((record) => record.text), ["Model X is available"]);
});

test("conflicting evidence requests a more reliable next round", async () => {
  const result = await runAgent({ input, maxRounds: 2, research: async () => response([signal({ verificationStatus: "conflicting" })]) });
  assert.equal(result.evaluation.conflictDetected, true);
  assert.equal(result.evaluation.preferredNextSourceType, "primary");
});

test("knowledge comparison distinguishes duplicate, update, and contradiction", async () => {
  const result = await runAgent({
    input, maxRounds: 1, research: async () => response([
      signal({ id: "same", title: "Codex exists", knowledgeStatus: "KNOWN" }),
      signal({ id: "update", eventStatus: "UPDATED", knowledgeStatus: "UPDATED" }),
      signal({ id: "conflict", verificationStatus: "conflicting" }),
    ]),
  });
  assert.deepEqual(result.knowledgeChanges.map((change) => change.classification), ["DUPLICATE", "UPDATES", "CONTRADICTS"]);
});

test("runs without LLM, database, or embeddings using injected deterministic research", async () => {
  const result = await runAgent({ input, research: async () => response([]) });
  assert.equal(result.rounds, 1);
  assert.equal(result.trace.some((entry) => entry.state === "COMPLETE"), true);
});

test("Run A persists NEW knowledge and Run B retrieves it for planning", async () => {
  const repository = new InMemorySignalRepository();
  const plans: string[][] = [];

  await runAgent({
    input: { ...input, knownInformation: "" },
    context,
    repository,
    userQuery: "Did Model X launch?",
    research: async () => response([signal({
      id: "model-x-launch",
      title: "Model X is now released",
      summary: "Official release notes confirm Model X is available.",
      claims: [{
        claimText: "Model X is now released.",
        sourceUrl: "https://example.com/model-x",
        publisher: "Official",
        publishedAt: "2026-09-05T00:00:00.000Z",
        sourceType: "primary",
        sourceTier: "S",
        evidenceSnippet: "Model X is now released.",
        verificationStatus: "verified",
        contentType: "FACT",
        independentEvidenceCount: 1,
        evidenceSources: [],
      }],
    })]),
  });

  const runB = await runAgent({
    input: { ...input, knownInformation: "" },
    context,
    repository,
    userQuery: "Did Model X launch?",
    onPlan: (plan) => plans.push(plan.queries),
    research: async () => response([]),
  });

  assert.ok(repository.listPersonalKnowledge(context).some((record) => record.text.includes("Model X is now released")));
  assert.ok(plans[0].some((query) => query.toLowerCase().includes("latest")));
  assert.match(runB.steps.find((step) => step.state === "RETRIEVE")?.output as string, /Model X is now released/);
});

test("the first evidence is NEW_INFORMATION and an identical second run is deduplicated", async () => {
  const repository = new InMemorySignalRepository();
  const evidence = (sourceUrl: string, claimText: string) => evidenceSignal({
    id: `signal-${sourceUrl}`,
    title: claimText,
    summary: claimText,
    sourceUrl,
    claims: [{
      claimText,
      sourceUrl,
      publisher: "Official",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: claimText,
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
  });

  const first = await runAgent({
    input, context: { ...context, filterId: "filter-dedup-first" }, repository, maxRounds: 1,
    research: async () => response([evidence("https://example.com/video-tool", "Video tool supports batch processing")]),
  });
  assert.equal(first.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
  assert.equal(first.knowledgeChanges[0]?.classification, "NEW");

  const second = await runAgent({
    input, context: { ...context, filterId: "filter-dedup-first" }, repository, maxRounds: 1,
    research: async () => response([evidence("https://example.com/video-tool", "Video tool supports batch processing")]),
  });
  assert.equal(second.response?.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
  assert.equal(second.knowledgeChanges.length, 0);
  assert.equal(repository.getResearchContextRevision({ ...context, filterId: "filter-dedup-first" }), 2);
  assert.equal(repository.listPersonalKnowledge({ ...context, filterId: "filter-dedup-first" }).length, 1);
});

test("the same source with a changed claim is UPDATED_INFORMATION and advances Knowledge", async () => {
  const repository = new InMemorySignalRepository();
  const runContext = { ...context, filterId: "filter-dedup-update" };
  const makeEvidence = (claimText: string) => evidenceSignal({
    id: `signal-${claimText}`,
    title: claimText,
    summary: claimText,
    sourceUrl: "https://example.com/video-tool",
    claims: [{
      claimText,
      sourceUrl: "https://example.com/video-tool",
      publisher: "Official",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: claimText,
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
  });

  await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("Video tool supports batch processing")]),
  });
  const beforeRevision = repository.getResearchContextRevision(runContext);
  const updated = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("Video tool supports batch processing with multi-clip understanding")]),
  });
  assert.equal(updated.response?.signals[0]?.informationGainStatus, "UPDATED_INFORMATION");
  assert.equal(updated.knowledgeChanges[0]?.classification, "UPDATES");
  assert.equal(repository.getResearchContextRevision(runContext), beforeRevision + 1);
});

test("an equivalent claim from a different URL does not create a duplicate Knowledge record", async () => {
  const repository = new InMemorySignalRepository();
  const runContext = { ...context, filterId: "filter-dedup-equivalent" };
  const makeEvidence = (sourceUrl: string) => evidenceSignal({
    id: `signal-${sourceUrl}`,
    title: "Video tool supports batch processing",
    summary: "Video tool supports batch processing",
    sourceUrl,
    claims: [{
      claimText: "Video tool supports batch processing",
      sourceUrl,
      publisher: "Video Tools",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: "Video tool supports batch processing",
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
  });

  await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("https://example.com/video-tool")]),
  });
  const second = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("https://docs.example.com/video-tool")]),
  });
  assert.equal(second.response?.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
  assert.equal(second.knowledgeChanges.length, 0);
  assert.equal(repository.listPersonalKnowledge(runContext).length, 1);
});

test("an accepted synonym of an existing fact is retrieved and classified as no information gain", async () => {
  const repository = new InMemorySignalRepository();
  const runContext = { ...context, filterId: "filter-knowledge-duplicate-synonym" };
  const makeEvidence = (claimText: string) => evidenceSignal({
    id: `signal-${claimText}`,
    title: claimText,
    summary: claimText,
    sourceUrl: "https://example.com/palmier-pro",
    claims: [{
      claimText,
      sourceUrl: "https://example.com/palmier-pro",
      publisher: "Official",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: claimText,
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
  });

  const first = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("Palmier Pro launched an open-source AI video editor for macOS.")]),
  });
  assert.equal(first.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
  assert.equal(first.knowledgeChanges[0]?.classification, "NEW");
  assert.equal(repository.listPersonalKnowledge(runContext).length, 1);

  const second = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence("Palmier Pro launches an open-source AI video editor for macOS.")]),
  });
  const retrieved = second.steps.find((step) => step.state === "RETRIEVE")?.output;
  assert.match(String(retrieved), /Palmier Pro launched an open-source AI video editor for macOS/);
  assert.equal(second.response?.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
  assert.equal(second.knowledgeChanges.length, 0);
  assert.equal(repository.listPersonalKnowledge(runContext).length, 1);
});

test("an accepted same-source claim that adds a new capability updates knowledge without replacing the old fact", async () => {
  const repository = new InMemorySignalRepository();
  const runContext = { ...context, filterId: "filter-knowledge-supplement" };
  const oldClaim = "Palmier Pro launched an open-source AI video editor for macOS.";
  const newClaim = "Palmier Pro launched an open-source AI video editor for macOS and now supports automated rough cut and shot selection.";
  const makeEvidence = (claimText: string) => evidenceSignal({
    id: `signal-${claimText}`,
    title: claimText,
    summary: claimText,
    sourceUrl: "https://example.com/palmier-pro",
    claims: [{
      claimText,
      sourceUrl: "https://example.com/palmier-pro",
      publisher: "Official",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: claimText,
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
  });

  const first = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence(oldClaim)]),
  });
  assert.equal(first.knowledgeChanges[0]?.classification, "NEW");

  const second = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([makeEvidence(newClaim)]),
  });
  const retrieved = second.steps.find((step) => step.state === "RETRIEVE")?.output;
  const stored = repository.listPersonalKnowledge(runContext).map((record) => record.text);
  assert.match(String(retrieved), new RegExp(oldClaim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(second.response?.signals[0]?.informationGainStatus, "UPDATED_INFORMATION");
  assert.equal(second.knowledgeChanges[0]?.classification, "UPDATES");
  assert.equal(stored.filter((text) => text === oldClaim).length, 1);
  assert.equal(stored.filter((text) => text === newClaim).length, 1);
});

test("a conflicting claim about stored knowledge is classified as CONTRADICTS and does not replace it", async () => {
  const repository = new InMemorySignalRepository();
  const runContext = { ...context, filterId: "filter-knowledge-conflict" };
  const known = "Palmier Pro launched an open-source AI video editor for macOS.";
  const contradiction = "Palmier Pro did not launch an open-source AI video editor for macOS.";
  const first = await runAgent({
    input, context: runContext, repository, maxRounds: 1,
    research: async () => response([evidenceSignal({
      id: "palmier-known",
      title: known,
      summary: known,
      sourceUrl: "https://example.com/palmier-pro",
    })]),
  });
  assert.equal(first.knowledgeChanges[0]?.classification, "NEW");

  const second = await runAgent({
    input, context: runContext, repository,
    research: async () => response([evidenceSignal({
      id: "palmier-conflict",
      title: contradiction,
      summary: contradiction,
      sourceUrl: "https://news.example.com/palmier-denial",
      verificationStatus: "conflicting",
      reliabilityScore: 42,
    })]),
  });
  const retrieved = second.steps.find((step) => step.state === "RETRIEVE")?.output;
  assert.match(String(retrieved), /Palmier Pro launched/);
  assert.equal(second.response?.signals[0]?.verificationStatus, "conflicting");
  assert.equal(second.evaluation.conflictDetected, true);
  assert.equal(second.knowledgeChanges.some((change) => change.classification === "CONTRADICTS"), false);
  assert.equal(repository.listPersonalKnowledge(runContext).some((record) => record.text === contradiction), false);
  assert.equal(repository.listPersonalKnowledge(runContext).filter((record) => record.text === known).length, 1);
});

test("CONFIRMS updates provenance without duplicate knowledge or revision", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Codex is available",
  }, "2026-09-05T00:00:00.000Z");
  const beforeRevision = repository.getResearchContextRevision(context);

  const result = await runAgent({
    input,
    context,
    repository,
    research: async () => response([signal({
      id: "codex-confirm",
      title: "Codex is available",
      summary: "Official docs confirm Codex is available.",
      knowledgeStatus: "NOVEL",
    })]),
  });

  assert.equal(result.knowledgeChanges[0].classification, "CONFIRMS");
  assert.equal(repository.listPersonalKnowledge(context).filter((record) => record.text === "Codex is available").length, 1);
  assert.equal(repository.getResearchContextRevision(context), beforeRevision);
});

test("NO_INFORMATION_GAIN blocks a duplicate Knowledge write and revision", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Codex workflow supports batch review",
  }, "2026-09-05T00:00:00.000Z");
  const beforeRevision = repository.getResearchContextRevision(context);
  const duplicate = signal({
    id: "duplicate-actionability",
    title: "Codex workflow supports batch review",
    summary: "The same workflow fact is repeated without a new capability.",
    knowledgeStatus: "KNOWN",
    informationGainStatus: "NO_INFORMATION_GAIN",
    actionabilityStatus: "LIBRARY_ONLY",
  });

  const result = await runAgent({
    input,
    context,
    research: async () => response([duplicate]),
  });

  assert.equal(result.knowledgeChanges[0]?.classification, "DUPLICATE");
  assert.equal(repository.listPersonalKnowledge(context).length, 1);
  assert.equal(repository.getResearchContextRevision(context), beforeRevision);
});

test("UPDATED_INFORMATION permits a changed fact to update Knowledge", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Model X releaseStatus = false",
  }, "2026-09-05T00:00:00.000Z");
  const beforeRevision = repository.getResearchContextRevision(context);
  const updated = signal({
    id: "updated-actionability",
    title: "Model X releaseStatus = true",
    summary: "Official release evidence changes the previously known status.",
    eventStatus: "UPDATED",
    knowledgeStatus: "UPDATED",
    informationGainStatus: "UPDATED_INFORMATION",
    actionabilityStatus: "REVIEW_FIRST",
  });

  const result = await updateKnowledgeFromChanges({
    context,
    repository,
    response: response([updated]),
    changes: [{
      signalId: updated.id,
      classification: "UPDATES",
      supportingEvidenceIds: [],
      previousRevision: beforeRevision,
      currentRevision: beforeRevision + 1,
      reason: "UPDATED_INFORMATION",
    }],
    runId: "updated-actionability",
    now: "2026-09-06T00:00:00.000Z",
  });

  assert.equal(result.persistedChanges[0]?.classification, "UPDATES");
  assert.equal(repository.getResearchContextRevision(context), beforeRevision + 1);
  assert.ok(repository.listPersonalKnowledge(context).some((record) => record.text === updated.title));
});

test("UPDATES and CONTRADICTS create revisions while preserving previous knowledge", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Model X releaseStatus = false",
  }, "2026-09-05T00:00:00.000Z");
  const before = repository.getResearchContextRevision(context);

  await runAgent({
    input,
    context,
    repository,
    initialRevision: before,
    research: async () => response([
      signal({
        id: "model-x-updated",
        title: "Model X releaseStatus = true",
        summary: "Official source updates the release status.",
        eventStatus: "UPDATED",
        knowledgeStatus: "UPDATED",
      }),
      signal({
        id: "model-x-conflict",
        title: "Model X releaseStatus may still be false",
        summary: "A source conflicts with the current release status.",
        verificationStatus: "conflicting",
      }),
    ]),
  });

  const records = repository.listPersonalKnowledge(context);
  assert.ok(records.some((record) => record.text === "Model X releaseStatus = false"));
  assert.ok(records.some((record) => record.structuredPayload && JSON.stringify(record.structuredPayload).includes("previousRevision")));
  assert.ok(repository.getResearchContextRevision(context) > before);
});

test("low reliability social contradiction does not overwrite high reliability knowledge", async () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Model X releaseStatus = true",
    structuredPayload: { reliabilityScore: 92, verificationStatus: "verified" },
  }, "2026-09-05T00:00:00.000Z");
  const beforeRevision = repository.getResearchContextRevision(context);

  await runAgent({
    input,
    context,
    repository,
    research: async () => response([signal({
      id: "social-conflict",
      title: "Model X releaseStatus = false",
      summary: "A social post claims Model X is not released.",
      sourceType: "social",
      sourceTier: "C",
      reliabilityScore: 25,
      verificationStatus: "conflicting",
      informationType: "SIGNAL",
    })]),
  });

  assert.equal(repository.getResearchContextRevision(context), beforeRevision);
  assert.equal(repository.listPersonalKnowledge(context).length, 1);
});

test("repository update failure does not leave personal knowledge or revision half-written", async () => {
  const repository = new InMemorySignalRepository();
  const failingRepository = Object.assign(Object.create(Object.getPrototypeOf(repository)), repository, {
    upsertPersonalKnowledge: () => {
      throw new Error("write failed");
    },
  });

  await assert.rejects(() => updateKnowledgeFromChanges({
    context,
    repository: failingRepository,
    response: response([signal({ id: "new-failing-write", title: "New failing write" })]),
    changes: [{
      signalId: "new-failing-write",
      classification: "NEW",
      supportingEvidenceIds: [],
      previousRevision: 1,
      currentRevision: 2,
      reason: "test",
    }],
    runId: "run-fail",
    now: "2026-09-05T00:00:00.000Z",
  }));

  assert.equal(repository.listPersonalKnowledge(context).length, 0);
  assert.equal(repository.getResearchContextRevision(context), 1);
});

test("AgentRunMetadata traces run evidence, changes, and attention", async () => {
  const repository = new InMemorySignalRepository();
  const result = await runAgent({
    input,
    context,
    repository,
    runId: "agent-run-metadata",
    research: async () => response([signal({
      claims: [{
        claimText: "Codex added a new workflow.",
        sourceUrl: "https://example.com/update",
        publisher: "Official",
        publishedAt: "2026-09-05T00:00:00.000Z",
        sourceType: "primary",
        sourceTier: "S",
        evidenceSnippet: "Codex added a new workflow.",
        verificationStatus: "verified",
        contentType: "FACT",
        independentEvidenceCount: 1,
        evidenceSources: [],
      }],
    })]),
  });

  const metadata = repository.getLatestRunMetadata(context);
  assert.equal(metadata?.id, "agent-run-metadata");
  assert.equal(metadata?.status, result.status);
  assert.deepEqual(metadata?.attentionResult, ["MUST_READ"]);
  assert.ok((metadata?.evidenceIds ?? []).length);
  assert.equal(metadata?.knowledgeChanges?.[0].signalId, "event-1");
});

test("source selection reaches the next research plan and preserves fallback intent", async () => {
  const plans: Array<{ selected?: string; fallback?: string[] }> = [];
  let round = 0;
  await runAgent({
    input,
    maxRounds: 2,
    onPlan: (plan) => plans.push({ selected: plan.selectedSourceType, fallback: plan.fallbackSourceTypes }),
    research: async () => {
      round += 1;
      return round === 1
        ? response([signal({ sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified" })])
        : response([signal()]);
    },
  });
  assert.equal(plans[0].selected, "OFFICIAL");
  assert.equal(plans[1].selected, "OFFICIAL");
});

test("empty primary execution triggers an ordered fallback execution", async () => {
  let calls = 0;
  const selected: string[] = [];
  const result = await runAgent({
    input,
    maxRounds: 1,
    onPlan: (plan) => selected.push(plan.selectedSourceType ?? "none"),
    research: async (_input, plan) => {
      calls += 1;
      selected.push(plan.selectedSourceType ?? "none");
      return calls === 1 ? response([]) : response([signal()]);
    },
  });
  assert.equal(calls, 2);
  assert.equal(selected[0], "OFFICIAL");
  assert.equal(selected[1], "OFFICIAL");
  assert.equal(selected[2], "PRIMARY");
  assert.equal(result.status, "completed");
});
