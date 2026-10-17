import { buildSignalCluster, sourceRoleForEvidence } from "./cluster.ts";
import type { FusionEvidence, SignalClassification, SignalFusionResult } from "./types.ts";

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function daySpan(evidence: FusionEvidence[]) {
  const times = evidence
    .map((item) => item.publishedAt ? new Date(item.publishedAt).getTime() : NaN)
    .filter(Number.isFinite);
  if (times.length < 2) return 0;
  return (Math.max(...times) - Math.min(...times)) / (24 * 60 * 60 * 1000);
}

export function fuseSignal(evidence: FusionEvidence[]): SignalFusionResult {
  const cluster = buildSignalCluster(evidence);
  const roles = evidence.map(sourceRoleForEvidence);
  const hasPrimary = roles.includes("PRIMARY");
  const socialOnly = evidence.every((item) => item.sourceType === "social" || item.sourceTier === "C");
  const avgReliability = average(evidence.map((item) => item.reliabilityScore ?? 0));
  const avgNovelty = average(evidence.map((item) => item.noveltyScore ?? 0));
  const duplicateRatio = evidence.length ? cluster.duplicateCount / evidence.length : 0;
  const sourceRoleDiversity = cluster.sourceRoles.length;
  const primaryEvidenceIds = evidence
    .filter((item) => sourceRoleForEvidence(item) === "PRIMARY")
    .map((item) => item.evidenceId);
  let signalType: SignalClassification;
  let reason: string;

  if (cluster.conflictState !== "none") {
    signalType = "CONFLICT";
    reason = "来源之间存在未解决冲突";
  } else if (cluster.independentSourceCount <= 1 && duplicateRatio > 0) {
    signalType = "NOISE";
    reason = "新 URL 没有带来新的独立来源";
  } else if (
    cluster.independentSourceCount >= 3 &&
    sourceRoleDiversity >= 2 &&
    daySpan(evidence) >= 1 &&
    avgReliability >= 55 &&
    avgNovelty >= 45
  ) {
    signalType = "TREND";
    reason = "多类独立来源在不同时间点重复出现";
  } else if (hasPrimary && avgReliability >= 70 && !socialOnly) {
    signalType = "FACT";
    reason = "包含 Primary/官方证据且无冲突";
  } else if (socialOnly) {
    signalType = "EARLY_SIGNAL";
    reason = "只有 Social/Tier C 线索，不能当作事实";
  } else {
    signalType = "INTERPRETATION";
    reason = "有外部证据但尚未形成 Primary 事实闭环";
  }

  return {
    cluster,
    signalType,
    independentSourceCount: cluster.independentSourceCount,
    duplicateRatio,
    sourceRoleDiversity,
    confirmationGain: cluster.independentSourceCount > 1 || hasPrimary,
    primaryEvidenceIds,
    reason,
  };
}
