import type { QueryPlan, ResearchInput, TopicProfile } from "./types";
import { deduplicateQueries, resolveResearchEntities } from "./entity-resolution.ts";

const expansions: Array<{
  test: RegExp;
  english: string[];
  synonyms: string[];
}> = [
  {
    test: /IPO|上市/i,
    english: ["technology IPO", "IPO prospectus", "SEC S-1"],
    synonyms: ["首次公开募股", "招股书", "上市申请"],
  },
  {
    test: /募资|募集资金|融资/i,
    english: ["IPO proceeds", "use of proceeds", "offering proceeds"],
    synonyms: ["资金用途", "融资规模", "募集用途"],
  },
  {
    test: /纳指|纳斯达克|Nasdaq/i,
    english: ["Nasdaq", "Nasdaq technology IPO"],
    synonyms: ["NASDAQ", "美国科技股市场"],
  },
  {
    test: /科技股|科技公司/i,
    english: ["technology stocks", "technology company filing"],
    synonyms: ["科技企业", "技术公司"],
  },
  {
    test: /财报|业绩|营收/i,
    english: ["earnings report", "annual report", "quarterly results"],
    synonyms: ["年度报告", "季度业绩", "经营数据"],
  },
  {
    test: /AI|人工智能|大模型|模型/i,
    english: ["artificial intelligence", "foundation model", "model release"],
    synonyms: ["生成式 AI", "基础模型", "模型更新"],
  },
  {
    test: /Codex/i,
    english: ["OpenAI Codex", "Codex release notes", "Codex documentation"],
    synonyms: ["AI coding agent", "编程智能体"],
  },
  {
    test: /小红书|RedNote/i,
    english: ["Xiaohongshu", "RedNote"],
    synonyms: ["小红书平台", "RED"],
  },
];

function unique(values: string[], limit = 24) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(
    0,
    limit,
  );
}

function tokens(value: string) {
  return value
    .split(/[,，、；;：:\n]|\s{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

const topicNoise = new Set([
  "a", "an", "and", "are", "be", "can", "change", "changes", "do", "does",
  "for", "from", "how", "is", "it", "latest", "new", "news", "official",
  "please", "recent", "research", "the", "this", "today", "update", "updates",
  "artificial", "intelligence", "foundation", "model", "release",
  "what", "when", "where", "which", "who", "why", "with", "domain", "field",
]);

const topicAnchorRules: Array<{ anchor: string; patterns: RegExp[] }> = [
  {
    anchor: "AI video editing",
    patterns: [
      /AI\s*(?:assisted|辅助)?\s*(?:video\s*)?editing/i,
      /AI\s*辅助视频剪辑/u,
      /AI\s*视频剪辑/u,
      /视频剪辑/u,
      /video editing/i,
    ],
  },
  {
    anchor: "automated rough cut",
    patterns: [/自动粗剪/u, /automatic(?:ally)?\s+rough\s+cut/i, /rough\s+cut/i],
  },
  {
    anchor: "multi-asset understanding",
    patterns: [
      /多素材理解/u,
      /multi[-\s]?asset understanding/i,
      /multi[-\s]?clip understanding/i,
    ],
  },
  {
    anchor: "shot selection",
    patterns: [/镜头选择/u, /shot selection/i],
  },
  {
    anchor: "batch processing",
    patterns: [/批量处理/u, /batch processing/i],
  },
  {
    anchor: "commercial workflow",
    patterns: [/可商用工作流/u, /commercial workflow/i, /production workflow/i],
  },
];

function stripInstructionClauses(value: string) {
  return value
    .replace(/(?:排除|不要|避免|只看|优先|exclude|avoid|prefer|only consider)[^，,。；;.!！？?\n]*/giu, " ")
    .replace(/(?:告诉我|为什么值得关注|值得我测试|为什么重要|why it matters|worth testing)[^，,。；;.!！？?\n]*/giu, " ")
    .replace(/(?:重点关注|重点是|focus on|prioritize)\s*/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicAnchorsFor(input: ResearchInput) {
  const source = stripInstructionClauses([
    input.industry,
    input.focusAreas,
    input.currentQuestions,
    input.informationGaps,
    input.trackedEntities,
    input.trackedEvents,
  ].filter(Boolean).join("；"));
  return topicAnchorRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(source)))
    .map((rule) => rule.anchor);
}

function englishPhrases(value: string) {
  return [...stripInstructionClauses(value).matchAll(/\b[A-Za-z][A-Za-z0-9+.#-]*(?:\s+[A-Za-z][A-Za-z0-9+.#-]*){1,5}\b/g)]
    .map((match) => match[0].trim())
    .filter((phrase) =>
      phrase.split(/\s+/).some((word) => !topicNoise.has(word.toLocaleLowerCase())),
    );
}

function isTopicPhrase(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 3 ||
    normalized.length > 80 ||
    (/[?？。！!]/.test(normalized) && normalized.length > 12) ||
    (/[一-龥]/u.test(normalized) && normalized.length > 24 &&
      /有哪些|什么|值得|关注|过去|告诉我|为什么|现在/u.test(normalized))
  ) {
    return false;
  }
  if (/排除|告诉我|为什么|值得|优先|不要|避免|只看|exclude|tell|why|worth|prefer|avoid|only/iu.test(normalized)) {
    return false;
  }
  return normalized.split(/\s+/).some((word) => {
    const token = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}+#.-]/gu, "");
    return token.length > 2 && !topicNoise.has(token);
  });
}

function topicKeywordsFor(input: ResearchInput, englishKeywords: string[], topicAnchors: string[]) {
  const sourceSegments = [
    input.industry,
    input.focusAreas,
    input.currentQuestions,
    input.informationGaps,
    input.trackedEntities,
    input.trackedEvents,
  ].flatMap((value) =>
    stripInstructionClauses(value || "")
      .split(/[，,、；;：:\n.!！？?]+/u)
      .map((segment) => segment.trim())
      .filter(Boolean),
  );
  return unique([
    ...topicAnchors,
    ...sourceSegments,
    ...englishPhrases(input.focusAreas),
    ...englishPhrases(input.currentQuestions),
    ...englishPhrases(input.informationGaps),
    ...englishKeywords.filter((keyword) => !topicNoise.has(keyword.toLocaleLowerCase())),
  ].filter((value) =>
    isTopicPhrase(value) &&
    !/(?:排除|告诉我|为什么|值得|优先|不要|避免|只看|有哪些|什么|过去|最近|当前|exclude|tell|why|worth|prefer|avoid|only|what|recent|latest)/iu.test(value),
  ), 16);
}

const genericProfileTerms = [
  "ai",
  "artificial intelligence",
  "model",
  "models",
  "multimodal",
  "multi modal",
  "observation",
  "observations",
  "workflow",
  "automation",
  "research",
  "paper",
  "dataset",
  "method",
  "system",
];

const genericProfileTermSet = new Set(genericProfileTerms);

const profileInstructionPattern = /排除|告诉我|为什么|值得|优先|不要|避免|只看|有哪些|什么|过去|最近|当前|现在|exclude|tell|why|worth|prefer|avoid|only|what|recent|latest/iu;

const domainProfileHints = /\b(video|audio|image|text|code|coding|software|developer|medical|health|finance|financial|education|legal|robotics|marketing|security)\b|视频|音频|图像|文本|代码|软件|医疗|健康|金融|教育|法律|机器人|营销|安全/iu;
const taskProfileHints = /\b(edit|editing|rough cut|shot selection|multi[- ]?(?:asset|clip)|batch|workflow|automation|generation|detection|classification|retrieval|summarization|translation|production)\b|剪辑|粗剪|镜头|素材|批量|工作流|自动化|生成|检测|分类|检索|摘要|翻译/iu;

function topicProfileFor(
  input: ResearchInput,
  topicAnchors: string[],
  topicKeywords: string[],
): TopicProfile | undefined {
  const candidates = unique([
    input.industry,
    ...topicAnchors,
    ...topicKeywords,
  ]).map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => value.length >= 3 && value.length <= 80 && !profileInstructionPattern.test(value));
  const words = unique(candidates.flatMap((value) => value.split(/\s+/u)))
    .filter((value) => value.length >= 2 && !genericProfileTermSet.has(value.toLocaleLowerCase()));
  const taskSpecific = (value: string) =>
    /\b(video editing|audio editing|rough cut|shot selection|multi[- ]?(?:asset|clip) understanding|batch processing|production|generation|detection|classification|retrieval|summarization|translation)\b|剪辑|粗剪|镜头选择|素材理解|批量处理|工作流|自动化|生成|检测|分类|检索|摘要|翻译/iu.test(value) &&
    !genericProfileTermSet.has(value.toLocaleLowerCase());
  const domainAnchors = unique([
    ...candidates.filter((value) => domainProfileHints.test(value)),
    ...words.filter((value) => domainProfileHints.test(value)),
  ]);
  const taskAnchors = unique([
    ...domainAnchors.filter((value) => taskSpecific(value)),
    ...candidates.filter((value) => taskProfileHints.test(value) && taskSpecific(value)),
    ...words.filter((value) => taskProfileHints.test(value) && taskSpecific(value)),
  ]);
  const taskSet = new Set(taskAnchors.map((value) => value.toLocaleLowerCase()));
  const filteredDomainAnchors = (domainAnchors.length ? domainAnchors : candidates.slice(0, 1))
    .filter((value) => !taskSet.has(value.toLocaleLowerCase()));
  if (!filteredDomainAnchors.length || !taskAnchors.length) return undefined;
  return {
    domainAnchors: filteredDomainAnchors,
    taskAnchors: taskAnchors.filter((value, index, values) =>
      values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index),
    genericTerms: genericProfileTerms,
  };
}

export function buildDiversifiedQueries(
  topicAnchors: string[] = [],
  topicKeywords: string[] = [],
  fallbackSubject = "",
  limit = 5,
) {
  const anchors = [...new Set([...topicAnchors, ...topicKeywords].map((value) => value.trim()).filter(Boolean))];
  const first = anchors[0] || fallbackSubject.trim();
  const second = anchors.slice(1, 3).join(" ") || first;
  const third = anchors.slice(3, 5).join(" ") || second;
  return [...new Set([
    `${first} product launch release`,
    `${second} workflow tool`,
    `${third} research model`,
    `${first} official documentation release notes`,
    `${second} implementation ${anchors[5] || "commercial workflow"}`,
  ].map((query) => query.trim()).filter(Boolean))].slice(0, limit);
}

const genericEntityWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "is",
  "it",
  "map",
  "please",
  "research",
  "signal",
  "the",
  "this",
  "use",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

function semanticNeed(input: ResearchInput) {
  return [
    input.industry,
    input.focusAreas,
    input.currentQuestions,
    input.informationGaps,
    input.trackedEntities,
    input.trackedEvents,
    input.freshnessWindow,
  ]
    .filter(Boolean)
    .join("；");
}

function entityText(input: ResearchInput) {
  return [
    input.focusAreas,
    input.currentQuestions,
    input.trackedEntities,
    input.trackedEvents,
  ]
    .filter(Boolean)
    .join("；");
}

function validEntityCandidate(value: string) {
  const normalized = value.trim();
  if (normalized.length < 2) return false;
  if (/^(AI|API|Agent|Model|Research|Open|New|Latest)$/i.test(normalized)) return false;
  if (genericEntityWords.has(normalized.toLocaleLowerCase())) return false;
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(normalized);
}

const changeKeywords = [
  "latest",
  "today",
  "update",
  "new",
  "release",
  "announcement",
  "release notes",
  "changelog",
  "GitHub",
  "new feature",
  "new limitation",
  "pricing",
  "API",
  "policy",
  "hiring",
  "this week",
];

function normalizeFreshnessWindow(value: string): QueryPlan["requestedFreshnessWindow"] {
  if (/24h|1d|24\s*小时/i.test(value)) return "24h";
  if (/3d|3\s*天/i.test(value)) return "3d";
  if (/30d|30\s*天|1\s*月/i.test(value)) return "30d";
  return "7d";
}

function knownEntitySubjects(value: string, entities: string[]) {
  return unique(
    entities.filter((entity) => value.toLowerCase().includes(entity.toLowerCase())),
    6,
  );
}

export function planQuery(input: ResearchInput): QueryPlan {
  const originalNeed = semanticNeed(input);
  const entityScope = entityText(input);
  const matched = expansions.filter((item) => item.test.test(originalNeed));
  const coreKeywords = unique([
    input.industry,
    ...tokens(input.focusAreas),
    ...tokens(input.currentQuestions),
    ...tokens(input.informationGaps),
    ...tokens(input.trackedEntities),
    ...tokens(input.trackedEvents),
  ], 10);
  const englishKeywords = unique(
    matched.flatMap((item) => item.english).concat(
      originalNeed.match(/\b[A-Za-z][A-Za-z0-9.-]{1,}\b/g) || [],
    ),
  );
  const topicAnchors = topicAnchorsFor(input);
  const topicKeywords = topicKeywordsFor(input, englishKeywords, topicAnchors);
  const topicProfile = topicProfileFor(input, topicAnchors, topicKeywords);
  const synonyms = unique(matched.flatMap((item) => item.synonyms));
  const entities = unique([
    ...tokens(input.trackedEntities),
    ...(entityScope.match(/\b[A-Z][A-Za-z0-9.-]{1,}\b/g) || []),
    ...(entityScope.match(/[“「『\"]([^”」』\"]{2,})[”」』\"]/g) || []).map(
      (item) => item.replace(/[“”「」『』\"]/g, ""),
    ),
  ]).filter(validEntityCandidate);
  const resolvedEntities = resolveResearchEntities({ entities, query: originalNeed });
  const aliasesConsidered = unique(resolvedEntities.flatMap((entity) => entity.aliasesConsidered));
  const knownSubjects = knownEntitySubjects(input.knownInformation, entities);
  const industryKeywords = unique([
    input.industry,
    ...(/IPO|上市|纳指|股票|投资|金融|证券/i.test(originalNeed)
      ? ["SEC filing", "Investor Relations", "Nasdaq", "NYSE", "prospectus"]
      : []),
    ...(/AI|人工智能|大模型|Codex|Agent/i.test(originalNeed)
      ? ["official documentation", "release notes", "research", "GitHub"]
      : []),
    ...(/医疗|医药|健康|临床/i.test(originalNeed)
      ? ["regulatory filing", "clinical guidance", "official announcement"]
      : []),
  ]);
  const knowledgeAwareQueries = unique([
    ...knownSubjects.flatMap((subject) => [
      `${subject} latest update`,
      `${subject} API`,
      `${subject} new feature`,
      `${subject} new limitation`,
      `${subject} pricing`,
      `${subject} policy update`,
      `${subject} copyright update`,
    ]),
  ]);
  const searchCombinations = deduplicateQueries([
    ...entities.map((entity) => `${entity} latest update`),
    ...knownSubjects.map((subject) => `${subject} API new feature new limitation pricing policy`),
    ...entities.flatMap((entity) => [
      `${entity} today announcement`,
      `${entity} release notes changelog`,
      `${entity} GitHub release this week`,
      `${entity} new feature new limitation pricing API policy hiring`,
    ]),
    ...knowledgeAwareQueries,
    ...entities.flatMap((entity) => [
      `${entity} Investor Relations`,
      `${entity} official announcement`,
      `${entity} latest update`,
    ]),
    ...buildDiversifiedQueries(topicAnchors, topicKeywords, input.industry, 5),
    ...englishKeywords.map((keyword) => `${keyword} latest update`),
    `${input.industry} 官方公告`,
    `${input.industry} 权威媒体`,
    ...coreKeywords.slice(0, 4).flatMap((keyword) =>
      englishKeywords.slice(0, 3).map((english) => `${keyword} ${english}`),
    ),
  ], resolvedEntities, 24);

  return {
    originalNeed,
    coreKeywords,
    topicAnchors,
    topicKeywords,
    topicProfile,
    englishKeywords,
    synonyms,
    entities,
    industryKeywords,
    changeKeywords,
    knowledgeAwareQueries,
    searchCombinations,
    retrievalWindows: ["24h", "3d", "7d", "30d"],
    requestedFreshnessWindow: normalizeFreshnessWindow(input.freshnessWindow),
    resolvedEntities,
    aliasesConsidered,
    queryBudget: 24,
    deduplicatedQueryCount: searchCombinations.length,
  };
}
