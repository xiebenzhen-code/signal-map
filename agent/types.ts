import type { QueryPlan, ResearchInput, ResearchResponse, ResearchSignal } from "../research/types.ts";
import type { IntentClassification, SourceProfile } from "../intent/types.ts";
import type {
  AuthenticatedFilterContext,
  ClaimRepository,
  EventRepository,
  EvidenceRepository,
  PersonalKnowledgeRepository,
  ResearchContextRepository,
} from "../information/repositories/types.ts";

export type AgentState =
  | "UNDERSTAND"
  | "INTENT"
  | "RETRIEVE"
  | "PLAN"
  | "RESEARCH"
  | "EVALUATE"
  | "POLICY"
  | "STRATEGY"
  | "SOURCE_SELECTOR"
  | "UPDATE_KNOWLEDGE"
  | "ATTENTION"
  | "COMPLETE";

export type StepStatus = "completed" | "skipped" | "failed" | "needs_more_evidence";

export type ResearchPlan = {
  objective: string;
  queries: string[];
  preferredSourceTypes: string[];
  maxQueries: number;
  strategy?: ResearchStrategy;
  selectedSourceType?: SourceSelectionType;
  fallbackSourceTypes?: SourceSelectionType[];
  allowedProviderIds?: string[];
  reason?: string;
  sourceSelectionReason?: string;
  resolvedEntities?: QueryPlan["resolvedEntities"];
  topicAnchors?: QueryPlan["topicAnchors"];
  topicKeywords?: QueryPlan["topicKeywords"];
  topicProfile?: QueryPlan["topicProfile"];
  intent?: IntentClassification;
  freshnessWindow?: ResearchInput["freshnessWindow"];
  retrievalWindows?: QueryPlan["retrievalWindows"];
};

export type SourceSelectionType =
  | "MEMORY"
  | "OFFICIAL"
  | "PRIMARY"
  | "GENERAL_WEB"
  | "INDEPENDENT_MEDIA"
  | "SOCIAL_SIGNAL";

export type SourceExecutionPlan = {
  primarySourceType?: SourceSelectionType;
  fallbackSourceTypes: SourceSelectionType[];
  allowedProviderIds: string[];
  reason: string;
  sourceGap: boolean;
  discoveryMode?: boolean;
  verificationSourceTypes?: SourceSelectionType[];
};

export type SourceCapability = {
  type: SourceSelectionType;
  available: boolean;
  supportsFreshness: boolean;
  supportsPrimaryDocuments: boolean;
  supportsDomainFilter: boolean;
  supportsTimeFilter: boolean;
};

export type SourceOutcome = {
  sourceType: SourceSelectionType;
  providerId: string;
  resultCount: number;
  requestCount?: number;
  /** Discovery/provider candidate count; never used as run-level Evidence. */
  newEvidenceCount: number;
  newClaimCount: number;
  reliabilityGain: number;
  conflictReduction: number;
};

export type ResearchStrategy =
  | "STOP"
  | "INITIAL"
  | "REFRESH"
  | "DEEPEN"
  | "BROADEN"
  | "ESCALATE_SOURCE"
  | "VERIFY_CONFLICT";

export type ResearchValue = "high" | "medium" | "low";

export type ResearchPolicyInput = {
  currentEvidence: ResearchResponse;
  relatedKnowledge: string[];
  conflictState: EvidenceEvaluation;
  sourceCoverage: ResearchResponse["coverage"];
  freshnessState: "fresh" | "stale" | "unknown";
  reliabilityState: "high" | "mixed" | "low" | "unknown";
  informationGain: number;
  round: number;
  maxRounds: number;
  previousStrategies: ResearchStrategy[];
  researchValue?: ResearchValue;
};

export type ResearchPolicyDecision = {
  strategy: ResearchStrategy;
  reason: string;
  value: ResearchValue;
};

export type EvidenceEvaluation = {
  decision: "STOP" | "CONTINUE";
  sufficientEvidence: boolean;
  conflictDetected: boolean;
  conflictingClaims: string[];
  preferredNextSourceType?: string;
  informationGain: number;
  reason: string;
};

export type KnowledgeChange = {
  signalId: string;
  classification: "NEW" | "CONFIRMS" | "UPDATES" | "CONTRADICTS" | "DUPLICATE";
  supportingEvidenceIds: string[];
  previousRevision: number;
  currentRevision: number;
  reason: string;
};

export type AgentTraceEntry = {
  state: AgentState;
  status: StepStatus;
  action: string;
  inputSummary: string;
  outputSummary: string;
  decisionReason?: string;
  strategy?: ResearchStrategy;
  strategyReason?: string;
  policyInputsSummary?: string;
  selectedSourceType?: SourceSelectionType;
  fallbackSourceTypes?: SourceSelectionType[];
  sourceSelectionReason?: string;
  sourceOutcome?: SourceOutcome;
  intent?: IntentClassification;
  sourceProfile?: SourceProfile;
  timestamp: string;
};

export type AgentStep = {
  state: AgentState;
  status: StepStatus;
  input: unknown;
  output: unknown;
};

export type AgentRunResult = {
  status: "completed" | "failed" | "needs_more_evidence";
  rounds: number;
  response?: ResearchResponse;
  plan: ResearchPlan;
  evaluation: EvidenceEvaluation;
  knowledgeChanges: KnowledgeChange[];
  attention: Array<ResearchSignal["attentionDecision"]>;
  steps: AgentStep[];
  trace: AgentTraceEntry[];
};

export type AgentRunOptions = {
  input: ResearchInput;
  context?: AuthenticatedFilterContext;
  repository?: EventRepository &
    ClaimRepository &
    EvidenceRepository &
    PersonalKnowledgeRepository &
    ResearchContextRepository;
  runId?: string;
  userQuery?: string;
  maxRounds?: number;
  maxQueriesPerRound?: number;
  maxEvidenceItems?: number;
  maxExecutionTimeMs?: number;
  availableSourceCapabilities?: SourceCapability[];
  currentGoal?: { type?: string; objective?: string };
  modelAdapter?: {
    status: "configured" | "not_configured" | "error";
    planResearch(input: {
      userQuery: string;
      relatedKnowledge: string[];
      existingEvidence: unknown[];
      previousQueries: string[];
      round: number;
    }): Promise<{
      status: "configured" | "not_configured" | "error";
      plan?: Pick<ResearchPlan, "objective" | "queries" | "preferredSourceTypes" | "maxQueries">;
    }>;
  };
  onPhase?: (event: {
    phase: string;
    round?: number;
    attemptId?: string;
    attemptType?: "primary" | "fallback" | "verification";
    success?: boolean;
    itemCount?: number;
    errorCode?: string;
    errorName?: string;
    errorMessage?: string;
    topStackFrame?: string;
    failureKind?: "throw_exception" | "failure_result" | "empty_response";
    diagnostic?: Record<string, unknown>;
  }) => void;
  deadlineAt?: number;
  initialRevision?: number;
  research?: (input: ResearchInput, plan: ResearchPlan, round: number) => Promise<ResearchResponse>;
  onPlan?: (plan: ResearchPlan, input: ResearchInput, round: number) => void;
};
