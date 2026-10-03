import type { InformationRun } from "./types.ts";

export function todayContextNotice(input: {
  loading: boolean;
  error: string;
  filterId: string;
  researchContextRevision: number;
  previousRun: Pick<InformationRun, "filterId" | "generatedFromResearchContextRevision" | "status"> | null;
}): { kind: "never_researched" | "stale" | "failed"; message: string } | null {
  if (input.loading || input.error) return null;
  if (!input.previousRun || input.previousRun.filterId !== input.filterId) {
    return { kind: "never_researched", message: "这个过滤器还没有研究结果，请输入关注的问题并开始研究。" };
  }
  if (input.previousRun.status === "failed") {
    return { kind: "failed", message: "上次研究未完成，未作为本次有效结果。请点击重新过滤。" };
  }
  if (input.previousRun.generatedFromResearchContextRevision !== input.researchContextRevision) {
    return { kind: "stale", message: "你的认知或过滤条件已更新，之前的结果已失效。点击重新过滤，查看基于当前认知的结果。" };
  }
  return null;
}

export function todayResultCopy(displayedCount: number, retrievedCount: number, acceptedCount = 0) {
  if (displayedCount > 0) {
    return {
      headline: `今天只需阅读 ${displayedCount} 条。`,
      supporting: "只保留可能改变你判断、且有证据支持的新变化。",
    };
  }
  if (acceptedCount > 0) {
    return {
      headline: "今天没有需要你优先阅读的新变化。",
      supporting: `检索到 ${retrievedCount} 条，${acceptedCount} 条通过筛选；当前没有需要优先阅读的条目，可在信息页查看。`,
    };
  }
  if (retrievedCount > 0) {
    return {
      headline: "今天没有需要你关注的新变化。",
      supporting: `检索到 ${retrievedCount} 条，但都未通过验证（内容不足 / 可信度不够）。`,
    };
  }
  return {
    headline: "今天没有需要你关注的新变化。",
    supporting: "本次已完成来源检查，暂未找到足够证据支持的新变化。",
  };
}
