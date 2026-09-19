import type {
  EvidenceSource,
  ResearchSignal,
  SourceTier,
  SourceType,
  VerificationStatus,
} from "../research/types.ts";

type DataMode = "live" | "demo" | "mixed" | "imported";

export type EventRecord = {
  id: string;
  canonicalTitle: string;
  normalizedKey: string;
  entities: string[];
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ClaimRecord = {
  id: string;
  eventId: string;
  claimText: string;
  normalizedClaim: string;
  entities: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type EvidenceRecord = {
  id: string;
  claimId: string;
  sourceUrl: string;
  canonicalUrl: string;
  publisher: string;
  publishedAt?: string;
  sourceType: SourceType;
  sourceRole: EvidenceSource["sourceRole"];
  sourceTier: SourceTier;
  verificationStatus: VerificationStatus;
  evidenceSnippet: string;
  dataMode: DataMode;
  socialChainId?: string;
  retrievedAt: string;
  createdAt: string;
};

export type PersonalKnowledgeType =
  | "KNOWN_INFORMATION"
  | "QUESTION"
  | "GAP"
  | "JUDGEMENT"
  | "TRACKED_ENTITY"
  | "TRACKED_EVENT"
  | "NOTE";

export type PersonalKnowledgeRecordInput = {
  type: PersonalKnowledgeType;
  text: string;
  structuredPayload?: unknown;
};

export type PersonalKnowledgeRecord = PersonalKnowledgeRecordInput & {
  id: string;
  userId: string;
  filterId: string;
  normalizedText: string;
  stableId: string;
  createdAt: string;
  updatedAt: string;
};

export type StructuredTraceEntry = {
  state: string;
  status: string;
  action: string;
  inputSummary: string;
  outputSummary: string;
  decisionReason?: string;
  strategy?: string;
  strategyReason?: string;
  policyInputsSummary?: string;
  selectedSourceType?: string;
  fallbackSourceTypes?: string[];
  sourceSelectionReason?: string;
  sourceOutcome?: unknown;
  timestamp: string;
};

export type ResearchRunMetadata = {
  id: string;
  userQuery?: string;
  startedAt?: string;
  completedAt?: string;
  status?: "completed" | "failed" | "needs_more_evidence";
  rounds?: number;
  evidenceIds?: string[];
  knowledgeChanges?: Array<{
    signalId: string;
    classification: string;
    supportingEvidenceIds: string[];
    previousRevision: number;
    currentRevision: number;
    reason: string;
  }>;
  attentionResult?: string[];
  strategies?: string[];
  trace?: StructuredTraceEntry[];
  generatedFromResearchContextRevision: number;
  dataMode: "live" | "demo" | "mixed";
  fallbackReason?: string;
  createdAt: string;
};

export type SignalRecords = {
  event: EventRecord;
  claims: ClaimRecord[];
  evidence: EvidenceRecord[];
};

export const RESEARCH_CONTEXT_KNOWLEDGE_TYPES = new Set<PersonalKnowledgeType>([
  "KNOWN_INFORMATION",
  "QUESTION",
  "GAP",
  "JUDGEMENT",
  "TRACKED_ENTITY",
  "TRACKED_EVENT",
]);

export function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableRecordId(parts: string[]) {
  const input = parts.map((part) => normalizeText(part)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function canonicalizeUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return sourceUrl.trim();
  }
}

export function claimFingerprint(claim: Pick<ResearchSignal["claims"][number], "claimText" | "canonicalClaimFingerprint">) {
  return normalizeText(claim.canonicalClaimFingerprint || claim.claimText);
}

function evidenceFromSource(
  claimId: string,
  source: EvidenceSource,
  signal: ResearchSignal,
  socialChainId?: string,
): EvidenceRecord {
  const canonicalUrl = canonicalizeUrl(source.sourceUrl);
  return {
    id: `evidence-${stableRecordId([claimId, canonicalUrl])}`,
    claimId,
    sourceUrl: source.sourceUrl,
    canonicalUrl,
    publisher: source.publisher,
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    sourceRole: source.sourceRole,
    sourceTier: source.sourceTier,
    verificationStatus: source.verificationStatus,
    evidenceSnippet: source.evidenceSnippet,
    dataMode: signal.dataOrigin === "imported" ? "imported" : signal.dataOrigin,
    socialChainId,
    retrievedAt: signal.retrievedAt,
    createdAt: signal.retrievedAt,
  };
}

export function recordsFromSignal(signal: ResearchSignal): SignalRecords {
  const createdAt = signal.firstSeenAt || signal.retrievedAt;
  const updatedAt = signal.lastUpdatedAt || signal.retrievedAt;
  const event: EventRecord = {
    id: signal.id,
    canonicalTitle: signal.originalTitle || signal.title,
    normalizedKey: normalizeText(`${signal.id} ${signal.originalTitle || signal.title}`),
    entities: signal.entityMatches,
    tags: signal.tags,
    firstSeenAt: signal.firstSeenAt,
    lastSeenAt: signal.retrievedAt,
    createdAt,
    updatedAt,
  };
  const claims: ClaimRecord[] = signal.claims.map((claim) => {
    const normalizedClaim = normalizeText(claim.originalClaimText || claim.claimText);
    return {
      id: `claim-${stableRecordId([signal.id, normalizedClaim])}`,
      eventId: event.id,
      claimText: claim.originalClaimText || claim.claimText,
      normalizedClaim,
      entities: signal.entityMatches,
      tags: signal.tags,
      createdAt,
      updatedAt,
    };
  });
  const evidence = signal.claims.flatMap((claim, index) => {
    const claimId = claims[index].id;
    const sources = claim.evidenceSources.length
      ? claim.evidenceSources
      : [{
          sourceUrl: claim.sourceUrl,
          publisher: claim.publisher,
          publishedAt: claim.publishedAt,
          sourceType: claim.sourceType,
          sourceTier: claim.sourceTier,
          sourceRole: claim.sourceType === "social" ? "discovery" : "verification",
          evidenceSnippet: claim.originalEvidenceSnippet || claim.evidenceSnippet,
          verificationStatus: claim.verificationStatus,
        } satisfies EvidenceSource];
    return sources.map((source) => evidenceFromSource(claimId, source, signal, claim.evidenceChainId));
  });

  return { event, claims, evidence };
}
