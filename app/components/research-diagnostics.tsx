import { explainZeroDisplay, type ZeroDisplayReason } from "../../research/filtering-summary.ts";
import { formatCoverageNotice, type SourceExecutionOutcome } from "../../research/source-coverage.ts";
import type { BackgroundMaterial, FilteringSummary } from "../../research/types.ts";

const zeroDisplayCopy: Record<ZeroDisplayReason, string> = {
  SOURCE_FAILED: "来源读取失败",
  NO_MATERIAL: "本次没有取得材料",
  SOURCE_NOT_SEARCHED: "部分来源未搜索（未配置）",
  ALL_UNCERTAIN: "材料与问题的关系不确定，已放入可能相关",
  ALL_IRRELEVANT: "取得的材料都与问题无关",
  MIXED_FILTERED: "材料被多种原因过滤",
};

export function ResearchDiagnostics({ summary, outcomes, background = [] }: {
  summary?: FilteringSummary;
  background?: BackgroundMaterial[];
  outcomes: SourceExecutionOutcome[];
}) {
  const reason = summary?.displayedCount === 0 ? explainZeroDisplay({
    retrievedCount: summary.retrievedCount,
    displayedCount: summary.displayedCount,
    outcomes,
    allSignals: (summary.filteringDetails ?? []).map(item => ({ topicRelevance: item.topicRelevance })),
  }) : undefined;
  const failureCodes = [...new Set(outcomes
    .filter(item => item.execution === "failed" || item.execution === "unavailable")
    .map(item => item.detailFailureCode || item.failureCode)
    .filter((code): code is string => Boolean(code)))];
  const possibleRelated = summary?.possibleRelated ?? [];
  return (
    <section className="mt-5 rounded-2xl border border-[#e4e7eb] bg-white p-4 text-sm">
      {reason ? <p role="status" className="font-semibold text-[#172033]">
        {zeroDisplayCopy[reason]}{reason === "SOURCE_FAILED" ? `（${failureCodes.join("、") || "未知原因"}）` : ""}
      </p> : null}
      {outcomes.length ? <details className="mt-3">
        <summary className="cursor-pointer text-sm font-bold">本次来源读取情况</summary>
        <ul className="mt-3 grid gap-2 text-xs leading-5 text-[#596473]">
          {outcomes.map((item, index) => <li key={`${item.sourceId ?? item.source}-${index}`}>
            <span className="font-bold">{item.source}：</span>
            {item.coverage?.notice || formatCoverageNotice({ ...item, ...item.coverage, resultCount: item.coverage?.returnedCount ?? item.resultCount })}
          </li>)}
        </ul>
      </details> : null}
      {possibleRelated.length ? <details className="mt-4 rounded-xl border border-[#e4e7eb] p-3">
        <summary className="cursor-pointer font-bold">可能相关 · {possibleRelated.length} 条 <span className="ml-2 text-xs font-normal text-[#727b87]">未确认</span></summary>
        <p className="mt-2 text-xs text-[#727b87]">这些材料与问题的关系尚不确定，供你核对，未作为确认结论。</p>
        <ul className="mt-3 grid gap-3">
          {possibleRelated.map(item => <li key={item.id}>
            {item.url && /^https?:\/\//i.test(item.url)
              ? <a href={item.url} target="_blank" rel="noreferrer" className="text-[#1a4fd6] hover:underline">{item.title}</a>
              : <span>{item.title}</span>}
            <p className="mt-1 text-xs text-[#727b87]">未确认 · 相关性不确定{item.reason ? `（${item.reason}）` : ""}</p>
          </li>)}
        </ul>
      </details> : null}
      {background.length ? <details className="mt-4 rounded-xl border border-[#e4e7eb] p-3">
        <summary className="cursor-pointer font-bold">背景 · {background.length} 条 <span className="ml-2 text-xs font-normal text-[#727b87]">窗口外，仅供参考</span></summary>
        <ul className="mt-3 grid gap-3">
          {background.map(item => <li key={item.url}>
            {/^https?:\/\//i.test(item.url)
              ? <a href={item.url} target="_blank" rel="noreferrer" className="text-[#1a4fd6] hover:underline">{item.title}</a>
              : <span>{item.title}</span>}
            <p className="mt-1 text-xs text-[#727b87]">{item.source} · <time dateTime={item.publishedAt}>{item.publishedAt}</time></p>
          </li>)}
        </ul>
      </details> : null}
    </section>
  );
}
