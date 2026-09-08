export type ResearchIntent =
  | "PRODUCT_UPDATE"
  | "JOB_SEARCH"
  | "INDUSTRY_TREND"
  | "AIGC_OPPORTUNITY"
  | "TECH_RESEARCH"
  | "COMPANY_WATCH"
  | "MARKET_OPPORTUNITY"
  | "COMPETITOR_INTELLIGENCE"
  | "POLICY_REGULATION"
  | "ACADEMIC_RESEARCH"
  | "TOOL_DISCOVERY"
  | "LEARNING_PATH"
  | "PURCHASE_DECISION"
  | "GENERAL_RESEARCH";

export type IntentClassification = {
  primaryIntent: ResearchIntent;
  secondaryIntent?: ResearchIntent;
  confidence: number;
  reason: string;
};

export type ProfileSourceType =
  | "MEMORY"
  | "OFFICIAL"
  | "PRIMARY"
  | "GENERAL_WEB"
  | "INDEPENDENT_MEDIA"
  | "SOCIAL_SIGNAL"
  | "GITHUB"
  | "COMPANY"
  | "COMPANY_CAREERS"
  | "JOB_BOARD"
  | "COMMUNITY"
  | "STARTUP"
  | "FUNDING"
  | "JOB"
  | "CAREERS"
  | "MEDIA"
  | "INDUSTRY_MEDIA"
  | "CHANGELOG"
  | "PRICING"
  | "GOVERNMENT"
  | "REGULATOR"
  | "PRIMARY_DOCUMENT"
  | "OFFICIAL_DOCS"
  | "PAPER"
  | "CONFERENCE"
  | "ARXIV"
  | "PRODUCT_DIRECTORY"
  | "COURSE"
  | "JOB_REQUIREMENTS"
  | "PRACTICAL_CASES"
  | "OFFICIAL_SPEC"
  | "INDEPENDENT_REVIEW"
  | "USER_FEEDBACK"
  | "SEARCH_TREND";

export type RankingDimension =
  | "Freshness"
  | "Reliability"
  | "Authority"
  | "Relevance"
  | "Novelty"
  | "Actionability"
  | "SignalDiversity"
  | "PrimaryEvidence"
  | "Reproducibility"
  | "Demand"
  | "Competition"
  | "GrowthSignal";

export type FreshnessRequirement = "strict_recent" | "recent" | "balanced" | "evergreen";
export type EvidenceRequirement = "primary_required" | "multiple_independent" | "verified_preferred" | "signal_allowed";
export type OutputMode =
  | "GENERAL_BRIEF"
  | "JOB_SHORTLIST"
  | "TREND_BRIEF"
  | "OPPORTUNITY_MAP"
  | "EVIDENCE_MATRIX";

export type IntentMappedOutput =
  | { mode: "GENERAL_BRIEF"; items: Array<{ title: string; status: string; source: string }> }
  | { mode: "JOB_SHORTLIST"; jobs: Array<{ role: string; company: string; location: string; postedAt?: string; matchReason: string; actionability: string; source: string }> }
  | { mode: "TREND_BRIEF"; trends: Array<{ trend: string; confidence: number; evidenceSignals: string[]; status: "FACT" | "INTERPRETATION" | "EARLY_SIGNAL" }> }
  | { mode: "OPPORTUNITY_MAP"; opportunities: Array<{ opportunity: string; confidence: number; evidenceSignals: string[]; supportingSources: string[]; risks: string[]; status: "FACT" | "INTERPRETATION" | "EARLY_SIGNAL" }> }
  | { mode: "EVIDENCE_MATRIX"; rows: Array<{ claim: string; verificationStatus: string; sourceTier: string; source: string }> };

export type SourceProfile = {
  intent: ResearchIntent;
  preferredSourceTypes: ProfileSourceType[];
  requiredSignals: string[];
  rankingDimensions: RankingDimension[];
  freshnessRequirement: FreshnessRequirement;
  evidenceRequirement: EvidenceRequirement;
  outputMode: OutputMode;
};

export type IntentClassifierInput = {
  userQuery: string;
  filterContext?: {
    industry?: string;
    focusAreas?: string;
    currentQuestions?: string;
  };
  relatedKnowledge: string[];
  currentGoal?: { type?: string; objective?: string };
};
