import type { LiveItem } from "@/social/providers";

export type SourceType =
  | "primary"
  | "trusted_media"
  | "industry_media"
  | "social";
export type SourceTier = "S" | "A" | "B" | "C";
export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "conflicting";

export type Claim = {
  claimText: string;
  originalClaimText?: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
  sourceType: SourceType;
  sourceTier: SourceTier;
  evidenceSnippet: string;
  originalEvidenceSnippet?: string;
  verificationStatus: VerificationStatus;
  contentType: "FACT" | "SIGNAL";
};

export type QueryPlan = {
  originalNeed: string;
  coreKeywords: string[];
  englishKeywords: string[];
  synonyms: string[];
  entities: string[];
  industryKeywords: string[];
  searchCombinations: string[];
};

export type PipelineCounts = {
  candidates: number;
  primary: number;
  trustedMedia: number;
  industryMedia: number;
  social: number;
  verified: number;
};

export type PipelineProgress = {
  stage:
    | "planning"
    | "candidates"
    | "primary"
    | "trusted_media"
    | "social"
    | "deduplication"
    | "clustering"
    | "claim_extraction"
    | "verification"
    | "gap_matching"
    | "novelty"
    | "scoring"
    | "filtering"
    | "explanation"
    | "translation"
    | "complete";
  label: string;
  counts: PipelineCounts;
  detail?: string;
};

export type ResearchCandidate = LiveItem & {
  sourceType: SourceType;
};

export type ResearchSignal = {
  id: string;
  category: "匹配";
  channel: "官方" | "社区" | "混合";
  title: string;
  originalTitle?: string;
  summary: string;
  originalSummary?: string;
  translationStatus?: "translated" | "not_needed" | "failed";
  translationFailureReason?: string;
  time: string;
  truth: number;
  baseUseful: number;
  lead: number;
  tags: string[];
  action: string;
  why: string;
  official: Array<{ name: string; url: string; kind: "原文" }>;
  social: Array<{ name: string; url: string; kind: "讨论" }>;
  sourceType: SourceType;
  sourceTier: SourceTier;
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
  confidence: number;
  verificationStatus: VerificationStatus;
  relevanceScore: number;
  reliabilityScore: number;
  freshnessScore: number;
  noveltyScore: number;
  judgementImpactScore: number;
  gapMatchScore: number;
  overallScore: number;
  sourceCount: number;
  claims: Claim[];
  sources: Array<{
    sourceUrl: string;
    publisher: string;
    publishedAt: string;
    sourceType: SourceType;
    sourceTier: SourceTier;
  }>;
  section: "must_know" | "gap_update" | "emerging" | "all";
  gapMatches: string[];
  questionMatches: string[];
  entityMatches: string[];
  whyItMatters: string;
  eventStatus: "NEW" | "UPDATED" | "FOLLOW_UP" | "SIGNAL";
  informationType: "FACT" | "INTERPRETATION" | "SIGNAL";
  knowledgeStatus: "NOVEL" | "UPDATED" | "KNOWN";
  attentionDecision: "MUST_READ" | "LIBRARY_ONLY" | "IGNORE";
};

export type ResearchOverview = {
  scanned: number;
  deduplicated: number;
  events: number;
  verified: number;
  relevant: number;
  mustKnow: number;
  libraryOnly: number;
  ignored: number;
  noiseReductionRate: number;
  novelInformationRate: number;
};

export type ResearchResponse = {
  signals: ResearchSignal[];
  status: Array<{ name: string; ok: boolean; state?: string }>;
  queryPlan: QueryPlan;
  progress: PipelineProgress[];
  failures: string[];
  counts: PipelineCounts;
  overview: ResearchOverview;
  fetchedAt: string;
};

export type ResearchInput = {
  identity: string;
  industry: string;
  focusAreas: string;
  currentQuestions: string;
  knownInformation: string;
  informationGaps: string;
  trackedEntities: string;
  trackedEvents: string;
  userJudgements: string;
  evidenceHistory: string;
  freshnessWindow: string;
};
