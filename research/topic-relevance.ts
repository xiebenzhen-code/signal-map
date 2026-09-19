import type { QueryPlan, TopicProfile, TopicRelevance } from "./types.ts";

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

function topicProfile(plan: QueryPlan): TopicProfile {
  if (plan.topicProfile) {
    const expand = (terms: string[]) => [...new Set(terms
      .flatMap((term) => {
        const normalized = normalize(term);
        return [normalized, ...normalized.split(" ")];
      })
      .filter((term) => term.length > 1 && !PROFILE_GENERIC_TERMS.has(term)))];
    return {
      domainAnchors: expand(plan.topicProfile.domainAnchors),
      taskAnchors: expand(plan.topicProfile.taskAnchors),
      genericTerms: plan.topicProfile.genericTerms,
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
    domainAnchors: [...new Set([
      ...candidates.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
      ...words.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
    ])],
    taskAnchors: [...new Set([
      ...candidates.filter((term) => PROFILE_TASK_HINTS.test(term)),
      ...words.filter((term) => PROFILE_TASK_HINTS.test(term) && !PROFILE_GENERIC_TERMS.has(term)),
    ])],
    genericTerms: [...PROFILE_GENERIC_TERMS],
  };
}

export function assessTopicRelevance(text: string, plan: QueryPlan): TopicRelevance {
  const normalizedText = normalize(text);
  const profile = topicProfile(plan);
  const matchedDomainAnchors = profile.domainAnchors.filter((term) => matches(normalizedText, normalize(term)));
  const matchedTaskAnchors = profile.taskAnchors.filter((term) => matches(normalizedText, normalize(term)));
  if (profile.domainAnchors.length && profile.taskAnchors.length) {
    const matchedTerms = [...new Set([...matchedDomainAnchors, ...matchedTaskAnchors])];
    const decision = matchedDomainAnchors.length > 0 && matchedTaskAnchors.length > 0
      ? "MATCH"
      : "TOPIC_MISMATCH";
    return {
      decision,
      matchedTerms,
      score: decision === "MATCH"
        ? Math.min(100, 70 + matchedTerms.length * 10)
        : 0,
    };
  }
  const terms = topicTerms(plan);
  const matchedTerms = terms.filter((term) => matches(normalizedText, term));
  const hasTopicTerms = terms.length > 0;
  const decision = !hasTopicTerms || matchedTerms.length > 0
    ? "MATCH"
    : "TOPIC_MISMATCH";
  return {
    decision,
    matchedTerms,
    score: !hasTopicTerms ? 50 : matchedTerms.length ? Math.min(100, 60 + matchedTerms.length * 15) : 0,
  };
}
