import assert from "node:assert/strict";
import test from "node:test";

import { abandonGoal, pauseGoal, resumeGoalByUser } from "../agent/goal-control.ts";
import type { Goal } from "../agent/goal-types.ts";
import { getControlAgentRuns, getControlGoals, getControlKnowledge, getControlNotifications } from "../backend/control-plane.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";

const context = { authenticatedUserId: "control-user-a", filterId: "control-filter-a" };
const otherUser = { authenticatedUserId: "control-user-b", filterId: "control-filter-a" };
const otherFilter = { authenticatedUserId: "control-user-a", filterId: "control-filter-b" };
const now = "2026-09-07T10:00:00.000Z";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-control-1",
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    objective: "Track Codex release limitations",
    status: "waiting",
    successCriteria: ["release verified", "limitations understood"],
    openQuestions: ["What changed?"],
    taskIds: ["task-1", "task-2"],
    completedTaskIds: ["task-1"],
    taskMetadata: [
      { taskId: "task-1", objective: "Find official release note", type: "FACT_FINDING", status: "completed", resultSummary: "Official note found", supportingEvidenceIds: ["evidence-1"] },
      { taskId: "task-2", objective: "Verify limitation impact", type: "VERIFICATION", status: "pending" },
    ],
    completedCriteria: ["release verified"],
    remainingCriteria: ["limitations understood"],
    currentSummary: "Waiting for a clearer limitation signal.",
    createdAt: "2026-09-07T08:00:00.000Z",
    updatedAt: "2026-09-07T09:00:00.000Z",
    lastTransition: {
      goalId: "goal-control-1",
      previousStatus: "active",
      newStatus: "waiting",
      completedCriteria: ["release verified"],
      remainingCriteria: ["limitations understood"],
      selectedNextTasks: ["task-2"],
      blockingReason: "Need clearer evidence.",
      relatedAgentRunIds: ["run-1"],
      timestamp: "2026-09-07T09:00:00.000Z",
    },
    watch: {
      resumeCondition: { type: "POLL", reason: "Check official changelog", target: "Codex changelog", nextCheckAt: "2026-09-07T12:00:00.000Z" },
      consecutiveNoChangeCount: 2,
      watchStatus: "waiting",
      lastCheckedAt: "2026-09-07T09:00:00.000Z",
      nextCheckAt: "2026-09-07T12:00:00.000Z",
      lastCheckOutcome: "no_change",
      schedulerFailureCount: 0,
      leaseOwner: "worker-hidden",
      leaseExpiresAt: "2026-09-07T09:05:00.000Z",
    },
    ...overrides,
  };
}

test("Control goal list and detail are scoped by authenticated user and filter", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal());
  repository.saveGoal(otherUser, { ...goal({ id: "other-user-goal", objective: "Other user goal" }), userId: otherUser.authenticatedUserId });
  repository.saveGoal(otherFilter, { ...goal({ id: "other-filter-goal", objective: "Other filter goal" }), filterId: otherFilter.filterId });

  const list = await getControlGoals({ context, repository });

  assert.equal(list.goals.length, 1);
  assert.equal(list.goals[0]?.id, "goal-control-1");
  assert.equal(list.goals[0]?.completedCriteria.length, 1);
  assert.equal(list.goals[0]?.remainingCriteria.length, 1);
  assert.equal(list.goals[0]?.watch?.nextCheckAt, "2026-09-07T12:00:00.000Z");
  assert.equal("leaseOwner" in (list.goals[0]?.watch ?? {}), false);

  const detail = await getControlGoals({ context, repository, goalId: "goal-control-1" });
  assert.equal(detail.goal?.taskHistory.length, 2);
  assert.equal(detail.goal?.schedulerStatus?.watchStatus, "waiting");
});

test("Goal controls use business helpers and preserve completed tasks", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ status: "active" }));

  const paused = await pauseGoal({ context, repository, goalId: "goal-control-1", now });
  assert.equal(paused.goal?.status, "waiting");
  assert.equal(paused.goal?.completedTaskIds[0], "task-1");
  assert.equal(paused.goal?.watch?.resumeCondition.type, "MANUAL");

  const resumed = await resumeGoalByUser({
    context,
    repository,
    goalId: "goal-control-1",
    input: {} as never,
    now,
    runTask: async () => ({ status: "completed" } as never),
  });
  assert.equal(resumed.goal?.id, "goal-control-1");
  assert.equal(resumed.goal?.completedTaskIds.includes("task-1"), true);

  const abandoned = await abandonGoal({ context, repository, goalId: "goal-control-1", now });
  assert.equal(abandoned.goal?.status, "abandoned");
  assert.equal(abandoned.goal?.watch?.watchStatus, "expired");
});

test("completed and abandoned goals cannot be resumed by control actions", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(context, goal({ status: "completed", completedAt: now }));
  assert.equal((await resumeGoalByUser({ context, repository, goalId: "goal-control-1", input: {} as never })).status, "rejected");

  repository.saveGoal(context, goal({ status: "abandoned" }));
  assert.equal((await resumeGoalByUser({ context, repository, goalId: "goal-control-1", input: {} as never })).status, "rejected");
});

test("Notification, knowledge, evidence, and agent run inspectors expose scoped structured state", async () => {
  const repository = new InMemorySignalRepository();
  repository.upsertEvent({
    id: "event-1",
    canonicalTitle: "Codex release",
    normalizedKey: "codex release",
    entities: ["Codex"],
    tags: ["release"],
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });
  repository.upsertClaim({
    id: "claim-1",
    eventId: "event-1",
    claimText: "Codex released a workflow update",
    normalizedClaim: "codex released workflow update",
    entities: ["Codex"],
    tags: ["release"],
    createdAt: now,
    updatedAt: now,
  });
  repository.upsertEvidence({
    id: "evidence-1",
    claimId: "claim-1",
    sourceUrl: "https://example.com/codex",
    canonicalUrl: "https://example.com/codex",
    publisher: "Example",
    publishedAt: now,
    sourceType: "primary",
    sourceRole: "verification",
    sourceTier: "A",
    verificationStatus: "verified",
    evidenceSnippet: "Official workflow update.",
    dataMode: "live",
    retrievedAt: now,
    createdAt: now,
  });
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Codex released a workflow update",
    structuredPayload: {
      currentRevision: 2,
      previousRevision: 1,
      revisionReason: "UPDATES from verified evidence",
      supportingEvidenceIds: ["evidence-1"],
      verificationStatus: "verified",
      reliabilityScore: 92,
    },
  }, now);
  repository.saveNotification(context, {
    id: "notification-1",
    notificationKey: "key-1",
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    goalId: "goal-control-1",
    attention: "MUST_READ",
    deliveryAction: "IMMEDIATE",
    relatedEvidenceIds: ["evidence-1"],
    relatedRevisionId: "rev-2",
    status: "DELIVERED",
    createdAt: now,
    deliveredAt: now,
  });
  repository.saveRunMetadata(context, {
    id: "run-1",
    userQuery: "What changed in Codex?",
    startedAt: now,
    completedAt: now,
    status: "completed",
    rounds: 1,
    evidenceIds: ["evidence-1"],
    knowledgeChanges: [{ signalId: "event-1", classification: "UPDATES", supportingEvidenceIds: ["evidence-1"], previousRevision: 1, currentRevision: 2, reason: "Verified update" }],
    attentionResult: ["MUST_READ"],
    strategies: ["INITIAL", "STOP"],
    trace: [{ state: "COMPLETE", status: "completed", action: "complete", inputSummary: "{}", outputSummary: "{}", timestamp: now }],
    generatedFromResearchContextRevision: 1,
    dataMode: "live",
    createdAt: now,
  });

  const notifications = await getControlNotifications({ context, repository });
  assert.equal(notifications.notifications[0]?.deliveryAction, "IMMEDIATE");

  const knowledge = await getControlKnowledge({ context, repository });
  assert.equal(knowledge.knowledge[0]?.revision.currentRevision, 2);
  assert.equal(knowledge.knowledge[0]?.supportingEvidence[0]?.id, "evidence-1");
  assert.equal(knowledge.knowledge[0]?.supportingEvidence[0]?.sourceUrl, "https://example.com/codex");

  let listEvidenceCalled = false;
  repository.listEvidence = () => {
    listEvidenceCalled = true;
    throw new Error("Evidence detail should not be loaded in summary mode");
  };
  const knowledgeSummary = await getControlKnowledge({ context, repository }, { includeSupportingEvidence: false });
  assert.equal(knowledgeSummary.knowledge[0]?.currentValue, "Codex released a workflow update");
  assert.deepEqual(knowledgeSummary.knowledge[0]?.supportingEvidence, []);
  assert.equal(listEvidenceCalled, false);

  const runs = await getControlAgentRuns({ context, repository });
  assert.equal(runs.agentRuns[0]?.id, "run-1");
  assert.deepEqual(runs.agentRuns[0]?.trace.map((entry) => entry.state), ["COMPLETE"]);
});

test("standalone private Control routes reject shared Guest identity", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleBackendRequest(new Request("http://localhost/api/control/goals?guest=true&filterId=guest-filter"));
    assert.equal(response.status, 401);

    const unknown = await handleBackendRequest(new Request("http://localhost/api/control/goals/nope/resume?guest=true", { method: "POST" }));
    assert.equal(unknown.status, 401);
  } finally {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});
