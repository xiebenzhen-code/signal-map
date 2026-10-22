// 候选观察层（第一阶段）：把"是否正式入选"与"是否允许用户查看"分开。
//
// 数据来源是研究管线已记录的 ProviderRejectionSample——候选与筛选理由的现成
// 记录；本模块只做展示分流，不重新判断相关性，不放宽任何正式门槛，也不产生
// 任何持久化写路径（输出仅随本次响应展示）。
//
// 分流：
// - pending（可查看）：相关性不确定（candidate_admission/TOPIC_MISMATCH）等
//   待核对材料；
// - collapsed（默认收起）：同标题重复材料，只保留首条代表并计数；
// - excluded（安全拒绝，不可见）：FEED_* 安全码与 normalization 的无效内容
//   （invalid_url / missing_url / missing_title），不绕过地址与内容保护。

import type { SourceExecutionOutcome } from "../research/source-coverage.ts";

export type ObservationItem = {
  title: string;
  titleTranslated?: string;
  summary?: string;
  url?: string;
  /** 原始发布日期；未知时为 undefined，展示层显示"未知"，不用抓取时间替代。 */
  publishedAt?: string;
  source: string;
  stage: "normalization" | "candidate_admission";
  reason: string;
  reasonZh: string;
  duplicateCount: number;
  status: "pending_review";
};

export type ObservationLayer = {
  items: ObservationItem[];
  collapsedCount: number;
  excludedSafetyCount: number;
};

export const OBSERVATION_MAX_ITEMS = 8;

const SAFE_REASON_PATTERN = /^FEED_/;
const SAFE_NORMALIZATION_REASONS = new Set(["invalid_url", "missing_url", "missing_title"]);
const REASON_ZH: Record<string, string> = {
  TOPIC_MISMATCH: "主题与当前问题不匹配，待人工核对是否误判。",
};

function reasonZh(reason: string) {
  return REASON_ZH[reason] ?? `筛选阶段判定未入选（${reason}），待人工核对。`;
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

function isSafetyExcluded(stage: string, reason: string) {
  return stage === "normalization"
    ? SAFE_NORMALIZATION_REASONS.has(reason)
    : SAFE_REASON_PATTERN.test(reason);
}

export async function buildObservationLayer(
  outcomes: SourceExecutionOutcome[],
  options: { translate?: (text: string) => Promise<string | null> } = {},
): Promise<ObservationLayer> {
  type Group = { representative: ObservationItem; duplicateCount: number };
  const groups = new Map<string, Group>();
  let collapsedCount = 0;
  let excludedSafetyCount = 0;

  for (const outcome of outcomes) {
    const samples = [
      ...(outcome.candidateAdmissionRejectedSamples ?? []),
      ...(outcome.normalizationRejectedSamples ?? []),
    ];
    for (const sample of samples) {
      if (isSafetyExcluded(sample.rejectionStage, sample.rejectionReason)) {
        excludedSafetyCount += 1;
        continue;
      }
      if (sample.rejectionStage === "normalization") {
        // 未知 normalization 拒绝码按安全侧处理：不展示。
        excludedSafetyCount += 1;
        continue;
      }
      const key = normalizeTitle(sample.title);
      const existing = groups.get(key);
      if (existing) {
        existing.duplicateCount += 1;
        continue;
      }
      groups.set(key, {
        duplicateCount: 0,
        representative: {
          title: sample.title,
          url: sample.url,
          publishedAt: sample.publishedAt,
          source: outcome.source,
          stage: sample.rejectionStage,
          reason: sample.rejectionReason,
          reasonZh: reasonZh(sample.rejectionReason),
          duplicateCount: 0,
          status: "pending_review",
        },
      });
    }
  }

  const representatives = [...groups.values()].slice(0, OBSERVATION_MAX_ITEMS);
  collapsedCount = Math.max(0, groups.size - representatives.length);

  const items: ObservationItem[] = [];
  for (const group of representatives) {
    const item = group.representative;
    item.duplicateCount = group.duplicateCount;
    if (options.translate) {
      try {
        const translated = await options.translate(item.title);
        if (translated && translated.trim() && translated.trim() !== item.title) {
          item.titleTranslated = translated.trim();
        }
      } catch {
        // 翻译失败回退原文：titleTranslated 保持缺失，不阻断。
      }
    }
    items.push(item);
  }

  return { items, collapsedCount, excludedSafetyCount };
}
