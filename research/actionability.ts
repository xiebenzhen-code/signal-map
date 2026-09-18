import type { ResearchSignal } from "./types.ts";

export type ActionabilityStatus =
  | "TEST_NOW"
  | "REVIEW_FIRST"
  | "LIBRARY_ONLY"
  | "BACKGROUND";

export type InformationGainStatus =
  | "NEW_INFORMATION"
  | "UPDATED_INFORMATION"
  | "NO_INFORMATION_GAIN";

export type ActionabilityAssessment = {
  actionabilityStatus: ActionabilityStatus;
  informationGainStatus: InformationGainStatus;
  hasExecutableAction: boolean;
  action: string;
  reason: string;
};

type ActionabilityInput = Pick<
  ResearchSignal,
  | "title"
  | "summary"
  | "sourceUrl"
  | "tags"
  | "sourceType"
  | "sourceTier"
  | "eventStatus"
  | "knowledgeStatus"
  | "noveltyScore"
  | "relevanceScore"
  | "reliabilityScore"
  | "freshnessScore"
  | "verificationStatus"
  | "informationType"
> & {
  knownMatches?: string[];
  evidenceText?: string;
};

const EXECUTABLE_PATTERN =
  /\b(api|sdk|download|install|try|demo|playground|model card|space|github|workflow|batch|export|plugin|integration|release|launch|available|pricing|license|commercial|open source|quickstart|documentation)\b|接口|下载|安装|试用|演示|工作流|批量|导出|插件|集成|发布|上线|可用|定价|许可证|商用|开源|快速开始|文档/u;

const ACADEMIC_PATTERN =
  /\b(arxiv|paper|research|dataset|benchmark|method|we propose|experiment|academic|manuscript)\b|论文|研究|数据集|基准|方法|实验|手稿|学术/u;

function signalText(input: ActionabilityInput) {
  return [
    input.title,
    input.summary,
    input.tags.join(" "),
    input.sourceUrl,
    input.evidenceText || "",
  ].join(" ");
}

function informationGainStatus(input: ActionabilityInput): InformationGainStatus {
  if (
    input.knowledgeStatus === "KNOWN" ||
    input.noveltyScore < 38 ||
    (input.knownMatches?.length ?? 0) > 0
  ) {
    return "NO_INFORMATION_GAIN";
  }
  if (input.knowledgeStatus === "UPDATED") return "UPDATED_INFORMATION";
  return "NEW_INFORMATION";
}

function executableAction(input: ActionabilityInput, text: string) {
  if (/\b(api|sdk|接口)\b/i.test(text)) {
    return "打开公开 API/SDK 文档，用一个最小输入完成一次调用并记录结果。";
  }
  if (/\b(model card|space|playground|demo|github|quickstart)\b|模型卡|演示|快速开始|开源/iu.test(text)) {
    return "打开公开 Demo、Model Card 或代码入口，运行一个最小样例并记录结果。";
  }
  if (/workflow|batch|export|plugin|integration|commercial|工作流|批量|导出|插件|集成|商用/iu.test(text)) {
    return "用一组真实样例跑一次该工作流，比较耗时、质量和人工修改量。";
  }
  if (/release|launch|available|pricing|license|发布|上线|可用|定价|许可证/iu.test(text)) {
    return "打开官方入口完成一次最小试用，记录可用范围、限制和是否适合当前流程。";
  }
  return input.sourceType === "primary" && input.sourceTier !== "C"
    ? "先打开原文确认适用范围；若有公开入口，再用最小样例验证。"
    : "先核对证据与来源，再决定是否安排小规模验证。";
}

export function assessSignalActionability(input: ActionabilityInput): ActionabilityAssessment {
  const text = signalText(input);
  const gain = informationGainStatus(input);
  const hasExecutableAction = EXECUTABLE_PATTERN.test(text);
  const isAcademicOnly =
    ACADEMIC_PATTERN.test(text) &&
    !hasExecutableAction &&
    input.informationType !== "SIGNAL";

  if (input.eventStatus === "BACKGROUND") {
    return {
      actionabilityStatus: "BACKGROUND",
      informationGainStatus: gain,
      hasExecutableAction,
      action: "仅作背景参考；除非出现新的公开能力或工作流变化，否则不安排测试。",
      reason: "事件已超出当前新鲜度范围",
    };
  }

  if (gain === "NO_INFORMATION_GAIN") {
    return {
      actionabilityStatus: "LIBRARY_ONLY",
      informationGainStatus: gain,
      hasExecutableAction,
      action: "与已有 Knowledge 高度重合，先不安排重复测试。",
      reason: "没有明确的信息增量",
    };
  }

  if (isAcademicOnly) {
    return {
      actionabilityStatus: "LIBRARY_ONLY",
      informationGainStatus: gain,
      hasExecutableAction: false,
      action: "保留为研究资料；除非公开代码、模型或接口可用，否则不安排立即测试。",
      reason: "只有学术研究价值，缺少公开可执行入口",
    };
  }

  const qualityGate =
    input.verificationStatus !== "unverified" &&
    input.verificationStatus !== "conflicting" &&
    input.relevanceScore >= 75 &&
    input.reliabilityScore >= 70 &&
    input.freshnessScore >= 65;

  if (hasExecutableAction && qualityGate) {
    return {
      actionabilityStatus: "TEST_NOW",
      informationGainStatus: gain,
      hasExecutableAction: true,
      action: executableAction(input, text),
      reason: "存在公开可执行入口，且已满足现有证据质量门槛",
    };
  }

  return {
    actionabilityStatus: "REVIEW_FIRST",
    informationGainStatus: gain,
    hasExecutableAction,
    action: executableAction(input, text),
    reason: hasExecutableAction
      ? "存在潜在执行入口，但仍需先核对证据质量或适用范围"
      : "证据相关但没有明确的公开执行入口",
  };
}
