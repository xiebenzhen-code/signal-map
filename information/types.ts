import type { ResearchOverview, ResearchSignal } from "../research/types.ts";

export type SourceScope = "official" | "verified" | "all";

export type InformationFilter = {
  id: string;
  filterName: string;
  identity: string;
  industry: string;
  focusAreas: string[];
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  freshnessWindow: string;
  sourceScope: SourceScope;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeState = {
  identity: string;
  industry: string;
  focusAreas: string[];
  currentQuestions: string[];
  knownInformation: string[];
  informationGaps: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  userJudgements: string[];
  evidenceHistory: string[];
  freshnessWindow: string;
};

export type ProviderCoverage = {
  level: "Broad" | "Partial" | "Limited";
  usedProviders: string[];
  unavailableProviders: string[];
  notConfiguredProviders: string[];
  failedProviders: string[];
};

export type InformationRun = {
  signals: ResearchSignal[];
  overview: ResearchOverview;
  coverage: ProviderCoverage;
  failures: string[];
  fetchedAt: string;
  dataMode: "DEMO" | "LIVE" | "MIXED";
  lastCheckedAt?: string;
};

export type ProviderContext = {
  filter: InformationFilter;
  knowledge: KnowledgeState;
};

export interface InformationProvider {
  id:
    | "demo"
    | "imported"
    | "web"
    | "x"
    | "xiaohongshu";
  label: string;
  getStatus():
    | "available"
    | "unavailable"
    | "not_configured"
    | "error";
  run(context: ProviderContext): Promise<InformationRun>;
}

export type DemoSource = {
  id: string;
  eventKey: string;
  title: string;
  summary: string;
  claimText: string;
  publisher: string;
  sourceUrl: string;
  sourceType: "primary" | "trusted_media" | "industry_media" | "social";
  sourceTier: "S" | "A" | "B" | "C";
  publishedAt?: string;
  eventOccurredAt?: string;
  firstSeenAt: string;
  lastUpdatedAt?: string;
  retrievedAt: string;
  metadataPublishedAt?: string;
  dataOrigin: "demo";
  evidenceSnippet?: string;
  tags: string[];
  entities: string[];
  reliability: number;
  conflict?: boolean;
  duplicateOf?: string;
};

export type FeedbackRecord = {
  id: string;
  eventId: string;
  value:
    | "changed_view"
    | "already_knew"
    | "not_useful"
    | "monitor";
  createdAt: string;
};

export type ExperienceFeedback = {
  id: string;
  sessionId: string;
  worthwhileCount: 0 | 1 | 2 | 3 | 4 | 5;
  alreadyKnown: "yes" | "no";
  trustScore: 1 | 2 | 3 | 4 | 5;
  missedInformation: string;
  continueUsing: "yes" | "maybe" | "no";
  biggestProblem: string;
  createdAt: string;
};
