import { buildEvidenceSnippet } from "./snippet-builder.ts";
import type { PresentationInput, SignalPresentation } from "./types.ts";

function concise(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function fallbackHeadline(input: PresentationInput) {
  if (input.claim.quality === "VALID") return concise(input.claim.statement, 92);
  return concise(input.title, 92);
}

function why(input: PresentationInput) {
  const context = input.userContext;
  if (context?.questionMatches.length) return `这直接回应了你正在核对的“${context.questionMatches[0]}”。`;
  if (context?.gapMatches.length) return `这补充了你的信息缺口“${context.gapMatches[0]}”。`;
  if (context?.entityMatches.length) return `这是你正在跟踪的 ${context.entityMatches[0]} 的相关变化。`;
  return undefined;
}

function normalizedKey(value: string) {
  return value.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

const UNKNOWN_MARKER =
  /未知|未公布|未公开|待定|待确认|尚未确定|TBD|undecided|undisclosed|not (?:yet )?(?:announced|published|available|decided)|to be (?:determined|announced)/i;

// A condition counts as unknown when the evidence never mentions it, or when
// every mention is paired with an unknown marker nearby ("License: TBD" stays
// unknown; "MIT license" does not).
function conditionIsUnknown(evidenceText: string, topic: RegExp): boolean {
  const matches = [...evidenceText.matchAll(new RegExp(topic.source, "gi"))];
  if (matches.length === 0) return true;
  return matches.every((match) => {
    const start = Math.max(0, (match.index ?? 0) - 30);
    const window = evidenceText.slice(start, (match.index ?? 0) + 60);
    return UNKNOWN_MARKER.test(window);
  });
}

// Software-specific conditions are only presented for software-release
// questions; neutral announcements get neutral copy instead.
function unknownConditions(input: PresentationInput): string[] {
  if (!input.upgradeContext) return [];
  const text = input.cleaned.mainContent;
  const gaps: string[] = [];
  if (conditionIsUnknown(text, /licen[sc]e|许可|商用|commercial/)) gaps.push("商用许可");
  if (conditionIsUnknown(text, /价格|pricing|成本|费用|paid|free|免费/)) gaps.push("成本");
  if (conditionIsUnknown(text, /兼容|compat|硬件|gpu|vram|内存|memory|系统要求/)) gaps.push("硬件与兼容性");
  return gaps;
}

// A claim only counts as a change statement when it adds substance beyond the
// title — a version-title restatement carries no change detail.
function changeStatementOf(input: PresentationInput): string | undefined {
  if (input.claim.quality !== "VALID") return undefined;
  const statement = input.claim.statement.trim();
  if (!statement) return undefined;
  if (normalizedKey(statement) === normalizedKey(input.title)) return undefined;
  return concise(statement, 200);
}

export function mapSignalPresentation(input: PresentationInput): SignalPresentation {
  if (input.cleaned.quality !== "VALID" || input.claim.quality !== "VALID") {
    return {
      headline: fallbackHeadline(input),
      fact: "正文提取不足，无法生成可验证事实。",
      whyItMatters: "正文提取不足，无法给出具体变化与影响判断。",
      evidence: [],
      contentQuality: "INSUFFICIENT_CONTENT",
      failureReason: input.claim.failureReason || input.cleaned.failureReason || "INSUFFICIENT_CONTENT",
    };
  }
  const snippet = buildEvidenceSnippet(input.cleaned, input.claim);
  if (!snippet) {
    return {
      headline: fallbackHeadline(input),
      fact: "未找到能支撑该 claim 的有效证据片段。",
      whyItMatters: "证据片段不足以支撑该结论，无法给出具体变化与影响判断。",
      evidence: [],
      contentQuality: "INSUFFICIENT_CONTENT",
      failureReason: "SNIPPET_NOT_SUPPORTED",
    };
  }
  const isSignal = input.informationType === "SIGNAL";
  const fact = isSignal
    ? `这是早期信号，尚未充分确认：${concise(input.claim.statement, 180)}`
    : concise(input.claim.statement, 180);
  const changeStatement = changeStatementOf(input);
  const unknowns = unknownConditions(input);
  const neutralNote = "请核查原文确认适用范围与生效条件。";
  const unknownNote = unknowns.length
    ? `证据未说明${unknowns.join("、")}，升级价值需结合你的使用场景验证。`
    : "升级价值需结合你的使用场景验证。";
  const gapNote = input.upgradeContext
    ? "证据未包含超出标题的具体变化说明，升级价值未知；请查看发布原文确认。"
    : "证据未包含超出标题的具体变化说明，请查看原文确认。";
  return {
    headline: fallbackHeadline(input),
    oneLineSummary: input.informationType === "FACT" ? changeStatement || gapNote : undefined,
    fact,
    whyItMatters: changeStatement
      ? `该变化的具体内容：${changeStatement}。${input.upgradeContext ? unknownNote : neutralNote}`
      : input.informationType === "FACT"
        ? gapNote
        : why(input),
    changeStatement,
    evidence: [{
      sourceName: input.sourceName,
      sourceRole: input.sourceType === "social" ? "discovery" : "verification",
      snippet,
      publishedAt: input.publishedAt,
      url: input.sourceUrl,
    }],
    interpretation: input.informationType === "INTERPRETATION"
      ? "这是基于已提取证据的解释，不等同于已确认事实。"
      : undefined,
    contentQuality: "VALID",
  };
}
