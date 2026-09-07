import type { ResearchResponse, ResearchSignal } from "../research/types.ts";
import type { EvidenceEvaluation, KnowledgeChange } from "./types.ts";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function relatedToKnowledge(signal: ResearchSignal, known: string[]) {
  const text = normalize(`${signal.originalTitle || signal.title} ${signal.originalSummary || signal.summary}`);
  return known.some((item) => {
    const normalized = normalize(item);
    return normalized.length > 8 && (text.includes(normalized) || normalized.includes(text));
  });
}

export function evaluateEvidence(response: ResearchResponse, round: number, maxRounds: number): EvidenceEvaluation {
  const signals = response.signals;
  const conflictSignals = signals.filter((signal) => signal.verificationStatus === "conflicting");
  const conflictDetected = conflictSignals.length > 0;
  const reliable = signals.filter((signal) => signal.verificationStatus === "verified");
  const socialOnly = signals.length > 0 && signals.every((signal) => signal.informationType === "SIGNAL" || signal.sourceType === "social");
  const informationGain = signals.filter((signal) => signal.knowledgeStatus !== "KNOWN" && signal.noveltyScore >= 38).length;
  const sufficientEvidence = reliable.length > 0 && !conflictDetected;
  const shouldContinue = round < maxRounds && (!sufficientEvidence || conflictDetected || socialOnly) && informationGain > 0;
  let reason = sufficientEvidence ? "已有一致的高可靠证据" : "当前证据尚不足以确认结论";
  if (conflictDetected) reason = "检测到冲突 Claim，下一轮优先补充更可靠来源";
  if (socialOnly) reason = "当前只有 Social/Signal 线索，继续寻找官方或可信来源";
  if (!informationGain && round > 1) reason = "连续一轮没有明显新增信息";
  return {
    decision: shouldContinue ? "CONTINUE" : "STOP",
    sufficientEvidence,
    conflictDetected,
    conflictingClaims: conflictSignals.flatMap((signal) => signal.claims.map((claim) => claim.claimText)),
    preferredNextSourceType: conflictDetected || socialOnly ? "primary" : undefined,
    informationGain,
    reason: round >= maxRounds && shouldContinue ? "达到最大研究轮数" : reason,
  };
}

export function compareKnowledge(response: ResearchResponse, knownInformation: string, previousRevision: number): KnowledgeChange[] {
  const known = knownInformation.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean);
  return response.signals.map((signal) => {
    const knownMatch = relatedToKnowledge(signal, known);
    const isConflict = signal.verificationStatus === "conflicting";
    const isUpdate = signal.eventStatus === "UPDATED" || signal.knowledgeStatus === "UPDATED";
    const classification = isConflict ? "CONTRADICTS" : isUpdate ? "UPDATES" : knownMatch ? (signal.knowledgeStatus === "KNOWN" ? "DUPLICATE" : "CONFIRMS") : "NEW";
    return {
      signalId: signal.id,
      classification,
      supportingEvidenceIds: signal.claims.map((claim) => claim.sourceUrl),
      previousRevision,
      currentRevision: classification === "NEW" || classification === "UPDATES" || classification === "CONTRADICTS" ? previousRevision + 1 : previousRevision,
      reason: classification === "DUPLICATE" ? "与已有 Knowledge State 高度重合" : `基于 ${signal.verificationStatus} evidence 与事件状态判断`,
    };
  });
}
