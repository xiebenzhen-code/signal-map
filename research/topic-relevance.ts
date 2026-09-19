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

function topicProfile(plan: QueryPlan): { profile: TopicProfile; explicit: boolean } {
  if (plan.topicProfile) {
    const genericTerms = new Set(plan.topicProfile.genericTerms.map(normalize));
    const expand = (terms: string[]) => [...new Set(terms
      .flatMap((term) => {
        const normalized = normalize(term);
        return [normalized, ...normalized.split(" ")];
      })
      .filter((term) => term.length > 1 && !PROFILE_GENERIC_TERMS.has(term) && !genericTerms.has(term)))];
    return {
      profile: {
        domainAnchors: expand(plan.topicProfile.domainAnchors),
        taskAnchors: expand(plan.topicProfile.taskAnchors),
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
    const queryTermMatch = matchedQueryTerms.length > 0;
    const decision = hasDomainAnchors && hasTaskAnchors
      ? domainMatch && taskMatch ? "MATCH" : "TOPIC_MISMATCH"
      : hasDomainAnchors
        ? domainMatch || queryTermMatch ? "MATCH" : "TOPIC_MISMATCH"
        : hasTaskAnchors
          ? taskMatch || queryTermMatch ? "MATCH" : "TOPIC_MISMATCH"
          : queryTermMatch ? "MATCH" : "TOPIC_MISMATCH";
    const reason: TopicRelevanceReason = hasDomainAnchors && hasTaskAnchors
      ? domainMatch && taskMatch
        ? "DOMAIN_AND_TASK_ANCHOR_MATCH"
        : !domainMatch
          ? "MISSING_DOMAIN_ANCHOR"
          : "MISSING_TASK_ANCHOR"
      : hasDomainAnchors
        ? domainMatch ? "DOMAIN_ANCHOR_MATCH" : queryTermMatch ? "LEGACY_QUERY_TERM_MATCH" : "MISSING_DOMAIN_ANCHOR"
        : hasTaskAnchors
          ? taskMatch ? "TASK_ANCHOR_MATCH" : queryTermMatch ? "LEGACY_QUERY_TERM_MATCH" : "MISSING_TASK_ANCHOR"
          : queryTermMatch ? "LEGACY_QUERY_TERM_MATCH" : "PROFILE_HAS_NO_NON_GENERIC_ANCHORS";
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
