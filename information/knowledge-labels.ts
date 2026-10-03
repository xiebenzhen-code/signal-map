import type { VerificationStatus } from "../research/types.ts";

const verificationLabels: Record<VerificationStatus, string> = {
  verified: "已验证",
  partially_verified: "部分验证",
  unverified: "未验证",
  conflicting: "存在冲突",
};

export function accountKnowledgeVerificationLabel(item: {
  type: string;
  provenance: { verificationStatus?: string };
}) {
  if (item.type === "JUDGEMENT") return "用户判断";
  const status = item.provenance.verificationStatus;
  return verificationLabels[status as VerificationStatus] || "未标注验证状态";
}
