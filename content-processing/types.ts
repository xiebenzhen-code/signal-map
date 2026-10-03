export type ContentQuality =
  | "VALID"
  | "INSUFFICIENT_CONTENT";

export type CleanedContent = {
  rawContent: string;
  cleanedContent: string;
  mainContent: string;
  quality: ContentQuality;
  failureReason?: string;
};

export type ExtractedClaim = {
  statement: string;
  quality: ContentQuality;
  failureReason?: string;
};

export type PresentationEvidence = {
  sourceName: string;
  sourceRole: "discovery" | "verification";
  snippet: string;
  publishedAt?: string;
  url: string;
};

export type SignalPresentation = {
  headline: string;
  oneLineSummary?: string;
  fact: string;
  whyItMatters?: string;
  /** The evidence-backed change statement, present only when the claim adds substance beyond the title. */
  changeStatement?: string;
  evidence: PresentationEvidence[];
  interpretation?: string;
  contentQuality: ContentQuality;
  failureReason?: string;
};

export type PresentationInput = {
  title: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt?: string;
  sourceType: "primary" | "trusted_media" | "industry_media" | "social";
  verificationStatus: "verified" | "partially_verified" | "unverified" | "conflicting";
  informationType: "FACT" | "INTERPRETATION" | "SIGNAL";
  userContext?: {
    questionMatches: string[];
    gapMatches: string[];
    entityMatches: string[];
  };
  cleaned: CleanedContent;
  claim: ExtractedClaim;
  /** True when the user's own question is about software releases/upgrades — gates software-specific wording. */
  upgradeContext?: boolean;
};
