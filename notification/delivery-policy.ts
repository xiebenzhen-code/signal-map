import type { GoalStatus, GoalTransition } from "../agent/goal-types.ts";
import type { KnowledgeChange } from "../agent/types.ts";
import type { DeliveryAttention, DeliveryDecision, NotificationRecord } from "./types.ts";

export type DeliveryPolicyInput = {
  finalAttention: DeliveryAttention;
  goalStatus?: GoalStatus;
  goalTransition?: GoalTransition;
  knowledgeChange?: KnowledgeChange;
  notificationHistory?: NotificationRecord[];
  userDeliveryPreference?: "silent" | "digest" | "immediate";
};

function normalizedAttention(attention: DeliveryAttention) {
  if (attention === "LIBRARY_ONLY") return "STORE_ONLY";
  if (attention === "WORTH_WATCHING") return "SURFACE";
  return attention;
}

export function decideDelivery(input: DeliveryPolicyInput): DeliveryDecision {
  const attention = normalizedAttention(input.finalAttention);
  if (input.userDeliveryPreference === "silent") return { action: "SILENT", priority: "none", reason: "User preference is silent." };
  if (attention === "IGNORE" || attention === "STORE_ONLY") return { action: "SILENT", priority: "none", reason: "Final attention does not require delivery." };
  if (input.goalStatus === "waiting" || input.goalStatus === "blocked") return { action: "SILENT", priority: "none", reason: "Goal has not reached a meaningful final delivery state." };
  if (attention === "MUST_READ") return { action: "IMMEDIATE", priority: "high", reason: "Final attention is Must Read." };
  if (attention === "SURFACE") {
    if (input.userDeliveryPreference === "digest") return { action: "DIGEST", priority: "normal", reason: "Surface attention is queued for digest by preference." };
    return { action: "IN_APP", priority: "normal", reason: "Surface attention is delivered in app." };
  }
  return { action: "SILENT", priority: "none", reason: "Final attention is not actionable." };
}
