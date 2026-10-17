import type { ResearchSignal } from "../research/types.ts";
import type { ResearchIntent } from "./types.ts";

export type ActionabilityRating = "high" | "medium" | "low" | "not_applicable";

const actionableIntents = new Set<ResearchIntent>([
  "JOB_SEARCH",
  "MARKET_OPPORTUNITY",
  "TOOL_DISCOVERY",
  "PURCHASE_DECISION",
  "LEARNING_PATH",
]);

export function assessActionability(input: {
  intent: ResearchIntent;
  signal: Pick<ResearchSignal, "title" | "summary" | "sourceUrl" | "tags" | "relevanceScore" | "freshnessScore" | "verificationStatus">;
  personalContext?: { skills?: string[]; location?: string; seenUrls?: string[]; appliedUrls?: string[] };
}): { rating: ActionabilityRating; reason: string } {
  if (!actionableIntents.has(input.intent)) return { rating: "not_applicable", reason: "该 Intent 不使用 Actionability 排序" };
  const text = `${input.signal.title} ${input.signal.summary} ${input.signal.tags.join(" ")}`.toLowerCase();
  if (input.personalContext?.appliedUrls?.includes(input.signal.sourceUrl)) return { rating: "low", reason: "用户已处理过该条目" };
  if (/closed|expired|no longer accepting|已关闭|停止招聘|过期/.test(text)) return { rating: "low", reason: "结果看起来已经不可行动" };
  const hasEntry = /apply|application|careers|greenhouse|lever|投递|申请|报名|官网/.test(`${text} ${input.signal.sourceUrl.toLowerCase()}`);
  const fresh = input.signal.freshnessScore >= 70;
  const relevant = input.signal.relevanceScore >= 70;
  const reliable = input.signal.verificationStatus !== "unverified";
  if (hasEntry && fresh && relevant && reliable) return { rating: "high", reason: "有入口、较新、相关且来源可验证" };
  if ((hasEntry && relevant) || (fresh && relevant && reliable)) return { rating: "medium", reason: "有一定行动价值，但仍缺少部分条件" };
  return { rating: "low", reason: "缺少明确行动入口或匹配度不足" };
}
