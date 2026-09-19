import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import type { Goal } from "../agent/goal-types.ts";
import {
  closePostgresPool,
  createPostgresRepository,
  databaseConfigured,
  getPostgresPool,
  runRagCoreMigration,
} from "../backend/postgres.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const runKey = Date.now().toString();
const contextA = { authenticatedUserId: `phase4-a-${runKey}`, filterId: `filter-a-${runKey}` };
const contextB = { authenticatedUserId: `phase4-b-${runKey}`, filterId: `filter-b-${runKey}` };

const input = {
  identity: "builder",
  industry: "AI developer tools",
  focusAreas: "Model X",
  currentQuestions: "Did Model X launch?",
  knownInformation: "",
  informationGaps: "release status",
  trackedEntities: "Model X",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "7d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const publishedAt = new Date().toISOString();
  return {
    id: `phase4-event-${runKey}`,
    category: "匹配",
    channel: "官方",
    title: `Model X launched ${runKey}`,
    summary: "Official release notes confirm Model X is available.",
    time: "1h",
    truth: 95,
    baseUseful: 95,
    lead: 90,
    tags: ["Model X"],
    action: "read",
    why: "new release",
    official: [],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: `https://example.com/model-x/${runKey}`,
    publisher: "Official",
    publishedAt,
    firstSeenAt: publishedAt,
    retrievedAt: publishedAt,
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 95,
    verificationStatus: "verified",
    relevanceScore: 95,
    reliabilityScore: 95,
    freshnessScore: 95,
    noveltyScore: 90,
    judgementImpactScore: 90,
    gapMatchScore: 90,
    overallScore: 94,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 0,
    claims: [{
      claimText: "Model X is now released.",
      sourceUrl: `https://example.com/model-x/${runKey}`,
      publisher: "Official",
      publishedAt,
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: "Model X is now released.",
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
    sources: [],
    section: "must_know",
    gapMatches: ["release status"],
    questionMatches: ["Did Model X launch?"],
    entityMatches: ["model x"],
    whyItMatters: "This resolves the release-status question.",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: new Date().toISOString(),
    dataMode: "live",
  };
}

const dedupSourceUrl = `https://example.com/signal-map/p3-dedup/${runKey}`;
const dedupClaimFingerprint = `p3-dedup-claim-${runKey}`;
const dedupClaimText = `AI video tool supports multi-asset batch editing ${runKey}.`;

function dedupSignal() {
  const base = signal({
    id: `p3-dedup-signal-${runKey}`,
    title: dedupClaimText,
    summary: dedupClaimText,
    sourceUrl: dedupSourceUrl,
  });
  return {
    ...base,
    claims: base.claims.map((claim) => ({
      ...claim,
      claimText: dedupClaimText,
      canonicalClaimFingerprint: dedupClaimFingerprint,
      sourceUrl: dedupSourceUrl,
      evidenceSnippet: dedupClaimText,
    })),
  };
}

test("P3 PostgreSQL stateful E2E deduplicates the same Evidence across runs", {
  skip: databaseConfigured() ? undefined : "DATABASE_URL not configured",
}, async () => {
  const pool = getPostgresPool();
  await runRagCoreMigration(pool);
  const context = {
    authenticatedUserId: `p3-dedup-user-${runKey}`,
    filterId: `p3-dedup-filter-${runKey}`,
  };
  const repositoryA = createPostgresRepository(pool);

  try {
    const revisionBeforeA = await repositoryA.getResearchContextRevision(context);
    const runA = await runAgent({
      input,
      context,
      repository: repositoryA,
      userQuery: "Does this AI video tool support multi-asset batch editing?",
      runId: `p3-dedup-run-a-${runKey}`,
      maxRounds: 1,
      research: async () => response([dedupSignal()]),
    });
    const revisionAfterA = await repositoryA.getResearchContextRevision(context);
    const knowledgeAfterA = await repositoryA.listPersonalKnowledge(context);
    const evidenceAfterA = (await repositoryA.listEvidence()).filter((record) => record.sourceUrl === dedupSourceUrl);

    assert.equal(runA.status, "completed");
    assert.equal(runA.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
    assert.equal(runA.knowledgeChanges.length, 1);
    assert.equal(runA.knowledgeChanges[0]?.classification, "NEW");
    assert.equal(revisionBeforeA, 1);
    assert.equal(revisionAfterA, revisionBeforeA + 1);
    assert.equal(knowledgeAfterA.length, 1);
    assert.equal(evidenceAfterA.length, 1);
    assert.equal(evidenceAfterA[0]?.sourceUrl, dedupSourceUrl);
    assert.equal(evidenceAfterA[0]?.canonicalUrl, dedupSourceUrl);

    const repositoryB = createPostgresRepository(pool);
    const revisionBeforeB = await repositoryB.getResearchContextRevision(context);
    const knowledgeBeforeB = await repositoryB.listPersonalKnowledge(context);
    const evidenceBeforeB = (await repositoryB.listEvidence()).filter((record) => record.sourceUrl === dedupSourceUrl);
    const runB = await runAgent({
      input,
      context,
      repository: repositoryB,
      userQuery: "Does this AI video tool support multi-asset batch editing?",
      runId: `p3-dedup-run-b-${runKey}`,
      maxRounds: 1,
      research: async () => response([dedupSignal()]),
    });
    const revisionAfterB = await repositoryB.getResearchContextRevision(context);
    const knowledgeAfterB = await repositoryB.listPersonalKnowledge(context);
    const evidenceAfterB = (await repositoryB.listEvidence()).filter((record) => record.sourceUrl === dedupSourceUrl);

    assert.equal(runB.status, "completed");
    assert.equal(runB.response?.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
    assert.equal(runB.knowledgeChanges.length, 0);
    assert.equal(revisionBeforeB, revisionAfterA);
    assert.equal(revisionAfterB, revisionBeforeB);
    assert.equal(knowledgeBeforeB.length, 1);
    assert.equal(knowledgeAfterB.length, knowledgeBeforeB.length);
    assert.equal(evidenceBeforeB.length, 1);
    assert.equal(evidenceAfterB.length, evidenceBeforeB.length);
    assert.equal(evidenceAfterB[0]?.id, evidenceAfterA[0]?.id);
    assert.equal(evidenceAfterB[0]?.canonicalUrl, dedupSourceUrl);
    assert.equal(dedupClaimFingerprint, String(runA.response?.signals[0]?.claims[0]?.canonicalClaimFingerprint));
    assert.equal(dedupClaimFingerprint, String(runB.response?.signals[0]?.claims[0]?.canonicalClaimFingerprint));
  } finally {
    await pool.query("DELETE FROM research_run_metadata WHERE user_id = $1 AND filter_id = $2", [context.authenticatedUserId, context.filterId]);
    await pool.query("DELETE FROM personal_knowledge WHERE user_id = $1 AND filter_id = $2", [context.authenticatedUserId, context.filterId]);
    await pool.query("DELETE FROM research_context_revisions WHERE user_id = $1 AND filter_id = $2", [context.authenticatedUserId, context.filterId]);
    await pool.query("DELETE FROM evidence WHERE source_url = $1", [dedupSourceUrl]);
    await pool.query("DELETE FROM claims WHERE claim_text = $1", [dedupClaimText]);
    await pool.query("DELETE FROM events WHERE id = $1", [`p3-dedup-signal-${runKey}`]);
    await closePostgresPool();
  }
});

test("Phase 4 PostgreSQL Agent memory survives repository recreation and remains isolated", {
  skip: databaseConfigured() ? undefined : "DATABASE_URL not configured",
}, async () => {
  const pool = getPostgresPool();
  await runRagCoreMigration(pool);
  const repositoryA = createPostgresRepository(pool);

  try {
    const runA = await runAgent({
      input,
      context: contextA,
      repository: repositoryA,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-a-${runKey}`,
      maxRounds: 1,
      research: async () => response([signal()]),
    });
    assert.equal(runA.status, "completed");

    const knowledgeA = await repositoryA.listPersonalKnowledge(contextA);
    assert.ok(knowledgeA.some((record) => record.text.includes(`Model X launched ${runKey}`)));
    assert.equal(await repositoryA.getResearchContextRevision(contextA), 2);
    const metadataA = await repositoryA.getLatestRunMetadata(contextA);
    assert.ok(metadataA);
    assert.ok(metadataA.evidenceIds && metadataA.evidenceIds.length > 0);
    assert.ok(metadataA.knowledgeChanges && metadataA.knowledgeChanges.length > 0);

    const goalA: Goal = {
      id: `phase9-goal-${runKey}`,
      userId: contextA.authenticatedUserId,
      filterId: contextA.filterId,
      objective: "Track Model X release",
      status: "active",
      successCriteria: ["release confirmed"],
      openQuestions: ["What changed next?"],
      taskIds: [`goal-task-release-confirmed`],
      completedTaskIds: [],
      taskMetadata: [{ taskId: "goal-task-release-confirmed", objective: "Research and verify: release confirmed", type: "FACT_FINDING", status: "completed", resultSummary: "Release confirmed." }],
      completedCriteria: [],
      remainingCriteria: ["release confirmed"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      watch: {
        resumeCondition: { type: "POLL", reason: "Check for release updates", target: "Model X", nextCheckAt: new Date().toISOString() },
        consecutiveNoChangeCount: 2,
        watchStatus: "waiting",
        lastCheckOutcome: "no_change",
      },
    };
    await repositoryA.saveGoal(contextA, goalA);

    const repositoryB = createPostgresRepository(pool);
    const persistedGoal = await repositoryB.getGoal(contextA, goalA.id);
    assert.equal(persistedGoal?.objective, goalA.objective);
    assert.equal(persistedGoal?.taskMetadata?.[0]?.resultSummary, "Release confirmed.");
    assert.equal(persistedGoal?.watch?.resumeCondition.target, "Model X");
    assert.equal(persistedGoal?.watch?.consecutiveNoChangeCount, 2);
    assert.equal(await repositoryB.getGoal(contextB, goalA.id), null);
    const plans: string[][] = [];
    const runB = await runAgent({
      input,
      context: contextA,
      repository: repositoryB,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-b-${runKey}`,
      maxRounds: 1,
      onPlan: (plan) => plans.push(plan.queries),
      research: async () => response([]),
    });
    assert.equal(runB.status, "needs_more_evidence");
    assert.ok(plans[0]?.some((query) => query.toLowerCase().includes("latest")));
    assert.ok(String(runB.steps.find((step) => step.state === "RETRIEVE")?.output).includes(`Model X launched ${runKey}`));

    const metadataB = await repositoryB.getLatestRunMetadata(contextA);
    assert.equal(metadataB?.id, `phase4-run-b-${runKey}`);
    assert.equal(await repositoryB.listPersonalKnowledge(contextB).then((records) => records.length), 0);
    assert.equal(await repositoryB.getLatestRunMetadata(contextB), null);

    const beforeConfirmRevision = await repositoryB.getResearchContextRevision(contextA);
    const beforeConfirmCount = (await repositoryB.listPersonalKnowledge(contextA)).length;
    const confirm = await runAgent({
      input,
      context: contextA,
      repository: repositoryB,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-confirm-${runKey}`,
      maxRounds: 1,
      research: async () => response([signal()]),
    });
    assert.equal(confirm.response?.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
    assert.equal(confirm.knowledgeChanges.length, 0);
    assert.equal(await repositoryB.getResearchContextRevision(contextA), beforeConfirmRevision);
    assert.equal((await repositoryB.listPersonalKnowledge(contextA)).length, beforeConfirmCount);

    const update = await runAgent({
      input,
      context: contextA,
      repository: repositoryB,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-update-${runKey}`,
      maxRounds: 1,
      research: async () => {
        const updatedClaim = `Model X is now released with expanded access ${runKey}.`;
        return response([signal({
          id: `phase4-event-update-${runKey}`,
          title: `Model X launch expanded ${runKey}`,
          eventStatus: "UPDATED",
          knowledgeStatus: "UPDATED",
          claims: signal().claims.map((claim) => ({
            ...claim,
            claimText: updatedClaim,
            evidenceSnippet: updatedClaim,
          })),
        })]);
      },
    });
    assert.equal(update.knowledgeChanges[0]?.classification, "UPDATES");
    assert.ok((await repositoryB.getResearchContextRevision(contextA)) > beforeConfirmRevision);
    assert.ok((await repositoryB.listPersonalKnowledge(contextA)).some((record) => JSON.stringify(record.structuredPayload).includes("previousRevision")));

    const beforeConflict = await repositoryB.listPersonalKnowledge(contextA);
    const conflict = await runAgent({
      input,
      context: contextA,
      repository: repositoryB,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-conflict-${runKey}`,
      maxRounds: 1,
      research: async () => response([signal({
        id: `phase4-event-conflict-${runKey}`,
        title: `Model X launch disputed ${runKey}`,
        verificationStatus: "conflicting",
      })]),
    });
    assert.equal(conflict.knowledgeChanges.length, 0);
    const afterConflict = await repositoryB.listPersonalKnowledge(contextA);
    assert.ok(afterConflict.some((record) => record.text === beforeConflict[0]?.text));

    const beforeSocial = afterConflict.length;
    await runAgent({
      input,
      context: contextA,
      repository: repositoryB,
      userQuery: "Did Model X launch?",
      runId: `phase4-run-social-${runKey}`,
      maxRounds: 1,
      research: async () => response([signal({
        id: `phase4-event-social-${runKey}`,
        title: `Model X launch denied socially ${runKey}`,
        sourceType: "social",
        sourceTier: "C",
        reliabilityScore: 25,
        verificationStatus: "conflicting",
        informationType: "SIGNAL",
      })]),
    });
    assert.equal((await repositoryB.listPersonalKnowledge(contextA)).length, beforeSocial);
  } finally {
    await pool.query("DELETE FROM goals WHERE user_id IN ($1,$2)", [contextA.authenticatedUserId, contextB.authenticatedUserId]);
    await pool.query("DELETE FROM research_run_metadata WHERE user_id IN ($1,$2)", [contextA.authenticatedUserId, contextB.authenticatedUserId]);
    await pool.query("DELETE FROM personal_knowledge WHERE user_id IN ($1,$2)", [contextA.authenticatedUserId, contextB.authenticatedUserId]);
    await pool.query("DELETE FROM research_context_revisions WHERE user_id IN ($1,$2)", [contextA.authenticatedUserId, contextB.authenticatedUserId]);
    await pool.query("DELETE FROM evidence WHERE source_url LIKE $1", [`https://example.com/model-x/${runKey}%`]);
    await pool.query("DELETE FROM claims WHERE claim_text = $1", ["Model X is now released."]);
    await pool.query("DELETE FROM events WHERE normalized_key LIKE $1", [`model x%${runKey}%`]);
    await closePostgresPool();
  }
});
