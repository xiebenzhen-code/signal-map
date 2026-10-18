import type { ResearchOverview, ResearchSignal } from "../research/types.ts";
import type { SourceCoverage } from "../research/source-coverage.ts";

export type FreshnessWindow = "24h" | "3d" | "7d" | "30d" | "90d";
export type SourceScope = "domestic" | "global" | "hybrid" | "custom";
type DataMode = "live" | "demo" | "mixed";

export type PersonalProfile = { defaultIdentity: string };

export type InformationFilter = {
  id: string;
  filterName: string;
  identityOverride?: string;
  industry: string;
  focusAreas: string[];
  freshnessWindow: FreshnessWindow;
  sourceScope: SourceScope;
  customSources?: string[];
  createdAt: string;
  updatedAt: string;
};

export type FilterKnowledgeState = {
  researchContextRevision: number;
  updatedAt: string;
  currentQuestions: string[];
  knownInformation: string[];
  informationGaps: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  userJudgements: string[];
  evidenceHistory: string[];
};

export type KnowledgeByFilterId = Record<string, FilterKnowledgeState>;

export type ActiveKnowledgeContext = {
  identity: string;
  industry: string;
  focusAreas: string[];
  freshnessWindow: FreshnessWindow;
  sourceScope: SourceScope;
  customSources: string[];
  currentQuestions: string[];
  knownInformation: string[];
  informationGaps: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  userJudgements: string[];
  researchContextRevision: number;
};

export type ProviderCoverage = SourceCoverage;

export type InformationRunPayload = {
  modelUsage?: ReturnType<ReturnType<typeof import("../agent/models/usage-observation.ts").createModelUsageCollector>["snapshot"]>;
  customSourceChecks?: import("../lib/custom-sources.ts").CustomSourceCheck[];
  status?: "completed" | "failed" | "needs_more_evidence";
  requestId?: string;
  signals: ResearchSignal[];
  overview: ResearchOverview;
  coverage: ProviderCoverage;
  filteringSummary?: import("../research/types.ts").FilteringSummary;
  // Query plan is part of the /api/signals response; the home page reads the
  // requested freshness window from it to keep "today" gates window-aware.
  queryPlan?: import("../research/types.ts").QueryPlan;
  failures: string[];
  fetchedAt: string;
  dataMode: DataMode;
  lastCheckedAt?: string;
  fallbackReason?: string;
  researchMode?: "anonymous" | "authenticated";
};

export type InformationRun = InformationRunPayload & {
  filterId: string;
  generatedFromResearchContextRevision: number;
};

export type ProviderContext = {
  filter: InformationFilter;
  knowledge: ActiveKnowledgeContext;
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
  run(context: ProviderContext): Promise<InformationRunPayload>;
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

export type LibraryEntry = {
  event: ResearchSignal;
  notes: string;
  judgement: string;
  savedAt: string;
};
