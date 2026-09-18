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

export type ExecutionEntryType = "API" | "DEMO" | "REPOSITORY" | "WORKFLOW";

export type ExecutionEntry = {
  type: ExecutionEntryType;
  evidence: string;
  sourceUrl: string;
};

export type ActionabilityAssessment = {
  actionabilityStatus: ActionabilityStatus;
  informationGainStatus: InformationGainStatus;
  hasExecutableAction: boolean;
  executionEntry?: ExecutionEntry;
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

function matchEntry(input: ActionabilityInput): ExecutionEntry | undefined {
  const sourceUrl = input.sourceUrl;
  if (/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(sourceUrl)) {
    return {
      type: "REPOSITORY",
      evidence: sourceUrl,
      sourceUrl,
    };
  }
  if (/\/(?:api|api-docs|docs\/api)(?:\/|$)/i.test(sourceUrl)) {
    return {
      type: "API",
      evidence: sourceUrl,
      sourceUrl,
    };
  }
  if (/\/(?:demo|playground|space)(?:\/|$)/i.test(sourceUrl)) {
    return {
      type: "DEMO",
      evidence: sourceUrl,
      sourceUrl,
    };
  }
  if (/\/(?:workflow|template)(?:\/|$)/i.test(sourceUrl)) {
    return {
      type: "WORKFLOW",
      evidence: sourceUrl,
      sourceUrl,
    };
  }

  const text = signalText(input);
  const patterns: Array<[ExecutionEntryType, RegExp]> = [
    [
      "API",
      /(?:(?:public|open|available|documented)\s+)?(?:api|sdk)\b[\s\S]{0,80}\b(?:docs?|documentation|endpoint|quickstart|access|call)\b|\b(?:docs?|documentation|endpoint|quickstart|access|call)\b[\s\S]{0,80}\b(?:api|sdk)\b|公开\s*(?:api|sdk)|api\s*(?:文档|接口|调用|可用)/iu,
    ],
    [
      "DEMO",
      /\b(?:public|live|interactive)\s+demo\b|\btry\s+(?:it|the demo)\b|\b(?:demo|playground)\s+(?:available|link|入口)\b|公开(?:演示|demo)|在线(?:演示|试用)|试用入口/iu,
    ],
    [
      "REPOSITORY",
      /\b(?:source code|code repository)\s+(?:available|is available|link)\b|\bgithub\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|(?:源码|代码)\s*(?:仓库|开源|可用)/iu,
    ],
    [
      "WORKFLOW",
      /\b(?:public|executable|importable)\s+workflow\b|\bworkflow\s+(?:template|available|can be run|入口)\b|公开工作流|工作流(?:模板|可直接运行|入口)|导入工作流/iu,
    ],
  ];
  for (const [type, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { type, evidence: match[0], sourceUrl };
  }
  return undefined;
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

function executableAction(entry: ExecutionEntry | undefined) {
  if (entry?.type === "API") {
    return "打开公开 API/SDK 文档，用一个最小输入完成一次调用并记录结果。";
  }
  if (entry?.type === "DEMO") {
    return "打开证据明确指向的公开 Demo，运行一个最小样例并记录结果。";
  }
  if (entry?.type === "REPOSITORY") {
    return "打开证据明确指向的代码仓库，按 README 运行一个最小样例并记录结果。";
  }
  if (entry?.type === "WORKFLOW") {
    return "导入或运行证据明确指向的工作流模板，比较耗时、质量和人工修改量。";
  }
  return "阅读原文并评估适用范围；当前没有可验证的执行入口，不安排立即测试。";
}

export function assessSignalActionability(input: ActionabilityInput): ActionabilityAssessment {
  const gain = informationGainStatus(input);
  const executionEntry = matchEntry(input);
  const hasExecutableAction = Boolean(executionEntry);
  const isAcademicOnly =
    ACADEMIC_PATTERN.test(signalText(input)) &&
    !executionEntry &&
    input.informationType !== "SIGNAL";

  if (input.eventStatus === "BACKGROUND") {
    return {
      actionabilityStatus: "BACKGROUND",
      informationGainStatus: gain,
      hasExecutableAction,
      executionEntry,
      action: "仅作背景参考；除非出现新的公开能力或工作流变化，否则不安排测试。",
      reason: "事件已超出当前新鲜度范围",
    };
  }

  if (gain === "NO_INFORMATION_GAIN") {
    return {
      actionabilityStatus: "LIBRARY_ONLY",
      informationGainStatus: gain,
      hasExecutableAction,
      executionEntry,
      action: "与已有 Knowledge 高度重合，先不安排重复测试。",
      reason: "没有明确的信息增量",
    };
  }

  if (isAcademicOnly) {
    return {
      actionabilityStatus: "LIBRARY_ONLY",
      informationGainStatus: gain,
      hasExecutableAction,
      executionEntry,
      action: "保留为研究资料；阅读论文并评估方法适用范围，不安排立即测试。",
      reason: "只有学术研究价值，缺少公开可执行入口",
    };
  }

  const qualityGate =
    input.verificationStatus !== "unverified" &&
    input.verificationStatus !== "conflicting" &&
    input.relevanceScore >= 75 &&
    input.reliabilityScore >= 70 &&
    input.freshnessScore >= 65;

  if (executionEntry && qualityGate) {
    return {
      actionabilityStatus: "TEST_NOW",
      informationGainStatus: gain,
      hasExecutableAction: true,
      executionEntry,
      action: executableAction(executionEntry),
      reason: "存在公开可执行入口，且已满足现有证据质量门槛",
    };
  }

  return {
    actionabilityStatus: "REVIEW_FIRST",
    informationGainStatus: gain,
    hasExecutableAction,
    executionEntry,
    action: executableAction(executionEntry),
    reason: executionEntry
      ? "存在潜在执行入口，但仍需先核对证据质量或适用范围"
      : "证据相关但没有明确的公开执行入口",
  };
}
