import type { QueryPlan, TopicProfile, TopicRelevance, TopicRelevanceReason } from "./types.ts";

const GENERIC_TERMS = new Set([
  "a",
  "an",
  "and",
  "ai",
  "api",
  "agent",
  "agents",
  "artificial",
  "artificial intelligence",
  "change",
  "changes",
  "current",
  "for",
  "from",
  "general",
  "github",
  "information",
  "intelligence",
  "latest",
  "model",
  "models",
  "new",
  "news",
  "official",
  "primary",
  "recent",
  "research",
  "source",
  "technology",
  "the",
  "today",
  "update",
  "updates",
  "what",
  "with",
  "official documentation",
  "release notes",
]);

const PROFILE_GENERIC_TERMS = new Set([
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
]);

const PROFILE_DOMAIN_HINTS = /\b(video|audio|image|text|code|coding|software|developer|medical|health|finance|financial|education|legal|robotics|marketing|security)\b|视频|音频|图像|文本|代码|软件|医疗|健康|金融|教育|法律|机器人|营销|安全/iu;
const PROFILE_TASK_HINTS = /\b(edit|editing|rough cut|shot selection|multi[- ]?(?:asset|clip)|batch|generation|detection|classification|retrieval|summarization|translation|production)\b|剪辑|粗剪|镜头|素材|批量|生成|检测|分类|检索|摘要|翻译/iu;
const TASK_SPECIFIC_PATTERN = /\b(video editing|audio editing|rough cut|shot selection|multi[- ]?(?:asset|clip) understanding|batch processing|production|generation|detection|classification|retrieval|summarization|translation)\b|剪辑|粗剪|镜头选择|素材理解|批量处理|工作流|自动化|生成|检测|分类|检索|摘要|翻译/iu;
const QUESTION_GENERIC_TERMS = new Set([
  ...PROFILE_GENERIC_TERMS,
  "video",
  "editing",
]);
const PROFILE_ANCHOR_INSTRUCTION = /排除|告诉我|为什么|值得|优先|不要|避免|只看|有哪些|什么|过去|最近|当前|现在|exclude|tell|why|worth|prefer|avoid|only|what|recent|latest/iu;

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningful(term: string) {
  if (GENERIC_TERMS.has(term)) return false;
  if (/^[a-z0-9 ]+$/.test(term)) return term.replace(/\s/g, "").length >= 3;
  return term.length >= 2;
}

function topicTerms(plan: QueryPlan) {
  const values = [
    plan.originalNeed,
    ...plan.coreKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
    ...plan.entities,
    ...(plan.aliasesConsidered || []),
    ...plan.industryKeywords,
  ];
  const terms = new Set<string>();
  for (const value of values) {
    const normalized = normalize(value);
    if (meaningful(normalized)) terms.add(normalized);
    for (const token of normalized.split(" ")) {
      if (meaningful(token)) terms.add(token);
    }
  }
  return [...terms].sort((left, right) => right.length - left.length);
}

function matches(text: string, term: string) {
  if (!/[a-z0-9]/i.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").test(text);
}

function isTaskAnchor(term: string) {
  const normalized = normalize(term);
  return normalized.length > 2 && !PROFILE_GENERIC_TERMS.has(normalized) && TASK_SPECIFIC_PATTERN.test(normalized);
}

function isUsableProfileAnchor(term: string) {
  const raw = term.trim();
  const normalized = normalize(raw);
  return Boolean(normalized) && raw.length <= 80 &&
    !PROFILE_ANCHOR_INSTRUCTION.test(raw) &&
    !(normalized.split(" ").length > 8) &&
    !(raw.length > 24 && /[\u3400-\u9fff]/u.test(raw));
}

function domainParts(term: string) {
  const normalized = normalize(term);
  const parts = normalized.split(" ").filter((part) => /^(video|audio|image|text|code|software|developer|medical|health|finance|education|legal|robotics|marketing|security)$/i.test(part));
  return parts.length ? parts : [normalized];
}

export function isGenericQuestionTerm(term: string) {
  return QUESTION_GENERIC_TERMS.has(normalize(term));
}

function topicProfile(plan: QueryPlan): { profile: TopicProfile; explicit: boolean } {
  if (plan.topicProfile) {
    const genericTerms = new Set(plan.topicProfile.genericTerms.map(normalize));
    const cleanDomainInputs = plan.topicProfile.domainAnchors.filter(isUsableProfileAnchor);
    const cleanTaskInputs = plan.topicProfile.taskAnchors.filter(isUsableProfileAnchor);
    const domainAnchors = [...new Set(cleanDomainInputs
      .flatMap(domainParts)
      .filter((term) => term.length > 1 && !PROFILE_GENERIC_TERMS.has(term) && !genericTerms.has(term)))];
    const taskAnchors = [...new Set([...cleanDomainInputs, ...cleanTaskInputs]
      .map(normalize)
      .filter((term) => isTaskAnchor(term) && !genericTerms.has(term)))];
    const taskSet = new Set(taskAnchors);
    return {
      profile: {
        domainAnchors: domainAnchors.filter((term) => !taskSet.has(term)),
        taskAnchors,
        genericTerms: [...genericTerms],
      },
      explicit: true,
    };
  }
  const candidates = [
    ...(plan.topicAnchors || []),
    ...(plan.topicKeywords || []),
    ...plan.industryKeywords,
  ].map((term) => normalize(term)).filter(Boolean);
  const words = [...new Set(candidates.flatMap((term) => term.split(" ")))]
    .filter((term) => term.length > 1);
  return {
    profile: {
      domainAnchors: [...new Set([
        ...candidates.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
        ...words.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
      ])],
      taskAnchors: [...new Set([
        ...candidates.filter((term) => PROFILE_TASK_HINTS.test(term)),
        ...words.filter((term) => PROFILE_TASK_HINTS.test(term) && !PROFILE_GENERIC_TERMS.has(term)),
      ])],
      genericTerms: [...PROFILE_GENERIC_TERMS],
    },
    explicit: false,
  };
}

export function assessTopicRelevance(text: string, plan: QueryPlan): TopicRelevance {
  const normalizedText = normalize(text);
  const { profile, explicit } = topicProfile(plan);
  const matchedDomainAnchors = profile.domainAnchors.filter((term) => matches(normalizedText, normalize(term)));
  const matchedTaskAnchors = profile.taskAnchors.filter((term) => matches(normalizedText, normalize(term)));
  const matchedGenericTerms = profile.genericTerms
    .map(normalize)
    .filter((term) => term && matches(normalizedText, term));
  const matchedTerms = [...new Set([...matchedDomainAnchors, ...matchedTaskAnchors])];
  const matchedQueryTerms = topicTerms(plan).filter((term) => matches(normalizedText, term));
  if (explicit) {
    const hasDomainAnchors = profile.domainAnchors.length > 0;
    const hasTaskAnchors = profile.taskAnchors.length > 0;
    const domainMatch = matchedDomainAnchors.length > 0;
    const taskMatch = matchedTaskAnchors.length > 0;
    const distinctAnchorMatch = matchedDomainAnchors.some((domain) =>
      matchedTaskAnchors.some((task) => domain !== task),
    );
    const decision = hasDomainAnchors && hasTaskAnchors && domainMatch && taskMatch && distinctAnchorMatch
      ? "MATCH"
      : "TOPIC_MISMATCH";
    const reason: TopicRelevanceReason = !hasDomainAnchors
      ? "MISSING_DOMAIN_ANCHOR"
      : !hasTaskAnchors
        ? "MISSING_TASK_ANCHOR"
        : !domainMatch
          ? "MISSING_DOMAIN_ANCHOR"
          : !taskMatch
            ? "MISSING_TASK_ANCHOR"
            : !distinctAnchorMatch
              ? "NO_DOMAIN_OR_TASK_ANCHOR_MATCH"
              : "DOMAIN_AND_TASK_ANCHOR_MATCH";
    return {
      decision,
      reason,
      matchedTerms,
      matchedDomainAnchors,
      matchedTaskAnchors,
      matchedGenericTerms,
      matchedQueryTerms,
      relevanceGateApplied: true,
      relevanceGatePassed: decision === "MATCH",
      score: decision === "MATCH"
        ? Math.min(100, 70 + matchedTerms.length * 10)
        : 0,
    };
  }
  const terms = topicTerms(plan);
  const legacyMatchedTerms = terms.filter((term) => matches(normalizedText, term));
  const hasTopicTerms = terms.length > 0;
  const decision = !hasTopicTerms || legacyMatchedTerms.length > 0
    ? "MATCH"
    : "TOPIC_MISMATCH";
  return {
    decision,
    reason: !hasTopicTerms
      ? "NO_TOPIC_TERMS"
      : legacyMatchedTerms.length
        ? "LEGACY_QUERY_TERM_MATCH"
        : "NO_QUERY_TERM_MATCH",
    matchedTerms: legacyMatchedTerms,
    matchedDomainAnchors,
    matchedTaskAnchors,
    matchedGenericTerms,
    matchedQueryTerms: legacyMatchedTerms,
    relevanceGateApplied: false,
    relevanceGatePassed: decision === "MATCH",
    score: !hasTopicTerms ? 50 : legacyMatchedTerms.length ? Math.min(100, 60 + legacyMatchedTerms.length * 15) : 0,
  };
}
