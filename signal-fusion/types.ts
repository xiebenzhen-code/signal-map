export type SourceRole =
  | "PRIMARY"
  | "AUTHORITATIVE_MEDIA"
  | "TECH_COMMUNITY"
  | "EARLY_SIGNAL"
  | "BACKGROUND";

export type SignalClassification =
  | "FACT"
  | "INTERPRETATION"
  | "EARLY_SIGNAL"
  | "TREND"
  | "NOISE"
  | "CONFLICT";

export type SignalConflictState = "none" | "conflicting" | "unresolved";

export type FusionSourceType =
  | "primary"
  | "trusted_media"
  | "industry_media"
  | "social";

export type FusionSourceTier = "S" | "A" | "B" | "C";

export type FusionVerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "conflicting";

export type FusionEvidence = {
  evidenceId: string;
  entity?: string;
  topic?: string;
  claim: string;
  sourceUrl: string;
  publisher: string;
  publishedAt?: string;
  sourceType: FusionSourceType;
  sourceTier: FusionSourceTier;
  verificationStatus: FusionVerificationStatus;
  reliabilityScore?: number;
  noveltyScore?: number;
  upstreamSource?: string;
};

export type SignalCluster = {
  clusterId: string;
  entity: string;
  topic: string;
  normalizedClaim: string;
  timeScope?: string;
  evidenceIds: string[];
  sourceRoles: SourceRole[];
  independentSourceCount: number;
  duplicateCount: number;
  conflictState: SignalConflictState;
  canonicalSources: string[];
};

export type SignalFusionResult = {
  cluster: SignalCluster;
  signalType: SignalClassification;
  independentSourceCount: number;
  duplicateRatio: number;
  sourceRoleDiversity: number;
  confirmationGain: boolean;
  primaryEvidenceIds: string[];
  reason: string;
};
