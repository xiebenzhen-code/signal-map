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

export function mapSignalPresentation(input: PresentationInput): SignalPresentation {
  if (input.cleaned.quality !== "VALID" || input.claim.quality !== "VALID") {
    return {
      headline: fallbackHeadline(input),
      fact: "正文提取不足，无法生成可验证事实。",
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
      evidence: [],
      contentQuality: "INSUFFICIENT_CONTENT",
      failureReason: "SNIPPET_NOT_SUPPORTED",
    };
  }
  const isSignal = input.informationType === "SIGNAL";
  const fact = isSignal
    ? `这是早期信号，尚未充分确认：${concise(input.claim.statement, 180)}`
    : concise(input.claim.statement, 180);
  return {
    headline: fallbackHeadline(input),
    oneLineSummary: input.informationType === "FACT"
      ? `该结论由 ${input.sourceName} 的证据片段直接支撑。`
      : undefined,
    fact,
    whyItMatters: why(input),
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
