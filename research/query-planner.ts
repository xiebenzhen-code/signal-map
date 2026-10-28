import type { QueryPlan, ResearchInput, TopicProfile } from "./types";
import { deduplicateQueries, resolveResearchEntities } from "./entity-resolution.ts";

export type ExclusionTargets = {
  /** Brand/company/product targets: fully excluded from positive planning. */
  entities: string[];
  /** Content-type targets ("营销文章", "marketing articles"): recorded, never
   *  treated as an entity, and never allowed to remove a positive subject. */
  contentTypes: string[];
};

// A per-question exclusion wins over the standing tracked-entity profile.
const EXCLUSION_CLAUSE = /(?:排除|不包含|不包括|不要|避免|剔除|exclude|excluding|avoid)\s*([^，,。；;.!！？?\n]*)/giu;
const EXCLUSION_TAIL = /(其他|其它|等等|无关|之类|相关)/u;
const EXCLUSION_TAIL_HEAD = /^(其他|其它|等|等等|相关|无关|类型|任何)/u;
const BARE_CONTENT_NOUN = /^(产品|内容|文章|信息|新闻|来源|话题|主题)$/u;

const exclusionKey = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

function exclusionTargets(value: string): string[] {
  return value
    .split(/[、，,；;/]|和|与|及|或者?|\s+and\s+/iu)
    .map((target) => target.trim().replace(/^[的和与及或]+|[的和与及或]+$/gu, "").trim())
    .filter(Boolean);
}

/**
 * Parses per-question exclusion clauses ("排除 Shopify 及其他无关产品",
 * "exclude marketing articles"). Brand-like targets (contain latin letters or
 * digits) become excluded entities; CJK-only phrases become content-type
 * exclusions so "排除营销文章" never removes the positive subject and never
 * fabricates a negative entity. Quantifier tails ("及其他无关产品") are
 * dropped entirely. Known limitation: a CJK company name that is not present
 * in the latin-only company registry is classified as a content type.
 */
export function parseExclusions(text: string): ExclusionTargets {
  const entities: string[] = [];
  const contentTypes: string[] = [];
  for (const match of String(text ?? "").matchAll(EXCLUSION_CLAUSE)) {
    for (const target of exclusionTargets(match[1] ?? "")) {
      if (!target || target.length > 24) continue;
      if (EXCLUSION_TAIL_HEAD.test(target) || EXCLUSION_TAIL.test(target)) continue;
      if (BARE_CONTENT_NOUN.test(target)) continue;
      if (/[A-Za-z0-9]/.test(target)) entities.push(target);
      else contentTypes.push(target);
    }
  }
  return { entities: [...new Set(entities)], contentTypes: [...new Set(contentTypes)] };
}

function sameExcludedEntity(value: string, excluded: string[]) {
  const key = exclusionKey(value);
  return excluded.some((entity) => exclusionKey(entity) === key);
}

function mentionsExcludedEntity(value: string, excluded: string[]) {
  const normalized = ` ${String(value ?? "").toLocaleLowerCase()} `;
  return excluded.some((entity) => {
    const escaped = entity.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalized);
  });
}

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
  // Instruction fragments from homepage gap sentences must never become
  // standalone search keywords or queries.
  "supporting", "evidence", "backed", "around", "find", "following", "sentence",
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
  const source = stripInstructionClauses(retrievalTextFields(input).join("；"));
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
  if (/排除|告诉我|为什么|值得|优先|不要|避免|只看|围绕|寻找|证据支持|exclude|tell|why|worth|prefer|avoid|only/iu.test(normalized)) {
    return false;
  }
  return normalized.split(/\s+/).some((word) => {
    const token = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}+#.-]/gu, "");
    return token.length > 2 && !topicNoise.has(token);
  });
}

function topicKeywordsFor(input: ResearchInput, englishKeywords: string[], topicAnchors: string[]) {
  const sourceSegments = retrievalTextFields(input).flatMap((value) =>
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
    // 围绕/寻找/证据支持 fragments come from the homepage gap sentence template;
    // they are instructions, not topic concepts.
    !/(?:排除|告诉我|为什么|值得|优先|不要|避免|只看|有哪些|什么|过去|最近|当前|围绕|寻找|证据支持|exclude|tell|why|worth|prefer|avoid|only|what|recent|latest)/iu.test(value),
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
    searchTermSource(input.industry),
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

const sourcePlatformWords = new Set([
  // Platforms that host evidence are sources, not research subjects. Treating
  // them as entities produced nonsense queries ("GitHub Investor Relations") and
  // gated correct results behind entity matches containing "github".
  "github", "gitlab", "arxiv", "hugging face", "huggingface", "producthunt", "product hunt",
  "reddit", "stack overflow", "stackoverflow", "npm", "pypi", "google news",
]);

function validEntityCandidate(value: string) {
  const normalized = value.trim();
  if (normalized.length < 2) return false;
  if (sourcePlatformWords.has(normalized.toLocaleLowerCase())) return false;
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

export function normalizeFreshnessWindow(value: string): import("./types.ts").FreshnessResolution {
  const raw = value.trim().toLowerCase();
  const text = raw.replace(/^(?:过去|最近|近|past\s+|last\s+)\s*/i, "");
  const match = /^(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(h|hours?|小时|d|days?|天|w|weeks?|周|星期|months?|个月|月)$/i.exec(text);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const chineseNumber = (token: string): number => {
    if (digits[token]) return digits[token];
    const tens = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(token);
    return tens ? (tens[1] ? digits[tens[1]] : 1) * 10 + (tens[2] ? digits[tens[2]] : 0) : NaN;
  };
  const amount = match ? (/^\d/.test(match[1]) ? Number(match[1]) : chineseNumber(match[1])) : NaN;
  const unit = match?.[2] ?? "";
  const hours = /^(?:h|hours?|小时)$/.test(unit) ? 1
    : /^(?:w|weeks?|周|星期)$/.test(unit) ? 168
    : /^(?:months?|个月|月)$/.test(unit) ? 720 : 24;
  const requestedHours = amount * hours;
  const tiers = [[24, "24h"], [72, "3d"], [168, "7d"], [720, "30d"], [2160, "90d"]] as const;
  const tier = Number.isFinite(requestedHours) && requestedHours > 0
    ? tiers.find(([limit]) => requestedHours <= limit) : undefined;
  if (!tier) return {
    input: value, status: "UNRECOGNIZED", appliedWindow: "7d",
    notice: `未识别时间窗口“${value}”（仅支持至90天）；实际使用 7d。`,
  };
  const [limit, appliedWindow] = tier;
  const status = requestedHours === limit ? "EXACT" : "MAPPED";
  return {
    input: value, status, appliedWindow, requestedHours,
    ...(status === "MAPPED" ? { notice: `请求时间窗口“${value}”映射到可包含它的最小档位；实际使用 ${appliedWindow}。` } : {}),
  };
}

function knownEntitySubjects(value: string, entities: string[]) {
  return unique(
    entities.filter((entity) => value.toLowerCase().includes(entity.toLowerCase())),
    6,
  );
}

// Placeholder labels produced when the intent classifier finds no better
// category ("个人关注方向", "值得关注的新变化"). They describe the absence of a
// classification, not the user's subject, so injecting them into a real search
// query only adds noise — the observed Shopify queries literally contained
// "个人关注方向 product launch release" and some had lost the entity entirely.
// They stay available for display and source-profile selection, but never enter
// retrieval terms.
const genericFallbackLabels = new Set([
  "个人关注方向",
  "值得关注的新变化",
  "general research",
  "general interest",
]);

function searchTermSource(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return genericFallbackLabels.has(trimmed) ? "" : trimmed;
}

// Same placeholder filtering for the keyword/anchor inputs. These feed retrieval
// terms as well, so the generic label must be dropped here too — otherwise the
// placeholder reappears as a topic keyword (observed "个人关注方向 product
// launch release").
// "围绕…寻找有证据支持的新变化" is a template instruction, not a subject.
// stripInstructionClauses covers the imperative forms but not this framing, so
// core keywords reject these fragments explicitly.
const instructionFragmentPattern = /寻找有证据支持的新变化|^[”"」』]|[“「『"]$/;

function retrievalTextFields(input: ResearchInput) {
  return [input.industry, input.focusAreas, input.currentQuestions, input.informationGaps, input.trackedEntities, input.trackedEvents]
    .map((value) => searchTermSource(value))
    .filter(Boolean);
}

export function planQuery(input: ResearchInput): QueryPlan {
  const originalNeed = semanticNeed(input);
  const entityScope = entityText(input);
  const matched = expansions.filter((item) => item.test.test(originalNeed));
  const industryTerm = searchTermSource(input.industry);
  const exclusions = parseExclusions(originalNeed);
  const excludedEntities = exclusions.entities;
  // The entity-scope text keeps its exclusion clauses for display fields, but
  // entity/keyword extraction must never read an excluded brand as a subject.
  const entityScopeClean = stripInstructionClauses(entityScope);
  const originalNeedClean = stripInstructionClauses(originalNeed);
    // Instruction clauses ("围绕…寻找有证据支持的新变化") describe how to search,
  // not what to search for. They must not become retrieval keywords. Baseline
  // only avoided them by accident: the generic labels happened to fill the
  // leading slots of this capped list, so once those labels are no longer
  // emitted the fragments moved into range. Strip them explicitly instead of
  // relying on the incidental ordering.
  const coreKeywords = unique([
    industryTerm,
    ...retrievalTextFields(input)
      .filter((value) => !genericFallbackLabels.has(value))
      .flatMap((value) => tokens(stripInstructionClauses(value)))
      .filter((keyword) => !instructionFragmentPattern.test(keyword)),
  ], 10);
  const englishKeywords = unique(
    matched.flatMap((item) => item.english).concat(
      (originalNeedClean.match(/\b[A-Za-z][A-Za-z0-9.-]{1,}\b/g) || [])
        .filter((keyword) => !sameExcludedEntity(keyword, excludedEntities)),
    ),
  );
  const topicAnchors = topicAnchorsFor(input);
  const topicKeywords = topicKeywordsFor(input, englishKeywords, topicAnchors)
    .filter((keyword) => !sameExcludedEntity(keyword, excludedEntities));
  const topicProfile = topicProfileFor(input, topicAnchors, topicKeywords);
  const synonyms = unique(matched.flatMap((item) => item.synonyms));
  const entities = unique([
    ...tokens(input.trackedEntities),
    ...(entityScopeClean.match(/\b[A-Z][A-Za-z0-9.-]{1,}\b/g) || []),
    ...(entityScopeClean.match(/[“「『\"]([^”」』\"]{2,})[”」』\"]/g) || []).map(
      (item) => item.replace(/[“”「」『』\"]/g, ""),
    ),
  ])
    .filter(validEntityCandidate)
    // A per-question exclusion removes the entity even from trackedEntities.
    .filter((entity) => !sameExcludedEntity(entity, excludedEntities));
  const resolvedEntities = resolveResearchEntities({ entities, query: originalNeed });
  const aliasesConsidered = unique(resolvedEntities.flatMap((entity) => entity.aliasesConsidered));
  const knownSubjects = knownEntitySubjects(input.knownInformation, entities);
  const industryKeywords = unique([
    industryTerm,
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
    ...buildDiversifiedQueries(topicAnchors, topicKeywords, industryTerm, 5),
    ...englishKeywords.map((keyword) => `${keyword} latest update`),
    // A classified industry term adds a real retrieval angle. Without one, the
    // entity already anchors these queries, so emitting the bare placeholder
    // would only produce entity-free filler searches.
    ...(industryTerm ? [`${industryTerm} 官方公告`, `${industryTerm} 权威媒体`] : []),
    ...coreKeywords.slice(0, 4).flatMap((keyword) =>
      englishKeywords.slice(0, 3).map((english) => `${keyword} ${english}`),
    ),
  ].filter((query) => !mentionsExcludedEntity(query, excludedEntities)), resolvedEntities, 24);

  return {
    originalNeed,
    requestedQuestion: input.currentQuestions,
    coreKeywords: coreKeywords.filter((keyword) => !sameExcludedEntity(keyword, excludedEntities)),
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
    requestedFreshnessWindow: normalizeFreshnessWindow(input.freshnessWindow).appliedWindow,
    freshnessResolution: normalizeFreshnessWindow(input.freshnessWindow),
    resolvedEntities,
    aliasesConsidered,
    excludedEntities,
    excludedContentTypes: exclusions.contentTypes,
    queryBudget: 24,
    deduplicatedQueryCount: searchCombinations.length,
  };
}
