const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

// Kept only for audit: this reproduces the former token-overlap input so the
// debug trace can show why an event was previously penalized. It is not used
// to calculate the current novelty score.
const LEGACY_STOPWORDS = /^(and|the|for|with|what|after|recent|recently|change|changes|changed|latest|official|information|update|updates|什么|最近|变化|信息|官方)$/i;

type NoveltyKnowledgeOrigin = "knownInformation" | "evidenceHistory";

export type NoveltyClusterMember = {
  title: string;
  snippet: string;
  sourceUrl: string;
  publisher: string;
};

type KnownItem = {
  origin: NoveltyKnowledgeOrigin;
  text: string;
  terms: string[];
  normalizedFact: string;
};

type NoveltyTokenMatch = {
  matchedTerm: string;
  origin: NoveltyKnowledgeOrigin;
  knownInformationItem: string;
  matchedEventText: string;
  legacyPenaltyContribution: number;
};

type NoveltyFactMatch = {
  knownInformationItem: string;
  origin: NoveltyKnowledgeOrigin;
  matchedTerm: string;
  matchedEventText: string;
  penaltyContribution: number;
};

export type NoveltyAttribution = {
  knownItems: KnownItem[];
  knownTerms: string[];
  tokenMatches: NoveltyTokenMatch[];
  knownMatches: NoveltyFactMatch[];
  unmatchedKnownTerms: string[];
  normalizedClusterText: string;
  noveltyScore: number;
  baseScore: number;
  knownFactPenalty: number;
  freshnessBonus: number;
  judgementPenalty: number;
};

export type NoveltyAuditTrace = NoveltyAttribution & {
  clusterId: string;
  title: string;
  snippet: string;
  clusterMembers: NoveltyClusterMember[];
  claims: Array<{
    claimText: string;
    sourceUrl: string;
    verificationStatus: string;
  }>;
  claimAttribution: "unavailable";
};

export type NoveltyAttributionInput = {
  knownInformation: string;
  evidenceHistory: string;
  userJudgements: string;
  title: string;
  snippet: string;
  clusterMembers: NoveltyClusterMember[];
  freshnessScore: number;
  judgementMatchCount?: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function factTerms(value: string) {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !FUNCTION_WORDS.has(term));
}

function knowledgeItems(value: string, origin: NoveltyKnowledgeOrigin): KnownItem[] {
  return value
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const terms = factTerms(text);
      return { origin, text, terms, normalizedFact: terms.join(" ") };
    });
}

function legacyTerms(value: string) {
  return unique(
    value
      .split(/[,，、；;：:\n\s]+/)
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 1 && !LEGACY_STOPWORDS.test(term)),
  );
}

function matchingContext(text: string, term: string) {
  const index = text.indexOf(term);
  if (index < 0) return term;

  return text.slice(Math.max(0, index - 20), Math.min(text.length, index + term.length + 20)).trim();
}

function claimVariants(title: string) {
  return unique(
    [title, ...title.split(/\s+(?:and|&)\s+/i)]
      .map((claim) => factTerms(claim).join(" "))
      .filter(Boolean),
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function assessNoveltyAttribution(
  input: NoveltyAttributionInput,
): NoveltyAttribution {
  const knownItems = [
    ...knowledgeItems(input.knownInformation, "knownInformation"),
    ...knowledgeItems(input.evidenceHistory, "evidenceHistory"),
  ];
  const clusterText = [
    input.title,
    input.snippet,
    ...input.clusterMembers.flatMap((member) => [member.title, member.snippet]),
  ].join(" ");
  const normalizedClusterText = factTerms(clusterText).join(" ");
  const legacyKnowledgeItems = [
    ...input.knownInformation
      .split(/\r?\n/)
      .map((text) => ({ origin: "knownInformation" as const, text: text.trim() }))
      .filter((item) => item.text),
    ...input.evidenceHistory
      .split(/\r?\n/)
      .map((text) => ({ origin: "evidenceHistory" as const, text: text.trim() }))
      .filter((item) => item.text),
  ];
  const knownTerms = unique(legacyKnowledgeItems.flatMap((item) => legacyTerms(item.text)));
  const legacyClusterText = clusterText.toLowerCase();
  const tokenMatches = legacyKnowledgeItems.flatMap((item) =>
    legacyTerms(item.text)
      .filter((term) => legacyClusterText.includes(term))
      .map((matchedTerm) => ({
        matchedTerm,
        origin: item.origin,
        knownInformationItem: item.text,
        matchedEventText: matchingContext(legacyClusterText, matchedTerm),
        legacyPenaltyContribution: 28,
      })),
  );
  const eventClaimVariants = unique([
    ...claimVariants(input.title),
    ...input.clusterMembers.flatMap((member) => claimVariants(member.title)),
  ]);
  const matchingItems = knownItems.flatMap((item) => {
    if (item.terms.length < 2) return [];
    const matchedEventText = eventClaimVariants.find(
      (claim) => claim === item.normalizedFact,
    );
    return matchedEventText ? [{ item, matchedEventText }] : [];
  });
  const knownFactPenalty = matchingItems.length ? 74 : 0;
  const knownMatches = matchingItems.map(({ item, matchedEventText }, index) => ({
    knownInformationItem: item.text,
    origin: item.origin,
    matchedTerm: item.normalizedFact,
    matchedEventText,
    penaltyContribution: index === 0 ? knownFactPenalty : 0,
  }));
  const freshnessBonus = input.freshnessScore >= 85 ? 4 : 0;
  const judgementPenalty = Math.min(18, (input.judgementMatchCount || 0) * 6);
  const baseScore = knownItems.length ? 92 : 86;

  return {
    knownItems,
    knownTerms,
    tokenMatches,
    knownMatches,
    unmatchedKnownTerms: knownTerms.filter((term) => !tokenMatches.some((match) => match.matchedTerm === term)),
    normalizedClusterText,
    noveltyScore: clamp(baseScore - knownFactPenalty + freshnessBonus - judgementPenalty),
    baseScore,
    knownFactPenalty,
    freshnessBonus,
    judgementPenalty,
  };
}
