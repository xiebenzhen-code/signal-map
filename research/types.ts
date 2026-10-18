import type { LiveItem } from "../social/providers/index.ts";
import type { EvidenceRecord } from "../information/rag-records.ts";
import type { SourceCoverage } from "./source-coverage.ts";
import type { IntentClassification, IntentMappedOutput, SourceProfile } from "../intent/types.ts";
import type { SignalClassification, SignalCluster, SourceRole as FusionSourceRole } from "../signal-fusion/types.ts";
import type { ContentQuality, SignalPresentation } from "../content-processing/types.ts";
import type { DetailEnrichmentMetadata, DetailEnrichmentSummary, SourceCapabilityRole } from "../source-enrichment/types.ts";
import type { ActionabilityStatus, ExecutionEntry, InformationGainStatus } from "./actionability.ts";
import type { ProviderRejectionSample } from "./source-coverage.ts";

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

export type TopicRelevanceDecision = "MATCH" | "TOPIC_MISMATCH";

export type TopicRelevanceReason =
  | "DOMAIN_AND_TASK_ANCHOR_MATCH"
  | "DOMAIN_ANCHOR_MATCH"
  | "TASK_ANCHOR_MATCH"
  | "MISSING_DOMAIN_ANCHOR"
  | "MISSING_TASK_ANCHOR"
  | "NO_DOMAIN_OR_TASK_ANCHOR_MATCH"
  | "PROFILE_HAS_NO_NON_GENERIC_ANCHORS"
  | "LEGACY_QUERY_TERM_MATCH"
  | "NO_QUERY_TERM_MATCH"
  | "NO_TOPIC_TERMS";

export type TopicProfile = {
  domainAnchors: string[];
  taskAnchors: string[];
  genericTerms: string[];
};

export type TopicRelevance = {
  decision: TopicRelevanceDecision;
  reason?: TopicRelevanceReason;
  matchedTerms: string[];
  matchedDomainAnchors?: string[];
  matchedTaskAnchors?: string[];
  matchedGenericTerms?: string[];
  matchedQueryTerms?: string[];
  relevanceGateApplied?: boolean;
  relevanceGatePassed?: boolean;
  score: number;
};

type SourceRole = "discovery" | "verification";

export type EvidenceSource = {
  sourceUrl: string;
  publisher: string;
  publishedAt?: string;
  sourceType: SourceType;
  sourceTier: SourceTier;
  evidenceSnippet: string;
  sourceRole: SourceRole;
  verificationStatus: VerificationStatus;
  discoveredBy?: string;
  evidenceFrom?: string;
};

export type Claim = {
  claimText: string;
  originalClaimText?: string;
  sourceUrl: string;
  publisher: string;
  publishedAt?: string;
  sourceType: SourceType;
  sourceTier: SourceTier;
  evidenceSnippet: string;
  originalEvidenceSnippet?: string;
  verificationStatus: VerificationStatus;
  contentType: "FACT" | "SIGNAL";
  evidenceSources: EvidenceSource[];
  discoveredBy?: string;
  evidenceFrom?: string;
  contentQuality?: ContentQuality;
  evidenceChainId?: string;
  canonicalClaimFingerprint?: string;
  propagationCount?: number;
  independentEvidenceCount: number;
};

export type QueryPlan = {
  originalNeed: string;
  coreKeywords: string[];
  topicAnchors?: string[];
  topicKeywords?: string[];
  topicProfile?: TopicProfile;
  englishKeywords: string[];
  synonyms: string[];
  entities: string[];
  industryKeywords: string[];
  changeKeywords: string[];
  knowledgeAwareQueries: string[];
  searchCombinations: string[];
  retrievalWindows: Array<"24h" | "3d" | "7d" | "30d" | "90d">;
  requestedFreshnessWindow: "24h" | "3d" | "7d" | "30d" | "90d";
  selectedSourceType?: string;
  fallbackSourceTypes?: string[];
  allowedProviderIds?: string[];
  sourceSelectionReason?: string;
  resolvedEntities?: Array<{ canonicalEntity: string; aliasesConsidered: string[] }>;
  aliasesConsidered?: string[];
  queryBudget?: number;
  deduplicatedQueryCount?: number;
};

export type RetrievalPlan = {
  queries: string[];
  topicAnchors?: string[];
  topicKeywords?: string[];
  topicProfile?: TopicProfile;
  selectedSourceType?: string;
  fallbackSourceTypes?: string[];
  allowedProviderIds?: string[];
  reason?: string;
  resolvedEntities?: QueryPlan["resolvedEntities"];
  intent?: IntentClassification;
  freshnessWindow?: ResearchInput["freshnessWindow"];
  retrievalWindows?: QueryPlan["retrievalWindows"];
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
  providerId?: string;
  sourceCapability?: SourceCapabilityRole;
  enrichedRawContent?: string;
  detailEnrichment?: DetailEnrichmentMetadata;
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
  publishedAt?: string;
  eventOccurredAt?: string;
  firstSeenAt: string;
  lastUpdatedAt?: string;
  retrievedAt: string;
  originalOccurredAt?: string;
  latestUpdateAt?: string;
  timestampStatus:
    | "valid"
    | "missing"
    | "future"
    | "metadata_conflict"
    | "suspected_retrieval_copy";
  dataOrigin: "demo" | "live" | "imported";
  confidence: number;
  verificationStatus: VerificationStatus;
  topicRelevance?: TopicRelevance;
  relevanceScore: number;
  reliabilityScore: number;
  freshnessScore: number;
  noveltyScore: number;
  judgementImpactScore: number;
  gapMatchScore: number;
  overallScore: number;
  sourceCount: number;
  independentEvidenceCount: number;
  propagationCount: number;
  signalType?: SignalClassification;
  signalCluster?: SignalCluster;
  sourceRoles?: FusionSourceRole[];
  sourceRoleDiversity?: number;
  duplicateRatio?: number;
  confirmationGain?: boolean;
  primaryEvidenceIds?: string[];
  claims: Claim[];
  sources: Array<{
    sourceUrl: string;
    publisher: string;
    publishedAt?: string;
    sourceType: SourceType;
    sourceTier: SourceTier;
  }>;
  section: "must_know" | "gap_update" | "emerging" | "all";
  gapMatches: string[];
  questionMatches: string[];
  entityMatches: string[];
  whyItMatters: string;
  eventStatus: "NEW" | "UPDATED" | "FOLLOW_UP" | "SIGNAL" | "BACKGROUND";
  informationType: "FACT" | "INTERPRETATION" | "SIGNAL";
  knowledgeStatus: "NOVEL" | "UPDATED" | "KNOWN";
  actionabilityStatus?: ActionabilityStatus;
  informationGainStatus?: InformationGainStatus;
  hasExecutableAction?: boolean;
  executionEntry?: ExecutionEntry;
  attentionDecision:
    | "MUST_READ"
    | "WORTH_WATCHING"
    | "LIBRARY_ONLY"
    | "IGNORE";
  presentation?: SignalPresentation;
  contentQuality?: ContentQuality;
  contentFailureReason?: string;
};

export type ResearchOverview = {
  scanned: number;
  deduplicated: number;
  events: number;
  verified: number;
  relevant: number;
  mustKnow: number;
  worthWatching: number;
  libraryOnly: number;
  ignored: number;
  noiseReductionRate: number;
  novelInformationRate: number;
};

export type FilteringReason =
  | "STALE"
  | "DUPLICATE"
  | "LOW_RELIABILITY"
  | "INSUFFICIENT_VERIFICATION"
  | "BACKGROUND_ONLY"
  | "LOW_NOVELTY"
  | "UNRESOLVED_CONFLICT"
  | "LOW_ACTIONABILITY"
  | "NO_INFORMATION_GAIN"
  | "INSUFFICIENT_CONTENT"
  | "TOPIC_MISMATCH";

export type FilteringSummary = {
  retrievedCount: number;
  clusteredCount: number;
  displayedCount: number;
  filteredReasons: {
    stale: number;
    duplicate: number;
    lowReliability: number;
    insufficientVerification: number;
    background: number;
    lowNovelty: number;
    unresolvedConflict: number;
    lowActionability?: number;
    noInformationGain?: number;
    insufficientContent?: number;
    topicMismatch?: number;
  };
  detailEnrichment?: DetailEnrichmentSummary;
  strongestHiddenSignal?: {
    signalType: SignalClassification;
    reason: FilteringReason;
    evidenceCount: number;
    independentSourceCount: number;
  };
  filteringDetails?: Array<{
    id: string;
    title: string;
    decision: "displayed" | "filtered";
    reason?: FilteringReason;
    explanation: string;
    topicRelevance?: Pick<TopicRelevance, "decision" | "reason" | "matchedDomainAnchors" | "matchedTaskAnchors" | "matchedGenericTerms" | "matchedQueryTerms" | "relevanceGateApplied" | "relevanceGatePassed">;
    sources: Array<{ publisher: string; sourceUrl: string }>;
  }>;
  summaryText: string;
};

export type EvidenceAccounting = {
  discoveredCandidateCount: number;
  producedEvidenceCount: number;
  cumulativeEvidenceCount?: number;
  evaluatedEvidenceCount: number;
  acceptedEvidenceCount: number;
  rejectedEvidenceCount: number;
  finalEvidenceCount: number;
  rejectionReasons?: FilteringSummary["filteredReasons"];
};

export type ResearchResponse = {
  customSourceChecks?: import("../lib/custom-sources.ts").CustomSourceCheck[];
  signals: ResearchSignal[];
  status: Array<{ name: string; ok: boolean; state?: string }>;
  queryPlan: QueryPlan;
  progress: PipelineProgress[];
  failures: string[];
  counts: PipelineCounts;
  overview: ResearchOverview;
  coverage: SourceCoverage;
  filteringSummary?: FilteringSummary;
  evidenceAccounting?: EvidenceAccounting;
  /** Evidence objects produced during this run, including evaluated-but-filtered records. */
  evidenceRecords?: EvidenceRecord[];
  fetchedAt: string;
  dataMode: "live" | "demo" | "mixed";
  lastCheckedAt?: string;
  sourceOutcomes?: ResearchSourceOutcome[];
  sourceDiagnostics?: SourceStageDiagnostics[];
  intent?: IntentClassification;
  sourceProfile?: SourceProfile;
  outputMode?: SourceProfile["outputMode"];
  intentOutput?: IntentMappedOutput;
};

export type SourceStageDiagnostics = {
  providerId: string;
  rawProviderResultCount: number;
  normalizedCandidateCount: number;
  admittedCandidateCount: number;
  enrichmentEligibleCount: number;
  detailAttempted: number;
  detailSucceeded: number;
  detailFailed: number;
  pipelineRetrievedCount: number;
  displayedCount: number;
  rejectionReasons?: Record<string, number>;
  rejectedRawCount?: number;
  normalizationRejectionReasons?: Record<string, number>;
  normalizationRejectedSamples?: ProviderRejectionSample[];
  candidateAdmissionRejectionReasons?: Record<string, number>;
  candidateAdmissionRejectedSamples?: ProviderRejectionSample[];
};

type ResearchSourceOutcome = {
  sourceType: string;
  providerId: string;
  executed: boolean;
  resultCount: number;
  requestCount?: number;
  /** Number of newly discovered provider candidates; not produced/accepted Evidence. */
  newEvidenceCount: number;
  newClaimCount: number;
  reliabilityGain: number;
  conflictReduction: number;
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
  sourceScope?: string;
  customSources?: string;
};
