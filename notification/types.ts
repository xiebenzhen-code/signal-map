import type { ResearchSignal } from "../research/types.ts";

export type DeliveryAction = "SILENT" | "IN_APP" | "DIGEST" | "IMMEDIATE";
export type DeliveryPriority = "none" | "low" | "normal" | "high";
export type NotificationStatus = "PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED";

export type DeliveryAttention = ResearchSignal["attentionDecision"] | "STORE_ONLY" | "SURFACE";

export type NotificationRecord = {
  id: string;
  notificationKey: string;
  userId: string;
  filterId: string;
  goalId?: string;
  attention: DeliveryAttention;
  deliveryAction: DeliveryAction;
  relatedEvidenceIds: string[];
  relatedRevisionId?: string;
  status: NotificationStatus;
  unread?: boolean;
  readAt?: string;
  createdAt: string;
  deliveredAt?: string;
  failureSummary?: string;
  digestWindowId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
};

export type DeliveryDecision = {
  action: DeliveryAction;
  priority: DeliveryPriority;
  reason: string;
};

export type DeliveryAdapterResult = {
  status: "delivered" | "failed";
  retryable?: boolean;
  failureSummary?: string;
};

export type DeliveryAdapter = {
  channel: "IN_APP" | "TEST" | "NOOP";
  deliver(notification: NotificationRecord): Promise<DeliveryAdapterResult> | DeliveryAdapterResult;
};
