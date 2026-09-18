import { recordsFromSignal } from "../information/rag-records.ts";
import type {
  AuthenticatedFilterContext,
  ClaimRepository,
  EventRepository,
  EvidenceRepository,
  PersonalKnowledgeRepository,
} from "../information/repositories/types.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";
import type { KnowledgeChange } from "./types.ts";

export type KnowledgeUpdateRepository =
  EventRepository &
  ClaimRepository &
  EvidenceRepository &
  PersonalKnowledgeRepository;

export type KnowledgeUpdateResult = {
  evidenceIds: string[];
  persistedChanges: KnowledgeChange[];
};

export async function persistResearchRecords(options: {
  repository: KnowledgeUpdateRepository;
  response: ResearchResponse;
}): Promise<{ evidenceIds: string[] }> {
  const allEvidenceIds: string[] = [];
  for (const signal of options.response.signals.filter(
    (candidate) => candidate.topicRelevance?.decision !== "TOPIC_MISMATCH",
  )) {
    const records = recordsFromSignal(signal);
    await Promise.resolve(options.repository.upsertEvent(records.event));
    for (const claim of records.claims) await Promise.resolve(options.repository.upsertClaim(claim));
    for (const evidence of records.evidence) {
      const persisted = await Promise.resolve(options.repository.upsertEvidence(evidence));
      allEvidenceIds.push(persisted.id);
    }
  }
  return { evidenceIds: Array.from(new Set(allEvidenceIds)) };
}

function signalText(signal: ResearchSignal) {
  return signal.originalTitle || signal.title;
}

function canWriteKnowledge(signal: ResearchSignal, change: KnowledgeChange) {
  return signal.reliabilityScore >= 55 &&
    signal.topicRelevance?.decision !== "TOPIC_MISMATCH" &&
    signal.informationGainStatus !== "NO_INFORMATION_GAIN" &&
    signal.verificationStatus !== "unverified" &&
    signal.informationType !== "SIGNAL" &&
    change.classification !== "CONTRADICTS";
}

function shouldAdvanceRevision(change: KnowledgeChange) {
  return ["NEW", "UPDATES", "CONTRADICTS"].includes(change.classification);
}

function payload(signal: ResearchSignal, change: KnowledgeChange, runId: string, evidenceIds: string[], now: string) {
  return {
    sourceAgentRunId: runId,
    signalId: signal.id,
    classification: change.classification,
    previousRevision: change.previousRevision,
    currentRevision: change.currentRevision,
    revisionReason: change.reason,
    supportingEvidenceIds: evidenceIds,
    supportingClaimIds: signal.claims.map((claim) => claim.canonicalClaimFingerprint || claim.claimText),
    verificationStatus: signal.verificationStatus,
    reliabilityScore: signal.reliabilityScore,
    updatedAt: now,
  };
}

export async function updateKnowledgeFromChanges(options: {
  context: AuthenticatedFilterContext;
  repository: KnowledgeUpdateRepository;
  response: ResearchResponse;
  changes: KnowledgeChange[];
  runId: string;
  now: string;
}): Promise<KnowledgeUpdateResult> {
  const signalsById = new Map(options.response.signals.map((signal) => [signal.id, signal]));
  const persistedChanges: KnowledgeChange[] = [];
  const allEvidenceIds: string[] = [];

  const persistedRecords = await persistResearchRecords(options);
  allEvidenceIds.push(...persistedRecords.evidenceIds);

  for (const change of options.changes) {
    const signal = signalsById.get(change.signalId);
    if (!signal || change.classification === "DUPLICATE") continue;
    if (!canWriteKnowledge(signal, change)) continue;

    const evidenceIds = recordsFromSignal(signal).evidence.map((evidence) => evidence.id);
    const result = await Promise.resolve(options.repository.upsertPersonalKnowledge(
      options.context,
      {
        type: "KNOWN_INFORMATION",
        text: signalText(signal),
        structuredPayload: payload(signal, change, options.runId, evidenceIds, options.now),
      },
      options.now,
      { advanceRevision: shouldAdvanceRevision(change) },
    ));

    persistedChanges.push({
      ...change,
      supportingEvidenceIds: evidenceIds,
      previousRevision: result.previousRevision,
      currentRevision: result.currentRevision,
    });
  }

  return {
    evidenceIds: Array.from(new Set(allEvidenceIds)),
    persistedChanges,
  };
}
