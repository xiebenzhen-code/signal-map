import type { QueryPlan, TopicRelevance } from "./types.ts";

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

export function assessTopicRelevance(text: string, plan: QueryPlan): TopicRelevance {
  const normalizedText = normalize(text);
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
