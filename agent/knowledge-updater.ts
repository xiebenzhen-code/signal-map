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

/** Index pages, subscription endpoints and channel boilerplate carry no claim. */
const NAVIGATION_TEXT = /\b(?:changelog|release notes?|newsletter|subscribe|rss|atom feed|feed\.xml|developer center|documentation index|find the latest|learn about new platform)\b|导航|订阅|最新动态|了解更多平台/iu;

function canWriteKnowledge(signal: ResearchSignal, change: KnowledgeChange) {
  // An official source and a high reliability score describe the publisher, not
  // whether the item answers this question. Requiring an explicit MATCH keeps
  // unjudged and off-task material out; navigation and channel boilerplate
  // never become confirmed facts even when their source is authoritative.
  if (signal.topicRelevance?.decision !== "MATCH") return false;
  if (signal.reliabilityScore < 55) return false;
  if (signal.informationGainStatus === "NO_INFORMATION_GAIN") return false;
  if (signal.verificationStatus === "unverified") return false;
  if (signal.informationType === "SIGNAL") return false;
  if (change.classification === "CONTRADICTS") return false;
  if (change.classification === "DUPLICATE") return false;
  return !NAVIGATION_TEXT.test(`${signal.originalTitle || ""} ${signal.title || ""}`);
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
    sourceUrls: Array.from(new Set([
      signal.sourceUrl,
      ...signal.sources.map((source) => source.sourceUrl),
      ...signal.claims.map((claim) => claim.sourceUrl),
      ...signal.claims.flatMap((claim) => claim.evidenceSources.map((source) => source.sourceUrl)),
    ])),
    claimFingerprints: signal.claims.map((claim) => claim.canonicalClaimFingerprint || claim.claimText),
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
