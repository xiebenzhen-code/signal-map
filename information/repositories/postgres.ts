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
import type { Goal, GoalTaskMetadata, GoalTransition, GoalWatchMetadata } from "../../agent/goal-types.ts";
import type { NotificationRecord } from "../../notification/types.ts";

type QueryResult<T> = { rows: T[] };

export type PostgresClient = {
  query<T>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};

type RecoverPostgresReadClient = (failedClient: PostgresClient, error: unknown) => PostgresClient;

function sanitizePostgresTraceValue(value: unknown) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\b(password|token|apikey|api_key|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function postgresErrorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}

function postgresErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "";
}

function logPostgresReadRetry(event: Record<string, unknown>) {
  console.warn(JSON.stringify(event));
}

export function isPostgresConnectionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "message" in error ? String(error.message) : "";
  return message.includes("Connection terminated unexpectedly") ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "57P01" ||
    /^08/.test(code);
}

type EventRow = {
  id: string;
  canonical_title: string;
  normalized_key: string;
  entities: string[];
  tags: string[];
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type ClaimRow = {
  id: string;
  event_id: string;
  claim_text: string;
  normalized_claim: string;
  entities: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
};

type EvidenceRow = {
  id: string;
  claim_id: string;
  source_url: string;
  canonical_url: string;
  publisher: string;
  published_at?: string;
  source_type: EvidenceRecord["sourceType"];
  source_role: EvidenceRecord["sourceRole"];
  source_tier: EvidenceRecord["sourceTier"];
  verification_status: EvidenceRecord["verificationStatus"];
  evidence_snippet: string;
  data_mode: EvidenceRecord["dataMode"];
  social_chain_id?: string;
  retrieved_at: string;
  created_at: string;
};

type KnowledgeRow = {
  id: string;
  user_id: string;
  filter_id: string;
  type: PersonalKnowledgeRecord["type"];
  text: string;
  structured_payload?: unknown;
  normalized_text: string;
  stable_id: string;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  user_query?: string;
  started_at?: string;
  completed_at?: string;
  status?: ResearchRunMetadata["status"];
  rounds?: number;
  evidence_ids?: string[];
  knowledge_changes?: ResearchRunMetadata["knowledgeChanges"];
  attention_result?: string[];
  strategies?: string[];
  trace?: ResearchRunMetadata["trace"];
  generated_from_research_context_revision: number;
  data_mode: ResearchRunMetadata["dataMode"];
  fallback_reason?: string;
  created_at: string;
};

type GoalRow = Goal & { user_id: string; filter_id: string; success_criteria: string[]; open_questions: string[]; task_ids: string[]; completed_task_ids: string[]; task_metadata?: GoalTaskMetadata[]; completed_criteria: string[]; remaining_criteria: string[]; current_summary?: string; created_at: string; updated_at: string; completed_at?: string; last_transition?: GoalTransition; watch_metadata?: GoalWatchMetadata };
type NotificationRow = NotificationRecord & { notification_key: string; user_id: string; filter_id: string; goal_id?: string; delivery_action: NotificationRecord["deliveryAction"]; related_evidence_ids: string[]; related_revision_id?: string; unread?: boolean; read_at?: string; created_at: string; delivered_at?: string; failure_summary?: string; digest_window_id?: string; lease_owner?: string; lease_expires_at?: string };
type FilterRow = { id: string; user_id: string; name?: string; created_at: string; updated_at: string };

function eventFromRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    canonicalTitle: row.canonical_title,
    normalizedKey: row.normalized_key,
    entities: row.entities,
    tags: row.tags,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function claimFromRow(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    claimText: row.claim_text,
    normalizedClaim: row.normalized_claim,
    entities: row.entities,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function evidenceFromRow(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    claimId: row.claim_id,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    publisher: row.publisher,
    publishedAt: row.published_at,
    sourceType: row.source_type,
    sourceRole: row.source_role,
    sourceTier: row.source_tier,
    verificationStatus: row.verification_status,
    evidenceSnippet: row.evidence_snippet,
    dataMode: row.data_mode,
    socialChainId: row.social_chain_id,
    retrievedAt: row.retrieved_at,
    createdAt: row.created_at,
  };
}

function knowledgeFromRow(row: KnowledgeRow): PersonalKnowledgeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    filterId: row.filter_id,
    type: row.type,
    text: row.text,
    structuredPayload: row.structured_payload,
    normalizedText: row.normalized_text,
    stableId: row.stable_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runFromRow(row: RunRow): ResearchRunMetadata {
  return {
    id: row.id,
    userQuery: row.user_query,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    rounds: row.rounds,
    evidenceIds: row.evidence_ids,
    knowledgeChanges: row.knowledge_changes,
    attentionResult: row.attention_result,
    strategies: row.strategies,
    trace: row.trace,
    generatedFromResearchContextRevision: row.generated_from_research_context_revision,
    dataMode: row.data_mode,
    fallbackReason: row.fallback_reason,
    createdAt: row.created_at,
  };
}

function goalFromRow(row: GoalRow): Goal {
  return { id: row.id, userId: row.user_id, filterId: row.filter_id, objective: row.objective, status: row.status, successCriteria: row.success_criteria, openQuestions: row.open_questions, taskIds: row.task_ids, completedTaskIds: row.completed_task_ids, taskMetadata: row.task_metadata ?? [], completedCriteria: row.completed_criteria, remainingCriteria: row.remaining_criteria, currentSummary: row.current_summary, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, lastTransition: row.last_transition, watch: row.watch_metadata };
}

function notificationFromRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    notificationKey: row.notification_key,
    userId: row.user_id,
    filterId: row.filter_id,
    goalId: row.goal_id,
    attention: row.attention,
    deliveryAction: row.delivery_action,
    relatedEvidenceIds: row.related_evidence_ids,
    relatedRevisionId: row.related_revision_id,
    status: row.status,
    unread: row.unread,
    readAt: row.read_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    failureSummary: row.failure_summary,
    digestWindowId: row.digest_window_id,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
  };
}

function filterFromRow(row: FilterRow): OwnedFilterRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type UserPreferenceRow = {
  id: string;
  user_id: string;
  filter_id: string;
  scope_type: string;
  scope_value: string;
  feedback_type: string;
  created_at: string;
  updated_at: string;
};

function userPreferenceFromRow(row: UserPreferenceRow): UserPreferenceRecord {
  return {
    id: row.id,
    scopeType: row.scope_type as UserPreferenceRecord["scopeType"],
    scopeValue: row.scope_value,
    feedbackType: row.feedback_type as UserPreferenceRecord["feedbackType"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresSignalRepository implements
  EventRepository,
  ClaimRepository,
  EvidenceRepository,
  FilterOwnershipRepository,
  GoalRepository,
  NotificationRepository,
  PersonalKnowledgeRepository,
  PreferenceRepository,
  ResearchContextRepository {
  private client: PostgresClient;
  private recoverReadClient?: RecoverPostgresReadClient;

  constructor(client: PostgresClient, recoverReadClient?: RecoverPostgresReadClient) {
    this.client = client;
    this.recoverReadClient = recoverReadClient;
  }

  private async readOnlyQuery<T>(queryName: string, sql: string, values?: unknown[]) {
    try {
      return await this.client.query<T>(sql, values);
    } catch (error) {
      if (!this.recoverReadClient || !isPostgresConnectionError(error)) throw error;
      logPostgresReadRetry({
        phase: "postgres_read_retry_started",
        queryName,
        firstErrorName: sanitizePostgresTraceValue(postgresErrorName(error)),
        firstErrorMessage: sanitizePostgresTraceValue(postgresErrorMessage(error)),
      });
      const nextClient = this.recoverReadClient(this.client, error);
      const recoveredClientChanged = nextClient !== this.client;
      this.client = nextClient;
      try {
        const result = await nextClient.query<T>(sql, values);
        logPostgresReadRetry({
          phase: "postgres_read_retry_finished",
          queryName,
          retrySuccess: true,
          recoveredClientChanged,
        });
        return result;
      } catch (retryError) {
        logPostgresReadRetry({
          phase: "postgres_read_retry_finished",
          queryName,
          retrySuccess: false,
          recoveredClientChanged,
          retryErrorName: sanitizePostgresTraceValue(postgresErrorName(retryError)),
          retryErrorMessage: sanitizePostgresTraceValue(postgresErrorMessage(retryError)),
        });
        throw retryError;
      }
    }
  }

  async upsertEvent(event: EventRecord) {
    const result = await this.client.query<EventRow>(
      `INSERT INTO events (
        id, canonical_title, normalized_key, entities, tags, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (normalized_key) DO UPDATE SET
        canonical_title = EXCLUDED.canonical_title,
        entities = EXCLUDED.entities,
        tags = EXCLUDED.tags,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        event.id,
        event.canonicalTitle,
        event.normalizedKey,
        JSON.stringify(event.entities),
        JSON.stringify(event.tags),
        event.firstSeenAt,
        event.lastSeenAt,
        event.createdAt,
        event.updatedAt,
      ],
    );
    return eventFromRow(result.rows[0]);
  }

  async getEventById(id: string) {
    const result = await this.client.query<EventRow>("SELECT * FROM events WHERE id = $1", [id]);
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async getEventByNormalizedKey(normalizedKey: string) {
    const result = await this.client.query<EventRow>(
      "SELECT * FROM events WHERE normalized_key = $1",
      [normalizedKey],
    );
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async listEvents() {
    const result = await this.client.query<EventRow>("SELECT * FROM events ORDER BY updated_at DESC LIMIT 200");
    return result.rows.map(eventFromRow);
  }

  async upsertClaim(claim: ClaimRecord) {
    const result = await this.client.query<ClaimRow>(
      `INSERT INTO claims (
        id, event_id, claim_text, normalized_claim, entities, tags, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (event_id, normalized_claim) DO UPDATE SET
        claim_text = EXCLUDED.claim_text,
        entities = EXCLUDED.entities,
        tags = EXCLUDED.tags,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        claim.id,
        claim.eventId,
        claim.claimText,
        claim.normalizedClaim,
        JSON.stringify(claim.entities),
        JSON.stringify(claim.tags),
        claim.createdAt,
        claim.updatedAt,
      ],
    );
    return claimFromRow(result.rows[0]);
  }

  async listClaimsForEvent(eventId: string) {
    const result = await this.client.query<ClaimRow>(
      "SELECT * FROM claims WHERE event_id = $1 ORDER BY created_at ASC",
      [eventId],
    );
    return result.rows.map(claimFromRow);
  }

  async listClaims() {
    const result = await this.client.query<ClaimRow>("SELECT * FROM claims ORDER BY updated_at DESC LIMIT 500");
    return result.rows.map(claimFromRow);
  }

  async upsertEvidence(evidence: EvidenceRecord) {
    const result = await this.client.query<EvidenceRow>(
      `INSERT INTO evidence (
        id, claim_id, source_url, canonical_url, publisher, published_at, source_type, source_role,
        source_tier, verification_status, evidence_snippet, data_mode, social_chain_id, retrieved_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (claim_id, canonical_url) DO UPDATE SET
        publisher = EXCLUDED.publisher,
        published_at = COALESCE(EXCLUDED.published_at, evidence.published_at),
        verification_status = EXCLUDED.verification_status,
        evidence_snippet = EXCLUDED.evidence_snippet,
        retrieved_at = EXCLUDED.retrieved_at
      RETURNING *`,
      [
        evidence.id,
        evidence.claimId,
        evidence.sourceUrl,
        evidence.canonicalUrl,
        evidence.publisher,
        evidence.publishedAt,
        evidence.sourceType,
        evidence.sourceRole,
        evidence.sourceTier,
        evidence.verificationStatus,
        evidence.evidenceSnippet,
        evidence.dataMode,
        evidence.socialChainId,
        evidence.retrievedAt,
        evidence.createdAt,
      ],
    );
    return evidenceFromRow(result.rows[0]);
  }

  async listEvidenceForClaim(claimId: string) {
    const result = await this.client.query<EvidenceRow>(
      "SELECT * FROM evidence WHERE claim_id = $1 ORDER BY created_at ASC",
      [claimId],
    );
    return result.rows.map(evidenceFromRow);
  }

  async listEvidence() {
    const result = await this.client.query<EvidenceRow>("SELECT * FROM evidence ORDER BY created_at DESC LIMIT 500");
    return result.rows.map(evidenceFromRow);
  }

  async addPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
  ) {
    return (await this.upsertPersonalKnowledge(context, input, now, {
      advanceRevision: RESEARCH_CONTEXT_KNOWLEDGE_TYPES.has(input.type),
    })).record;
  }

  async upsertPersonalKnowledge(
    context: AuthenticatedFilterContext,
    input: PersonalKnowledgeRecordInput,
    now: string,
    options: { advanceRevision?: boolean } = {},
  ) {
    const normalizedText = normalizeText(input.text);
    const stableId = `${input.type}:${stableRecordId([input.type, normalizedText])}`;
    const id = `pk-${stableRecordId([context.authenticatedUserId, context.filterId, stableId])}`;
    const previousRevision = await this.getResearchContextRevision(context);
    const result = await this.client.query<KnowledgeRow>(
      `INSERT INTO personal_knowledge (
        id, user_id, filter_id, type, text, structured_payload, normalized_text, stable_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (user_id, filter_id, stable_id) DO UPDATE SET
        text = EXCLUDED.text,
        structured_payload = EXCLUDED.structured_payload,
        normalized_text = EXCLUDED.normalized_text,
        updated_at = EXCLUDED.updated_at
      RETURNING *, (xmax = 0) AS created`,
      [
        id,
        context.authenticatedUserId,
        context.filterId,
        input.type,
        input.text,
        input.structuredPayload ? JSON.stringify(input.structuredPayload) : null,
        normalizedText,
        stableId,
        now,
        now,
      ],
    );
    const row = result.rows[0] as KnowledgeRow & { created?: boolean };
    const created = "created" in row ? Boolean(row.created) : true;
    let currentRevision = previousRevision;
    if (options.advanceRevision && created) {
      const revisionResult = await this.client.query<{ research_context_revision: number }>(
        `INSERT INTO research_context_revisions (
          user_id, filter_id, research_context_revision, updated_at
        ) VALUES ($1,$2,2,$3)
        ON CONFLICT (user_id, filter_id) DO UPDATE SET
          research_context_revision = research_context_revisions.research_context_revision + 1,
          updated_at = EXCLUDED.updated_at
        RETURNING research_context_revision`,
        [context.authenticatedUserId, context.filterId, now],
      );
      currentRevision = revisionResult.rows[0]?.research_context_revision ?? previousRevision + 1;
    }
    return {
      record: knowledgeFromRow(result.rows[0]),
      created,
      previousRevision,
      currentRevision,
    };
  }

  async listPersonalKnowledge(context: AuthenticatedFilterContext) {
    const result = await this.readOnlyQuery<KnowledgeRow>(
      "listPersonalKnowledge",
      "SELECT * FROM personal_knowledge WHERE user_id = $1 AND filter_id = $2 ORDER BY created_at ASC",
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows.map(knowledgeFromRow);
  }

  async savePreference(context: AuthenticatedFilterContext, input: UserPreferenceInput, now: string) {
    const tenant = `${context.authenticatedUserId}:${context.filterId}`;
    const id = stableRecordId([tenant, input.scopeType, input.scopeValue, input.feedbackType]);
    const result = await this.client.query<UserPreferenceRow>(
      `INSERT INTO user_preferences (
        id, user_id, filter_id, scope_type, scope_value, feedback_type, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (user_id, filter_id, scope_type, scope_value, feedback_type) DO UPDATE SET
        updated_at = EXCLUDED.updated_at,
        id = EXCLUDED.id
      RETURNING *`,
      [
        id,
        context.authenticatedUserId,
        context.filterId,
        input.scopeType,
        input.scopeValue,
        input.feedbackType,
        now,
        now,
      ],
    );
    return userPreferenceFromRow(result.rows[0]);
  }

  async listPreferences(context: AuthenticatedFilterContext) {
    const result = await this.readOnlyQuery<UserPreferenceRow>(
      "listPreferences",
      "SELECT * FROM user_preferences WHERE user_id = $1 AND filter_id = $2 ORDER BY created_at ASC",
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows.map(userPreferenceFromRow);
  }

  async getResearchContextRevision(context: AuthenticatedFilterContext) {
    const result = await this.readOnlyQuery<{ research_context_revision: number }>(
      "getResearchContextRevision",
      `SELECT research_context_revision FROM research_context_revisions
      WHERE user_id = $1 AND filter_id = $2`,
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows[0]?.research_context_revision ?? 1;
  }

  async saveRunMetadata(context: AuthenticatedFilterContext, metadata: ResearchRunMetadata) {
    await this.client.query(
      `INSERT INTO research_run_metadata (
        id, user_id, filter_id, user_query, started_at, completed_at, status, rounds, evidence_ids,
        knowledge_changes, attention_result, strategies, trace, generated_from_research_context_revision, data_mode,
        fallback_reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        metadata.id,
        context.authenticatedUserId,
        context.filterId,
        metadata.userQuery,
        metadata.startedAt,
        metadata.completedAt,
        metadata.status,
        metadata.rounds,
        JSON.stringify(metadata.evidenceIds ?? []),
        JSON.stringify(metadata.knowledgeChanges ?? []),
        JSON.stringify(metadata.attentionResult ?? []),
        JSON.stringify(metadata.strategies ?? []),
        JSON.stringify(metadata.trace ?? []),
        metadata.generatedFromResearchContextRevision,
        metadata.dataMode,
        metadata.fallbackReason,
        metadata.createdAt,
      ],
    );
  }

  async getLatestRunMetadata(context: AuthenticatedFilterContext) {
    const result = await this.readOnlyQuery<RunRow>(
      "getLatestRunMetadata",
      `SELECT id, user_query, started_at, completed_at, status, rounds, evidence_ids, knowledge_changes,
        attention_result, strategies, trace, generated_from_research_context_revision, data_mode, fallback_reason, created_at
      FROM research_run_metadata
      WHERE user_id = $1 AND filter_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows[0] ? runFromRow(result.rows[0]) : null;
  }

  async listRunMetadata(context: AuthenticatedFilterContext) {
    const result = await this.client.query<RunRow>(
      `SELECT id, user_query, started_at, completed_at, status, rounds, evidence_ids, knowledge_changes,
        attention_result, strategies, trace, generated_from_research_context_revision, data_mode, fallback_reason, created_at
      FROM research_run_metadata
      WHERE user_id = $1 AND filter_id = $2
      ORDER BY created_at DESC
      LIMIT 100`,
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows.map(runFromRow);
  }

  async saveFilter(context: AuthenticatedFilterContext, filter: OwnedFilterRecord) {
    const result = await this.client.query<FilterRow>(
      `INSERT INTO filters (id, user_id, name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = EXCLUDED.updated_at
       WHERE filters.user_id = EXCLUDED.user_id
       RETURNING *`,
      [context.filterId, context.authenticatedUserId, filter.name, filter.createdAt, filter.updatedAt],
    );
    if (!result.rows[0]) throw new Error("Filter write rejected for the requested user");
    return filterFromRow(result.rows[0]);
  }

  async getFilter(context: AuthenticatedFilterContext) {
    const result = await this.client.query<FilterRow>(
      "SELECT * FROM filters WHERE id = $1 AND user_id = $2",
      [context.filterId, context.authenticatedUserId],
    );
    return result.rows[0] ? filterFromRow(result.rows[0]) : null;
  }

  async filterBelongsTo(context: AuthenticatedFilterContext) {
    return (await this.getFilter(context)) !== null;
  }

  async saveGoal(context: AuthenticatedFilterContext, goal: Goal) {
    const result = await this.client.query<GoalRow>(
      `INSERT INTO goals (id, user_id, filter_id, objective, status, success_criteria, open_questions, task_ids, completed_task_ids, task_metadata, completed_criteria, remaining_criteria, current_summary, created_at, updated_at, completed_at, last_transition, watch_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, success_criteria = EXCLUDED.success_criteria, open_questions = EXCLUDED.open_questions, task_ids = EXCLUDED.task_ids, completed_task_ids = EXCLUDED.completed_task_ids, task_metadata = EXCLUDED.task_metadata, completed_criteria = EXCLUDED.completed_criteria, remaining_criteria = EXCLUDED.remaining_criteria, current_summary = EXCLUDED.current_summary, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at, last_transition = EXCLUDED.last_transition, watch_metadata = EXCLUDED.watch_metadata
       WHERE goals.user_id = EXCLUDED.user_id AND goals.filter_id = EXCLUDED.filter_id
       RETURNING *`,
      [goal.id, context.authenticatedUserId, context.filterId, goal.objective, goal.status, JSON.stringify(goal.successCriteria), JSON.stringify(goal.openQuestions), JSON.stringify(goal.taskIds), JSON.stringify(goal.completedTaskIds), JSON.stringify(goal.taskMetadata ?? []), JSON.stringify(goal.completedCriteria), JSON.stringify(goal.remainingCriteria), goal.currentSummary, goal.createdAt, goal.updatedAt, goal.completedAt, goal.lastTransition ? JSON.stringify(goal.lastTransition) : null, goal.watch ? JSON.stringify(goal.watch) : null],
    );
    if (!result.rows[0]) throw new Error("Goal write rejected for the requested user and filter");
    return goalFromRow(result.rows[0]);
  }

  async getGoal(context: AuthenticatedFilterContext, goalId: string) {
    const result = await this.client.query<GoalRow>("SELECT * FROM goals WHERE id = $1 AND user_id = $2 AND filter_id = $3", [goalId, context.authenticatedUserId, context.filterId]);
    return result.rows[0] ? goalFromRow(result.rows[0]) : null;
  }

  async listGoals(context: AuthenticatedFilterContext) {
    const result = await this.client.query<GoalRow>("SELECT * FROM goals WHERE user_id = $1 AND filter_id = $2 ORDER BY updated_at DESC", [context.authenticatedUserId, context.filterId]);
    return result.rows.map(goalFromRow);
  }

  async findDueGoals(now: string, limit = 25) {
    const result = await this.client.query<GoalRow>(
      `SELECT * FROM goals
       WHERE status IN ('waiting', 'blocked')
         AND watch_metadata IS NOT NULL
         AND COALESCE(watch_metadata->>'watchStatus', 'waiting') IN ('waiting', 'error')
         AND watch_metadata->'resumeCondition'->>'type' NOT IN ('MANUAL', 'EVENT')
         AND COALESCE(watch_metadata->>'nextCheckAt', watch_metadata->'resumeCondition'->>'nextCheckAt') IS NOT NULL
         AND (COALESCE(watch_metadata->>'nextCheckAt', watch_metadata->'resumeCondition'->>'nextCheckAt'))::timestamptz <= $1::timestamptz
         AND (
           watch_metadata->>'leaseExpiresAt' IS NULL
           OR (watch_metadata->>'leaseExpiresAt')::timestamptz <= $1::timestamptz
         )
       ORDER BY updated_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      context: { authenticatedUserId: row.user_id, filterId: row.filter_id },
      goal: goalFromRow(row),
    }));
  }

  async claimDueGoal(context: AuthenticatedFilterContext, goalId: string, leaseOwner: string, leaseExpiresAt: string, now: string) {
    const result = await this.client.query<GoalRow>(
      `UPDATE goals SET
         watch_metadata = watch_metadata || $5::jsonb,
         updated_at = $4::timestamptz
       WHERE id = $1
         AND user_id = $2
         AND filter_id = $3
         AND status IN ('waiting', 'blocked')
         AND watch_metadata IS NOT NULL
         AND COALESCE(watch_metadata->>'watchStatus', 'waiting') IN ('waiting', 'error')
         AND watch_metadata->'resumeCondition'->>'type' NOT IN ('MANUAL', 'EVENT')
         AND COALESCE(watch_metadata->>'nextCheckAt', watch_metadata->'resumeCondition'->>'nextCheckAt') IS NOT NULL
         AND (COALESCE(watch_metadata->>'nextCheckAt', watch_metadata->'resumeCondition'->>'nextCheckAt'))::timestamptz <= $4::timestamptz
         AND (
           watch_metadata->>'leaseExpiresAt' IS NULL
           OR (watch_metadata->>'leaseExpiresAt')::timestamptz <= $4::timestamptz
         )
       RETURNING *`,
      [
        goalId,
        context.authenticatedUserId,
        context.filterId,
        now,
        JSON.stringify({ leaseOwner, leaseExpiresAt, schedulerLastRunAt: now }),
      ],
    );
    return result.rows[0] ? goalFromRow(result.rows[0]) : null;
  }

  async saveNotification(context: AuthenticatedFilterContext, notification: NotificationRecord) {
    const result = await this.client.query<NotificationRow>(
      `INSERT INTO notifications (
        id, notification_key, user_id, filter_id, goal_id, attention, delivery_action,
        related_evidence_ids, related_revision_id, status, unread, read_at, created_at, delivered_at,
        failure_summary, digest_window_id, lease_owner, lease_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET
        attention = EXCLUDED.attention,
        delivery_action = EXCLUDED.delivery_action,
        related_evidence_ids = EXCLUDED.related_evidence_ids,
        related_revision_id = EXCLUDED.related_revision_id,
        status = EXCLUDED.status,
        unread = EXCLUDED.unread,
        read_at = EXCLUDED.read_at,
        delivered_at = EXCLUDED.delivered_at,
        failure_summary = EXCLUDED.failure_summary,
        digest_window_id = EXCLUDED.digest_window_id,
        lease_owner = EXCLUDED.lease_owner,
        lease_expires_at = EXCLUDED.lease_expires_at
      WHERE notifications.user_id = EXCLUDED.user_id AND notifications.filter_id = EXCLUDED.filter_id
      RETURNING *`,
      [
        notification.id,
        notification.notificationKey,
        context.authenticatedUserId,
        context.filterId,
        notification.goalId,
        notification.attention,
        notification.deliveryAction,
        JSON.stringify(notification.relatedEvidenceIds),
        notification.relatedRevisionId,
        notification.status,
        notification.unread ?? notification.status !== "SUPPRESSED",
        notification.readAt,
        notification.createdAt,
        notification.deliveredAt,
        notification.failureSummary,
        notification.digestWindowId,
        notification.leaseOwner,
        notification.leaseExpiresAt,
      ],
    );
    if (!result.rows[0]) throw new Error("Notification write rejected for the requested user and filter");
    return notificationFromRow(result.rows[0]);
  }

  async getNotificationByKey(context: AuthenticatedFilterContext, notificationKey: string) {
    const result = await this.client.query<NotificationRow>(
      "SELECT * FROM notifications WHERE user_id = $1 AND filter_id = $2 AND notification_key = $3 ORDER BY created_at ASC LIMIT 1",
      [context.authenticatedUserId, context.filterId, notificationKey],
    );
    return result.rows[0] ? notificationFromRow(result.rows[0]) : null;
  }

  async listNotifications(context: AuthenticatedFilterContext) {
    const result = await this.client.query<NotificationRow>(
      "SELECT * FROM notifications WHERE user_id = $1 AND filter_id = $2 ORDER BY created_at ASC LIMIT 500",
      [context.authenticatedUserId, context.filterId],
    );
    return result.rows.map(notificationFromRow);
  }

  async claimNotification(context: AuthenticatedFilterContext, notificationId: string, leaseOwner: string, leaseExpiresAt: string, now: string) {
    const result = await this.client.query<NotificationRow>(
      `UPDATE notifications SET
        lease_owner = $4,
        lease_expires_at = $5::timestamptz
      WHERE id = $1
        AND user_id = $2
        AND filter_id = $3
        AND status = 'PENDING'
        AND (lease_expires_at IS NULL OR lease_expires_at <= $6::timestamptz)
      RETURNING *`,
      [notificationId, context.authenticatedUserId, context.filterId, leaseOwner, leaseExpiresAt, now],
    );
    return result.rows[0] ? notificationFromRow(result.rows[0]) : null;
  }

  async markNotificationRead(context: AuthenticatedFilterContext, notificationId: string, now: string) {
    const result = await this.client.query<NotificationRow>(
      `UPDATE notifications SET unread = false, read_at = $4::timestamptz
       WHERE id = $1 AND user_id = $2 AND filter_id = $3
       RETURNING *`,
      [notificationId, context.authenticatedUserId, context.filterId, now],
    );
    return result.rows[0] ? notificationFromRow(result.rows[0]) : null;
  }
}
