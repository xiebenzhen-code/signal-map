import assert from "node:assert/strict";
import test from "node:test";

import { analyzeTask, createResearchTaskPlan, runTaskPlannedAgent, synthesizeTaskResults, validateTaskPlan } from "../agent/task-runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { AgentRunResult } from "../agent/types.ts";
import type { ResearchInput, ResearchResponse, ResearchSignal } from "../research/types.ts";

const input: ResearchInput = {
  identity: "builder",
  industry: "AI developer tools",
  focusAreas: "Codex",
  currentQuestions: "What changed in Codex?",
  knownInformation: "",
  informationGaps: "workflow changes",
  trackedEntities: "Codex",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "7d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: overrides.id ?? "event-1",
    category: "匹配",
    channel: "官方",
    title: overrides.title ?? "Codex update",
    summary: overrides.summary ?? "Official evidence confirms a workflow change.",
    time: "1h",
    truth: 90,
    baseUseful: 90,
    lead: 80,
    tags: ["Codex"],
    action: "read",
    why: "new evidence",
    official: [],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: "https://example.com/update",
    publisher: "Official",
    publishedAt: "2026-09-06T00:00:00.000Z",
    firstSeenAt: "2026-09-06T00:00:00.000Z",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 90,
    verificationStatus: "verified",
    relevanceScore: 90,
    reliabilityScore: 90,
    freshnessScore: 90,
    noveltyScore: 80,
    judgementImpactScore: 80,
    gapMatchScore: 80,
    overallScore: 88,
    sourceCount: 1,
    independentEvidenceCount: 1,
    propagationCount: 0,
    claims: [{
      claimText: "Codex added a workflow change.",
      sourceUrl: "https://example.com/update",
      publisher: "Official",
      publishedAt: "2026-09-06T00:00:00.000Z",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: "Codex added a workflow change.",
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }],
    sources: [],
    section: "must_know",
    gapMatches: ["workflow changes"],
    questionMatches: ["What changed in Codex?"],
    entityMatches: ["codex"],
    whyItMatters: "It answers the active question.",
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
    fetchedAt: "2026-09-06T00:00:00.000Z",
    dataMode: "live",
  };
}

function agentResult(signalId: string): AgentRunResult {
  return {
    status: "completed",
    rounds: 1,
    response: response([signal({ id: signalId, title: `${signalId} result` })]),
    plan: { objective: signalId, queries: [signalId], preferredSourceTypes: ["primary"], maxQueries: 1 },
    evaluation: {
      decision: "STOP",
      sufficientEvidence: true,
      conflictDetected: false,
      conflictingClaims: [],
      informationGain: 1,
      reason: "done",
    },
    knowledgeChanges: [{
      signalId,
      classification: "NEW",
      supportingEvidenceIds: [`evidence-${signalId}`],
      previousRevision: 1,
      currentRevision: 2,
      reason: "new evidence",
    }],
    attention: ["MUST_READ"],
    steps: [],
    trace: [],
  };
}

test("simple factual question stays SINGLE_TASK", () => {
  const analysis = analyzeTask({ userQuery: "Did Codex release a new version?", relatedKnowledge: [] });
  assert.equal(analysis.mode, "SINGLE_TASK");
});

test("comparison question decomposes into independent research tasks and synthesis", () => {
  const plan = createResearchTaskPlan({
    userQuery: "Compare Codex and Claude Code recent release limitations",
    relatedKnowledge: [],
  });
  assert.equal(plan.tasks.at(-1)?.type, "SYNTHESIS");
  assert.ok(plan.tasks.some((task) => task.type === "COMPARISON_INPUT" && /Codex/i.test(task.objective)));
  assert.ok(plan.tasks.some((task) => task.type === "COMPARISON_INPUT" && /Claude Code/i.test(task.objective)));
  assert.doesNotThrow(() => validateTaskPlan(plan));
});

test("complex multi-condition question creates a legal bounded DAG", () => {
  const plan = createResearchTaskPlan({
    userQuery: "Find Codex release facts, verify official evidence, then conclude whether it changes developer workflow",
    relatedKnowledge: [],
  });
  assert.ok(plan.tasks.length <= 6);
  assert.doesNotThrow(() => validateTaskPlan(plan));
  assert.ok(plan.tasks.some((task) => task.type === "FACT_FINDING"));
  assert.ok(plan.tasks.some((task) => task.type === "VERIFICATION"));
  assert.equal(plan.finalTaskId, plan.tasks.at(-1)?.id);
});

test("invalid dependencies and cycles are rejected", () => {
  const plan = createResearchTaskPlan({
    userQuery: "Compare Codex and Claude Code",
    relatedKnowledge: [],
  });
  plan.tasks[0].dependencies = ["missing"];
  assert.throws(() => validateTaskPlan(plan), /unknown dependency/);

  const cyclic = createResearchTaskPlan({
    userQuery: "Compare Codex and Claude Code",
    relatedKnowledge: [],
  });
  cyclic.tasks[0].dependencies = [cyclic.finalTaskId];
  assert.throws(() => validateTaskPlan(cyclic), /cycle/);
});

test("dependency state controls execution and blocking", async () => {
  const plan = createResearchTaskPlan({
    userQuery: "Compare Codex and Claude Code",
    relatedKnowledge: [],
  });
  const executed: string[] = [];
  const result = await runTaskPlannedAgent({
    input,
    userQuery: "Compare Codex and Claude Code",
    plan,
    runAgent: async ({ task }) => {
      executed.push(task.id);
      if (/Claude Code/i.test(task.objective)) throw new Error("provider failed");
      return agentResult(task.id);
    },
  });

  assert.ok(executed.length >= 2);
  assert.equal(result.taskPlan?.tasks.find((task) => task.type === "SYNTHESIS")?.status, "blocked");
});

test("completed dependencies unlock synthesis without calling providers", async () => {
  let providerCalls = 0;
  const result = await runTaskPlannedAgent({
    input,
    userQuery: "Compare Codex and Claude Code",
    runAgent: async ({ task }) => {
      providerCalls += 1;
      return agentResult(task.id);
    },
  });

  assert.equal(providerCalls, 2);
  assert.equal(result.analysis.mode, "DECOMPOSE");
  assert.equal(result.synthesis?.supportingTaskIds.length, 2);
  assert.equal(result.taskPlan?.tasks.find((task) => task.type === "SYNTHESIS")?.status, "completed");
});

test("synthesis uses task results only and creates no new evidence", () => {
  const synthesis = synthesizeTaskResults([
    { taskId: "task-a", result: agentResult("a") },
    { taskId: "task-b", result: agentResult("b") },
  ]);

  assert.deepEqual(synthesis.supportingTaskIds, ["task-a", "task-b"]);
  assert.deepEqual(synthesis.supportingEvidenceIds.sort(), ["evidence-a", "evidence-b"]);
  assert.equal(synthesis.createdEvidenceIds.length, 0);
  assert.equal(synthesis.conclusions.length, 2);
});

test("historical knowledge creates refresh-oriented tasks without replacing external validation", () => {
  const plan = createResearchTaskPlan({
    userQuery: "Compare Codex and Claude Code recent release limitations",
    relatedKnowledge: ["Codex had a release yesterday"],
  });

  const codexTask = plan.tasks.find((task) => /Codex/i.test(task.objective) && task.type === "COMPARISON_INPUT");
  assert.match(codexTask?.objective ?? "", /Refresh/i);
  assert.ok(plan.tasks.some((task) => task.objective.includes("Verify with external evidence")));
});

test("task execution reuses existing AgentRunner boundary", async () => {
  const repository = new InMemorySignalRepository();
  const result = await runTaskPlannedAgent({
    input,
    context: { authenticatedUserId: "user-a", filterId: "filter-a" },
    repository,
    userQuery: "Compare Codex and Claude Code",
    runAgent: async ({ task }) => agentResult(task.id),
  });

  assert.equal(result.taskResults.every((taskResult) => taskResult.result?.status === "completed"), true);
  assert.equal(repository.listPersonalKnowledge({ authenticatedUserId: "user-a", filterId: "filter-a" }).length, 0);
});
