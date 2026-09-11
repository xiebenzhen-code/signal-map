import type { Goal } from "./goal-types.ts";
import type { AuthenticatedFilterContext } from "../information/repositories/types.ts";
import { stableRecordId } from "../information/rag-records.ts";

export type FollowIntensity = "major_only" | "worth_knowing" | "more";
export type FollowDelivery = "important" | "daily" | "weekly";

export type FollowInput = {
  topic: string;
  intensity?: FollowIntensity;
  delivery?: FollowDelivery;
};

export type FollowView = {
  id: string;
  topic: string;
  intensity: FollowIntensity;
  intensityLabel: string;
  delivery: FollowDelivery;
  deliveryLabel: string;
  status: Goal["status"];
  nextCheckAt?: string;
  reason: string;
};

const intensityLabels: Record<FollowIntensity, string> = {
  major_only: "只看重大变化",
  worth_knowing: "值得知道时告诉我",
  more: "尽量多关注",
};

const deliveryLabels: Record<FollowDelivery, string> = {
  important: "重要提醒",
  daily: "每日摘要",
  weekly: "每周摘要",
};

export function followIntensityLabel(value: FollowIntensity) {
  return intensityLabels[value];
}

export function followDeliveryLabel(value: FollowDelivery) {
  return deliveryLabels[value];
}

export function normalizeFollowInput(input: FollowInput) {
  const topic = input.topic.trim().replace(/\s+/g, " ");
  if (!topic) throw Object.assign(new Error("关注主题不能为空"), { code: "EMPTY_FOLLOW_TOPIC" });
  return {
    topic,
    intensity: input.intensity ?? "worth_knowing",
    delivery: input.delivery ?? "daily",
  };
}

export function nextCheckAtForFollow(delivery: FollowDelivery, now: string) {
  const date = new Date(now);
  if (delivery === "important") date.setHours(date.getHours() + 6);
  else if (delivery === "weekly") date.setDate(date.getDate() + 7);
  else date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function followGoalId(context: AuthenticatedFilterContext, topic: string) {
  return `follow-${stableRecordId([context.authenticatedUserId, context.filterId, topic])}`;
}

export function createFollowGoal(context: AuthenticatedFilterContext, input: FollowInput, now = new Date().toISOString()): Goal {
  const normalized = normalizeFollowInput(input);
  const nextCheckAt = nextCheckAtForFollow(normalized.delivery, now);
  const criteria = [
    `发现会明显改变已有判断或行动的信息：${normalized.topic}`,
    `发现与当前目标高度相关的新机会：${normalized.topic}`,
    `发现高价值且此前没有主动关注的新变化：${normalized.topic}`,
    `发现重要风险、价格、政策或产品能力变化：${normalized.topic}`,
  ];
  return {
    id: followGoalId(context, normalized.topic),
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    objective: `持续关注：${normalized.topic}`,
    status: "waiting",
    successCriteria: criteria,
    openQuestions: [`${normalized.topic} 是否出现足以改变认知或行动的新证据？`],
    taskIds: [],
    completedTaskIds: [],
    taskMetadata: [],
    completedCriteria: [],
    remainingCriteria: criteria,
    currentSummary: `${followIntensityLabel(normalized.intensity)}；${followDeliveryLabel(normalized.delivery)}。没有改变判断或行动的信息只存档，不打扰。`,
    createdAt: now,
    updatedAt: now,
    lastTransition: {
      goalId: followGoalId(context, normalized.topic),
      previousStatus: "active",
      newStatus: "waiting",
      completedCriteria: [],
      remainingCriteria: criteria,
      selectedNextTasks: [],
      blockingReason: "等待外部世界出现足以改变认知或行动的新证据。",
      relatedAgentRunIds: [],
      timestamp: now,
    },
    watch: {
      resumeCondition: {
        type: "POLL",
        reason: `持续关注 ${normalized.topic}，只在新证据可能改变判断或行动时恢复研究。`,
        target: normalized.topic,
        nextCheckAt,
      },
      nextCheckAt,
      consecutiveNoChangeCount: 0,
      watchStatus: "waiting",
      lastCheckOutcome: "not_checked",
      followTopic: normalized.topic,
      followIntensity: normalized.intensity,
      deliveryPreference: normalized.delivery,
    },
  };
}

export function isFollowGoal(goal: Goal) {
  return Boolean(goal.watch?.followTopic);
}

export function toFollowView(goal: Goal): FollowView {
  const intensity = goal.watch?.followIntensity ?? "worth_knowing";
  const delivery = goal.watch?.deliveryPreference ?? "daily";
  return {
    id: goal.id,
    topic: goal.watch?.followTopic ?? goal.objective.replace(/^持续关注：/, ""),
    intensity,
    intensityLabel: followIntensityLabel(intensity),
    delivery,
    deliveryLabel: followDeliveryLabel(delivery),
    status: goal.status,
    nextCheckAt: goal.watch?.nextCheckAt ?? goal.watch?.resumeCondition.nextCheckAt,
    reason: goal.watch?.resumeCondition.reason ?? "等待足以改变判断或行动的新证据。",
  };
}
