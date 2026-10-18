import type {
  ResearchPolicyDecision,
  ResearchPolicyInput,
  ResearchStrategy,
  ResearchValue,
} from "./types.ts";

function valueOf(input: ResearchPolicyInput): ResearchValue {
  if (input.conflictState.conflictDetected || input.conflictState.preferredNextSourceType === "primary") return "high";
  if (input.informationGain > 0) return input.currentEvidence.signals.length > input.informationGain ? "medium" : "high";
  return "low";
}

function hasOnlySocial(input: ResearchPolicyInput) {
  return input.currentEvidence.signals.length > 0 && input.currentEvidence.signals.every(
    (signal) => signal.informationType === "SIGNAL" || signal.sourceType === "social",
  );
}

function hasHighReliableAgreement(input: ResearchPolicyInput) {
  const verified = input.currentEvidence.signals.filter((signal) => signal.verificationStatus === "verified");
  const sourceCount = new Set(verified.flatMap((signal) => signal.sources.map((source) => source.sourceUrl).concat(signal.sourceUrl))).size;
  return verified.length > 0 && sourceCount >= 2 && !input.conflictState.conflictDetected;
}

// A source that has not been searched yet can still produce evidence, so zero
// information gain alone does not justify stopping. But `not_searched` is not
// by itself an opportunity: the same execution state also covers providers that
// were never allowed to execute, that are not configured, or that the deadline
// already consumed. Treating those as remaining work is what produced the
// "retrieval failed but a fallback exists" escalation after every executable
// source had already been spent.
//
// A real remaining opportunity requires all of:
//   - the source was left unattempted for a reason that another attempt could fix
//     (no `blockedBy`), and
//   - it is not in the not_configured / unavailable / failed sets, and
//   - it has not already been searched with or without results.
// Callers may pass a partially populated coverage object, so every list is read
// defensively rather than assumed present.
function executableUntriedSources(input: ResearchPolicyInput) {
  const coverage = input.sourceCoverage;
  const spent = new Set([
    ...(coverage.usedProviders ?? []),
    ...(coverage.zeroResultProviders ?? []),
    ...(coverage.failedProviders ?? []),
    ...(coverage.notConfiguredProviders ?? []),
    ...(coverage.unavailableProviders ?? []),
  ]);
  const outcomes = coverage.outcomes ?? [];
  const unattempted = outcomes.filter((outcome) =>
    outcome?.execution === "not_searched" && !outcome.blockedBy && !spent.has(outcome.source));
  if (outcomes.length) return unattempted.map((outcome) => outcome.source);
  // Coverage without per-outcome detail cannot be filtered by reason, so fall
  // back to the name lists and subtract everything already known to be spent.
  return (coverage.notSearchedProviders ?? []).filter((source) => !spent.has(source));
}

function hasRetrievalFailure(input: ResearchPolicyInput) {
  return (input.sourceCoverage.failedProviders ?? []).length > 0;
}

export function chooseResearchStrategy(input: ResearchPolicyInput): ResearchPolicyDecision {
  const value = input.researchValue ?? valueOf(input);
  const stop = (reason: string): ResearchPolicyDecision => ({ strategy: "STOP", reason, value });

  if (input.round >= input.maxRounds) return stop("达到最大研究轮数");
  // "Evidence already satisfies the goal" is only true when the evidence layer
  // actually says so. Zero information gain because retrieval failed or because
  // nothing relevant came back is not satisfaction, and must never be reported
  // as such (observed: a Shopify run stopped here after PRIMARY failed and
  // GENERAL_WEB had never run).
  if (input.conflictState.decision === "STOP" && !input.conflictState.conflictDetected) {
    if (input.conflictState.sufficientEvidence) return stop("现有证据已满足当前研究目标");
    const untried = executableUntriedSources(input);
    // Only escalate when an unattempted source really can run. A failure is not
    // evidence that a fallback exists, and zero evidence is not satisfaction.
    if (untried.length) {
      return {
        strategy: "ESCALATE_SOURCE",
        reason: hasRetrievalFailure(input)
          ? `已执行的来源检索失败，仍有未执行且可用的来源：${untried.join("、")}`
          : `当前证据不足，仍有未执行且可用的来源：${untried.join("、")}`,
        value: "high",
      };
    }
    // Every source that could execute has been spent. Say which of the three
    // honest endings this is instead of implying the goal was met.
    if (hasRetrievalFailure(input)) {
      return stop(input.currentEvidence.signals.length
        ? "已执行的来源检索失败，其余可执行来源均已用尽"
        : "全部可执行来源均已尝试，其中存在检索失败，未取得可用证据");
    }
    return stop(input.currentEvidence.signals.length
      ? "已检索的来源均未返回相关证据，且没有其他可执行来源"
      : "已检索的来源未返回可用证据，且没有其他可执行来源");
  }
  if (input.conflictState.conflictDetected) {
    return { strategy: "VERIFY_CONFLICT", reason: "存在互斥 Claim，需要定向验证冲突", value: "high" };
  }
  if (hasOnlySocial(input)) {
    return { strategy: "ESCALATE_SOURCE", reason: "当前只有 Social/Signal 线索", value: "high" };
  }
  if (input.reliabilityState !== "high" && input.sourceCoverage.usedProviders.length > 0 && !input.sourceCoverage.usedProviders.some((source) => /official|github|primary/i.test(source))) {
    return { strategy: "ESCALATE_SOURCE", reason: "当前来源层级不足，优先寻找官方或 primary source", value: "high" };
  }
  if (input.relatedKnowledge.length > 0 && input.freshnessState === "stale") {
    return { strategy: "REFRESH", reason: "已有历史 Knowledge，但需要检查近期变化", value };
  }
  if (hasHighReliableAgreement(input)) return stop("高可靠、多来源证据一致");
  if (input.informationGain <= 0 || value === "low") return stop("连续一轮没有明显信息增益");
  if (input.currentEvidence.signals.length > 0 && input.currentEvidence.signals.every((signal) => signal.claims.length === 0)) {
    return { strategy: "BROADEN", reason: "当前结果缺少可验证 Claim，需要拓展来源与角度", value };
  }
  if (input.sourceCoverage.usedProviders.length <= 1) {
    return { strategy: "BROADEN", reason: "当前来源过于单一，需要独立来源", value };
  }
  return { strategy: "DEEPEN", reason: "研究方向正确，但仍需补充关键细节", value };
}

export const researchStrategyPriority: ResearchStrategy[] = [
  "VERIFY_CONFLICT",
  "ESCALATE_SOURCE",
  "REFRESH",
  "DEEPEN",
  "BROADEN",
  "STOP",
];
