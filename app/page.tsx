"use client";

import {
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  LibraryBig,
  RefreshCw,
  Settings,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ResearchSignal,
  VerificationStatus,
} from "@/research/types";
import { createEmptyKnowledge, sourceCoverageExplanation } from "@/information/filter-engine";
import { demoProvider } from "@/information/providers/demo-provider";
import type {
  FeedbackRecord,
  ExperienceFeedback,
  InformationFilter,
  InformationRun,
  KnowledgeState,
  ProviderCoverage,
  SourceScope,
} from "@/information/types";
import {
  clearAlphaData,
  loadAlphaSnapshot,
  setAlphaValue,
  type LibraryEntry,
} from "@/lib/alpha-storage";

type Page = "today" | "information" | "library" | "settings";
type LibraryView = "following" | "saved" | "questions" | "knowledge";
type Feedback =
  | "changed_view"
  | "added_context"
  | "already_knew"
  | "not_useful"
  | "monitor"
  | "resolved";

type Connection = {
  id: "x" | "xiaohongshu";
  label: string;
  state:
    | "connected"
    | "login_required"
    | "not_configured"
    | "unavailable"
    | "error";
  adapter: "official-api" | "official-oauth" | "local-browser";
  detail: string;
  service?: { state: Connection["state"]; detail: string };
  account?: { state: Connection["state"]; detail: string };
};

const defaultKnowledge: KnowledgeState = {
  identity: "AI 产品经理与独立创作者",
  industry: "人工智能与创作者工具",
  focusAreas: ["Codex", "AI Agent", "大模型更新"],
  currentQuestions: ["哪些能力变化会真实影响普通创作者的工作方式？"],
  knownInformation: ["Codex 可以协助完成多步骤编程任务"],
  informationGaps: ["近期官方能力变化", "对普通创作者的实际影响"],
  trackedEntities: ["OpenAI", "Anthropic", "Google"],
  trackedEvents: [],
  userJudgements: [],
  evidenceHistory: [],
  freshnessWindow: "7d",
};

const navItems: Array<{ id: Page; label: string; icon: typeof Target }> = [
  { id: "today", label: "Today", icon: Target },
  { id: "information", label: "Information", icon: FileSearch },
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "settings", label: "Settings", icon: Settings },
];

const feedbackLabels: Record<Feedback, string> = {
  changed_view: "Changed my view",
  added_context: "Added context",
  already_knew: "Already knew it",
  not_useful: "Not useful",
  monitor: "Continue monitoring",
  resolved: "Resolved my question",
};

const verificationLabels: Record<VerificationStatus, string> = {
  verified: "已验证",
  partially_verified: "部分验证",
  unverified: "未验证",
  conflicting: "证据冲突",
};

const statusTone: Record<VerificationStatus, string> = {
  verified: "text-emerald-700 bg-emerald-50",
  partially_verified: "text-violet-700 bg-violet-50",
  unverified: "text-amber-700 bg-amber-50",
  conflicting: "text-rose-700 bg-rose-50",
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function textToList(value: string) {
  return unique(value.split(/[\n,，；;]/));
}

function reliabilityLabel(score: number) {
  if (score >= 85) return "High reliability";
  if (score >= 70) return "Medium reliability";
  return "Low reliability";
}

function EventCard({
  event,
  onOpen,
  compact = false,
}: {
  event: ResearchSignal;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <article className="rounded-[24px] border border-[#e6e8e5] bg-white p-5 shadow-[0_8px_30px_rgba(28,36,50,.035)] sm:p-6">
      <div className="flex items-center justify-between gap-3 text-xs font-black">
        <span className="text-[#2359ff]">{event.eventStatus}</span>
        <span className="shrink-0 text-[#7d8691]">{event.time}</span>
      </div>

      <h3 className="mt-4 text-[19px] font-black leading-7 tracking-[-.035em] text-[#142035] sm:text-[22px] sm:leading-8">
        {event.title}
      </h3>
      <div className="mt-4 rounded-2xl bg-[#f6f7f4] p-4">
        <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#8a929d]">
          Why it matters
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">
          {event.whyItMatters}
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-[#eceeea] pt-4 text-xs text-[#68727f]">
        <span className="font-black text-[#172033]">{reliabilityLabel(event.reliabilityScore)}</span>
        <span>{event.sourceCount} {event.sourceCount === 1 ? "source" : "sources"}</span>
      </div>

      {!compact && (
        <button
          onClick={onOpen}
          className="mt-4 flex min-h-12 w-full items-center justify-between rounded-xl bg-[#172033] px-4 text-sm font-black text-white"
        >
          查看证据与判断依据
          <ChevronRight size={15} />
        </button>
      )}
      {compact && (
        <button
          onClick={onOpen}
          className="mt-3 min-h-11 text-sm font-black text-[#2359ff]"
        >
          查看事件证据 →
        </button>
      )}
    </article>
  );
}

function EmptyToday({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="mt-14 rounded-[30px] border border-[#e6e8e5] bg-white px-6 py-14 text-center sm:px-10">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Check size={22} />
      </div>
      <h2 className="mt-5 text-2xl font-black tracking-[-.04em] text-[#172033]">
        You&apos;re caught up.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#77808b]">
        今天没有值得占用你注意力的重要变化。
      </p>
      <button
        onClick={onRefresh}
        className="mt-6 inline-flex items-center gap-2 text-xs font-black text-[#2359ff]"
      >
        <RefreshCw size={14} />
        重新核对来源
      </button>
    </section>
  );
}

function FeedbackButtons({ onFeedback }: { onFeedback: (value: Feedback) => void }) {
  const visibleFeedback: Feedback[] = [
    "already_knew",
    "changed_view",
    "not_useful",
    "monitor",
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {visibleFeedback.map((value) => (
        <button
          key={value}
          onClick={() => onFeedback(value)}
          className="min-h-11 rounded-xl border border-[#dfe3e7] px-3 text-xs font-bold text-[#616b79] transition hover:border-[#9bb0ff] hover:text-[#2359ff]"
        >
          {feedbackLabels[value]}
        </button>
      ))}
    </div>
  );
}

function EventDetail({
  event,
  saved,
  initialNote,
  onClose,
  onSave,
  onFeedback,
}: {
  event: ResearchSignal;
  saved: boolean;
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => void;
  onFeedback: (value: Feedback) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const reliableClaims = event.claims.filter((claim) =>
    ["verified", "partially_verified"].includes(claim.verificationStatus),
  );
  const factClaims = reliableClaims.filter((claim) => claim.contentType === "FACT");
  const respond = (value: Feedback) => {
    if (note.trim()) onSave(note);
    onFeedback(value);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d1728]/35 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={onClose}
    >
      <section
        onMouseDown={(eventObject) => eventObject.stopPropagation()}
        className="h-full w-full overflow-y-auto bg-white px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 text-[#172033] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-[620px] sm:rounded-[28px] sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-black">
            <span className={`rounded-full px-2.5 py-1 ${statusTone[event.verificationStatus]}`}>
              {verificationLabels[event.verificationStatus]}
            </span>
            <span>{event.eventStatus}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="grid h-11 w-11 place-items-center rounded-full bg-[#f1f2ef] text-[#737c88]"
          >
            <X size={16} />
          </button>
        </div>

        <h2 className="mt-5 text-2xl font-black leading-9 tracking-[-.04em]">
          {event.title}
        </h2>
        <section className="mt-6">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Why it matters</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">
            {event.whyItMatters}
          </p>
        </section>

        <section className="mt-6">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Fact</p>
          {factClaims.length === 0 && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              No reliable evidence found.
            </div>
          )}
          <div className="mt-3 grid gap-2">
            {factClaims.map((claim) => <p key={`${claim.sourceUrl}-${claim.claimText}`} className="rounded-2xl bg-[#f5f7f4] p-4 text-sm font-bold leading-6">{claim.claimText}</p>)}
          </div>
        </section>

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Evidence</p>
          <div className="mt-3 grid gap-3">
            {event.claims.map((claim) => <article key={`${claim.sourceUrl}-${claim.claimText}`} className="border-l-2 border-[#d9e0ff] pl-4"><p className={`text-xs font-black ${claim.contentType === "FACT" ? "text-emerald-700" : "text-amber-700"}`}>{claim.contentType} · {claim.publisher}</p><p className="mt-2 text-sm leading-6 text-[#5d6775]">{claim.evidenceSnippet}</p></article>)}
          </div>
        </section>

        <section className="mt-7 rounded-2xl bg-[#f6f7f4] p-4">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Interpretation</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">{event.why}</p>
        </section>

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Sources · {event.sourceCount}</p>
          <div className="mt-3 grid gap-2">
            {event.sources.map((source) => <a key={`${source.publisher}-${source.sourceUrl}`} href={source.sourceUrl} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between rounded-xl border border-[#e2e5e8] px-4 text-sm font-bold text-[#2359ff]"><span>{source.publisher}</span><span>原文 ↗</span></a>)}
          </div>
        </section>

        <label className="mt-7 block">
          <span className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">My Note</span>
          <textarea value={note} onChange={(eventObject) => setNote(eventObject.target.value)} placeholder="这条证据如何影响你的判断？" className="mt-3 min-h-28 w-full resize-none rounded-2xl border border-[#dfe3e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#8facff]" />
        </label>

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">Actions</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => onSave(note)} className={`min-h-12 rounded-xl text-sm font-black ${saved ? "bg-emerald-50 text-emerald-700" : "bg-[#172033] text-white"}`}>{saved ? "Saved" : "Save"}</button>
            <button onClick={() => respond("monitor")} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">Follow</button>
            <button onClick={() => respond("already_knew")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">Already knew this</button>
            <button onClick={() => respond("changed_view")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">Changed my view</button>
            <button onClick={() => respond("not_useful")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">Not useful</button>
            <button onClick={() => respond("monitor")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">Continue monitoring</button>
          </div>
        </section>

        <details className="mt-7 rounded-2xl border border-[#e2e5e8] p-4">
          <summary className="min-h-11 cursor-pointer text-sm font-black">Score Breakdown</summary>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {[[event.relevanceScore, "Relevance"], [event.reliabilityScore, "Reliability"], [event.freshnessScore, "Freshness"], [event.noveltyScore, "Novelty"], [event.judgementImpactScore, "Judgement impact"], [event.gapMatchScore, "Gap match"]].map(([value, label]) => <div key={String(label)} className="rounded-xl bg-[#f4f6f8] p-3"><strong>{value}</strong><span className="ml-2 text-xs text-[#7b8490]">{label}</span></div>)}
          </div>
        </details>
      </section>
    </div>
  );
}

function FocusReading({
  events,
  library,
  onClose,
  onSaveNote,
  onFeedback,
}: {
  events: ResearchSignal[];
  library: LibraryEntry[];
  onClose: () => void;
  onSaveNote: (event: ResearchSignal, note: string) => void;
  onFeedback: (event: ResearchSignal, value: Feedback) => void;
}) {
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(15 * 60);
  const [caughtUp, setCaughtUp] = useState(false);
  const event = events[index];
  const [note, setNote] = useState(
    () => library.find((entry) => entry.event.id === events[0]?.id)?.notes || "",
  );

  useEffect(() => {
    if (caughtUp) return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          setCaughtUp(true);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [caughtUp]);

  if (caughtUp || !event) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[#172033] p-5 text-center text-white">
        <section className="max-w-md">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/10">
            <Check size={26} />
          </div>
          <h2 className="mt-6 text-3xl font-black tracking-[-.05em]">You’re caught up.</h2>
          <p className="mt-3 text-sm leading-6 text-white/65">
            今天真正值得注意的信息已经处理完。现在可以离开产品，继续你的工作。
          </p>
          <button onClick={onClose} className="mt-7 rounded-full bg-white px-6 py-3 text-xs font-black text-[#172033]">
            结束阅读
          </button>
        </section>
      </div>
    );
  }

  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainingSeconds = String(seconds % 60).padStart(2, "0");
  const finishEvent = (feedback?: Feedback) => {
    onSaveNote(event, note);
    if (feedback) onFeedback(event, feedback);
    if (index >= events.length - 1) setCaughtUp(true);
    else {
      const nextEvent = events[index + 1];
      setIndex((value) => value + 1);
      setNote(
        library.find((entry) => entry.event.id === nextEvent.id)?.notes || "",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#fbfbf8] text-[#172033]">
      <header className="sticky top-0 z-10 border-b border-[#e5e7e4] bg-[#fbfbf8]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#7e8791]">Focus Reading</p>
            <p className="mt-0.5 text-xs font-bold">Today Must Read · {index + 1} / {events.length}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-black">{minutes}:{remainingSeconds}</span>
            <button onClick={onClose} aria-label="关闭专注阅读" className="grid h-9 w-9 place-items-center rounded-full bg-[#eceeea]">
              <X size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8 pb-20 sm:px-6">
        <div className="flex items-center gap-2 text-[10px] font-black">
          <span className={`rounded-full px-2.5 py-1 ${statusTone[event.verificationStatus]}`}>
            {verificationLabels[event.verificationStatus]}
          </span>
          <span>{event.eventStatus}</span>
        </div>
        <h1 className="mt-5 text-3xl font-black leading-[1.2] tracking-[-.05em]">{event.title}</h1>
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(28,36,50,.035)]">
          <p className="text-[9px] font-black tracking-[.14em] text-[#8a929d]">WHY IT MATTERS · INTERPRETATION</p>
          <p className="mt-2 text-sm font-semibold leading-7 text-[#4f5968]">{event.whyItMatters}</p>
        </section>
        <section className="mt-5">
          <p className="text-[10px] font-black uppercase tracking-[.15em] text-[#7b8490]">Evidence</p>
          <div className="mt-3 grid gap-3">
            {event.claims.map((claim) => (
              <article key={claim.sourceUrl} className="rounded-2xl border border-[#e4e6e2] bg-white p-4">
                <p className={`text-[9px] font-black ${claim.contentType === "FACT" ? "text-emerald-700" : "text-amber-700"}`}>
                  {claim.contentType} · Tier {claim.sourceTier}
                </p>
                <p className="mt-2 text-sm font-bold leading-6">{claim.claimText}</p>
                <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-black text-[#2359ff]">
                  Original source ↗
                </a>
              </article>
            ))}
          </div>
        </section>
        <label className="mt-6 block">
          <span className="text-[10px] font-black uppercase tracking-[.14em] text-[#7b8490]">My Notes</span>
          <textarea
            value={note}
            onChange={(eventObject) => setNote(eventObject.target.value)}
            placeholder="记录这条证据如何影响你的判断…"
            className="mt-3 min-h-28 w-full resize-none rounded-2xl border border-[#dfe2e5] bg-white p-4 text-sm leading-6 outline-none focus:border-[#8facff]"
          />
        </label>
        <div className="mt-6">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[.14em] text-[#7b8490]">Did this change your view?</p>
          <FeedbackButtons onFeedback={(value) => finishEvent(value)} />
        </div>
        <button onClick={() => finishEvent()} className="mt-4 w-full rounded-xl bg-[#172033] py-3 text-xs font-black text-white">
          {index >= events.length - 1 ? "完成今日阅读" : "保存笔记并查看下一条"}
        </button>
      </main>
    </div>
  );
}

type FilterDraft = Omit<InformationFilter, "id" | "createdAt" | "updatedAt">;
type OnboardingDraft = FilterDraft & {
  trackedEntities: string[];
  currentJudgement: string;
};

const emptyFilterDraft: OnboardingDraft = {
  filterName: "",
  identity: "",
  industry: "",
  focusAreas: [],
  knownInformation: [],
  informationGaps: [],
  currentQuestions: [],
  freshnessWindow: "7d",
  sourceScope: "all",
  trackedEntities: [],
  currentJudgement: "",
};

function FilterBuilder({
  onSave,
  onCancel,
}: {
  onSave: (draft: OnboardingDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<OnboardingDraft>(emptyFilterDraft);
  const [step, setStep] = useState(0);
  const listInput = (
    field: "focusAreas" | "knownInformation" | "informationGaps" | "currentQuestions" | "trackedEntities",
    label: string,
    placeholder: string,
  ) => (
    <label className="block">
      <span className="text-xs font-black text-[#172033]">{label}</span>
      <textarea
        value={draft[field].join("\n")}
        onChange={(event) => setDraft((current) => ({ ...current, [field]: textToList(event.target.value) }))}
        placeholder={placeholder}
        className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#dde2e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#7e9cff]"
      />
    </label>
  );

  return (
    <main className="min-h-screen bg-[#fbfbf8] px-4 pb-10 pt-7 text-[#172033] sm:px-6">
      <section className="mx-auto max-w-[620px]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#2359ff] text-[11px] font-black text-white">SM</span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#2359ff]">Filter first</p>
              <p className="text-sm font-black">Signal Map</p>
            </div>
          </div>
          {onCancel && <button onClick={onCancel} className="text-xs font-bold text-[#727b87]">取消</button>}
        </div>

        <div className="mt-9 flex items-center justify-between">
          <p className="text-[11px] font-black uppercase tracking-[.14em] text-[#2359ff]">Step {step + 1} of 4</p>
          <p className="text-xs font-bold text-[#858e99]">{["Identity", "Focus", "Knowledge", "Gaps"][step]}</p>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2" aria-label={`Onboarding progress ${step + 1} of 4`}>
          {[0, 1, 2, 3].map((index) => <span key={index} className={`h-1.5 rounded-full ${index <= step ? "bg-[#2359ff]" : "bg-[#e3e6e8]"}`} />)}
        </div>

        <h1 className="mt-8 text-[36px] font-black leading-[1.06] tracking-[-.055em] sm:text-5xl">
          {["先从你是谁开始。", "你正在关注什么？", "你已经知道什么？", "最后，告诉我缺什么。"][step]}
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#707986]">
          {step === 0 ? "Signal Map 只把可能改变你判断的新证据带到面前。所有字段都可以跳过。" : "可以留空，之后随时在 Settings 里补充。"}
        </p>

        {step === 0 && (
          <button
            onClick={() => setDraft({
              filterName: "AI 产品与创作",
              identity: "AI 产品经理与独立创作者",
              industry: "人工智能与创作者工具",
              focusAreas: ["Codex", "AI Agent", "大模型更新", "创作者"],
              trackedEntities: ["OpenAI", "Anthropic", "Google"],
              knownInformation: ["Codex 可以协助完成多步骤编程任务"],
              currentJudgement: "AI Agent 的真实价值取决于任务完成与证据可审查性",
              informationGaps: ["Agent 真实任务评测", "AI 生成内容标识", "近期官方能力变化"],
              currentQuestions: ["哪些能力变化会真实影响普通创作者的工作方式？"],
              freshnessWindow: "7d",
              sourceScope: "all",
            })}
            className="mt-6 min-h-11 rounded-full border border-[#cfd8ff] bg-[#f3f6ff] px-4 py-2.5 text-xs font-black text-[#2359ff]"
          >
            使用示例快速体验
          </button>
        )}

        <div className="mt-7 grid gap-5 rounded-[28px] border border-[#e2e5e8] bg-[#f5f6f3] p-5 sm:p-7">
          {step === 0 && <>
            <label><span className="text-sm font-black">Filter Name</span><input value={draft.filterName} onChange={(event) => setDraft((current) => ({ ...current, filterName: event.target.value }))} placeholder="例如：我的 AI 产品雷达" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none focus:border-[#7e9cff]" /></label>
            <label><span className="text-sm font-black">Identity</span><input value={draft.identity} onChange={(event) => setDraft((current) => ({ ...current, identity: event.target.value }))} placeholder="你是谁 / 正在做什么" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none focus:border-[#7e9cff]" /></label>
            <label><span className="text-sm font-black">Industry</span><input value={draft.industry} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))} placeholder="所在行业或赛道" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none focus:border-[#7e9cff]" /></label>
          </>}
          {step === 1 && <>
            {listInput("focusAreas", "Focus Areas", "每行一项，例如：AI Agent")}
            {listInput("trackedEntities", "Tracked Entities", "公司、产品、人物；每行一项")}
            {listInput("currentQuestions", "Current Questions", "当前尚未解决的问题；每行一项")}
          </>}
          {step === 2 && <>
            {listInput("knownInformation", "Known Information", "你已经确认的信息；每行一项")}
            <label><span className="text-sm font-black">Current Judgement</span><textarea value={draft.currentJudgement} onChange={(event) => setDraft((current) => ({ ...current, currentJudgement: event.target.value }))} placeholder="你现在如何判断这个领域？" className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#dde2e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#7e9cff]" /></label>
          </>}
          {step === 3 && <>
            {listInput("informationGaps", "Information Gaps", "还缺少哪些证据；每行一项")}
            <label><span className="text-sm font-black">Freshness Window</span><select value={draft.freshnessWindow} onChange={(event) => setDraft((current) => ({ ...current, freshnessWindow: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="1d">24 小时</option><option value="3d">3 天</option><option value="7d">7 天</option><option value="30d">30 天</option></select></label>
            <label><span className="text-sm font-black">Source Scope</span><select value={draft.sourceScope} onChange={(event) => setDraft((current) => ({ ...current, sourceScope: event.target.value as SourceScope }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="all">全部层级</option><option value="verified">已验证来源</option><option value="official">仅官方</option></select></label>
          </>}

          <div className="flex gap-3 pt-1">
            {step > 0 && <button onClick={() => setStep((value) => value - 1)} className="min-h-12 flex-1 rounded-xl border border-[#d8dde3] bg-white text-sm font-black text-[#657080]">返回</button>}
            <button
              onClick={() => step < 3 ? setStep((value) => value + 1) : onSave({ ...draft, filterName: draft.filterName.trim() || "My Filter" })}
              className="min-h-12 flex-[2] rounded-xl bg-[#2359ff] px-4 text-sm font-black text-white"
            >
              {step < 3 ? "继续" : "创建过滤器并查看 Today"}
            </button>
          </div>
          <p className="text-center text-[11px] leading-5 text-[#8a929d]">数据只保存在这台设备的浏览器中，不需要账号或 API。</p>
        </div>
      </section>
    </main>
  );
}

function CoverageBadge({ coverage }: { coverage: ProviderCoverage }) {
  return (
    <details className="mt-5 rounded-2xl border border-[#e3e6e8] bg-white px-4 py-3 text-xs text-[#68727f]">
      <summary className="cursor-pointer list-none font-black">
        Source Coverage · <span className="text-[#2359ff]">{coverage.level}</span>
      </summary>
      <div className="mt-3 grid gap-2 border-t border-[#eceeea] pt-3 text-[10px] leading-5">
        {coverage.usedProviders.length > 0 && <p><strong>Used:</strong> {coverage.usedProviders.join(" · ")}</p>}
        {coverage.unavailableProviders.length > 0 && <p><strong>Unavailable:</strong> {coverage.unavailableProviders.join(" · ")}</p>}
        {coverage.notConfiguredProviders.length > 0 && <p><strong>Not configured:</strong> {coverage.notConfiguredProviders.join(" · ")}</p>}
        {coverage.failedProviders.length > 0 && <p><strong>Failed:</strong> {coverage.failedProviders.join(" · ")}</p>}
        <p className="text-[#8b929b]">{sourceCoverageExplanation}</p>
      </div>
    </details>
  );
}

export default function HomePage() {
  const [page, setPage] = useState<Page>("today");
  const [knowledge, setKnowledge] = useState<KnowledgeState>(defaultKnowledge);
  const [response, setResponse] = useState<InformationRun | null>(null);
  const [filters, setFilters] = useState<InformationFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libraryView, setLibraryView] = useState<LibraryView>("saved");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedbackRecords, setFeedbackRecords] = useState<FeedbackRecord[]>([]);
  const [experienceFeedback, setExperienceFeedback] = useState<ExperienceFeedback[]>([]);
  const [feedbackDraft, setFeedbackDraft] = useState({
    worthwhileCount: 3 as 0 | 1 | 2 | 3 | 4 | 5,
    alreadyKnown: "no" as "yes" | "no",
    trustScore: 4 as 1 | 2 | 3 | 4 | 5,
    missedInformation: "",
    continueUsing: "maybe" as "yes" | "maybe" | "no",
    biggestProblem: "",
  });
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<ResearchSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [sort, setSort] = useState<
    "relevance" | "reliability" | "newest" | "novelty" | "impact"
  >("relevance");
  const [visibleCount, setVisibleCount] = useState(8);
  const [newQuestion, setNewQuestion] = useState("");
  const [newEntity, setNewEntity] = useState("");
  const [newJudgement, setNewJudgement] = useState("");
  const activeFilter = useMemo(
    () => filters.find((filter) => filter.id === activeFilterId) || null,
    [activeFilterId, filters],
  );
  const navigate = (nextPage: Page) => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setPage(nextPage);
  };

  const refreshToday = useCallback(async (state: KnowledgeState, filter: InformationFilter) => {
    setLoading(true);
    setError("");
    try {
      const result = await demoProvider.run({ filter, knowledge: state });
      setResponse(result);
      await setAlphaValue("lastRun", result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法完成信息过滤");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAlphaSnapshot()
      .then(async (snapshot) => {
        if (cancelled) return;
        setFilters(snapshot.filters);
        setActiveFilterId(snapshot.activeFilterId);
        const restoredFilter = snapshot.filters.find((filter) => filter.id === snapshot.activeFilterId);
        const restoredKnowledge = snapshot.knowledge || (restoredFilter ? createEmptyKnowledge(restoredFilter) : null);
        if (restoredKnowledge) setKnowledge(restoredKnowledge);
        setLibrary(snapshot.library);
        setNotes(snapshot.notes);
        setFeedbackRecords(snapshot.feedback);
        setExperienceFeedback(snapshot.experienceFeedback);
        const restoredSessionId = snapshot.sessionId || crypto.randomUUID();
        setSessionId(restoredSessionId);
        if (!snapshot.sessionId) await setAlphaValue("sessionId", restoredSessionId);
        if (snapshot.lastRun) {
          setResponse(snapshot.lastRun);
        } else if (restoredFilter && restoredKnowledge) {
          const result = await demoProvider.run({ filter: restoredFilter, knowledge: restoredKnowledge });
          if (!cancelled) {
            setResponse(result);
            await setAlphaValue("lastRun", result);
          }
        }
      })
      .catch(() => setError("本地数据暂时无法读取，请检查浏览器是否允许 IndexedDB。"))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    const timer = window.setTimeout(() => {
      setTestMode(new URLSearchParams(window.location.search).get("test") === "true");
      fetch("/api/connections", { cache: "no-store" })
        .then(async (request) => (await request.json()) as { connections?: Connection[] })
        .then((value) => setConnections(value.connections || []))
        .catch(() => setConnections([]));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("knowledge", knowledge);
  }, [hydrated, knowledge]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("library", library);
  }, [hydrated, library]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("filters", filters);
    void setAlphaValue("activeFilterId", activeFilterId);
  }, [activeFilterId, filters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("notes", notes);
  }, [hydrated, notes]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("feedback", feedbackRecords);
  }, [feedbackRecords, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("experienceFeedback", experienceFeedback);
  }, [experienceFeedback, hydrated]);

  const signals = useMemo(() => response?.signals || [], [response]);
  const mustRead = useMemo(
    () => signals.filter((event) => event.attentionDecision === "MUST_READ").slice(0, 5),
    [signals],
  );
  const sortedInformation = useMemo(() => {
    const next = [...signals];
    return next.sort((left, right) => {
      if (sort === "reliability") return right.reliabilityScore - left.reliabilityScore;
      if (sort === "newest") return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
      if (sort === "novelty") return right.noveltyScore - left.noveltyScore;
      if (sort === "impact") return right.judgementImpactScore - left.judgementImpactScore;
      return right.relevanceScore - left.relevanceScore;
    });
  }, [signals, sort]);

  const saveEvent = useCallback((event: ResearchSignal, note = "") => {
    if (note) setNotes((current) => ({ ...current, [event.id]: note }));
    setLibrary((current) => {
      const existing = current.find((entry) => entry.event.id === event.id);
      if (existing) {
        return current.map((entry) =>
          entry.event.id === event.id
            ? { ...entry, event, notes: note || entry.notes }
            : entry,
        );
      }
      return [...current, { event, notes: note, judgement: "", savedAt: new Date().toISOString() }];
    });
  }, []);

  const applyFeedback = useCallback(
    (event: ResearchSignal, feedback: Feedback) => {
      setKnowledge((current) => {
        const sourceTitle = event.originalTitle || event.title;
        const next = { ...current };
        if (feedback === "already_knew") {
          next.knownInformation = unique([...current.knownInformation, sourceTitle]);
        }
        if (feedback === "changed_view") {
          next.userJudgements = unique([
            ...current.userJudgements,
            `Changed after evidence: ${sourceTitle}`,
          ]);
          next.evidenceHistory = unique([...current.evidenceHistory, sourceTitle]);
        }
        if (feedback === "added_context") {
          next.evidenceHistory = unique([...current.evidenceHistory, sourceTitle]);
        }
        if (feedback === "not_useful") {
          next.userJudgements = unique([...current.userJudgements, `Not useful: ${sourceTitle}`]);
        }
        if (feedback === "monitor") {
          next.trackedEvents = unique([...current.trackedEvents, sourceTitle]);
        }
        if (feedback === "resolved") {
          const resolved = event.questionMatches[0] || event.gapMatches[0];
          if (resolved) {
            next.currentQuestions = current.currentQuestions.filter(
              (question) => !question.toLowerCase().includes(resolved.toLowerCase()),
            );
            next.informationGaps = current.informationGaps.filter(
              (gap) => !gap.toLowerCase().includes(resolved.toLowerCase()),
            );
          }
          next.evidenceHistory = unique([...current.evidenceHistory, `Resolved: ${sourceTitle}`]);
        }
        return next;
      });
      if (["changed_view", "added_context", "monitor", "resolved"].includes(feedback)) {
        saveEvent(event);
      }
      if (["changed_view", "already_knew", "not_useful", "monitor"].includes(feedback)) {
        setFeedbackRecords((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            eventId: event.id,
            value: feedback as FeedbackRecord["value"],
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setSelected(null);
    },
    [saveEvent],
  );

  const createFilter = useCallback(
    (draft: OnboardingDraft) => {
      const now = new Date().toISOString();
      const { trackedEntities, currentJudgement, ...filterDraft } = draft;
      const filter: InformationFilter = {
        ...filterDraft,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const nextKnowledge: KnowledgeState = {
        ...createEmptyKnowledge(filter),
        trackedEntities,
        userJudgements: currentJudgement.trim() ? [currentJudgement.trim()] : [],
      };
      setFilters((current) => [...current, filter]);
      setActiveFilterId(filter.id);
      setKnowledge(nextKnowledge);
      setResponse(null);
      setFilterBuilderOpen(false);
      setPage("today");
      void refreshToday(nextKnowledge, filter);
    },
    [refreshToday],
  );

  const switchFilter = useCallback(
    (filter: InformationFilter) => {
      const nextKnowledge: KnowledgeState = {
        ...knowledge,
        identity: filter.identity,
        industry: filter.industry,
        focusAreas: filter.focusAreas,
        knownInformation: filter.knownInformation,
        informationGaps: filter.informationGaps,
        currentQuestions: filter.currentQuestions,
        freshnessWindow: filter.freshnessWindow,
      };
      setActiveFilterId(filter.id);
      setKnowledge(nextKnowledge);
      setResponse(null);
      setPage("today");
      void refreshToday(nextKnowledge, filter);
    },
    [knowledge, refreshToday],
  );

  const submitExperienceFeedback = useCallback(() => {
    setExperienceFeedback((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sessionId,
        ...feedbackDraft,
        createdAt: new Date().toISOString(),
      },
    ]);
    setFeedbackSaved(true);
  }, [feedbackDraft, sessionId]);

  const feedbackExportHref = useMemo(
    () => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ sessionId, feedback: experienceFeedback }, null, 2))}`,
    [experienceFeedback, sessionId],
  );

  const todayDate = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  const renderToday = () => (
    <main className="mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
      <button onClick={() => navigate("settings")} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#e1e5e8] bg-white px-4 text-left">
        <span>
          <span className="block text-[10px] font-black uppercase tracking-[.12em] text-[#7b8490]">Active Filter</span>
          <span className="mt-1 block text-sm font-black text-[#172033]">{activeFilter?.filterName}</span>
        </span>
        <ChevronRight size={18} className="text-[#8a929d]" />
      </button>

      <div className="mt-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[.16em] text-[#2359ff]">{todayDate}</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.055em] text-[#172033] sm:text-5xl">Today</h1>
          {!loading && response && <p className="mt-3 text-2xl font-black tracking-[-.04em] text-[#172033]">You only need to read {mustRead.length}.</p>}
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#737c88]">只保留可能改变你判断、且有证据支持的新变化。</p>
        </div>
        <button
          onClick={() => activeFilter && void refreshToday(knowledge, activeFilter)}
          disabled={loading}
          aria-label="重新过滤"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#dfe3e7] bg-white text-[#657080] disabled:opacity-40"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && (
        <section className="mt-12 rounded-[28px] border border-[#e5e7e4] bg-white p-8 text-center">
          <Clock3 className="mx-auto animate-pulse text-[#2359ff]" size={24} />
          <p className="mt-4 text-sm font-black">正在比较你的 Knowledge State 与新证据…</p>
          <p className="mt-2 text-xs text-[#7b8490]">先验证，后判断；没有可靠证据就不生成事实。</p>
        </section>
      )}
      {!loading && error && (
        <section className="mt-10 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-black">本次过滤未完成</p>
          <p className="mt-1 text-xs leading-5">{error}</p>
        </section>
      )}
      {!loading && response && mustRead.length === 0 && <EmptyToday onRefresh={() => activeFilter && void refreshToday(knowledge, activeFilter)} />}
      {!loading && mustRead.length > 0 && (
        <>
          <div className="mt-10 flex items-center justify-between gap-4">
            <p className="text-xs font-black uppercase tracking-[.16em] text-[#7d8691]">Must Read</p>
            <button onClick={() => setFocusOpen(true)} className="min-h-11 shrink-0 rounded-full bg-[#2359ff] px-4 text-xs font-black text-white">
              Start Focus Reading · 15 min
            </button>
          </div>
          <div className="mt-5 grid gap-4">
            {mustRead.map((event) => <EventCard key={event.id} event={event} onOpen={() => setSelected(event)} />)}
          </div>
          <p className="mt-7 text-center text-xs leading-5 text-[#8a929d]">
            其余 {(response?.overview.libraryOnly || 0) + (response?.overview.ignored || 0)} 个事件没有占用你的首页注意力。
          </p>
          {response && <CoverageBadge coverage={response.coverage} />}
        </>
      )}
    </main>
  );

  const renderInformation = () => {
    const visible = sortedInformation.slice(0, visibleCount);
    const conflicting = visible.filter((event) => event.verificationStatus === "conflicting");
    const emerging = visible.filter((event) => event.eventStatus === "SIGNAL" && event.verificationStatus !== "conflicting");
    const gapUpdates = visible.filter(
      (event) =>
        event.attentionDecision !== "MUST_READ" &&
        event.eventStatus !== "SIGNAL" &&
        event.verificationStatus !== "conflicting" &&
        (event.gapMatches.length > 0 || event.questionMatches.length > 0),
    );
    const assigned = new Set([...conflicting, ...emerging, ...gapUpdates].map((event) => event.id));
    const relevant = visible.filter((event) => !assigned.has(event.id));
    const Section = ({ title, eyebrow, events }: { title: string; eyebrow: string; events: ResearchSignal[] }) =>
      events.length ? (
        <section className="mt-10">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#7b8490]">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-black tracking-[-.04em]">{title}</h2>
          <div className="mt-4 grid gap-3">
            {events.map((event) => <EventCard key={event.id} event={event} compact onOpen={() => setSelected(event)} />)}
          </div>
        </section>
      ) : null;

    return (
      <main className="mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-[#2359ff]">Filtered events · not a feed</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-.055em]">Information</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">只展示经过聚合、验证、知识比较后仍具有价值的 Event。</p>

        {response && (
          <div className="mt-7 grid grid-cols-4 border-y border-[#e5e7e4] py-4 text-center">
            {[
              [response.overview.scanned, "Scanned"],
              [response.overview.events, "Events"],
              [response.overview.relevant, "Relevant"],
              [response.overview.mustKnow, "Must Read"],
            ].map(([value, label]) => (
              <div key={String(label)} className="min-w-0">
                <p className="text-lg font-black">{value}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[.06em] text-[#9299a2]">{label}</p>
              </div>
            ))}
          </div>
        )}
        {response && <CoverageBadge coverage={response.coverage} />}

        <label className="mt-6 block sm:hidden">
          <span className="text-xs font-black text-[#6f7884]">Sort events</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setVisibleCount(8); }} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">
            <option value="relevance">Most Relevant</option><option value="reliability">Most Reliable</option><option value="newest">Newest</option><option value="novelty">Most Novel</option><option value="impact">Highest Judgement Impact</option>
          </select>
        </label>
        <div className="mt-6 hidden flex-wrap gap-2 sm:flex">
          {([
            ["relevance", "Most Relevant"],
            ["reliability", "Most Reliable"],
            ["newest", "Newest"],
            ["novelty", "Most Novel"],
            ["impact", "Highest Judgement Impact"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => { setSort(value); setVisibleCount(8); }}
              className={`min-h-11 rounded-full px-4 text-xs font-bold ${sort === value ? "bg-[#172033] text-white" : "bg-[#eceeea] text-[#6f7884]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {!response && !loading && <p className="mt-12 text-center text-sm text-[#7b8490]">先在 Today 完成一次信息过滤。</p>}
        <Section eyebrow="Relevant now" title="Relevant Events" events={relevant} />
        <Section eyebrow="Your knowledge gaps" title="Gap Updates" events={gapUpdates} />
        <Section eyebrow="Needs caution" title="Conflicting Evidence" events={conflicting} />
        <Section eyebrow="Early and unconfirmed" title="Emerging Signals" events={emerging} />

        {visibleCount < sortedInformation.length && (
          <button onClick={() => setVisibleCount((value) => value + 8)} className="mt-8 w-full rounded-xl border border-[#dfe3e7] py-3 text-xs font-black text-[#596473]">
            Load more events · {sortedInformation.length - visibleCount} remaining
          </button>
        )}
      </main>
    );
  };

  const renderLibrary = () => {
    const addKnowledgeItem = (value: string, field: "currentQuestions" | "trackedEntities" | "userJudgements", clear: (value: string) => void) => {
      const nextValue = value.trim();
      if (!nextValue) return;
      setKnowledge((current) => ({ ...current, [field]: unique([...current[field], nextValue]) }));
      clear("");
    };
    return (
      <main className="mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="text-[11px] font-black uppercase tracking-[.16em] text-[#2359ff]">Personal Knowledge Memory</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-.055em]">Library</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">保存证据、跟踪事件，并维护你自己的问题与判断。</p>

        <div className="mt-7 grid grid-cols-4 rounded-2xl bg-[#eceeea] p-1">
          {([['following', 'Following'], ['saved', 'Saved'], ['questions', 'Questions'], ['knowledge', 'Knowledge']] as const).map(([value, label]) => (
            <button key={value} onClick={() => setLibraryView(value)} className={`min-h-11 rounded-xl px-1 text-[11px] font-black ${libraryView === value ? "bg-white text-[#172033] shadow-sm" : "text-[#737c88]"}`}>{label}</button>
          ))}
        </div>

        {libraryView === "following" && <section className="mt-8 grid gap-5">
          {knowledge.trackedEntities.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Entities</p><div className="mt-3 flex flex-wrap gap-2">{knowledge.trackedEntities.map((entity) => <span key={entity} className="rounded-full border border-[#dfe3e7] bg-white px-4 py-2.5 text-sm font-bold">{entity}</span>)}</div></div>}
          {knowledge.trackedEvents.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Events</p><div className="mt-3 grid gap-2">{knowledge.trackedEvents.map((event) => <div key={event} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm font-bold leading-6">{event}</div>)}</div></div>}
          {!knowledge.trackedEntities.length && !knowledge.trackedEvents.length && <p className="rounded-2xl bg-white p-6 text-sm text-[#7b8490]">你还没有关注任何实体或事件。</p>}
          <div className="flex gap-2"><input value={newEntity} onChange={(event) => setNewEntity(event.target.value)} placeholder="Follow an entity" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newEntity, "trackedEntities", setNewEntity)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">Follow</button></div>
        </section>}

        {libraryView === "saved" && <section className="mt-8">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Saved · {library.length}</p>
          <div className="mt-3 grid gap-3">{library.map((entry) => <article key={entry.event.id} className="rounded-[22px] border border-[#e5e7e4] bg-white p-5"><p className="text-xs font-black text-[#2359ff]">{entry.event.eventStatus} · {entry.event.sourceCount} sources</p><h3 className="mt-3 text-lg font-black leading-7">{entry.event.title}</h3><textarea value={notes[entry.event.id] ?? entry.notes} onChange={(eventObject) => { const note = eventObject.target.value; setNotes((current) => ({ ...current, [entry.event.id]: note })); setLibrary((current) => current.map((item) => item.event.id === entry.event.id ? { ...item, notes: note } : item)); }} placeholder="Add Note…" className="mt-4 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-[#fafbf9] p-3 text-base leading-6 outline-none"/><button onClick={() => setSelected(entry.event)} className="mt-3 min-h-11 text-sm font-black text-[#2359ff]">查看证据 →</button></article>)}</div>
          {!library.length && <p className="mt-3 rounded-2xl bg-white p-6 text-sm text-[#7b8490]">在 Today 的 Insight Detail 中点击 Save。</p>}
        </section>}

        {libraryView === "questions" && <section className="mt-8 grid gap-7">
          <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Open Questions</p><div className="mt-3 grid gap-2">{knowledge.currentQuestions.map((question) => <div key={question} className="flex items-start justify-between gap-3 rounded-2xl bg-white p-4 text-sm font-bold leading-6"><span>{question}</span><button onClick={() => setKnowledge((current) => ({ ...current, currentQuestions: current.currentQuestions.filter((item) => item !== question) }))} className="min-h-11 shrink-0 text-xs text-[#2359ff]">Resolve</button></div>)}</div><div className="mt-3 flex gap-2"><input value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Add a question" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newQuestion, "currentQuestions", setNewQuestion)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">Add</button></div></div>
          {knowledge.informationGaps.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Information Gaps</p><div className="mt-3 grid gap-2">{knowledge.informationGaps.map((gap) => <div key={gap} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm font-bold leading-6">{gap}</div>)}</div></div>}
        </section>}

        {libraryView === "knowledge" && <section className="mt-8 grid gap-7">
          {knowledge.knownInformation.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">Known Information</p><div className="mt-3 grid gap-2">{knowledge.knownInformation.map((item) => <div key={item} className="rounded-2xl bg-[#f1f3ef] p-4 text-sm leading-6">{item}</div>)}</div></div>}
          {knowledge.userJudgements.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">My Judgements</p><div className="mt-3 grid gap-2">{knowledge.userJudgements.map((item) => <div key={item} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm leading-6">{item}</div>)}</div></div>}
          <div className="flex gap-2"><input value={newJudgement} onChange={(event) => setNewJudgement(event.target.value)} placeholder="Add a judgement" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newJudgement, "userJudgements", setNewJudgement)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">Add</button></div>
        </section>}
      </main>
    );
  };

  const listField = (
    field: keyof Pick<
      KnowledgeState,
      | "focusAreas"
      | "currentQuestions"
      | "knownInformation"
      | "informationGaps"
      | "trackedEntities"
      | "trackedEvents"
      | "userJudgements"
      | "evidenceHistory"
    >,
    label: string,
    hint: string,
  ) => (
    <label className="block">
      <span className="text-sm font-black">{label}</span>
      <span className="ml-2 text-xs text-[#939aa3]">{hint}</span>
      <textarea
        value={knowledge[field].join("\n")}
        onChange={(event) => setKnowledge((current) => ({ ...current, [field]: textToList(event.target.value) }))}
        className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#dfe3e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#8facff]"
      />
    </label>
  );

  const renderSettings = () => {
    const sourceRows = [
      ["Demo Data", "Available"],
      ["Imported Data", "Available"],
      ["Web", "Available"],
      ["X", connections.find((item) => item.id === "x")?.state === "connected" ? "Connected" : "Not configured"],
      ["Xiaohongshu", connections.find((item) => item.id === "xiaohongshu")?.state === "connected" ? "Connected" : connections.find((item) => item.id === "xiaohongshu")?.state === "login_required" ? "Login required" : "Unavailable"],
    ];
    const accordionClass = "rounded-[22px] border border-[#e3e6e8] bg-white p-5";
    const summaryClass = "flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-black";
    return (
      <main className="mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="text-[11px] font-black uppercase tracking-[.16em] text-[#2359ff]">Private by default</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-.055em]">Settings</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">管理你的过滤器、认知状态和本地测试数据。</p>

        <div className="mt-8 grid gap-3">
          <details className={accordionClass}>
            <summary className={summaryClass}><span>My Profile</span><ChevronRight size={18}/></summary>
            <div className="mt-5 grid gap-5"><label><span className="text-sm font-black">Identity</span><input value={knowledge.identity} onChange={(event) => setKnowledge((current) => ({ ...current, identity: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] px-4 text-base"/></label><label><span className="text-sm font-black">Industry</span><input value={knowledge.industry} onChange={(event) => setKnowledge((current) => ({ ...current, industry: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] px-4 text-base"/></label></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>My Knowledge</span><ChevronRight size={18}/></summary>
            <div className="mt-5 grid gap-5">{listField("focusAreas", "Focus Areas", "每行一项")}{listField("currentQuestions", "Current Questions", "尚未解决的问题")}{listField("knownInformation", "Known Information", "已确认的事实")}{listField("informationGaps", "Information Gaps", "仍缺少的证据")}{listField("trackedEntities", "Tracked Entities", "公司、产品、人物")}{listField("trackedEvents", "Tracked Events", "持续观察的事件")}{listField("userJudgements", "User Judgements", "当前判断")}<label><span className="text-sm font-black">Freshness Window</span><select value={knowledge.freshnessWindow} onChange={(event) => setKnowledge((current) => ({ ...current, freshnessWindow: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="1d">24 小时</option><option value="3d">3 天</option><option value="7d">7 天</option><option value="30d">30 天</option></select></label><button onClick={() => { if (!activeFilter) return; setResponse(null); setPage("today"); void refreshToday(knowledge, activeFilter); }} className="min-h-12 rounded-xl bg-[#2359ff] text-sm font-black text-white">保存并重新判断 Today</button></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>My Filters</span><ChevronRight size={18}/></summary>
            <div className="mt-4 grid gap-2">{filters.map((filter) => <button key={filter.id} onClick={() => switchFilter(filter)} className={`flex min-h-14 items-center justify-between rounded-2xl border p-4 text-left ${filter.id === activeFilterId ? "border-[#9eb2ff] bg-[#f2f5ff]" : "border-[#e4e6e2] bg-white"}`}><span><strong className="block text-sm">{filter.filterName}</strong>{(filter.industry || filter.identity) && <span className="mt-1 block text-xs text-[#7b8490]">{filter.industry || filter.identity}</span>}</span><span className="text-xs font-black text-[#2359ff]">{filter.id === activeFilterId ? "ACTIVE" : "USE"}</span></button>)}<button onClick={() => setFilterBuilderOpen(true)} className="min-h-12 rounded-xl border border-dashed border-[#bfc7d1] text-sm font-black text-[#596473]">＋ Create another filter</button></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>Data Sources</span><ChevronRight size={18}/></summary>
            <div className="mt-4 grid gap-2">{sourceRows.map(([label, value]) => <div key={label} className="flex min-h-12 items-center justify-between border-b border-[#eceeea] text-sm last:border-0"><strong>{label}</strong><span className={value === "Available" || value === "Connected" ? "font-bold text-emerald-700" : "text-[#7b8490]"}>{value}</span></div>)}</div>
            {response && <CoverageBadge coverage={response.coverage}/>}<details className="mt-4 rounded-xl bg-[#f4f6f3] p-4 text-sm"><summary className="min-h-11 cursor-pointer font-black">Advanced</summary><p className="mt-2 leading-6 text-[#68727f]">真实 Provider 的连接参数只由运行环境提供。普通测试不需要配置任何凭证。</p></details>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>My Data</span><ChevronRight size={18}/></summary>
            <p className="mt-4 text-sm leading-6 text-[#68727f]">Filters、Knowledge、Library、Notes 与 Feedback 只保存在当前浏览器。</p>{experienceFeedback.length ? <a href={feedbackExportHref} download={`signal-map-feedback-${sessionId.slice(0, 8) || "alpha"}.json`} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black">Export Feedback JSON</a> : <span className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black opacity-40">Export Feedback JSON</span>}<button onClick={() => { if (!window.confirm("清除当前设备上的全部 Signal Map Alpha 数据？")) return; void clearAlphaData().then(() => { setFilters([]); setActiveFilterId(null); setKnowledge(defaultKnowledge); setLibrary([]); setNotes({}); setFeedbackRecords([]); setExperienceFeedback([]); setResponse(null); setPage("today"); }); }} className="mt-2 min-h-12 w-full rounded-xl text-sm font-black text-rose-700">Clear local alpha data</button>
          </details>
        </div>

        <details className="mt-6 rounded-[22px] border border-[#cfd8ff] bg-[#f4f6ff] p-5">
          <summary className={summaryClass}><span>反馈本次体验</span><ChevronRight size={18}/></summary>
          <div className="mt-5 grid gap-5">
            <label><span className="text-sm font-black">1. Today 里有几条真的值得你看？</span><select value={feedbackDraft.worthwhileCount} onChange={(event) => setFeedbackDraft((current) => ({ ...current, worthwhileCount: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">{[0,1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span className="text-sm font-black">2. 有没有你本来就知道的信息？</span><select value={feedbackDraft.alreadyKnown} onChange={(event) => setFeedbackDraft((current) => ({ ...current, alreadyKnown: event.target.value as "yes" | "no" }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label><span className="text-sm font-black">3. 你信任这些信息吗？</span><select value={feedbackDraft.trustScore} onChange={(event) => setFeedbackDraft((current) => ({ ...current, trustScore: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
            <label><span className="text-sm font-black">4. 系统漏掉了什么重要信息？</span><textarea value={feedbackDraft.missedInformation} onChange={(event) => setFeedbackDraft((current) => ({ ...current, missedInformation: event.target.value }))} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-white p-4 text-base"/></label>
            <label><span className="text-sm font-black">5. 如果每天只给这些，你愿意继续用吗？</span><select value={feedbackDraft.continueUsing} onChange={(event) => setFeedbackDraft((current) => ({ ...current, continueUsing: event.target.value as "yes" | "maybe" | "no" }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label>
            <label><span className="text-sm font-black">6. 最大的问题是什么？</span><textarea value={feedbackDraft.biggestProblem} onChange={(event) => setFeedbackDraft((current) => ({ ...current, biggestProblem: event.target.value }))} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-white p-4 text-base"/></label>
            <button onClick={submitExperienceFeedback} className="min-h-12 rounded-xl bg-[#2359ff] text-sm font-black text-white">{feedbackSaved ? "反馈已保存在本机" : "提交体验反馈"}</button>
          </div>
        </details>

        {testMode && <section className="mt-6 rounded-[22px] border border-[#e3e6e8] bg-white p-5"><p className="text-xs font-black uppercase tracking-[.12em] text-[#2359ff]">Alpha Test Mode</p><p className="mt-2 text-sm text-[#68727f]">Session ID · {sessionId.slice(0, 8)}</p><div className="mt-4 grid gap-2"><button onClick={() => activeFilter && void refreshToday(knowledge, activeFilter)} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">Reset Demo Data</button><button onClick={() => { setActiveFilterId(null); setResponse(null); void setAlphaValue("lastRun", null); }} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">Reset Filter</button>{experienceFeedback.length ? <a href={feedbackExportHref} download={`signal-map-feedback-${sessionId.slice(0, 8) || "alpha"}.json`} className="flex min-h-12 items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black">Export Feedback</a> : <span className="flex min-h-12 items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black opacity-40">Export Feedback</span>}</div></section>}
      </main>
    );
  };

  if (!hydrated) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfbf8] text-[#172033]">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-[#2359ff]" size={20} />
          <p className="mt-3 text-xs font-black">正在恢复本地 Knowledge State…</p>
        </div>
      </div>
    );
  }

  if (!activeFilter || filterBuilderOpen) {
    return (
      <FilterBuilder
        onSave={createFilter}
        onCancel={activeFilter ? () => setFilterBuilderOpen(false) : undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#fbfbf8] text-[#172033]">
      <header className="sticky top-0 z-30 border-b border-[#e6e8e5] bg-[#fbfbf8]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => navigate("today")} className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#2359ff] text-[10px] font-black text-white">SM</span>
            <span className="text-sm font-black tracking-[-.02em]">Signal Map</span>
          </button>
          <nav className="hidden items-center gap-1 rounded-full border border-[#e0e3e6] bg-white p-1 sm:flex">
            {navItems.map(({ id, label }) => (
              <button key={id} onClick={() => navigate(id)} className={`min-h-11 rounded-full px-4 text-xs font-black ${page === id ? "bg-[#172033] text-white" : "text-[#747d88]"}`}>
                {label}
              </button>
            ))}
          </nav>
          <span className="text-[9px] font-bold text-[#939aa3]">Attention, protected.</span>
        </div>
      </header>

      {page === "today" && renderToday()}
      {page === "information" && renderInformation()}
      {page === "library" && renderLibrary()}
      {page === "settings" && renderSettings()}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e1e4e7] bg-white/96 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-4">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => navigate(id)} className={`grid min-h-12 place-items-center gap-1 py-1 text-[10px] font-bold ${page === id ? "text-[#2359ff]" : "text-[#8b929c]"}`}>
              <Icon size={18} strokeWidth={page === id ? 2.5 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {selected && (
        <EventDetail
          event={selected}
          saved={library.some((entry) => entry.event.id === selected.id)}
          initialNote={notes[selected.id] || library.find((entry) => entry.event.id === selected.id)?.notes || ""}
          onClose={() => setSelected(null)}
          onSave={(note) => saveEvent(selected, note)}
          onFeedback={(value) => applyFeedback(selected, value)}
        />
      )}
      {focusOpen && mustRead.length > 0 && (
        <FocusReading
          events={mustRead}
          library={library}
          onClose={() => setFocusOpen(false)}
          onSaveNote={saveEvent}
          onFeedback={applyFeedback}
        />
      )}
    </div>
  );
}
