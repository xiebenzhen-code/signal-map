import type { FreshnessWindow, SourceScope } from "./types.ts";

export type NaturalResearchOptions = {
  freshnessWindow?: FreshnessWindow;
  sourcePreference?: "auto" | "official" | "domestic" | "global";
  region?: string;
  excludeKeywords?: string;
  reliabilityPreference?: "balanced" | "reliable" | "strict";
};

export type NaturalResearchDraft = {
  filterName: string;
  identity: string;
  industry: string;
  focusAreas: string[];
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  freshnessWindow: FreshnessWindow;
  sourceScope: SourceScope;
  customSources: string[];
  trackedEntities: string[];
  currentJudgement: string;
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferredFreshness(query: string, selected?: FreshnessWindow): FreshnessWindow {
  if (selected) return selected;
  const days = query.match(/(?<!\d)(\d+)\s*(?:天|days?)/i)?.[1];
  if (days && ![1, 3, 7, 30, 90].includes(Number(days))) {
    throw new RangeError(`${days}天时间范围暂不支持，请选择1、3、7、30或90天。`);
  }
  if (/90\s*(?:天|days?)|三个月|3\s*个月/i.test(query)) return "90d";
  if (/24\s*小时|今天|今日|一天|1\s*天/i.test(query)) return "24h";
  if (/3\s*天|三天/i.test(query)) return "3d";
  if (/30\s*天|一个月|1\s*个月|最近一月/i.test(query)) return "30d";
  return "7d";
}

function inferredSourceScope(options: NaturalResearchOptions): SourceScope {
  if (options.sourcePreference === "domestic") return "domestic";
  if (options.sourcePreference === "global") return "global";
  if (/国内|中国|中文/i.test(options.region ?? "")) return "domestic";
  if (/全球|海外|英文|美国|欧洲/i.test(options.region ?? "")) return "global";
  return "hybrid";
}

// GitHub-hosted release/update questions are open-source tool research; the
// generic fallback ("个人关注方向") made source selection miss the OFFICIAL
// first hop that carries GitHub Releases. "github" is matched as a word so a
// phrase like "工作" inside "工作流" cannot trigger the job industry.
function inferredIndustry(query: string) {
  // JOB_SEARCH must reflect explicit employment intent; a bare substring like
  // "工作" inside "工作流" (workflow) must not classify a tool-research query
  // as a job search. Aligned with intent/classifier.ts JOB_SEARCH rule set.
  if (/岗位|职位|招聘|求职|投递|内推|job|jobs|career|hiring|opening/i.test(query)) return "AI 招聘与职业机会";
  if (/视频|AIGC|剪辑|影像/i.test(query)) return /\bAI\b|AIGC|人工智能/i.test(query) ? "AI 视频与创作者工具" : "视频与创作者工具";
  if (/\bgithub\b|版本|release|changelog|开源|Node\.js/i.test(query)) return /\bAI\b|人工智能/i.test(query) ? "开源开发与 AI 工具" : "开源开发与软件工具";
  if (/模型|agent|智能体|工具|AI/i.test(query)) return "人工智能与产品工具";
  return "个人关注方向";
}

function inferredFocusAreas(query: string) {
  const rules: Array<[RegExp, string]> = [
    [/AIGC/i, "AIGC"],
    [/视频|影像|剪辑/i, "AI 视频工具"],
    [/岗位|招聘|投递|求职|职位|job|career/i, "AI 岗位机会"],
    [/Hugging\s*Face/i, "Hugging Face"],
    [/Product\s*Hunt/i, "Product Hunt"],
    [/Agent|智能体/i, "AI Agent"],
    [/模型|大模型/i, "AI 模型"],
    [/工具|产品/i, "AI 产品"],
  ];
  const matched = rules.filter(([pattern]) => pattern.test(query)).map(([, label]) => label);
  return unique(matched.length ? matched : ["值得关注的新变化"]);
}

function inferredEntities(query: string) {
  // The catalog mirrors the officialUpdateTargets / companySourceRegistry
  // entities; ComfyUI was missing, so a plain homepage question produced an
  // empty trackedEntities payload and GitHub discovery never ran.
  const known = ["OpenAI", "Anthropic", "Google", "DeepSeek", "ComfyUI", "Hugging Face", "Product Hunt", "Runway", "Pika", "Kling", "Midjourney"];
  const named = query.match(/\b[A-Z][A-Za-z]*(?:[.-][A-Za-z]+)*(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
  const noise = /^(?:AI|AIGC|API|SDK|HTTP|Linux|Windows|GitHub|GitLab|What|How|Please|Past|Recent|The|I)$/;
  return unique([...known.filter((entity) => query.toLowerCase().includes(entity.toLowerCase())),
    ...named.filter((entity) => entity.length >= 3 && !noise.test(entity))]);
}

function shortName(query: string) {
  const normalized = query.replace(/[？?。.!！]/g, "").trim();
  return normalized.length > 22 ? `${normalized.slice(0, 22)}…` : normalized || "我的研究";
}

function optionConstraints(options: NaturalResearchOptions) {
  const constraints: string[] = [];
  if (options.sourcePreference === "official") constraints.push("优先查看官方、一手来源和可核验页面");
  if (options.region?.trim()) constraints.push(`优先关注地区：${options.region.trim()}`);
  if (options.excludeKeywords?.trim()) constraints.push(`排除明显包含这些关键词的结果：${options.excludeKeywords.trim()}`);
  if (options.reliabilityPreference === "reliable") constraints.push("优先保留来源较可靠的信息");
  if (options.reliabilityPreference === "strict") constraints.push("只把证据更充分的信息放到首页");
  return constraints;
}

export function inferNaturalResearchDraft(
  query: string,
  options: NaturalResearchOptions = {},
): NaturalResearchDraft {
  const trimmed = query.trim();
  const prompt = trimmed || "最近有什么重要变化？";
  const constraints = optionConstraints(options);
  return {
    filterName: shortName(prompt),
    identity: "关注这个方向的用户",
    industry: inferredIndustry(prompt),
    focusAreas: inferredFocusAreas(prompt),
    knownInformation: [],
    informationGaps: unique([`围绕“${prompt}”寻找有证据支持的新变化`, ...constraints]),
    currentQuestions: [prompt],
    freshnessWindow: inferredFreshness(prompt, options.freshnessWindow),
    sourceScope: inferredSourceScope(options),
    customSources: [],
    trackedEntities: inferredEntities(prompt),
    currentJudgement: "",
  };
}
