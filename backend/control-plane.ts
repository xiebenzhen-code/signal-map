import { abandonGoal, pauseGoal, resumeGoalByUser, type GoalControlResult } from "../agent/goal-control.ts";
import type { Goal } from "../agent/goal-types.ts";
import { createFollowGoal, isFollowGoal, toFollowView, type FollowInput } from "../agent/following.ts";
import type {
  AuthenticatedFilterContext,
  ClaimRepository,
  EvidenceRepository,
  FilterOwnershipRepository,
  GoalRepository,
  NotificationRepository,
  PersonalKnowledgeRepository,
  ResearchContextRepository,
} from "../information/repositories/types.ts";
import type { EvidenceRecord, PersonalKnowledgeRecord, ResearchRunMetadata, StructuredTraceEntry } from "../information/rag-records.ts";
import type { AgentRunOptions } from "../agent/types.ts";

export type ControlRepository =
  GoalRepository &
  NotificationRepository &
  PersonalKnowledgeRepository &
  EvidenceRepository &
  ClaimRepository &
  ResearchContextRepository &
  FilterOwnershipRepository &
  NonNullable<AgentRunOptions["repository"]>;

type ControlInput = {
  context: AuthenticatedFilterContext;
  repository: ControlRepository;
};

function publicWatch(goal: Goal) {
  if (!goal.watch) return undefined;
  return {
    resumeCondition: goal.watch.resumeCondition,
    watchStatus: goal.watch.watchStatus,
    lastCheckedAt: goal.watch.lastCheckedAt,
    nextCheckAt: goal.watch.nextCheckAt ?? goal.watch.resumeCondition.nextCheckAt,
    consecutiveNoChangeCount: goal.watch.consecutiveNoChangeCount,
    lastCheckOutcome: goal.watch.lastCheckOutcome,
    schedulerFailureCount: goal.watch.schedulerFailureCount ?? 0,
    schedulerLastRunAt: goal.watch.schedulerLastRunAt,
    schedulerLastErrorSummary: goal.watch.schedulerLastErrorSummary,
  };
}

function summarizeGoal(goal: Goal) {
  const nextTask = goal.taskMetadata?.find((task) => !["completed", "failed", "blocked"].includes(task.status));
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    completedCriteria: goal.completedCriteria,
    remainingCriteria: goal.remainingCriteria,
    currentTask: goal.taskMetadata?.find((task) => task.status === "running") ?? null,
    nextTask: nextTask ?? null,
    waitingOrBlockedReason: goal.lastTransition?.blockingReason,
    nextCheckAt: goal.watch?.nextCheckAt ?? goal.watch?.resumeCondition.nextCheckAt,
    lastTransition: goal.lastTransition,
    lastRunTime: goal.lastTransition?.timestamp,
    watch: publicWatch(goal),
  };
}

function detailGoal(goal: Goal) {
  return {
    ...summarizeGoal(goal),
    taskHistory: goal.taskMetadata ?? [],
    completedTasks: (goal.taskMetadata ?? []).filter((task) => task.status === "completed"),
    remainingTasks: (goal.taskMetadata ?? []).filter((task) => task.status !== "completed"),
    supportingEvidenceCount: (goal.taskMetadata ?? []).reduce((count, task) => count + (task.supportingEvidenceIds?.length ?? 0), 0),
    watchCondition: goal.watch?.resumeCondition,
    schedulerStatus: publicWatch(goal),
  };
}

function payload(record: PersonalKnowledgeRecord) {
  return record.structuredPayload && typeof record.structuredPayload === "object"
    ? record.structuredPayload as Record<string, unknown>
    : {};
}

function evidenceIds(record: PersonalKnowledgeRecord) {
  const value = payload(record).supportingEvidenceIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function revision(record: PersonalKnowledgeRecord) {
  const data = payload(record);
  return {
    previousRevision: typeof data.previousRevision === "number" ? data.previousRevision : undefined,
    currentRevision: typeof data.currentRevision === "number" ? data.currentRevision : undefined,
    revisionReason: typeof data.revisionReason === "string" ? data.revisionReason : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : record.updatedAt,
  };
}

function provenance(record: PersonalKnowledgeRecord) {
  const data = payload(record);
  return {
    verificationStatus: typeof data.verificationStatus === "string" ? data.verificationStatus : undefined,
    reliabilityScore: typeof data.reliabilityScore === "number" ? data.reliabilityScore : undefined,
    sourceAgentRunId: typeof data.sourceAgentRunId === "string" ? data.sourceAgentRunId : undefined,
    supportingClaimIds: Array.isArray(data.supportingClaimIds) ? data.supportingClaimIds : [],
  };
}

function sanitizeTrace(trace: StructuredTraceEntry[] = []) {
  return trace.map((entry) => ({
    state: entry.state,
    status: entry.status,
    action: entry.action,
    result: entry.outputSummary,
    reason: entry.decisionReason ?? entry.strategyReason ?? entry.sourceSelectionReason,
    timestamp: entry.timestamp,
    strategy: entry.strategy,
    selectedSourceType: entry.selectedSourceType,
    fallbackSourceTypes: entry.fallbackSourceTypes,
  }));
}

function evidenceSummary(evidence: EvidenceRecord) {
  return {
    id: evidence.id,
    claimId: evidence.claimId,
    sourceUrl: evidence.sourceUrl,
    publisher: evidence.publisher,
    publishedAt: evidence.publishedAt,
    sourceType: evidence.sourceType,
    sourceRole: evidence.sourceRole,
    sourceTier: evidence.sourceTier,
    verificationStatus: evidence.verificationStatus,
    dataMode: evidence.dataMode,
  };
}

function runSummary(run: ResearchRunMetadata) {
  return {
    id: run.id,
    userQuery: run.userQuery,
    status: run.status,
    rounds: run.rounds,
    selectedStrategies: run.strategies ?? [],
    selectedSources: sanitizeTrace(run.trace).filter((entry) => entry.selectedSourceType),
    evidenceCount: run.evidenceIds?.length ?? 0,
    evidenceIds: run.evidenceIds ?? [],
    knowledgeChanges: run.knowledgeChanges ?? [],
    finalAttention: run.attentionResult ?? [],
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    trace: sanitizeTrace(run.trace),
  };
}

export async function getControlGoals(input: ControlInput & { goalId?: string }) {
  if (input.goalId) {
    const goal = await Promise.resolve(input.repository.getGoal(input.context, input.goalId));
    return { goals: [], goal: goal ? detailGoal(goal) : null };
  }
  const goals = await Promise.resolve(input.repository.listGoals(input.context));
  return { goals: goals.map(summarizeGoal), goal: null };
}

export async function getControlFollows(input: ControlInput) {
  const goals = await Promise.resolve(input.repository.listGoals(input.context));
  return { follows: goals.filter(isFollowGoal).map(toFollowView) };
}

export async function createControlFollow(input: ControlInput & {
  follow: FollowInput;
  now?: string;
}) {
  const goal = createFollowGoal(input.context, input.follow, input.now);
  const saved = await Promise.resolve(input.repository.saveGoal(input.context, goal));
  return { follow: toFollowView(saved), goalId: saved.id };
}

export async function getControlNotifications(input: ControlInput) {
  const notifications = await Promise.resolve(input.repository.listNotifications(input.context));
  return {
    notifications: notifications.map((notification) => ({
      id: notification.id,
      attention: notification.attention,
      deliveryAction: notification.deliveryAction,
      status: notification.status,
      createdAt: notification.createdAt,
      deliveredAt: notification.deliveredAt,
      unread: notification.unread ?? notification.status !== "SUPPRESSED",
      readAt: notification.readAt,
      relatedGoalId: notification.goalId,
      relatedRevisionId: notification.relatedRevisionId,
      relatedEvidenceIds: notification.relatedEvidenceIds,
      failureSummary: notification.failureSummary,
      digestWindowId: notification.digestWindowId,
    })),
  };
}

export async function getControlKnowledge(input: ControlInput, options: { includeSupportingEvidence?: boolean } = {}) {
  const includeSupportingEvidence = options.includeSupportingEvidence !== false;
  const [knowledge, evidence] = await Promise.all([
    Promise.resolve(input.repository.listPersonalKnowledge(input.context)),
    includeSupportingEvidence ? Promise.resolve(input.repository.listEvidence?.() ?? []) : Promise.resolve([]),
  ]);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return {
    knowledge: knowledge.map((record) => {
      const ids = evidenceIds(record);
      return {
        id: record.id,
        type: record.type,
        text: record.text,
        currentValue: record.text,
        updatedAt: record.updatedAt,
        revision: revision(record),
        provenance: provenance(record),
        supportingEvidence: ids.map((id) => evidenceById.get(id)).filter(Boolean).map((item) => evidenceSummary(item!)),
        revisionHistory: [{
          previousRevision: revision(record).previousRevision,
          currentRevision: revision(record).currentRevision,
          revisionReason: revision(record).revisionReason,
          updatedAt: revision(record).updatedAt,
          supportingEvidenceIds: ids,
        }],
      };
    }),
  };
}

export async function getControlAgentRuns(input: ControlInput) {
  const runs = await Promise.resolve(input.repository.listRunMetadata(input.context));
  return { agentRuns: runs.map(runSummary) };
}

export async function runGoalControlAction(input: ControlInput & {
  goalId: string;
  action: "resume" | "pause" | "abandon";
  requestInput?: GoalControlResult extends never ? never : AgentRunOptions["input"];
}) {
  if (input.action === "pause") return pauseGoal(input);
  if (input.action === "abandon") return abandonGoal(input);
  return resumeGoalByUser({
    ...input,
    input: input.requestInput ?? ({} as AgentRunOptions["input"]),
  });
}

export async function markControlNotificationRead(input: ControlInput & {
  notificationId: string;
  now?: string;
}) {
  const updated = await Promise.resolve(input.repository.markNotificationRead(
    input.context,
    input.notificationId,
    input.now ?? new Date().toISOString(),
  ));
  return { notification: updated };
}
