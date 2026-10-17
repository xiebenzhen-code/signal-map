import type { GoalStatus, GoalTransition } from "../agent/goal-types.ts";
import type { KnowledgeChange } from "../agent/types.ts";
import type { AuthenticatedFilterContext, NotificationRepository } from "../information/repositories/types.ts";
import { stableRecordId } from "../information/rag-records.ts";
import { decideDelivery } from "./delivery-policy.ts";
import type { DeliveryAdapter, DeliveryAttention, DeliveryDecision, NotificationRecord } from "./types.ts";

export type DeliveryRequest = {
  context: AuthenticatedFilterContext;
  repository: NotificationRepository;
  adapter: DeliveryAdapter;
  finalAttention: DeliveryAttention;
  goalId?: string;
  goalStatus?: GoalStatus;
  goalTransition?: GoalTransition;
  knowledgeChange?: KnowledgeChange;
  relatedEvidenceIds?: string[];
  relatedRevisionId?: string;
  userDeliveryPreference?: "silent" | "digest" | "immediate";
  now?: string;
  leaseOwner?: string;
  leaseMs?: number;
};

export type DeliveryResult = {
  decision: DeliveryDecision;
  notification?: NotificationRecord;
};

export const noopDeliveryAdapter: DeliveryAdapter = {
  channel: "NOOP",
  deliver: () => ({ status: "delivered" }),
};

export const inAppDeliveryAdapter: DeliveryAdapter = {
  channel: "IN_APP",
  deliver: () => ({ status: "delivered" }),
};

function normalizeAttention(attention: DeliveryAttention): DeliveryAttention {
  if (attention === "LIBRARY_ONLY") return "STORE_ONLY";
  if (attention === "WORTH_WATCHING") return "SURFACE";
  return attention;
}

export function notificationKey(input: {
  userId: string;
  filterId: string;
  goalId?: string;
  attention: DeliveryAttention;
  relatedEvidenceIds: string[];
  relatedRevisionId?: string;
  transitionTimestamp?: string;
}) {
  const attention = normalizeAttention(input.attention);
  const evidenceKey = [...input.relatedEvidenceIds].sort().join(",");
  const revisionOrEvidence = input.relatedRevisionId ?? evidenceKey;
  return [
    input.userId,
    input.filterId,
    input.goalId ?? "research",
    attention,
    revisionOrEvidence,
    input.transitionTimestamp ?? "",
  ].join(":");
}

function canRenotify(existing: NotificationRecord, attention: DeliveryAttention, relatedRevisionId?: string) {
  return (existing.attention === "SURFACE" || existing.attention === "WORTH_WATCHING") &&
    normalizeAttention(attention) === "MUST_READ" &&
    existing.relatedRevisionId === relatedRevisionId;
}

function digestWindowId(now: string) {
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export async function deliverAttention(input: DeliveryRequest): Promise<DeliveryResult> {
  const now = input.now ?? new Date().toISOString();
  const attention = normalizeAttention(input.finalAttention);
  const history = await Promise.resolve(input.repository.listNotifications(input.context));
  const decision = decideDelivery({
    finalAttention: attention,
    goalStatus: input.goalStatus,
    goalTransition: input.goalTransition,
    knowledgeChange: input.knowledgeChange,
    notificationHistory: history,
    userDeliveryPreference: input.userDeliveryPreference,
  });
  if (decision.action === "SILENT") return { decision };

  const relatedEvidenceIds = input.relatedEvidenceIds ?? input.knowledgeChange?.supportingEvidenceIds ?? [];
  const key = notificationKey({
    userId: input.context.authenticatedUserId,
    filterId: input.context.filterId,
    goalId: input.goalId,
    attention,
    relatedEvidenceIds,
    relatedRevisionId: input.relatedRevisionId,
    transitionTimestamp: input.goalTransition?.timestamp,
  });
  const existing = await Promise.resolve(input.repository.getNotificationByKey(input.context, key));
  if (existing?.status === "DELIVERED" && !canRenotify(existing, attention, input.relatedRevisionId)) {
    const suppressed: NotificationRecord = {
      ...existing,
      id: `notification-${stableRecordId([key, "suppressed", now])}`,
      status: "SUPPRESSED",
      createdAt: now,
      deliveredAt: undefined,
      failureSummary: "Duplicate notificationKey suppressed.",
    };
    await Promise.resolve(input.repository.saveNotification(input.context, suppressed));
    return { decision, notification: suppressed };
  }

  const record: NotificationRecord = existing && existing.status !== "DELIVERED"
    ? { ...existing, status: "PENDING", failureSummary: undefined }
    : {
        id: `notification-${stableRecordId([key])}`,
        notificationKey: key,
        userId: input.context.authenticatedUserId,
        filterId: input.context.filterId,
        goalId: input.goalId,
        attention,
        deliveryAction: decision.action,
        relatedEvidenceIds,
        relatedRevisionId: input.relatedRevisionId,
        status: "PENDING",
        createdAt: now,
        digestWindowId: decision.action === "DIGEST" ? digestWindowId(now) : undefined,
      };
  await Promise.resolve(input.repository.saveNotification(input.context, record));

  if (decision.action === "DIGEST") return { decision, notification: record };

  const leaseOwner = input.leaseOwner ?? "delivery";
  const leaseExpiresAt = new Date(Date.parse(now) + (input.leaseMs ?? 60_000)).toISOString();
  const claimed = await Promise.resolve(input.repository.claimNotification(input.context, record.id, leaseOwner, leaseExpiresAt, now));
  if (!claimed) return { decision, notification: { ...record, status: "SUPPRESSED", failureSummary: "Notification already claimed." } };
  const delivered = await Promise.resolve(input.adapter.deliver(claimed));
  const updated: NotificationRecord = delivered.status === "delivered"
    ? { ...claimed, status: "DELIVERED", deliveredAt: now, leaseOwner: undefined, leaseExpiresAt: undefined }
    : { ...claimed, status: delivered.retryable ? "PENDING" : "FAILED", failureSummary: delivered.failureSummary ?? "Delivery failed.", leaseOwner: undefined, leaseExpiresAt: undefined };
  return { decision, notification: await Promise.resolve(input.repository.saveNotification(input.context, updated)) };
}

export async function retryPendingNotifications(input: {
  context: AuthenticatedFilterContext;
  repository: NotificationRepository;
  adapter: DeliveryAdapter;
  now?: string;
  leaseOwner?: string;
  limit?: number;
}) {
  const now = input.now ?? new Date().toISOString();
  const pending = (await Promise.resolve(input.repository.listNotifications(input.context)))
    .filter((record) => record.status === "PENDING" && record.deliveryAction !== "DIGEST")
    .slice(0, input.limit ?? 25);
  const results: NotificationRecord[] = [];
  for (const record of pending) {
    const claimed = await Promise.resolve(input.repository.claimNotification(input.context, record.id, input.leaseOwner ?? "retry", new Date(Date.parse(now) + 60_000).toISOString(), now));
    if (!claimed) continue;
    const delivered = await Promise.resolve(input.adapter.deliver(claimed));
    const updated: NotificationRecord = delivered.status === "delivered"
      ? { ...claimed, status: "DELIVERED", deliveredAt: now, leaseOwner: undefined, leaseExpiresAt: undefined }
      : { ...claimed, status: delivered.retryable ? "PENDING" : "FAILED", failureSummary: delivered.failureSummary ?? "Delivery failed.", leaseOwner: undefined, leaseExpiresAt: undefined };
    results.push(await Promise.resolve(input.repository.saveNotification(input.context, updated)));
  }
  return results;
}

export async function collectDigest(input: {
  context: AuthenticatedFilterContext;
  repository: NotificationRepository;
  windowId: string;
}) {
  return (await Promise.resolve(input.repository.listNotifications(input.context)))
    .filter((record) => record.status === "PENDING" && record.deliveryAction === "DIGEST" && record.digestWindowId === input.windowId);
}

export async function markNotificationRead(input: {
  context: AuthenticatedFilterContext;
  repository: NotificationRepository;
  notificationId: string;
  now?: string;
}) {
  return Promise.resolve(input.repository.markNotificationRead(
    input.context,
    input.notificationId,
    input.now ?? new Date().toISOString(),
  ));
}
