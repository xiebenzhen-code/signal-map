const LABELS: Record<string, string> = {
  insufficientContent: "内容太少，无法验证",
  INSUFFICIENT_CONTENT: "内容太少，无法验证",
  lowReliability: "来源可信度不足",
  LOW_RELIABILITY: "来源可信度不足",
  insufficientVerification: "证据不足，尚未完成验证",
  INSUFFICIENT_VERIFICATION: "证据不足，尚未完成验证",
  unresolvedConflict: "来源之间仍有冲突",
  UNRESOLVED_CONFLICT: "来源之间仍有冲突",
  noInformationGain: "暂未发现明显新增信息",
  NO_INFORMATION_GAIN: "暂未发现明显新增信息",
  INTERPRETATION: "观点/解读（非事实）",
  FACT: "已由证据支持的事实",
  SIGNAL: "早期信号",
  EARLY_SIGNAL: "早期信号",
  TREND: "趋势信号",
  NOISE: "低价值噪声",
  verified: "已验证",
  partially_verified: "部分验证",
  unverified: "未验证",
  conflicting: "证据冲突",
  NEW: "新信息",
  UPDATED: "有更新",
  FOLLOW_UP: "后续信息",
  BACKGROUND: "背景资料",
  VALID: "内容足够验证",
  stale: "时间较旧",
  duplicate: "与已有信息重复",
  background: "仅作背景参考",
  BACKGROUND_ONLY: "仅作背景参考",
  lowNovelty: "新增信息有限",
  lowActionability: "暂时不影响行动",
};

export function userFacingLabel(value: unknown, fallback = "暂未满足展示条件") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return LABELS[value] ?? fallback;
}

export function userFacingReason(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "暂未满足展示条件";
  if (LABELS[value]) return LABELS[value];
  // Do not surface internal enum/code-shaped values in normal views.
  if (/^[A-Z][A-Z0-9_]+$/.test(value) || /^[a-z][A-Za-z0-9]+$/.test(value)) {
    return "暂未满足展示条件";
  }
  return value;
}

export function signalTypeLabel(value: unknown) {
  return userFacingLabel(value, "信息");
}

export function verificationStatusLabel(value: unknown) {
  return LABELS[value as string] ?? "验证状态未知";
}

export function goalStatusLabel(value: unknown) {
  const labels: Record<string, string> = { active: "进行中", waiting: "等待条件", blocked: "暂时受阻", completed: "已完成", abandoned: "已放弃" };
  return labels[value as string] ?? "状态未知";
}

export function resumeConditionLabel(value: unknown) {
  const labels: Record<string, string> = { TIME: "等待指定时间", POLL: "定期检查变化", EVENT: "等待相关事件", MANUAL: "等待手动继续" };
  return labels[value as string] ?? "等待恢复条件";
}
