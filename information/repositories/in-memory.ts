import {
  normalizeText,
  RESEARCH_CONTEXT_KNOWLEDGE_TYPES,
  stableRecordId,
  type ClaimRecord,
  type EvidenceRecord,
  type EventRecord,
  type PersonalKnowledgeRecord,
  type PersonalKnowledgeRecordInput,
  type ResearchRunMetadata,
  type UserPreferenceInput,
  type UserPreferenceRecord,
} from "../rag-records.ts";
import type {
  AuthenticatedFilterContext,
  ClaimRepository,
  EventRepository,
  EvidenceRepository,
  FilterOwnershipRepository,
  GoalRepository,
  NotificationRepository,
  OwnedFilterRecord,
  PersonalKnowledgeRepository,
  PreferenceRepository,
  ResearchContextRepository,
} from "./types.ts";
import type { Goal } from "../../agent/goal-types.ts";
import type { NotificationRecord } from "../../notification/types.ts";

function tenantKey(context: AuthenticatedFilterContext) {
  return `${context.authenticatedUserId}:${context.filterId}`;
}

function goalDueAt(goal: Goal) {
  return goal.watch?.nextCheckAt ?? goal.watch?.resumeCondition.nextCheckAt;
}

function isAutoSchedulable(goal: Goal, now: string) {
  if (goal.status !== "waiting" && goal.status !== "blocked") return false;
  if (!goal.watch || !["waiting", "error"].includes(goal.watch.watchStatus)) return false;
  const conditionType = goal.watch.resumeCondition.type;
  if (conditionType === "MANUAL" || conditionType === "EVENT") return false;
  const dueAt = goalDueAt(goal);
  if (!dueAt || Date.parse(dueAt) > Date.parse(now)) return false;
  return !goal.watch.leaseExpiresAt || Date.parse(goal.watch.leaseExpiresAt) <= Date.parse(now);
}

export class InMemorySignalRepository implements
  EventRepository,
  ClaimRepository,
  EvidenceRepository,
  FilterOwnershipRepository,
  GoalRepository,
  NotificationRepository,
  PersonalKnowledgeRepository,
  PreferenceRepository,
  ResearchContextRepository {
  private events = new Map<string, EventRecord>();
  private eventKeys = new Map<string, string>();
  private claims = new Map<string, ClaimRecord>();
  private evidence = new Map<string, EvidenceRecord>();
  private knowledge = new Map<string, PersonalKnowledgeRecord[]>();
  private preferences = new Map<string, UserPreferenceRecord[]>();
  private revisions = new Map<string, number>();
  private runMetadata = new Map<string, ResearchRunMetadata[]>();
  private goals = new Map<string, Goal>();
  private notifications = new Map<string, NotificationRecord>();
  private filters = new Map<string, OwnedFilterRecord>();

  upsertEvent(event: EventRecord) {
    const existingId = this.eventKeys.get(event.normalizedKey);
    if (existingId) {
      const existing = this.events.get(existingId)!;
      const merged = { ...existing, ...event, id: existing.id, createdAt: existing.createdAt };
      this.events.set(existing.id, merged);
      return merged;
    }
    this.events.set(event.id, event);
    this.eventKeys.set(event.normalizedKey, event.id);
    return event;
  }

  getEventById(id: string) {
    return this.events.get(id) ?? null;
  }

  getEventByNormalizedKey(normalizedKey: string) {
    const id = this.eventKeys.get(normalizedKey);
    return id ? this.events.get(id) ?? null : null;
  }

  listEvents() {
    return Array.from(this.events.values());
  }

  upsertClaim(claim: ClaimRecord) {
    this.claims.set(claim.id, this.claims.get(claim.id) ?? claim);
    return this.claims.get(claim.id)!;
  }

  listClaimsForEvent(eventId: string) {
    return Array.from(this.claims.values()).filter((claim) => claim.eventId === eventId);
  }

  listClaims() {
    return Array.from(this.claims.values());
  }

  upsertEvidence(evidence: EvidenceRecord) {
    this.evidence.set(evidence.id, this.evidence.get(evidence.id) ?? evidence);
    return this.evidence.get(evidence.id)!;
  }

  listEvidenceForClaim(claimId: string) {
    return Array.from(this.evidence.values()).filter((evidence) => evidence.claimId === claimId);
  }

  listEvidence() {
    return Array.from(this.evidence.values());
  }

  addPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
  ) {
    return this.upsertPersonalKnowledge(context, input, now, {
      advanceRevision: RESEARCH_CONTEXT_KNOWLEDGE_TYPES.has(input.type),
    }).record;
  }

  upsertPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
    options: { advanceRevision?: boolean } = {},
  ) {
    const key = tenantKey(context);
    const normalizedText = normalizeText(input.text);
    const stableId = `${input.type}:${stableRecordId([input.type, normalizedText])}`;
    const existing = this.knowledge.get(key) ?? [];
    const duplicate = existing.find((record) => record.stableId === stableId);
    const previousRevision = this.getResearchContextRevision(context);
    const shouldAdvanceRevision = options.advanceRevision === true;
    if (duplicate) {
      const updated: PersonalKnowledgeRecord = {
        ...duplicate,
        structuredPayload: input.structuredPayload ?? duplicate.structuredPayload,
        updatedAt: now,
      };
      this.knowledge.set(key, existing.map((record) => record.id === duplicate.id ? updated : record));
      return {
        record: updated,
        created: false,
        previousRevision,
        currentRevision: previousRevision,
      };
    }

    const record: PersonalKnowledgeRecord = {
      ...input,
      id: `pk-${stableRecordId([context.authenticatedUserId, context.filterId, stableId])}`,
      userId: context.authenticatedUserId,
      filterId: context.filterId,
      normalizedText,
      stableId,
      createdAt: now,
      updatedAt: now,
    };
    this.knowledge.set(key, [...existing, record]);
    const currentRevision = shouldAdvanceRevision ? previousRevision + 1 : previousRevision;
    if (shouldAdvanceRevision) this.revisions.set(key, currentRevision);
    return {
      record,
      created: true,
      previousRevision,
      currentRevision,
    };
  }

  listPersonalKnowledge(context: AuthenticatedFilterContext) {
    return [...(this.knowledge.get(tenantKey(context)) ?? [])];
  }

  getResearchContextRevision(context: AuthenticatedFilterContext) {
    return this.revisions.get(tenantKey(context)) ?? 1;
  }

  saveRunMetadata(context: AuthenticatedFilterContext, metadata: ResearchRunMetadata) {
    const key = tenantKey(context);
    this.runMetadata.set(key, [metadata, ...(this.runMetadata.get(key) ?? [])]);
  }

  getLatestRunMetadata(context: AuthenticatedFilterContext) {
    return this.runMetadata.get(tenantKey(context))?.[0] ?? null;
  }

  listRunMetadata(context: AuthenticatedFilterContext) {
    return [...(this.runMetadata.get(tenantKey(context)) ?? [])];
  }

  saveFilter(context: AuthenticatedFilterContext, filter: OwnedFilterRecord) {
    const existing = this.filters.get(context.filterId);
    if (existing && existing.userId !== context.authenticatedUserId) {
      throw new Error("Filter write rejected for the requested user");
    }
    const saved = {
      ...filter,
      id: context.filterId,
      userId: context.authenticatedUserId,
    };
    this.filters.set(saved.id, saved);
    return saved;
  }

  getFilter(context: AuthenticatedFilterContext) {
    const filter = this.filters.get(context.filterId);
    return filter?.userId === context.authenticatedUserId ? filter : null;
  }

  filterBelongsTo(context: AuthenticatedFilterContext) {
    return this.getFilter(context) !== null;
  }

  savePreference(context: AuthenticatedFilterContext, input: UserPreferenceInput, now: string) {
    const id = stableRecordId([tenantKey(context), input.scopeType, input.scopeValue, input.feedbackType]);
    const existing = (this.preferences.get(tenantKey(context)) ?? []).find((pref) => pref.id === id);
    const record: UserPreferenceRecord = {
      id,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue,
      feedbackType: input.feedbackType,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const list = (this.preferences.get(tenantKey(context)) ?? []).filter((pref) => pref.id !== id);
    this.preferences.set(tenantKey(context), [...list, record]);
    return record;
  }

  listPreferences(context: AuthenticatedFilterContext) {
    return [...(this.preferences.get(tenantKey(context)) ?? [])];
  }

  saveGoal(context: AuthenticatedFilterContext, goal: Goal) {
    const key = `${tenantKey(context)}:${goal.id}`;
    const saved = {
      ...goal,
      userId: context.authenticatedUserId,
      filterId: context.filterId,
      successCriteria: [...goal.successCriteria],
      openQuestions: [...goal.openQuestions],
      taskIds: [...goal.taskIds],
      completedTaskIds: [...goal.completedTaskIds],
      taskMetadata: goal.taskMetadata?.map((task) => ({ ...task, supportingEvidenceIds: task.supportingEvidenceIds ? [...task.supportingEvidenceIds] : undefined })),
      completedCriteria: [...goal.completedCriteria],
      remainingCriteria: [...goal.remainingCriteria],
      lastTransition: goal.lastTransition ? { ...goal.lastTransition, completedCriteria: [...goal.lastTransition.completedCriteria], remainingCriteria: [...goal.lastTransition.remainingCriteria], selectedNextTasks: [...goal.lastTransition.selectedNextTasks], relatedAgentRunIds: [...goal.lastTransition.relatedAgentRunIds] } : undefined,
      watch: goal.watch ? { ...goal.watch, resumeCondition: { ...goal.watch.resumeCondition } } : undefined,
    };
    this.goals.set(key, saved);
    return saved;
  }

  getGoal(context: AuthenticatedFilterContext, goalId: string) {
    return this.goals.get(`${tenantKey(context)}:${goalId}`) ?? null;
  }

  listGoals(context: AuthenticatedFilterContext) {
    const prefix = `${tenantKey(context)}:`;
    return Array.from(this.goals.entries()).filter(([key]) => key.startsWith(prefix)).map(([, goal]) => goal);
  }

  findDueGoals(now: string, limit = 25) {
    return Array.from(this.goals.values())
      .filter((goal) => isAutoSchedulable(goal, now))
      .slice(0, limit)
      .map((goal) => ({
        context: { authenticatedUserId: goal.userId, filterId: goal.filterId },
        goal,
      }));
  }

  claimDueGoal(context: AuthenticatedFilterContext, goalId: string, leaseOwner: string, leaseExpiresAt: string, now: string) {
    const key = `${tenantKey(context)}:${goalId}`;
    const goal = this.goals.get(key);
    if (!goal || !isAutoSchedulable(goal, now) || !goal.watch) return null;
    const claimed: Goal = {
      ...goal,
      updatedAt: now,
      watch: {
        ...goal.watch,
        leaseOwner,
        leaseExpiresAt,
        schedulerLastRunAt: now,
      },
    };
    this.goals.set(key, claimed);
    return claimed;
  }

  saveNotification(context: AuthenticatedFilterContext, notification: NotificationRecord) {
    const saved: NotificationRecord = {
      ...notification,
      userId: context.authenticatedUserId,
      filterId: context.filterId,
      relatedEvidenceIds: [...notification.relatedEvidenceIds],
      unread: notification.unread ?? notification.status !== "SUPPRESSED",
    };
    this.notifications.set(`${tenantKey(context)}:${saved.id}`, saved);
    return saved;
  }

  getNotificationByKey(context: AuthenticatedFilterContext, notificationKey: string) {
    const prefix = `${tenantKey(context)}:`;
    return Array.from(this.notifications.entries()).find(([key, notification]) => key.startsWith(prefix) && notification.notificationKey === notificationKey)?.[1] ?? null;
  }

  listNotifications(context: AuthenticatedFilterContext) {
    const prefix = `${tenantKey(context)}:`;
    return Array.from(this.notifications.entries()).filter(([key]) => key.startsWith(prefix)).map(([, notification]) => notification);
  }

  claimNotification(context: AuthenticatedFilterContext, notificationId: string, leaseOwner: string, leaseExpiresAt: string, now: string) {
    const key = `${tenantKey(context)}:${notificationId}`;
    const notification = this.notifications.get(key);
    if (!notification || notification.status !== "PENDING") return null;
    if (notification.leaseExpiresAt && Date.parse(notification.leaseExpiresAt) > Date.parse(now)) return null;
    const claimed = { ...notification, leaseOwner, leaseExpiresAt };
    this.notifications.set(key, claimed);
    return claimed;
  }

  markNotificationRead(context: AuthenticatedFilterContext, notificationId: string, now: string) {
    const key = `${tenantKey(context)}:${notificationId}`;
    const notification = this.notifications.get(key);
    if (!notification) return null;
    const updated = { ...notification, unread: false, readAt: now };
    this.notifications.set(key, updated);
    return updated;
  }
}
