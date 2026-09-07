import type {
  ClaimRecord,
  EvidenceRecord,
  EventRecord,
  PersonalKnowledgeRecord,
  PersonalKnowledgeRecordInput,
  ResearchRunMetadata,
} from "../rag-records.ts";
import type { Goal } from "../../agent/goal-types.ts";
import type { NotificationRecord } from "../../notification/types.ts";

type MaybePromise<T> = T | Promise<T>;

export type AuthenticatedFilterContext = {
  authenticatedUserId: string;
  filterId: string;
};

type PersonalKnowledgeUpsertResult = {
  record: PersonalKnowledgeRecord;
  created: boolean;
  previousRevision: number;
  currentRevision: number;
};

export type OwnedFilterRecord = {
  id: string;
  userId: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

export interface EventRepository {
  upsertEvent(event: EventRecord): MaybePromise<EventRecord>;
  getEventById(id: string): MaybePromise<EventRecord | null>;
  getEventByNormalizedKey(normalizedKey: string): MaybePromise<EventRecord | null>;
  listEvents?(): MaybePromise<EventRecord[]>;
}

export interface ClaimRepository {
  upsertClaim(claim: ClaimRecord): MaybePromise<ClaimRecord>;
  listClaimsForEvent(eventId: string): MaybePromise<ClaimRecord[]>;
  listClaims?(): MaybePromise<ClaimRecord[]>;
}

export interface EvidenceRepository {
  upsertEvidence(evidence: EvidenceRecord): MaybePromise<EvidenceRecord>;
  listEvidenceForClaim(claimId: string): MaybePromise<EvidenceRecord[]>;
  listEvidence?(): MaybePromise<EvidenceRecord[]>;
}

export interface PersonalKnowledgeRepository {
  addPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
  ): MaybePromise<PersonalKnowledgeRecord>;
  upsertPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
    options?: { advanceRevision?: boolean },
  ): MaybePromise<PersonalKnowledgeUpsertResult>;
  listPersonalKnowledge(context: AuthenticatedFilterContext): MaybePromise<PersonalKnowledgeRecord[]>;
}

export interface ResearchContextRepository {
  getResearchContextRevision(context: AuthenticatedFilterContext): MaybePromise<number>;
  saveRunMetadata(context: AuthenticatedFilterContext, metadata: ResearchRunMetadata): MaybePromise<void>;
  getLatestRunMetadata(context: AuthenticatedFilterContext): MaybePromise<ResearchRunMetadata | null>;
  listRunMetadata(context: AuthenticatedFilterContext): MaybePromise<ResearchRunMetadata[]>;
}

export interface FilterOwnershipRepository {
  saveFilter(context: AuthenticatedFilterContext, filter: OwnedFilterRecord): MaybePromise<OwnedFilterRecord>;
  getFilter(context: AuthenticatedFilterContext): MaybePromise<OwnedFilterRecord | null>;
  filterBelongsTo(context: AuthenticatedFilterContext): MaybePromise<boolean>;
}

export interface GoalRepository {
  saveGoal(context: AuthenticatedFilterContext, goal: Goal): MaybePromise<Goal>;
  getGoal(context: AuthenticatedFilterContext, goalId: string): MaybePromise<Goal | null>;
  listGoals(context: AuthenticatedFilterContext): MaybePromise<Goal[]>;
  findDueGoals(now: string, limit?: number): MaybePromise<Array<{ context: AuthenticatedFilterContext; goal: Goal }>>;
  claimDueGoal(context: AuthenticatedFilterContext, goalId: string, leaseOwner: string, leaseExpiresAt: string, now: string): MaybePromise<Goal | null>;
}

export interface NotificationRepository {
  saveNotification(context: AuthenticatedFilterContext, notification: NotificationRecord): MaybePromise<NotificationRecord>;
  getNotificationByKey(context: AuthenticatedFilterContext, notificationKey: string): MaybePromise<NotificationRecord | null>;
  listNotifications(context: AuthenticatedFilterContext): MaybePromise<NotificationRecord[]>;
  claimNotification(context: AuthenticatedFilterContext, notificationId: string, leaseOwner: string, leaseExpiresAt: string, now: string): MaybePromise<NotificationRecord | null>;
  markNotificationRead(context: AuthenticatedFilterContext, notificationId: string, now: string): MaybePromise<NotificationRecord | null>;
}
