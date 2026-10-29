import type { ResearchSignal } from "../../research/types.ts";

export function ReadingAttention({event}: {event: Partial<ResearchSignal>}) {
  return <>
    {event.actionabilityStatus === "TEST_NOW" ? <p className="mt-3 text-xs font-bold text-[#2359ff]">可立即试用</p> : null}
    {event.attentionDecision === "WORTH_WATCHING" ? <p className="mt-3 text-xs text-[#68727f]">24 小时内的早期线索</p> : null}
    {event.relatedUpdates?.length ? <details className="mt-4 rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-bold">同一对象的其他新消息 · {event.relatedUpdates.length} 条</summary>
      <ul className="mt-3 grid gap-3 text-sm">
        {event.relatedUpdates.map(item => <li key={item.id}>
          {/^https?:\/\//i.test(item.sourceUrl)
            ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-[#2359ff] hover:underline">{item.presentation?.headline || item.title}</a>
            : <span>{item.presentation?.headline || item.title}</span>}
          <p className="mt-1 text-xs text-[#68727f]">{item.publisher} · <time dateTime={item.publishedAt}>{item.publishedAt}</time></p>
        </li>)}
      </ul>
    </details> : null}
  </>;
}
