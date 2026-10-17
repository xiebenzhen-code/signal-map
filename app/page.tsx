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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FilteringSummary,
  ResearchSignal,
  VerificationStatus,
} from "@/research/types";
import { sourceCoverageExplanation } from "@/information/filter-engine";
import { demoProvider } from "@/information/providers/demo-provider";
import {
  applyDefaultIdentity,
  composeActiveKnowledgeContext,
  createEmptyFilterKnowledge,
  normalizeStrings,
  recordEvidence,
  updateFilterResearchConfig,
  updateResearchContext,
} from "@/information/knowledge-state";
import {
  runInformation,
  selectCurrentInformationRun,
} from "@/information/run-information";
import { createResearchRequest } from "@/information/research-request";
import { createBrowserResearchObservation } from "@/information/browser-observation";
import {
  inferNaturalResearchDraft,
  type NaturalResearchOptions,
} from "@/information/natural-research-intent";
import { selectTodayPresentation } from "@/information/today-selection";
import { todayContextNotice, todayResultCopy } from "@/information/today-copy";
import { accountKnowledgeVerificationLabel } from "@/information/knowledge-labels";
import type {
  ActiveKnowledgeContext,
  FilterKnowledgeState,
  FeedbackRecord,
  ExperienceFeedback,
  InformationFilter,
  InformationRun,
  InformationRunPayload,
  KnowledgeByFilterId,
  LibraryEntry,
  PersonalProfile,
  ProviderCoverage,
  SourceScope,
} from "@/information/types";
import {
  clearAlphaData,
  loadAlphaSnapshot,
  setAlphaValue,
  saveFilterSources,
} from "@/lib/alpha-storage";
import { CustomSourcesEditor } from "./components/custom-sources-editor";
import { parseCustomSources } from "@/lib/custom-sources";
import { signalTypeLabel, userFacingReason } from "@/lib/user-facing-labels";

type Page = "today" | "information" | "library" | "settings";
type LibraryView = "following" | "saved" | "questions" | "knowledge";
type Feedback =
  | "changed_view"
  | "added_context"
  | "already_knew"
  | "not_useful"
  | "monitor"
  | "resolved";

type KnowledgeView = ActiveKnowledgeContext & Pick<FilterKnowledgeState, "evidenceHistory">;

type KnowledgeListField = keyof Pick<
  KnowledgeView,
  | "focusAreas"
  | "currentQuestions"
  | "knownInformation"
  | "informationGaps"
  | "trackedEntities"
  | "trackedEvents"
  | "userJudgements"
  | "evidenceHistory"
>;

type Connection = {
  id: "x" | "xiaohongshu";
  label: string;
  state:
    | "connected"
    | "login_required"
    | "not_configured"
    | "unavailable"
    | "error";
  capabilities: string[];
  publicMessage?: string;
};

type CurrentUser = { id: string; mode: "authenticated" } | null;

type AccountKnowledgeItem = {
  id: string;
  type: string;
  currentValue: string;
  updatedAt: string;
  revision: { currentRevision?: number; revisionReason?: string };
  provenance: { verificationStatus?: string; reliabilityScore?: number };
  supportingEvidence: Array<{ id: string; publisher: string; sourceUrl: string; verificationStatus: string }>;
};

type FollowIntensity = "major_only" | "worth_knowing" | "more";
type FollowDelivery = "important" | "daily" | "weekly";
type AccountFollow = {
  id: string;
  topic: string;
  intensity: FollowIntensity;
  intensityLabel: string;
  delivery: FollowDelivery;
  deliveryLabel: string;
  status: string;
  nextCheckAt?: string;
  reason: string;
};

const defaultProfile: PersonalProfile = {
  defaultIdentity: "AI 产品经理与独立创作者",
};

const defaultFilterKnowledge: FilterKnowledgeState = {
  researchContextRevision: 1,
  updatedAt: "",
  currentQuestions: ["哪些能力变化会真实影响普通创作者的工作方式？"],
  knownInformation: ["Codex 可以协助完成多步骤编程任务"],
  informationGaps: ["近期官方能力变化", "对普通创作者的实际影响"],
  trackedEntities: ["OpenAI", "Anthropic", "Google"],
  trackedEvents: [],
  userJudgements: [],
  evidenceHistory: [],
};

const navItems: Array<{ id: Page; label: string; icon: typeof Target }> = [
  { id: "today", label: "今日", icon: Target },
  { id: "information", label: "信息", icon: FileSearch },
  { id: "library", label: "资料库", icon: LibraryBig },
  { id: "settings", label: "设置", icon: Settings },
];

const feedbackLabels: Record<Feedback, string> = {
  changed_view: "改变了我的看法",
  added_context: "补充了有用背景",
  already_knew: "我已经知道",
  not_useful: "对我没用",
  monitor: "继续关注",
  resolved: "解决了我的问题",
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

const eventStatusLabels: Record<ResearchSignal["eventStatus"], string> = {
  NEW: "新信息",
  UPDATED: "有更新",
  FOLLOW_UP: "后续",
  SIGNAL: "早期信号",
  BACKGROUND: "背景资料",
};

function pageFromParam(value: string | null): Page | null {
  return value === "today" || value === "information" || value === "library" || value === "settings"
    ? value
    : null;
}

function libraryViewFromParam(value: string | null): LibraryView | null {
  return value === "following" || value === "saved" || value === "questions" || value === "knowledge"
    ? value
    : null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function textToList(value: string) {
  return unique(value.split(/\r?\n/));
}

function reliabilityLabel(score: number) {
  if (score >= 85) return "高可靠性";
  if (score >= 70) return "中等可靠性";
  return "低可靠性";
}

function FilteringSummaryCard({ summary }: { summary?: FilteringSummary }) {
  if (!summary) return null;
  const reasons = [
    [summary.filteredReasons.duplicate, "重复传播"],
    [summary.filteredReasons.insufficientVerification, "证据不足"],
    [summary.filteredReasons.lowReliability, "可靠性偏低"],
    [summary.filteredReasons.stale, "时间过旧"],
    [summary.filteredReasons.background, "仅作背景"],
    [summary.filteredReasons.lowNovelty, "新信息不足"],
    [summary.filteredReasons.unresolvedConflict, "冲突未解决"],
    [summary.filteredReasons.lowActionability, "行动价值低"],
    [summary.filteredReasons.noInformationGain, "无明显信息增量"],
    [summary.filteredReasons.insufficientContent, "正文提取不足"],
  ].filter(([count]) => Number(count) > 0).slice(0, 3);
  const filteredCount = Math.max(0, summary.retrievedCount - summary.displayedCount);
  const hasContentOrReliabilityGap =
    (summary.filteredReasons.insufficientContent ?? 0) > 0 ||
    (summary.filteredReasons.lowReliability ?? 0) > 0;
  const overviewText = `今天检索到 ${summary.retrievedCount} 条，${summary.displayedCount} 条通过筛选。`;
  const filteredText = filteredCount > 0
    ? hasContentOrReliabilityGap
      ? "其余因内容不足或来源可信度不够被过滤。"
      : "其余因未达到筛选条件被过滤。"
    : "当前没有其他候选需要过滤。";
  return (
    <section className="mt-8 rounded-[24px] border border-[#dfe3e7] bg-white/75 p-5 text-sm leading-6 text-[#596473]">
      <p className="text-xs font-black uppercase tracking-[.14em] text-[#2359ff]">过滤说明</p>
      <p className="mt-2 font-semibold text-[#172033]">{overviewText}</p>
      <p className="mt-1 text-sm text-[#737c88]">{filteredText}</p>
      <details className="mt-4 rounded-2xl border border-[#e5e8eb] bg-white/60 px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-black text-[#2359ff]">查看筛选详情</summary>
        <p className="mt-3 text-xs text-[#737c88]">{summary.summaryText}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            [`检索 ${summary.retrievedCount}`, "条"],
            [`聚合 ${summary.clusteredCount}`, "个信号"],
            [`展示 ${summary.displayedCount}`, "个"],
            ...(summary.detailEnrichment
              ? [
                  [`详情抓取 ${summary.detailEnrichment.detailAttempted}`, "次"],
                  [`详情成功 ${summary.detailEnrichment.detailSucceeded}`, "次"],
                  [`仍不足 ${summary.detailEnrichment.stillInsufficient}`, "条"],
                ] as const
              : []),
          ].map(([label, suffix]) => (
            <span key={label} className="rounded-full bg-[#f3f4f1] px-3 py-1 text-xs font-bold text-[#596473]">{label}{suffix}</span>
          ))}
          {reasons.map(([count, label]) => (
            <span key={String(label)} className="rounded-full bg-[#fff4e6] px-3 py-1 text-xs font-bold text-[#8a5a00]">{label} {count}</span>
          ))}
        </div>
        {summary.strongestHiddenSignal && (
          <p className="mt-3 text-xs text-[#737c88]">
            最强隐藏信号：{signalTypeLabel(summary.strongestHiddenSignal.signalType)} · {summary.strongestHiddenSignal.independentSourceCount} 个独立来源 · 原因 {userFacingReason(summary.strongestHiddenSignal.reason)}
          </p>
        )}
        {summary.filteringDetails?.length ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">逐条筛选链路</p>
            {summary.filteringDetails.map((item) => (
              <article key={item.id} className="rounded-xl border border-[#e5e8eb] bg-white/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-[#172033]">{item.title}</p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${item.decision === "displayed" ? "bg-emerald-50 text-emerald-700" : "bg-[#fff4e6] text-[#8a5a00]"}`}>
                    {item.decision === "displayed" ? "保留" : "过滤"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#596473]">{item.explanation}</p>
                {item.sources.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.sources.map((source) => (
                      <a key={`${item.id}-${source.sourceUrl}`} href={source.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#2359ff] underline">来源：{source.publisher}</a>
                    ))}
                  </div>
                ) : <p className="mt-2 text-xs text-[#8a929d]">暂无可展示的来源链接</p>}
              </article>
            ))}
          </div>
        ) : null}
      </details>
    </section>
  );
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
    <article className="signal-event-card sm:p-6">
      <div className="signal-card-kicker flex items-center justify-between gap-3">
        <span className="text-[#2359ff]">
          {eventStatusLabels[event.eventStatus]}
          {event.dataOrigin === "demo" ? " · 演示数据" : ""}
        </span>
        <span className="shrink-0 text-[#7d8691]">{event.time}</span>
      </div>
      {(() => {
        const version = event.sources?.[0]?.sourceUrl?.match(/releases\/tag\/(v[\d.]+)/)?.[1];
        return version ? (
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-lg bg-[#e8ecfb] px-2.5 py-1 text-xs font-bold text-[#2359ff]">{version}</span>
            {event.publishedAt && <span className="text-xs text-[#68727f]">{new Date(event.publishedAt).toLocaleDateString("zh-CN")}</span>}
          </div>
        ) : null;
      })()}

      <h3 className="signal-event-title mt-4 text-[20px] leading-7 sm:text-[23px] sm:leading-8">
        {event.presentation?.headline || event.title}
      </h3>
      {event.presentation?.fact && (
        <p className="mt-3 text-sm font-semibold leading-6 text-[#4f5968]">
          {event.presentation.fact}
        </p>
      )}
      <div className="signal-why mt-4 rounded-xl p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#68727f]">
          为什么值得关注
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">
          {event.whyItMatters}
        </p>
      </div>

      <div className="signal-card-meta mt-5 flex items-center justify-between gap-4 border-t pt-4 text-xs text-[#68727f]">
        <span className="font-black text-[#172033]">{reliabilityLabel(event.reliabilityScore)}</span>
        <span>{event.sourceCount} 个来源</span>
      </div>

      {!compact && (
        <button
          onClick={onOpen}
          className="signal-primary-action mt-4 flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
        >
          查看证据与判断依据
          <ChevronRight size={15} />
        </button>
      )}
      {compact && (
        <button
          onClick={onOpen}
          className="signal-inline-action mt-3 min-h-11 text-sm font-semibold"
        >
          查看事件证据 →
        </button>
      )}
    </article>
  );
}

function EmptyToday({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="signal-empty mt-14 rounded-[28px] border px-6 py-14 text-center sm:px-10">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Check size={22} />
      </div>
      <h2 className="mt-5 text-2xl font-black tracking-[-.04em] text-[#172033]">
        今天已经看完了
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
  onFeedbackPersist,
}: {
  event: ResearchSignal;
  saved: boolean;
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => void;
  onFeedback: (value: Feedback) => void;
  onFeedbackPersist?: (value: Feedback, event: ResearchSignal) => Promise<{ ok: boolean; scope?: string; skipped?: boolean; errorCode?: string }>;
}) {
  const [note, setNote] = useState(initialNote);
  const [persistState, setPersistState] = useState<{ pending?: boolean; ok?: boolean; scope?: string; skipped?: boolean; errorCode?: string } | null>(null);
  const reliableClaims = event.claims.filter((claim) =>
    ["verified", "partially_verified"].includes(claim.verificationStatus),
  );
  const factClaims = reliableClaims.filter((claim) => claim.contentType === "FACT");
  const respond = (value: Feedback) => {
    if (note.trim()) onSave(note);
    onFeedback(value);
    if (onFeedbackPersist) {
      setPersistState({ pending: true });
      onFeedbackPersist(value, event)
        .then((result) => setPersistState(result.skipped ? null : { ok: result.ok, scope: result.scope, errorCode: result.errorCode }))
        .catch((error) => setPersistState({ ok: false, errorCode: String(error) }));
    }
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
            <span>{eventStatusLabels[event.eventStatus]}</span>
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
          {event.presentation?.headline || event.title}
        </h2>
        {event.latestUpdateAt && event.originalOccurredAt && (
          <p className="mt-2 text-xs font-semibold text-[#7d8691]">
            原事件：{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(event.originalOccurredAt))}
          </p>
        )}
        <section className="mt-6">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">为什么值得关注</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">
            {event.presentation?.whyItMatters || event.whyItMatters}
          </p>
        </section>

        <section className="mt-6">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">事实</p>
          {event.presentation?.contentQuality === "INSUFFICIENT_CONTENT" ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              正文提取不足，未生成可验证事实。
            </div>
          ) : factClaims.length === 0 && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              未找到可靠证据。
            </div>
          )}
          <div className="mt-3 grid gap-2">
            {event.presentation?.contentQuality === "VALID" && (
              <p className="rounded-2xl bg-[#f5f7f4] p-4 text-sm font-bold leading-6">{event.presentation.fact}</p>
            )}
          </div>
        </section>

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">证据</p>
          <div className="mt-3 grid gap-3">
            {(event.presentation?.evidence.length ? event.presentation.evidence : event.claims.map((claim) => ({ sourceName: claim.publisher, sourceRole: claim.contentType === "FACT" ? "verification" as const : "discovery" as const, snippet: claim.evidenceSnippet, url: claim.sourceUrl, publishedAt: claim.publishedAt }))).map((evidence) => <article key={`${evidence.url}-${evidence.snippet}`} className="border-l-2 border-[#d9e0ff] pl-4"><p className={`text-xs font-black ${evidence.sourceRole === "verification" ? "text-emerald-700" : "text-amber-700"}`}>{evidence.sourceRole === "verification" ? "事实证据" : "线索证据"} · {evidence.sourceName}</p><p className="mt-2 text-sm leading-6 text-[#5d6775]">{evidence.snippet}</p></article>)}
          </div>
        </section>

        <section className="mt-7 rounded-2xl bg-[#f6f7f4] p-4">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">解读</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">{event.presentation?.interpretation || event.why}</p>
        </section>

        {event.action && (
          <section className="mt-7 rounded-2xl bg-[#f6f7f4] p-4">
            <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">建议行动</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4f5968]">{event.action}</p>
          </section>
        )}

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">原始来源 · {event.sourceCount}</p>
          <div className="mt-3 grid gap-2">
            {event.sources.map((source) => <a key={`${source.publisher}-${source.sourceUrl}`} href={source.sourceUrl} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between rounded-xl border border-[#e2e5e8] px-4 text-sm font-bold text-[#2359ff]"><span>{source.publisher}</span><span>原文 ↗</span></a>)}
          </div>
        </section>

        <label className="mt-7 block">
          <span className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">我的笔记</span>
          <textarea value={note} onChange={(eventObject) => setNote(eventObject.target.value)} placeholder="这条证据如何影响你的判断？" className="mt-3 min-h-28 w-full resize-none rounded-2xl border border-[#dfe3e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#8facff]" />
        </label>

        <section className="mt-7">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7e8792]">操作</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => onSave(note)} className={`min-h-12 rounded-xl text-sm font-black ${saved ? "bg-emerald-50 text-emerald-700" : "bg-[#172033] text-white"}`}>{saved ? "已保存" : "保存"}</button>
            <button onClick={() => respond("monitor")} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">关注</button>
            <button onClick={() => respond("already_knew")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">我已经知道</button>
            <button onClick={() => respond("changed_view")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">改变了我的看法</button>
            <button onClick={() => respond("not_useful")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">对我没用</button>
            <button onClick={() => respond("monitor")} className="min-h-12 rounded-xl border border-[#dfe3e7] px-2 text-xs font-black">继续关注</button>
          </div>
          {persistState?.pending && <p className="mt-2 text-xs font-semibold text-[#7d8691]">正在保存反馈…</p>}
          {persistState && !persistState.pending && persistState.ok && <p className="mt-2 text-xs font-semibold text-emerald-700">反馈已保存{persistState.scope === "account" ? "到账号长期记忆" : ""}。</p>}
          {persistState && !persistState.pending && persistState.ok === false && <p className="mt-2 text-xs font-bold text-rose-700">反馈保存失败（{persistState.errorCode === "DB_TIMEOUT" ? "服务暂时不可用" : persistState.errorCode === "UNAUTHORIZED" ? "需要登录" : persistState.errorCode ?? "未知原因"}）。本地草稿仍保留，但未写入账号长期记忆。</p>}
        </section>

        <details className="mt-7 rounded-2xl border border-[#e2e5e8] p-4">
          <summary className="min-h-11 cursor-pointer text-sm font-black">评分明细</summary>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {[[event.relevanceScore, "相关性"], [event.reliabilityScore, "可靠性"], [event.freshnessScore, "新鲜度"], [event.noveltyScore, "信息增量"], [event.judgementImpactScore, "判断影响"], [event.gapMatchScore, "缺口匹配"]].map(([value, label]) => <div key={String(label)} className="rounded-xl bg-[#f4f6f8] p-3"><strong>{value}</strong><span className="ml-2 text-xs text-[#7b8490]">{label}</span></div>)}
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
          <h2 className="mt-6 text-3xl font-black tracking-[-.05em]">今天已经看完了</h2>
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
            <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#7e8791]">专注阅读</p>
            <p className="mt-0.5 text-xs font-bold">今日必读 · {index + 1} / {events.length}</p>
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
          <span>{eventStatusLabels[event.eventStatus]}</span>
        </div>
        <h1 className="mt-5 text-3xl font-black leading-[1.2] tracking-[-.05em]">{event.presentation?.headline || event.title}</h1>
        {event.presentation?.fact && (
          <p className="mt-4 text-base font-bold leading-7 text-[#4f5968]">{event.presentation.fact}</p>
        )}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(28,36,50,.035)]">
          <p className="text-[9px] font-black tracking-[.14em] text-[#8a929d]">为什么值得关注 · 解读</p>
          <p className="mt-2 text-sm font-semibold leading-7 text-[#4f5968]">{event.presentation?.whyItMatters || event.whyItMatters}</p>
        </section>
        <section className="mt-5">
          <p className="text-[10px] font-black uppercase tracking-[.15em] text-[#7b8490]">证据</p>
          <div className="mt-3 grid gap-3">
            {(event.presentation?.evidence.length ? event.presentation.evidence : event.claims.map((claim) => ({ sourceName: claim.publisher, sourceRole: claim.contentType === "FACT" ? "verification" as const : "discovery" as const, snippet: claim.evidenceSnippet, url: claim.sourceUrl }))).map((evidence) => (
              <article key={evidence.url} className="rounded-2xl border border-[#e4e6e2] bg-white p-4">
                <p className={`text-[9px] font-black ${evidence.sourceRole === "verification" ? "text-emerald-700" : "text-amber-700"}`}>
                  {evidence.sourceRole === "verification" ? "事实证据" : "线索证据"} · {evidence.sourceName}
                </p>
                <p className="mt-2 text-sm font-bold leading-6">{evidence.snippet}</p>
                <a href={evidence.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-black text-[#2359ff]">
                  查看原文 ↗
                </a>
              </article>
            ))}
          </div>
        </section>
        <label className="mt-6 block">
          <span className="text-[10px] font-black uppercase tracking-[.14em] text-[#7b8490]">我的笔记</span>
          <textarea
            value={note}
            onChange={(eventObject) => setNote(eventObject.target.value)}
            placeholder="记录这条证据如何影响你的判断…"
            className="mt-3 min-h-28 w-full resize-none rounded-2xl border border-[#dfe2e5] bg-white p-4 text-sm leading-6 outline-none focus:border-[#8facff]"
          />
        </label>
        <div className="mt-6">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[.14em] text-[#7b8490]">这条信息改变了你的看法吗？</p>
          <FeedbackButtons onFeedback={(value) => finishEvent(value)} />
        </div>
        <button onClick={() => finishEvent()} className="mt-4 w-full rounded-xl bg-[#172033] py-3 text-xs font-black text-white">
          {index >= events.length - 1 ? "完成今日阅读" : "保存笔记并查看下一条"}
        </button>
      </main>
    </div>
  );
}

type OnboardingDraft = {
  filterName: string;
  identity: string;
  industry: string;
  focusAreas: string[];
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  freshnessWindow: InformationFilter["freshnessWindow"];
  sourceScope: SourceScope;
  customSources?: string[];
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
  sourceScope: "hybrid",
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
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [options, setOptions] = useState<NaturalResearchOptions>({
    sourcePreference: "auto",
    reliabilityPreference: "balanced",
  });
  const examples = [
    "最近有哪些值得投递的 AIGC 岗位？",
    "最近有什么值得测试的 AI 视频工具？",
    "这个方向最近有什么重要变化？",
  ];
  const submit = () => {
    let draft: ReturnType<typeof inferNaturalResearchDraft>;
    try { draft = inferNaturalResearchDraft(query, options); }
    catch (error) { setSourceError(error instanceof Error ? error.message : "无法识别时间范围"); return; }
    const parsed = parseCustomSources(sources);
    if (parsed.errors.length) { setSourceError(parsed.errors[0]); return; }
    setSourceError("");
    onSave({ ...emptyFilterDraft, ...draft, customSources: parsed.urls });
  };

  return (
    <main className="signal-onboarding min-h-screen px-4 pb-10 pt-7 text-[#172033] sm:px-6">
      <section className="mx-auto max-w-[620px]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="signal-mark grid h-10 w-10 place-items-center rounded-xl text-[11px] font-bold text-white">SM</span>
            <div>
              <p className="signal-eyebrow">个人信息雷达</p>
              <p className="text-sm font-semibold">Signal Map</p>
            </div>
          </div>
          {onCancel && <button onClick={onCancel} className="text-xs font-bold text-[#727b87]">取消</button>}
        </div>

        <h1 className="signal-display mt-10 text-[42px] leading-[1.02] sm:text-6xl">你现在想了解什么？</h1>
        <p className="mt-4 text-sm leading-6 text-[#707986]">
          直接说问题就行。Signal Map 会自动判断要看多新的信息、优先查哪些来源，并只保留有证据支持的变化。
        </p>

        <div className="signal-onboarding-form mt-7 grid gap-5 rounded-[22px] border p-5 sm:p-7">
          <label>
            <span className="text-sm font-black">你现在想了解什么？</span>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：最近有什么值得测试的 AI 视频工具？"
              className="mt-2 min-h-32 w-full resize-none rounded-2xl border border-[#dde2e7] bg-white p-4 text-lg leading-7 outline-none focus:border-[#7e9cff]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                onClick={() => setQuery(example)}
                className="min-h-10 rounded-full border border-[#dfe3e7] bg-white px-3 text-xs font-bold text-[#596473]"
              >
                {example}
              </button>
            ))}
          </div>
          <details className="rounded-2xl border border-[#e4e7eb] bg-white/60 p-4">
            <summary className="min-h-10 cursor-pointer list-none text-sm font-black text-[#2359ff]">更多筛选</summary>
            <div className="mt-4 grid gap-4">
              <CustomSourcesEditor value={sources} onChange={setSources} />
              <label><span className="text-sm font-black">时间范围</span><select value={options.freshnessWindow ?? ""} onChange={(event) => setOptions((current) => ({ ...current, freshnessWindow: event.target.value ? event.target.value as InformationFilter["freshnessWindow"] : undefined }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="">自动判断</option><option value="24h">最新</option><option value="3d">最近 3 天</option><option value="7d">最近 7 天</option><option value="30d">最近一个月</option><option value="90d">最近三个月</option></select></label>
              <label><span className="text-sm font-black">来源偏好</span><select value={options.sourcePreference ?? "auto"} onChange={(event) => setOptions((current) => ({ ...current, sourcePreference: event.target.value as NaturalResearchOptions["sourcePreference"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="auto">自动选择</option><option value="official">优先官方和一手来源</option><option value="domestic">优先中文/国内来源</option><option value="global">优先全球来源</option></select></label>
              <label><span className="text-sm font-black">地区</span><input value={options.region ?? ""} onChange={(event) => setOptions((current) => ({ ...current, region: event.target.value }))} placeholder="例如：中国、美国、全球；不填则自动判断" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none" /></label>
              <label><span className="text-sm font-black">排除关键词</span><input value={options.excludeKeywords ?? ""} onChange={(event) => setOptions((current) => ({ ...current, excludeKeywords: event.target.value }))} placeholder="不想看的词，用逗号隔开" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none" /></label>
              <label><span className="text-sm font-black">最低可信度</span><select value={options.reliabilityPreference ?? "balanced"} onChange={(event) => setOptions((current) => ({ ...current, reliabilityPreference: event.target.value as NaturalResearchOptions["reliabilityPreference"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="balanced">正常过滤</option><option value="reliable">优先较可靠来源</option><option value="strict">只看证据更充分的信息</option></select></label>
            </div>
          </details>
          {sourceError && <p role="alert" className="mt-3 text-sm text-[#ad3342]">{sourceError}</p>}
          <div className="flex gap-3 pt-1">
            <button
              onClick={submit}
              className="min-h-12 flex-1 rounded-xl bg-[#2359ff] px-4 text-sm font-black text-white disabled:opacity-45"
              disabled={!query.trim()}
            >
              开始研究
            </button>
          </div>
          <p className="text-center text-[11px] leading-5 text-[#8a929d]">不用先配置系统。登录后可保存长期记忆；未登录只保存在当前浏览器。</p>
        </div>
      </section>
    </main>
  );
}

function ResearchPromptPanel({
  initialQuery = "",
  initialSources = [],
  onSourcesSave,
  loading,
  onSubmit,
}: {
  initialQuery?: string;
  initialSources?: string[];
  onSourcesSave?: (urls: string[]) => Promise<void>;
  loading: boolean;
  onSubmit: (draft: OnboardingDraft) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sources, setSources] = useState(initialSources.join("\n"));
  const [sourceError, setSourceError] = useState("");
  const [options, setOptions] = useState<NaturalResearchOptions>({
    sourcePreference: "auto",
    reliabilityPreference: "balanced",
  });
  const examples = [
    "最近有哪些值得投递的 AIGC 岗位？",
    "最近有什么值得测试的 AI 视频工具？",
    "这个方向最近有什么重要变化？",
  ];
  const submit = () => {
    let draft: ReturnType<typeof inferNaturalResearchDraft>;
    try { draft = inferNaturalResearchDraft(query, options); }
    catch (error) { setSourceError(error instanceof Error ? error.message : "无法识别时间范围"); return; }
    const parsed = parseCustomSources(sources);
    if (parsed.errors.length) { setSourceError(parsed.errors[0]); return; }
    setSourceError("");
    onSubmit({ ...emptyFilterDraft, ...draft, customSources: parsed.urls });
  };

  return (
    <section className="signal-onboarding-form rounded-[24px] border p-5 sm:p-6">
      <label>
        <span className="text-sm font-black text-[#172033]">你现在想了解什么？</span>
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：最近有哪些值得投递的 AIGC 岗位？"
          className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-[#dde2e7] bg-white p-4 text-lg leading-7 outline-none focus:border-[#7e9cff]"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            onClick={() => setQuery(example)}
            className="min-h-10 rounded-full border border-[#dfe3e7] bg-white px-3 text-xs font-bold text-[#596473]"
          >
            {example}
          </button>
        ))}
      </div>
      <details className="mt-4 rounded-2xl border border-[#e4e7eb] bg-white/60 p-4">
        <summary className="min-h-10 cursor-pointer list-none text-sm font-black text-[#2359ff]">更多筛选</summary>
        <div className="mt-4 grid gap-4">
          <CustomSourcesEditor value={sources} onChange={setSources} disabled={loading} onSave={onSourcesSave} />
              <label><span className="text-sm font-black">时间范围</span><select value={options.freshnessWindow ?? ""} onChange={(event) => setOptions((current) => ({ ...current, freshnessWindow: event.target.value ? event.target.value as InformationFilter["freshnessWindow"] : undefined }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="">自动判断</option><option value="24h">最新</option><option value="3d">最近 3 天</option><option value="7d">最近 7 天</option><option value="30d">最近一个月</option><option value="90d">最近三个月</option></select></label>
          <label><span className="text-sm font-black">来源偏好</span><select value={options.sourcePreference ?? "auto"} onChange={(event) => setOptions((current) => ({ ...current, sourcePreference: event.target.value as NaturalResearchOptions["sourcePreference"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="auto">自动选择</option><option value="official">优先官方和一手来源</option><option value="domestic">优先中文/国内来源</option><option value="global">优先全球来源</option></select></label>
          <label><span className="text-sm font-black">地区</span><input value={options.region ?? ""} onChange={(event) => setOptions((current) => ({ ...current, region: event.target.value }))} placeholder="例如：中国、美国、全球；不填则自动判断" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none" /></label>
          <label><span className="text-sm font-black">排除关键词</span><input value={options.excludeKeywords ?? ""} onChange={(event) => setOptions((current) => ({ ...current, excludeKeywords: event.target.value }))} placeholder="不想看的词，用逗号隔开" className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none" /></label>
          <label><span className="text-sm font-black">最低可信度</span><select value={options.reliabilityPreference ?? "balanced"} onChange={(event) => setOptions((current) => ({ ...current, reliabilityPreference: event.target.value as NaturalResearchOptions["reliabilityPreference"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dde2e7] bg-white px-4 text-base outline-none"><option value="balanced">正常过滤</option><option value="reliable">优先较可靠来源</option><option value="strict">只看证据更充分的信息</option></select></label>
        </div>
      </details>
      {sourceError && <p role="alert" className="mt-3 text-sm text-[#ad3342]">{sourceError}</p>}
      <button
        onClick={submit}
        disabled={loading || !query.trim()}
        className="mt-4 min-h-12 w-full rounded-xl bg-[#2359ff] px-4 text-sm font-black text-white disabled:opacity-45"
      >
        {loading ? "正在研究…" : "开始研究"}
      </button>
    </section>
  );
}

function CoverageBadge({ coverage }: { coverage: ProviderCoverage }) {
  return (
    <details className="mt-5 rounded-2xl border border-[#e3e6e8] bg-white px-4 py-3 text-xs text-[#68727f]">
      <summary className="cursor-pointer list-none font-black">
        来源覆盖 · <span className="text-[#2359ff]">{{ Broad: "广泛", Partial: "部分", Limited: "有限" }[coverage.level]}</span>
      </summary>
      <div className="mt-3 grid gap-2 border-t border-[#eceeea] pt-3 text-[10px] leading-5">
        {coverage.usedProviders.length > 0 && <p><strong>已使用：</strong> {coverage.usedProviders.join(" · ")}</p>}
        {coverage.zeroResultProviders.length > 0 && <p><strong>已搜索但未命中：</strong> {coverage.zeroResultProviders.join(" · ")}</p>}
        {coverage.notSearchedProviders.length > 0 && <p><strong>本轮未搜索：</strong> {coverage.notSearchedProviders.join(" · ")}</p>}
        {coverage.unavailableProviders.length > 0 && <p><strong>不可用：</strong> {coverage.unavailableProviders.join(" · ")}</p>}
        {coverage.notConfiguredProviders.length > 0 && <p><strong>未配置：</strong> {coverage.notConfiguredProviders.join(" · ")}</p>}
        {coverage.failedProviders.length > 0 && <p><strong>失败：</strong> {coverage.failedProviders.join(" · ")}</p>}
        <p className="text-[#8b929b]">{sourceCoverageExplanation}</p>
      </div>
    </details>
  );
}

export default function HomePage() {
  const [page, setPage] = useState<Page>("today");
  const [currentUser, setCurrentUser] = useState<CurrentUser>(null);
  const [profile, setProfile] = useState<PersonalProfile>(defaultProfile);
  const [knowledgeByFilterId, setKnowledgeByFilterId] = useState<KnowledgeByFilterId>({});
  const [lastRunByFilterId, setLastRunByFilterId] = useState<Record<string, InformationRun>>({});
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
  const [accountKnowledge, setAccountKnowledge] = useState<AccountKnowledgeItem[]>([]);
  const [accountKnowledgeUserId, setAccountKnowledgeUserId] = useState<string | null>(null);
  const [accountKnowledgeError, setAccountKnowledgeError] = useState("");
  const [accountFollows, setAccountFollows] = useState<AccountFollow[]>([]);
  const [accountFollowsUserId, setAccountFollowsUserId] = useState<string | null>(null);
  const [followTopic, setFollowTopic] = useState("");
  const [followIntensity, setFollowIntensity] = useState<FollowIntensity>("worth_knowing");
  const [followDelivery, setFollowDelivery] = useState<FollowDelivery>("daily");
  const [followStatus, setFollowStatus] = useState("");
  const [selected, setSelected] = useState<ResearchSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const researchObservation = useRef<ReturnType<typeof createBrowserResearchObservation>>(null);
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
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Record<string, string>>({});
  const loggedIn = Boolean(currentUser);
  const accountKnowledgeForCurrentUser = currentUser && accountKnowledgeUserId === currentUser.id
    ? accountKnowledge
    : [];
  const accountFollowsForCurrentUser = currentUser && accountFollowsUserId === currentUser.id
    ? accountFollows
    : [];
  const activeFilter = useMemo(
    () => filters.find((filter) => filter.id === activeFilterId) || null,
    [activeFilterId, filters],
  );
  const activeKnowledge = activeFilterId ? knowledgeByFilterId[activeFilterId] ?? null : null;
  const activeContext = useMemo(
    () => activeFilter && activeKnowledge
      ? composeActiveKnowledgeContext(profile, activeFilter, activeKnowledge)
      : null,
    [activeFilter, activeKnowledge, profile],
  );
  const response = activeContext && activeFilterId
    ? selectCurrentInformationRun(
        lastRunByFilterId,
        activeFilterId,
        activeContext.researchContextRevision,
      )
    : null;
  const contextNotice = activeContext && activeFilterId
    ? todayContextNotice({
        loading,
        error,
        filterId: activeFilterId,
        researchContextRevision: activeContext.researchContextRevision,
        previousRun: lastRunByFilterId[activeFilterId] ?? null,
      })
    : null;
  const knowledge = useMemo<KnowledgeView>(() => activeContext && activeKnowledge
    ? { ...activeContext, evidenceHistory: activeKnowledge.evidenceHistory }
    : {
        identity: profile.defaultIdentity,
        industry: "",
        focusAreas: [],
        freshnessWindow: "7d",
        sourceScope: "hybrid",
        customSources: [],
        currentQuestions: defaultFilterKnowledge.currentQuestions,
        knownInformation: defaultFilterKnowledge.knownInformation,
        informationGaps: defaultFilterKnowledge.informationGaps,
        trackedEntities: defaultFilterKnowledge.trackedEntities,
        trackedEvents: defaultFilterKnowledge.trackedEvents,
        userJudgements: defaultFilterKnowledge.userJudgements,
        evidenceHistory: defaultFilterKnowledge.evidenceHistory,
        researchContextRevision: 1,
      }, [activeContext, activeKnowledge, profile.defaultIdentity]);
  const currentResearchContextRef = useRef<{ filterId: string | null; researchContextRevision: number }>({
    filterId: null,
    researchContextRevision: 0,
  });
  useEffect(() => {
    currentResearchContextRef.current = {
      filterId: activeFilterId,
      researchContextRevision: activeContext?.researchContextRevision ?? 0,
    };
  }, [activeContext?.researchContextRevision, activeFilterId]);
  const setKnowledge = useCallback((updater: (current: KnowledgeView) => KnowledgeView) => {
    if (!activeFilter || !activeKnowledge || !activeFilterId) return;
    const nextView = updater(knowledge);
    const now = new Date().toISOString();
    let nextProfile = profile;
    let nextFilter = activeFilter;
    let nextKnowledgeByFilterId = knowledgeByFilterId;
    let nextKnowledge = activeKnowledge;

    if (nextView.identity !== knowledge.identity) {
      if (activeFilter.identityOverride !== undefined) {
        const updated = updateFilterResearchConfig(nextFilter, nextKnowledge, { identityOverride: nextView.identity }, now);
        nextFilter = updated.filter;
        nextKnowledge = updated.knowledge;
      } else {
        const updated = applyDefaultIdentity(profile, filters, nextKnowledgeByFilterId, nextView.identity, now);
        nextProfile = updated.profile;
        nextKnowledgeByFilterId = updated.knowledgeByFilterId;
        nextKnowledge = nextKnowledgeByFilterId[activeFilterId];
      }
    }

    const filterUpdate = updateFilterResearchConfig(nextFilter, nextKnowledge, {
      industry: nextView.industry,
      focusAreas: nextView.focusAreas,
      freshnessWindow: nextView.freshnessWindow,
      sourceScope: nextView.sourceScope,
      customSources: nextView.customSources,
    }, now);
    nextFilter = filterUpdate.filter;
    nextKnowledge = filterUpdate.knowledge;
    nextKnowledge = updateResearchContext(nextKnowledge, {
      currentQuestions: nextView.currentQuestions,
      knownInformation: nextView.knownInformation,
      informationGaps: nextView.informationGaps,
      trackedEntities: nextView.trackedEntities,
      trackedEvents: nextView.trackedEvents,
      userJudgements: nextView.userJudgements,
    }, now);
    const normalizedEvidence = normalizeStrings(nextView.evidenceHistory);
    if (normalizedEvidence.join("\n") !== nextKnowledge.evidenceHistory.join("\n")) {
      nextKnowledge = normalizedEvidence.reduce(
        (current, evidence) => recordEvidence(current, evidence, now),
        nextKnowledge,
      );
    }

    setProfile(nextProfile);
    setFilters((current) => current.map((filter) => filter.id === activeFilterId ? nextFilter : filter));
    setKnowledgeByFilterId({ ...nextKnowledgeByFilterId, [activeFilterId]: nextKnowledge });
  }, [activeFilter, activeFilterId, activeKnowledge, filters, knowledge, knowledgeByFilterId, profile]);
  const saveSources = useCallback(async (urls: string[]) => {
    if (!activeFilter || !activeKnowledge || !activeFilterId || loading) throw new Error("No active filter");
    const update = updateFilterResearchConfig(activeFilter, activeKnowledge, { customSources: urls }, new Date().toISOString());
    await saveFilterSources({
      filterId: activeFilterId,
      filterEntry: update.filter,
      knowledgeFilterId: activeFilterId,
      knowledgeEntry: update.knowledge,
    });
    setFilters(current => current.map(filter => filter.id === activeFilterId ? { ...filter, customSources: urls, updatedAt: update.filter.updatedAt } : filter));
    setKnowledgeByFilterId(current => {
      const latest = current[activeFilterId] ?? activeKnowledge;
      return { ...current, [activeFilterId]: update.knowledge === activeKnowledge ? latest : {
        ...latest, researchContextRevision: latest.researchContextRevision + 1, updatedAt: update.knowledge.updatedAt,
      } };
    });
  }, [activeFilter, activeFilterId, activeKnowledge, filters, knowledgeByFilterId, loading]);

  const navigate = (nextPage: Page) => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setPage(nextPage);
  };

  const refreshToday = useCallback(async (state: ActiveKnowledgeContext, filter: InformationFilter) => {
    researchObservation.current?.complete("incomplete");
    researchObservation.current = createBrowserResearchObservation();
    setLoading(true);
    setError("");
    try {
      const explicitDemo = new URLSearchParams(window.location.search).get("demo") === "true";
      const result = await runInformation({
        filterId: filter.id,
        researchContextRevision: state.researchContextRevision,
        localOnly: explicitDemo,
        allowDemoFallback: false,
        runLive: async () => {
          const { url, ...requestInit } = createResearchRequest(state);
          researchObservation.current?.request(new Headers(requestInit.headers).get("X-Signal-Map-Request-Id") ?? "");
          const request = await fetch(url, requestInit);
          if (!request.ok) {
            const body = await request.json().catch(() => null) as { error?: string; reason?: string } | null;
            const message = body?.reason || body?.error || "Live Web 暂时不可用";
            throw Object.assign(new Error(message), { status: request.status });
          }
          return (await request.json()) as InformationRunPayload;
        },
        runDemo: () => demoProvider.run({ filter, knowledge: state }),
      });
      const current = currentResearchContextRef.current;
      if (current.filterId !== result.filterId || current.researchContextRevision !== result.generatedFromResearchContextRevision) return;
      setLastRunByFilterId((runs) => ({ ...runs, [result.filterId]: result }));
      if (researchObservation.current) researchObservation.current.outcome = "completed";
    } catch (requestError) {
      if (researchObservation.current) researchObservation.current.outcome = "failed";
      setError(requestError instanceof Error ? requestError.message : "暂时无法完成信息过滤");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const observation = researchObservation.current;
    if (!observation) return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(`[data-research-state="${loading ? "loading" : error ? "error" : "ready"}"]`);
      if (!element || !element.getClientRects().length || document.visibilityState !== "visible") return;
      if (loading) observation.feedback();
      else if (observation.outcome) observation.complete(observation.outcome);
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, error]);

  useEffect(() => {
    let cancelled = false;
    void loadAlphaSnapshot()
      .then(async (snapshot) => {
        if (cancelled) return;
        setFilters(snapshot.filters);
        setActiveFilterId(snapshot.activeFilterId);
        const restoredFilter = snapshot.filters.find((filter) => filter.id === snapshot.activeFilterId);
        const restoredKnowledge = restoredFilter
          ? snapshot.knowledgeByFilterId[restoredFilter.id] ?? createEmptyFilterKnowledge(new Date().toISOString())
          : null;
        setProfile(snapshot.profile);
        setKnowledgeByFilterId(snapshot.knowledgeByFilterId);
        setLastRunByFilterId(snapshot.lastRunByFilterId);
        setLibrary(snapshot.library);
        setNotes(snapshot.notes);
        setFeedbackRecords(snapshot.feedback);
        setExperienceFeedback(snapshot.experienceFeedback);
        const restoredSessionId = snapshot.sessionId || crypto.randomUUID();
        setSessionId(restoredSessionId);
        if (!snapshot.sessionId) await setAlphaValue("sessionId", restoredSessionId);
        if (restoredFilter && restoredKnowledge) {
          const restoredContext = composeActiveKnowledgeContext(snapshot.profile, restoredFilter, restoredKnowledge);
          currentResearchContextRef.current = {
            filterId: restoredFilter.id,
            researchContextRevision: restoredContext.researchContextRevision,
          };
        }
      })
      .catch(() => setError("本地数据暂时无法读取，请检查浏览器是否允许 IndexedDB。"))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setTestMode(params.get("test") === "true");
      const initialPage = pageFromParam(params.get("page"));
      const initialLibraryView = libraryViewFromParam(params.get("libraryView"));
      if (initialPage) setPage(initialPage);
      if (initialLibraryView) setLibraryView(initialLibraryView);
      fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
        .then(async (request) => {
          if (!request.ok) throw new Error("auth unavailable");
          return (await request.json()) as { user: CurrentUser };
        })
        .then((value) => {
          setCurrentUser(value.user);
          setError("");
        })
        .catch(() => setCurrentUser(null));
      fetch("/api/connections", { cache: "no-store", credentials: "same-origin" })
        .then(async (request) => (await request.json()) as { connections?: Connection[] })
        .then((value) => setConnections(value.connections || []))
        .catch(() => setConnections([]));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshToday]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    fetch("/api/control/knowledge?summary=1", { cache: "no-store", credentials: "same-origin" })
      .then(async (request) => {
        if (!request.ok) {
          const body = await request.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "长期记忆暂时无法读取");
        }
        return (await request.json()) as { knowledge?: AccountKnowledgeItem[] };
      })
      .then((value) => {
        if (!cancelled) {
          setAccountKnowledge(value.knowledge || []);
          setAccountKnowledgeUserId(currentUser.id);
          setAccountKnowledgeError("");
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setAccountKnowledge([]);
          setAccountKnowledgeUserId(currentUser.id);
          setAccountKnowledgeError(requestError instanceof Error ? requestError.message : "长期记忆暂时无法读取");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const loadFollows = useCallback((userId: string) => {
    fetch("/api/control/follows", { cache: "no-store", credentials: "same-origin" })
      .then(async (request) => {
        if (!request.ok) {
          const body = await request.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "关注暂时无法读取");
        }
        return (await request.json()) as { follows?: AccountFollow[] };
      })
      .then((value) => {
        setAccountFollows(value.follows || []);
        setAccountFollowsUserId(userId);
        setFollowStatus("");
      })
      .catch((requestError) => {
        setAccountFollows([]);
        setAccountFollowsUserId(userId);
        setFollowStatus(requestError instanceof Error ? requestError.message : "关注暂时无法读取");
      });
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadFollows(currentUser.id);
  }, [currentUser, loadFollows]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("profile", profile);
    void setAlphaValue("knowledgeByFilterId", knowledgeByFilterId);
  }, [hydrated, knowledgeByFilterId, profile]);

  useEffect(() => {
    if (!hydrated) return;
    void setAlphaValue("lastRunByFilterId", lastRunByFilterId);
  }, [hydrated, lastRunByFilterId]);

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
  const todayPresentation = useMemo(() => selectTodayPresentation(signals, response?.queryPlan?.requestedFreshnessWindow), [signals, response]);
  const mustRead = todayPresentation.mustRead;
  const worthWatching = todayPresentation.worthWatching;
  const usableUpdates = todayPresentation.usableUpdates;
  const sortedInformation = useMemo(() => {
    const next = [...signals];
    return next.sort((left, right) => {
      if (sort === "reliability") return right.reliabilityScore - left.reliabilityScore;
      if (sort === "newest") {
        const rightTime = right.latestUpdateAt || right.eventOccurredAt || right.publishedAt;
        const leftTime = left.latestUpdateAt || left.eventOccurredAt || left.publishedAt;
        return (rightTime ? new Date(rightTime).getTime() : 0) - (leftTime ? new Date(leftTime).getTime() : 0);
      }
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
        const sourceTitle = (event.originalTitle || event.title).replace(/\s*\r?\n\s*/g, " ").trim();
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
      // Keep the detail mounted so the pending/save outcome remains visible.
    },
    [saveEvent, setKnowledge],
  );

  const createFilter = useCallback(
    (draft: OnboardingDraft) => {
      const now = new Date().toISOString();
      const {
        trackedEntities,
        currentJudgement,
        knownInformation,
        informationGaps,
        currentQuestions,
        identity,
        ...filterDraft
      } = draft;
      const resolvedIdentity = identity.trim();
      const nextProfile = filters.length === 0 && resolvedIdentity
        ? { defaultIdentity: resolvedIdentity }
        : profile;
      const filter: InformationFilter = {
        ...filterDraft,
        ...(resolvedIdentity && resolvedIdentity !== nextProfile.defaultIdentity
          ? { identityOverride: resolvedIdentity }
          : {}),
        focusAreas: normalizeStrings(filterDraft.focusAreas),
        customSources: normalizeStrings(filterDraft.customSources ?? []),
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const nextKnowledge: FilterKnowledgeState = {
        ...createEmptyFilterKnowledge(now),
        knownInformation: normalizeStrings(knownInformation),
        informationGaps: normalizeStrings(informationGaps),
        currentQuestions: normalizeStrings(currentQuestions),
        trackedEntities: normalizeStrings(trackedEntities),
        userJudgements: currentJudgement.trim() ? [currentJudgement.trim()] : [],
      };
      const nextContext = composeActiveKnowledgeContext(nextProfile, filter, nextKnowledge);
      setProfile(nextProfile);
      setFilters((current) => [...current, filter]);
      setKnowledgeByFilterId((current) => ({ ...current, [filter.id]: nextKnowledge }));
      setActiveFilterId(filter.id);
      setFilterBuilderOpen(false);
      setPage("today");
      currentResearchContextRef.current = {
        filterId: filter.id,
        researchContextRevision: nextContext.researchContextRevision,
      };
      void refreshToday(nextContext, filter);
    },
    [filters.length, profile, refreshToday],
  );

  const startResearch = useCallback(
    (draft: OnboardingDraft) => {
      if (!activeFilter || !activeKnowledge || !activeFilterId) {
        createFilter(draft);
        return;
      }
      const now = new Date().toISOString();
      const filterUpdate = updateFilterResearchConfig(activeFilter, activeKnowledge, {
        industry: draft.industry,
        focusAreas: draft.focusAreas,
        freshnessWindow: draft.freshnessWindow,
        sourceScope: draft.sourceScope,
        customSources: draft.customSources ?? [],
      }, now);
      const nextFilter: InformationFilter = {
        ...filterUpdate.filter,
        filterName: draft.filterName.trim() || filterUpdate.filter.filterName,
        updatedAt: now,
      };
      // Topic switch: when the user asks a different question on the same
      // page, the old question gap/entity echo must not leak into the new
      // research context (it produced residue inside an unrelated paper
      // request). Refinements of the same question still merge, preserving
      // accumulated context.
      const newQuestion = draft.currentQuestions[0]?.trim() ?? "";
      const currentQuestion = activeKnowledge.currentQuestions[0]?.trim() ?? "";
      const isTopicSwitch = Boolean(newQuestion) && newQuestion !== currentQuestion;
      const nextKnowledge = updateResearchContext(filterUpdate.knowledge, {
        currentQuestions: draft.currentQuestions,
        informationGaps: isTopicSwitch
          ? draft.informationGaps
          : unique([...activeKnowledge.informationGaps, ...draft.informationGaps]),
        trackedEntities: isTopicSwitch
          ? draft.trackedEntities
          : unique([...activeKnowledge.trackedEntities, ...draft.trackedEntities]),
      }, now);
      const nextContext = composeActiveKnowledgeContext(profile, nextFilter, nextKnowledge);
      setFilters((current) => current.map((filter) => filter.id === activeFilterId ? nextFilter : filter));
      setKnowledgeByFilterId((current) => ({ ...current, [activeFilterId]: nextKnowledge }));
      setPage("today");
      currentResearchContextRef.current = {
        filterId: activeFilterId,
        researchContextRevision: nextContext.researchContextRevision,
      };
      void refreshToday(nextContext, nextFilter);
    },
    [activeFilter, activeFilterId, activeKnowledge, createFilter, profile, refreshToday],
  );

  const switchFilter = useCallback(
    (filter: InformationFilter) => {
      const nextKnowledge = knowledgeByFilterId[filter.id] ?? createEmptyFilterKnowledge(new Date().toISOString());
      const nextContext = composeActiveKnowledgeContext(profile, filter, nextKnowledge);
      if (!knowledgeByFilterId[filter.id]) {
        setKnowledgeByFilterId((current) => ({ ...current, [filter.id]: nextKnowledge }));
      }
      setActiveFilterId(filter.id);
      setPage("today");
      currentResearchContextRef.current = {
        filterId: filter.id,
        researchContextRevision: nextContext.researchContextRevision,
      };
    },
    [knowledgeByFilterId, profile],
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

  const saveFollow = useCallback(() => {
    if (!currentUser || !followTopic.trim()) return;
    setFollowStatus("正在保存关注…");
    fetch("/api/control/follows", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: followTopic,
        intensity: followIntensity,
        delivery: followDelivery,
        filterId: activeFilterId ?? undefined,
      }),
    })
      .then(async (request) => {
        const body = await request.json().catch(() => null) as { follow?: AccountFollow; error?: string } | null;
        if (!request.ok || !body?.follow) throw new Error(body?.error ?? "关注保存失败");
        return body.follow;
      })
      .then((follow) => {
        setAccountFollows((current) => [follow, ...current.filter((item) => item.id !== follow.id)]);
        setAccountFollowsUserId(currentUser.id);
        setFollowTopic("");
        setFollowStatus("已开始关注。只有可能改变判断或行动的新证据才会提醒你。");
      })
      .catch((requestError) => setFollowStatus(requestError instanceof Error ? requestError.message : "关注保存失败"));
  }, [activeFilterId, currentUser, followDelivery, followIntensity, followTopic]);

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
    <main data-research-state={loading ? "loading" : error ? "error" : "ready"} className="signal-page mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
      <ResearchPromptPanel
        key={activeFilter?.id ?? "new"}
        initialQuery={activeContext?.currentQuestions[0] ?? ""}
        initialSources={activeFilter?.customSources ?? []}
        onSourcesSave={activeFilter ? saveSources : undefined}
        loading={loading}
        onSubmit={startResearch}
      />

      {response?.customSourceChecks?.length ? <section className="mt-5 rounded-2xl border border-[#e4e7eb] bg-white p-4">
        <h2 className="text-sm font-black">本次自选来源读取情况</h2>
        <p className="mt-1 text-xs text-[#727b87]">可读取不代表通过筛选，结果仍取决于相关性、时间和证据。</p>
        <ul className="mt-3 grid gap-2">{response.customSourceChecks.map((check, index) => <li key={`${check.url}-${index}`} className="text-xs leading-5"><p className="break-all font-bold">{check.url}</p><p>{check.reason}</p></li>)}</ul>
      </section> : null}

      <div className="mt-8 flex items-start justify-between gap-4">
        <div>
          <p className="signal-eyebrow">{todayDate}</p>
          <h1 className="signal-display mt-2 text-5xl sm:text-6xl">今日</h1>
          {contextNotice && (
            <p role="status" className="mt-3 max-w-xl text-sm leading-6 text-[#737c88]">{contextNotice.message}</p>
          )}
          {!loading && error && response && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-800">本次研究请求失败，以下是上次结果</p>
              <p className="mt-1 text-xs text-amber-600">{error}</p>
            </div>
          )}
          {!loading && !error && response && (() => {
            const copy = todayResultCopy(todayPresentation.items.length, response.filteringSummary?.retrievedCount ?? 0, response.filteringSummary?.displayedCount ?? response.signals.length);
            return <><p className="mt-3 text-[22px] font-semibold tracking-[-.045em] text-[#172033]">{copy.headline}</p><p className="mt-3 max-w-xl text-sm leading-6 text-[#737c88]">{copy.supporting}</p></>;
          })()}
        </div>
        <button
          onClick={() => activeFilter && activeContext && void refreshToday(activeContext, activeFilter)}
          disabled={loading}
          aria-label="重新过滤"
          className="signal-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full border disabled:opacity-40"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && (
          <section className="signal-empty mt-12 rounded-[28px] border p-8 text-center">
          <Clock3 className="mx-auto animate-pulse text-[#2359ff]" size={24} />
          <p className="mt-4 text-sm font-black">正在比较你的认知状态与新证据…</p>
          <p className="mt-2 text-xs text-[#7b8490]">先验证，后判断；没有可靠证据就不生成事实。</p>
        </section>
      )}
      {!loading && error && (
        <section className="mt-10 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-black">本次过滤未完成</p>
          <p className="mt-1 text-xs leading-5">{error}</p>
          {loggedIn
            ? <button onClick={() => activeFilter && activeContext && void refreshToday(activeContext, activeFilter)} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#2457ff] px-5 font-semibold text-white">重新尝试</button>
            : <a href="/control" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#2457ff] px-5 font-semibold text-white">登录 / 注册</a>}
        </section>
      )}
      {!loading && !error && response && <FilteringSummaryCard summary={response.filteringSummary} />}
      {!loading && !error && response && todayPresentation.kind === "caught_up" && <EmptyToday onRefresh={() => activeFilter && activeContext && void refreshToday(activeContext, activeFilter)} />}
      {!loading && mustRead.length > 0 && (
        <>
          <div className="mt-10 flex items-center justify-between gap-4">
            <p className="text-xs font-black uppercase tracking-[.16em] text-[#7d8691]">必读</p>
            <button onClick={() => setFocusOpen(true)} className="min-h-11 shrink-0 rounded-full bg-[#2359ff] px-4 text-xs font-black text-white">
              开始专注阅读 · 15 分钟
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
      {!loading && todayPresentation.kind === "worth_watching" && (
        <section className="mt-10">
          <p className="text-xs font-black uppercase tracking-[.16em] text-[#7d8691]">值得关注</p>
          <p className="mt-2 text-sm leading-6 text-[#737c88]">今天没有达到必读标准的重大变化，但有 {worthWatching.length} 个早期信号值得留意。</p>
          <div className="mt-5 grid gap-4">
            {worthWatching.map((event) => <EventCard key={event.id} event={event} onOpen={() => setSelected(event)} />)}
          </div>
        </section>
      )}
      {!loading && usableUpdates.length > 0 && (
        <section className="mt-10">
          <p className="text-xs font-black uppercase tracking-[.16em] text-[#7d8691]">今日可用更新</p>
          <p className="mt-2 text-sm leading-6 text-[#737c88]">这些更新来自官方或可信来源，与你的过滤器相关，但暂未达到必读级别。</p>
          <div className="mt-5 grid gap-4">
            {usableUpdates.map((event) => <EventCard key={event.id} event={event} onOpen={() => setSelected(event)} />)}
          </div>
        </section>
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
    <main className="signal-page mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="signal-eyebrow">筛选后的事件 · 不是信息流</p>
        <h1 className="signal-display mt-2 text-5xl">信息</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">只展示经过聚合、验证和认知比较后仍具有价值的事件。</p>

        {response && (
          <div className="mt-7 grid grid-cols-4 border-y border-[#e5e7e4] py-4 text-center">
            {[
              [response.overview.scanned, "已扫描"],
              [response.overview.events, "事件"],
              [response.overview.relevant, "相关"],
              [response.overview.mustKnow, "必读"],
            ].map(([value, label]) => (
              <div key={String(label)} className="min-w-0">
                <p className="text-lg font-black">{value}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[.06em] text-[#9299a2]">{label}</p>
              </div>
            ))}
          </div>
        )}
        {response && <CoverageBadge coverage={response.coverage} />}
        {response && <FilteringSummaryCard summary={response.filteringSummary} />}

        <label className="mt-6 block sm:hidden">
          <span className="text-xs font-black text-[#6f7884]">事件排序</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setVisibleCount(8); }} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">
            <option value="relevance">最相关</option><option value="reliability">最可靠</option><option value="newest">最新</option><option value="novelty">信息增量最高</option><option value="impact">最可能影响判断</option>
          </select>
        </label>
        <div className="mt-6 hidden flex-wrap gap-2 sm:flex">
          {([
            ["relevance", "最相关"],
            ["reliability", "最可靠"],
            ["newest", "最新"],
            ["novelty", "信息增量最高"],
            ["impact", "最可能影响判断"],
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

        {!response && !loading && <p className="mt-12 text-center text-sm text-[#7b8490]">请先在“今日”完成一次信息过滤。</p>}
        <Section eyebrow="当前相关" title="相关事件" events={relevant} />
        <Section eyebrow="命中你的信息缺口" title="缺口更新" events={gapUpdates} />
        <Section eyebrow="需要谨慎判断" title="冲突证据" events={conflicting} />
        <Section eyebrow="较早且尚未确认" title="早期信号" events={emerging} />

        {visibleCount < sortedInformation.length && (
          <button onClick={() => setVisibleCount((value) => value + 8)} className="mt-8 w-full rounded-xl border border-[#dfe3e7] py-3 text-xs font-black text-[#596473]">
            加载更多事件 · 还剩 {sortedInformation.length - visibleCount} 条
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
      <main className="signal-page mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="signal-eyebrow">个人认知记忆</p>
        <h1 className="signal-display mt-2 text-5xl">资料库</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">保存证据、跟踪事件，并维护你自己的问题与判断。</p>

        <div className="mt-7 grid grid-cols-4 rounded-2xl bg-[#eceeea] p-1">
          {([['following', '关注中'], ['saved', '已保存'], ['questions', '问题'], ['knowledge', '认知']] as const).map(([value, label]) => (
            <button key={value} onClick={() => setLibraryView(value)} className={`min-h-11 rounded-xl px-1 text-[11px] font-black ${libraryView === value ? "bg-white text-[#172033] shadow-sm" : "text-[#737c88]"}`}>{label}</button>
          ))}
        </div>

        {libraryView === "following" && <section className="mt-8 grid gap-5">
          {knowledge.trackedEntities.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">关注实体</p><div className="mt-3 flex flex-wrap gap-2">{knowledge.trackedEntities.map((entity) => <span key={entity} className="rounded-full border border-[#dfe3e7] bg-white px-4 py-2.5 text-sm font-bold">{entity}</span>)}</div></div>}
          {knowledge.trackedEvents.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">关注事件</p><div className="mt-3 grid gap-2">{knowledge.trackedEvents.map((event) => <div key={event} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm font-bold leading-6">{event}</div>)}</div></div>}
          {!knowledge.trackedEntities.length && !knowledge.trackedEvents.length && <p className="rounded-2xl bg-white p-6 text-sm text-[#7b8490]">你还没有关注任何实体或事件。</p>}
          <div className="flex gap-2"><input value={newEntity} onChange={(event) => setNewEntity(event.target.value)} placeholder="添加关注实体" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newEntity, "trackedEntities", setNewEntity)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">关注</button></div>
        </section>}

        {libraryView === "saved" && <section className="mt-8">
          <p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">已保存 · {library.length}</p>
          <div className="mt-3 grid gap-3">{library.map((entry) => <article key={entry.event.id} className="rounded-[22px] border border-[#e5e7e4] bg-white p-5"><p className="text-xs font-black text-[#2359ff]">{eventStatusLabels[entry.event.eventStatus]} · {entry.event.sourceCount} 个来源{entry.event.dataOrigin === "demo" ? " · 演示数据" : ""}</p><h3 className="mt-3 text-lg font-black leading-7">{entry.event.title}</h3><textarea value={notes[entry.event.id] ?? entry.notes} onChange={(eventObject) => { const note = eventObject.target.value; setNotes((current) => ({ ...current, [entry.event.id]: note })); setLibrary((current) => current.map((item) => item.event.id === entry.event.id ? { ...item, notes: note } : item)); }} placeholder="添加笔记…" className="mt-4 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-[#fafbf9] p-3 text-base leading-6 outline-none"/><button onClick={() => setSelected(entry.event)} className="mt-3 min-h-11 text-sm font-black text-[#2359ff]">查看证据 →</button></article>)}</div>
          {!library.length && <p className="mt-3 rounded-2xl bg-white p-6 text-sm text-[#7b8490]">在“今日”的信息详情中点击“保存”。</p>}
        </section>}

        {libraryView === "questions" && <section className="mt-8 grid gap-7">
          <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">未解决的问题</p><div className="mt-3 grid gap-2">{knowledge.currentQuestions.map((question) => <div key={question} className="flex items-start justify-between gap-3 rounded-2xl bg-white p-4 text-sm font-bold leading-6"><span>{question}</span><button onClick={() => setKnowledge((current) => ({ ...current, currentQuestions: current.currentQuestions.filter((item) => item !== question) }))} className="min-h-11 shrink-0 text-xs text-[#2359ff]">标记解决</button></div>)}</div><div className="mt-3 flex gap-2"><input value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="添加问题" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newQuestion, "currentQuestions", setNewQuestion)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">添加</button></div></div>
          {knowledge.informationGaps.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">信息缺口</p><div className="mt-3 grid gap-2">{knowledge.informationGaps.map((gap) => <div key={gap} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm font-bold leading-6">{gap}</div>)}</div></div>}
        </section>}

        {libraryView === "knowledge" && <section className="mt-8 grid gap-7">
          {loggedIn && <div>
            <p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">长期记忆</p>
            <div className="mt-3 grid gap-3">
              {accountKnowledgeForCurrentUser.map((item) => (
                <article key={item.id} className="rounded-[22px] border border-[#e5e7e4] bg-white p-5">
                  <p className="text-xs font-black text-[#2359ff]">
                    知识记录 · 修订 {item.revision.currentRevision ?? 1}
                  </p>
                  <h3 className="mt-3 text-base font-black leading-7">{item.currentValue}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#68727f]">
                    {accountKnowledgeVerificationLabel(item)}
                    {typeof item.provenance.reliabilityScore === "number" ? ` · 可靠性 ${item.provenance.reliabilityScore}` : ""}
                  </p>
                  {item.revision.revisionReason && <p className="mt-2 text-sm leading-6 text-[#68727f]">原因：{userFacingReason(item.revision.revisionReason)}</p>}
                  {item.supportingEvidence.length > 0 && (
                    <details className="mt-3 rounded-xl bg-[#f4f6f3] p-3 text-xs text-[#68727f]">
                      <summary className="min-h-8 cursor-pointer font-black">支撑证据（{item.supportingEvidence.length}）</summary>
                      <div className="mt-2 grid gap-2">
                        {item.supportingEvidence.map((evidence) => (
                          <a key={evidence.id} href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="leading-5 text-[#2359ff]">
                            {evidence.publisher || "来源"} · {verificationLabels[evidence.verificationStatus as VerificationStatus] || "未标注验证状态"}
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              ))}
              {!accountKnowledgeForCurrentUser.length && !accountKnowledgeError && <p className="rounded-2xl bg-white p-6 text-sm text-[#7b8490]">还没有服务器长期记忆。完成一次有证据支持的研究后，这里会出现已确认的知识。</p>}
              {accountKnowledgeError && <p className="rounded-2xl bg-white p-6 text-sm text-rose-700">长期记忆读取失败：{userFacingReason(accountKnowledgeError)}</p>}
            </div>
          </div>}
          {knowledge.knownInformation.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">已知信息</p><div className="mt-3 grid gap-2">{knowledge.knownInformation.map((item) => <div key={item} className="rounded-2xl bg-[#f1f3ef] p-4 text-sm leading-6">{item}</div>)}</div></div>}
          {knowledge.userJudgements.length > 0 && <div><p className="text-xs font-black uppercase tracking-[.12em] text-[#7b8490]">我的判断</p><div className="mt-3 grid gap-2">{knowledge.userJudgements.map((item) => <div key={item} className="rounded-2xl border border-[#e4e6e2] bg-white p-4 text-sm leading-6">{item}</div>)}</div></div>}
          <div className="flex gap-2"><input value={newJudgement} onChange={(event) => setNewJudgement(event.target.value)} placeholder="添加判断" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#dfe3e7] px-4 text-base"/><button onClick={() => addKnowledgeItem(newJudgement, "userJudgements", setNewJudgement)} className="min-h-12 rounded-xl bg-[#172033] px-4 text-sm font-black text-white">添加</button></div>
        </section>}
      </main>
    );
  };

  const listField = (
    field: KnowledgeListField,
    label: string,
    hint: string,
  ) => {
    const draftKey = `${activeFilterId ?? "inactive"}:${field}`;

    return (
      <label className="block">
        <span className="text-sm font-black">{label}</span>
        <span className="ml-2 text-xs text-[#939aa3]">{hint}</span>
        <textarea
          value={knowledgeDrafts[draftKey] ?? knowledge[field].join("\n")}
          onChange={(event) => {
            const value = event.target.value;
            setKnowledgeDrafts((current) => ({ ...current, [draftKey]: value }));
            setKnowledge((current) => ({ ...current, [field]: textToList(value) }));
          }}
          onBlur={(event) => {
            const normalized = textToList(event.target.value).join("\n");
            setKnowledgeDrafts((current) => ({ ...current, [draftKey]: normalized }));
          }}
          className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#dfe3e7] bg-white p-4 text-base leading-6 outline-none focus:border-[#8facff]"
        />
      </label>
    );
  };

  const renderSettings = () => {
    const sourceRows = [
      ["演示数据", "可用"],
      ["导入数据", "可用"],
      ["网页", "可用"],
      ["X", connections.find((item) => item.id === "x")?.state === "connected" ? "已连接" : "未配置"],
      ["小红书", connections.find((item) => item.id === "xiaohongshu")?.state === "connected" ? "已连接" : connections.find((item) => item.id === "xiaohongshu")?.state === "login_required" ? "需要登录" : "不可用"],
    ];
    const accordionClass = "signal-accordion";
    const summaryClass = "signal-accordion-summary";
    return (
      <main className="signal-page mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-6 sm:pt-12">
        <p className="signal-eyebrow">{loggedIn ? "已开启长期记忆" : "默认仅本地保存"}</p>
        <h1 className="signal-display mt-2 text-5xl">设置</h1>
        <p className="mt-3 text-sm leading-6 text-[#737c88]">管理你的过滤器、认知状态和测试数据。</p>
        {loggedIn ? (
          <button
            onClick={() => {
              setLibraryView("knowledge");
              navigate("library");
            }}
            className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#cfd8ff] bg-[#f4f6ff] text-sm font-black text-[#2359ff]"
          >
            查看长期记忆
          </button>
        ) : (
          <a href="/control" className="mt-5 flex min-h-12 items-center justify-center rounded-xl border border-[#cfd8ff] bg-[#f4f6ff] text-sm font-black text-[#2359ff]">登录 / 注册，开启长期记忆</a>
        )}

        <div className="mt-8 grid gap-3">
          <section className="rounded-[24px] border border-[#dfe3e7] bg-white/75 p-5">
            <p className="text-xs font-black uppercase tracking-[.14em] text-[#2359ff]">主动发现</p>
            <h2 className="mt-2 text-xl font-black tracking-[-.04em]">关注外部变化</h2>
            <p className="mt-2 text-sm leading-6 text-[#68727f]">不是有新内容就提醒；只有足以改变你的认知或行动时，才进入注意力层。</p>
            {loggedIn ? (
              <div className="mt-5 grid gap-4">
                <label>
                  <span className="text-sm font-black">关注主题</span>
                  <input value={followTopic} onChange={(event) => setFollowTopic(event.target.value)} placeholder="例如：AI 视频工具、AIGC 岗位、DeepSeek 产品变化" className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base outline-none focus:border-[#8facff]"/>
                </label>
                <label>
                  <span className="text-sm font-black">关注强度</span>
                  <select value={followIntensity} onChange={(event) => setFollowIntensity(event.target.value as FollowIntensity)} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">
                    <option value="major_only">只看重大变化</option>
                    <option value="worth_knowing">值得知道时告诉我</option>
                    <option value="more">尽量多关注</option>
                  </select>
                </label>
                <label>
                  <span className="text-sm font-black">推送方式</span>
                  <select value={followDelivery} onChange={(event) => setFollowDelivery(event.target.value as FollowDelivery)} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">
                    <option value="important">重要提醒</option>
                    <option value="daily">每日摘要</option>
                    <option value="weekly">每周摘要</option>
                  </select>
                </label>
                <button onClick={saveFollow} disabled={!followTopic.trim()} className="min-h-12 rounded-xl bg-[#2359ff] text-sm font-black text-white disabled:opacity-45">开始关注</button>
                {followStatus && <p className="text-sm leading-6 text-[#68727f]">{followStatus}</p>}
                {accountFollowsForCurrentUser.length > 0 && (
                  <div className="grid gap-3">
                    {accountFollowsForCurrentUser.map((follow) => (
                      <article key={follow.id} className="rounded-2xl border border-[#e5e7e4] bg-white p-4">
                        <h3 className="text-base font-black">{follow.topic}</h3>
                        <p className="mt-2 text-xs font-bold text-[#2359ff]">{follow.intensityLabel} · {follow.deliveryLabel}</p>
                        <p className="mt-2 text-sm leading-6 text-[#68727f]">{follow.reason}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-[#e5e8eb] bg-white p-4 text-sm leading-6 text-[#68727f]">
                <p>主动发现需要长期记忆和历史判断。登录后可以保存关注主题；未登录仍可临时检索，但不会写入长期记忆。</p>
                <a href="/control" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#172033] px-5 text-sm font-black text-white">登录 / 注册</a>
              </div>
            )}
          </section>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>我的资料</span><ChevronRight size={18}/></summary>
            <div className="mt-5 grid gap-5"><label><span className="text-sm font-black">身份</span><input value={knowledge.identity} onChange={(event) => setKnowledge((current) => ({ ...current, identity: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] px-4 text-base"/></label><label><span className="text-sm font-black">行业</span><input value={knowledge.industry} onChange={(event) => setKnowledge((current) => ({ ...current, industry: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] px-4 text-base"/></label></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>我的认知</span><ChevronRight size={18}/></summary>
            <div className="mt-5 grid gap-5">{listField("focusAreas", "关注领域", "每行一项")}{listField("currentQuestions", "当前问题", "尚未解决的问题")}{listField("knownInformation", "已知信息", "已确认的事实")}{listField("informationGaps", "信息缺口", "仍缺少的证据")}{listField("trackedEntities", "关注实体", "公司、产品、人物")}{listField("trackedEvents", "关注事件", "持续观察的事件")}{listField("userJudgements", "我的判断", "当前判断")}<label><span className="text-sm font-black">信息时效范围</span><select value={knowledge.freshnessWindow} onChange={(event) => setKnowledge((current) => ({ ...current, freshnessWindow: event.target.value as InformationFilter["freshnessWindow"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="24h">24 小时</option><option value="3d">3 天</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option></select></label><button onClick={() => { if (!activeFilter || !activeContext) return; setPage("today"); void refreshToday(activeContext, activeFilter); }} className="min-h-12 rounded-xl bg-[#2359ff] text-sm font-black text-white">保存并重新判断今日信息</button></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>我的过滤器</span><ChevronRight size={18}/></summary>
            <div className="mt-4 grid gap-2">{filters.map((filter) => <button key={filter.id} onClick={() => switchFilter(filter)} className={`flex min-h-14 items-center justify-between rounded-2xl border p-4 text-left ${filter.id === activeFilterId ? "border-[#9eb2ff] bg-[#f2f5ff]" : "border-[#e4e6e2] bg-white"}`}><span><strong className="block text-sm">{filter.filterName}</strong>{(filter.industry || filter.identityOverride || profile.defaultIdentity) && <span className="mt-1 block text-xs text-[#7b8490]">{filter.industry || filter.identityOverride || profile.defaultIdentity}</span>}</span><span className="text-xs font-black text-[#2359ff]">{filter.id === activeFilterId ? "使用中" : "使用"}</span></button>)}<button onClick={() => setFilterBuilderOpen(true)} className="min-h-12 rounded-xl border border-dashed border-[#bfc7d1] text-sm font-black text-[#596473]">＋ 新建过滤器</button></div>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>数据来源</span><ChevronRight size={18}/></summary>
            <div className="mt-4 grid gap-2">{sourceRows.map(([label, value]) => <div key={label} className="flex min-h-12 items-center justify-between border-b border-[#eceeea] text-sm last:border-0"><strong>{label}</strong><span className={value === "可用" || value === "已连接" ? "font-bold text-emerald-700" : "text-[#7b8490]"}>{value}</span></div>)}</div>
            {response && <CoverageBadge coverage={response.coverage}/>}<details className="mt-4 rounded-xl bg-[#f4f6f3] p-4 text-sm"><summary className="min-h-11 cursor-pointer font-black">高级设置</summary><p className="mt-2 leading-6 text-[#68727f]">真实数据源的连接参数只由运行环境提供。普通测试不需要配置任何凭证。</p></details>
          </details>

          <details className={accordionClass}>
            <summary className={summaryClass}><span>我的数据</span><ChevronRight size={18}/></summary>
            <p className="mt-4 text-sm leading-6 text-[#68727f]">{loggedIn ? "登录后长期 Knowledge 与 RAG Memory 由服务器账户隔离保存；本机仍保留界面草稿和反馈。" : "过滤器、认知状态、资料库、笔记与反馈只保存在当前浏览器。"}</p>{experienceFeedback.length ? <a href={feedbackExportHref} download={`signal-map-feedback-${sessionId.slice(0, 8) || "alpha"}.json`} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black">导出反馈 JSON</a> : <span className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black opacity-40">导出反馈 JSON</span>}<button onClick={() => { if (!window.confirm("清除当前设备上的全部 Signal Map Alpha 数据？")) return; void clearAlphaData().then(() => { setFilters([]); setActiveFilterId(null); setProfile(defaultProfile); setKnowledgeByFilterId({}); setLastRunByFilterId({}); setLibrary([]); setNotes({}); setFeedbackRecords([]); setExperienceFeedback([]); setPage("today"); }); }} className="mt-2 min-h-12 w-full rounded-xl text-sm font-black text-rose-700">清除本地测试数据</button>
          </details>
        </div>

        <details className="mt-6 rounded-[22px] border border-[#cfd8ff] bg-[#f4f6ff] p-5">
          <summary className={summaryClass}><span>反馈本次体验</span><ChevronRight size={18}/></summary>
          <div className="mt-5 grid gap-5">
            <label><span className="text-sm font-black">1. “今日”里有几条真的值得你看？</span><select value={feedbackDraft.worthwhileCount} onChange={(event) => setFeedbackDraft((current) => ({ ...current, worthwhileCount: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">{[0,1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span className="text-sm font-black">2. 有没有你本来就知道的信息？</span><select value={feedbackDraft.alreadyKnown} onChange={(event) => setFeedbackDraft((current) => ({ ...current, alreadyKnown: event.target.value as "yes" | "no" }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="yes">有</option><option value="no">没有</option></select></label>
            <label><span className="text-sm font-black">3. 你信任这些信息吗？</span><select value={feedbackDraft.trustScore} onChange={(event) => setFeedbackDraft((current) => ({ ...current, trustScore: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
            <label><span className="text-sm font-black">4. 系统漏掉了什么重要信息？</span><textarea value={feedbackDraft.missedInformation} onChange={(event) => setFeedbackDraft((current) => ({ ...current, missedInformation: event.target.value }))} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-white p-4 text-base"/></label>
            <label><span className="text-sm font-black">5. 如果每天只给这些，你愿意继续用吗？</span><select value={feedbackDraft.continueUsing} onChange={(event) => setFeedbackDraft((current) => ({ ...current, continueUsing: event.target.value as "yes" | "maybe" | "no" }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#dfe3e7] bg-white px-4 text-base"><option value="yes">愿意</option><option value="maybe">可能愿意</option><option value="no">不愿意</option></select></label>
            <label><span className="text-sm font-black">6. 最大的问题是什么？</span><textarea value={feedbackDraft.biggestProblem} onChange={(event) => setFeedbackDraft((current) => ({ ...current, biggestProblem: event.target.value }))} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#dfe3e7] bg-white p-4 text-base"/></label>
            <button onClick={submitExperienceFeedback} className="min-h-12 rounded-xl bg-[#2359ff] text-sm font-black text-white">{feedbackSaved ? "反馈已保存在本机" : "提交体验反馈"}</button>
          </div>
        </details>

        {testMode && <section className="mt-6 rounded-[22px] border border-[#e3e6e8] bg-white p-5"><p className="text-xs font-black uppercase tracking-[.12em] text-[#2359ff]">Alpha 测试模式</p><p className="mt-2 text-sm text-[#68727f]">测试会话 ID · {sessionId.slice(0, 8)}</p><div className="mt-4 grid gap-2"><button onClick={() => activeFilter && activeContext && void refreshToday(activeContext, activeFilter)} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">重置演示数据</button><button onClick={() => { setActiveFilterId(null); setLastRunByFilterId({}); void setAlphaValue("lastRunByFilterId", {}); }} className="min-h-12 rounded-xl border border-[#dfe3e7] text-sm font-black">重置过滤器</button>{experienceFeedback.length ? <a href={feedbackExportHref} download={`signal-map-feedback-${sessionId.slice(0, 8) || "alpha"}.json`} className="flex min-h-12 items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black">导出反馈</a> : <span className="flex min-h-12 items-center justify-center rounded-xl border border-[#dfe3e7] text-sm font-black opacity-40">导出反馈</span>}</div></section>}
      </main>
    );
  };

  const persistFeedback = useCallback(async (value: Feedback, event: ResearchSignal) => {
    if (!["already_knew", "not_useful", "changed_view", "monitor"].includes(value)) {
      return { ok: true, skipped: true };
    }
    try {
      const response = await fetch("/api/control/knowledge", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: value, sourceTitle: (event.originalTitle || event.title).replace(/\s*\r?\n\s*/g, " ").trim() }),
      });
      const body = await response.json().catch(() => null) as { scope?: string; error?: string; code?: string } | null;
      return {
        ok: response.ok,
        scope: body?.scope,
        errorCode: response.ok ? undefined : (body?.code ?? body?.error ?? `HTTP_${response.status}`),
      };
    } catch (error) {
      return { ok: false, errorCode: String(error).slice(0, 80) };
    }
  }, []);

  if (!hydrated) {
    return (
      <div className="signal-shell grid min-h-screen place-items-center text-[#172033]">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-[#2359ff]" size={20} />
          <p className="mt-3 text-xs font-black">正在恢复本地认知状态…</p>
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
    <div className="signal-shell text-[#172033]">
      <header className="signal-topbar sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => navigate("today")} className="flex items-center gap-3">
            <span className="signal-mark grid h-9 w-9 place-items-center rounded-lg text-[10px] font-bold text-white">SM</span>
            <span className="text-sm font-semibold tracking-[-.02em]">Signal Map</span>
          </button>
          <nav className="signal-desktop-nav hidden items-center gap-1 rounded-full border p-1 sm:flex">
            {navItems.map(({ id, label }) => (
              <button key={id} onClick={() => navigate(id)} className={`min-h-11 rounded-full px-4 text-xs font-black ${page === id ? "bg-[#172033] text-white" : "text-[#747d88]"}`}>
                {label}
              </button>
            ))}
          </nav>
          {loggedIn ? (
            <button
              onClick={() => {
                setLibraryView("knowledge");
                navigate("library");
              }}
              className="rounded-full border border-[#dfe3e7] px-3 py-2 text-[10px] font-black text-[#596473]"
            >
              长期记忆
            </button>
          ) : (
            <a href="/control" className="rounded-full border border-[#dfe3e7] px-3 py-2 text-[10px] font-black text-[#596473]">登录 / 注册</a>
          )}
        </div>
      </header>

      {page === "today" && renderToday()}
      {page === "information" && renderInformation()}
      {page === "library" && renderLibrary()}
      {page === "settings" && renderSettings()}

      <nav className="signal-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden">
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
          onFeedbackPersist={persistFeedback}
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
