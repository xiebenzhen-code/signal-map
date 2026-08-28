import type { QueryPlan, ResearchInput } from "./types";

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

export function planQuery(input: ResearchInput): QueryPlan {
  const originalNeed = [
    input.industry,
    input.identity,
    input.focusAreas,
    input.currentQuestions,
    input.informationGaps,
    input.trackedEntities,
    input.trackedEvents,
  ]
    .filter(Boolean)
    .join("；");
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
  const synonyms = unique(matched.flatMap((item) => item.synonyms));
  const entities = unique([
    ...tokens(input.trackedEntities),
    ...(originalNeed.match(/\b[A-Z][A-Za-z0-9.-]{1,}\b/g) || []),
    ...(originalNeed.match(/[“「『\"]([^”」』\"]{2,})[”」』\"]/g) || []).map(
      (item) => item.replace(/[“”「」『』\"]/g, ""),
    ),
  ]);
  const knownSubjects = tokens(input.knownInformation).slice(0, 4);
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
  const searchCombinations = unique([
    ...entities.flatMap((entity) => [
      `${entity} latest update`,
      `${entity} today announcement`,
      `${entity} release notes changelog`,
      `${entity} new feature limitation policy`,
    ]),
    ...knownSubjects.flatMap((subject) => [
      `${subject} latest update`,
      `${subject} API new feature restriction`,
    ]),
    ...englishKeywords.map((keyword) => `${keyword} latest update`),
    ...entities.flatMap((entity) => [
      `${entity} Investor Relations`,
      `${entity} official announcement`,
      `${entity} latest update`,
    ]),
    ...tokens(input.currentQuestions).slice(0, 3),
    `${input.industry} ${tokens(input.focusAreas).slice(0, 2).join(" ")}`,
    `${input.industry} 官方公告`,
    `${input.industry} 权威媒体`,
    ...coreKeywords.slice(0, 4).flatMap((keyword) =>
      englishKeywords.slice(0, 3).map((english) => `${keyword} ${english}`),
    ),
  ], 24);

  return {
    originalNeed,
    coreKeywords,
    englishKeywords,
    synonyms,
    entities,
    industryKeywords,
    searchCombinations,
    retrievalWindows: ["24h", "3d", "7d", "30d"],
  };
}
