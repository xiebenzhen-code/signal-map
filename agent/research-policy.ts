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

export function chooseResearchStrategy(input: ResearchPolicyInput): ResearchPolicyDecision {
  const value = input.researchValue ?? valueOf(input);
  const stop = (reason: string): ResearchPolicyDecision => ({ strategy: "STOP", reason, value });

  if (input.round >= input.maxRounds) return stop("达到最大研究轮数");
  if (input.conflictState.decision === "STOP" && !input.conflictState.conflictDetected) {
    return stop("现有证据已满足当前研究目标");
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
