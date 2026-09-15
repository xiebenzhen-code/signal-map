import { recordsFromSignal, type EvidenceRecord } from "../information/rag-records.ts";
import type { FilteringSummary, ResearchOverview, ResearchResponse, ResearchSignal, VerificationStatus } from "../research/types.ts";

export type VerificationOutcome =
  | "verification_success"
  | "verification_insufficient"
  | "carried_forward_without_new_verification"
  | "provider_failure_carried_forward"
  | "no_evidence";

export type EvidencePreservationSnapshot = {
  roundEvidenceCount: number;
  producedEvidenceCount: number;
  cumulativeEvidenceCount: number;
  carriedForwardEvidenceCount: number;
  acceptedEvidenceCount: number;
  rejectedEvidenceCount: number;
  verificationOutcome: VerificationOutcome;
  finalEvidenceCount: number;
  rejectionReason?: Record<string, number>;
};

export function normalizeEvidenceKey(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function signalIdentity(signal: ResearchSignal) {
  return signal.sourceUrl || signal.id || normalizeEvidenceKey(`${signal.title} ${signal.publisher}`);
}

export function claimIdentity(claim: ResearchSignal["claims"][number]) {
  return `${claim.sourceUrl || ""}:${normalizeEvidenceKey(claim.claimText)}`;
}

export function sourceIdentity(source: ResearchSignal["sources"][number]) {
  return source.sourceUrl || `${source.publisher}:${source.publishedAt ?? ""}`;
}

export function verificationRank(status: VerificationStatus) {
  return ({ unverified: 0, partially_verified: 1, conflicting: 2, verified: 3 })[status] ?? 0;
}

export function strongerVerification(a: VerificationStatus, b: VerificationStatus) {
  return verificationRank(b) > verificationRank(a) ? b : a;
}

function evidenceIdentity(record: EvidenceRecord) {
  return `${record.canonicalUrl}:${normalizeEvidenceKey(record.evidenceSnippet)}`;
}

function mergeEvidenceRecords(previous: EvidenceRecord[], next: EvidenceRecord[]) {
  const merged = new Map<string, EvidenceRecord>();
  for (const record of [...previous, ...next]) {
    const key = evidenceIdentity(record);
    const current = merged.get(key);
    merged.set(key, current
      ? {
          ...current,
          ...record,
          verificationStatus: strongerVerification(current.verificationStatus, record.verificationStatus),
        }
      : record);
  }
  return [...merged.values()];
}

export function evidenceRecordsFromResponse(response: ResearchResponse | undefined) {
  if (!response) return [];
  return mergeEvidenceRecords(
    response.evidenceRecords ?? [],
    response.signals.flatMap((signal) => recordsFromSignal(signal).evidence),
  );
}

export function countEvidence(response: ResearchResponse | undefined) {
  return evidenceRecordsFromResponse(response).length;
}

function acceptedEvidenceRecords(response: ResearchResponse | undefined) {
  if (!response) return [];
  return mergeEvidenceRecords(
    [],
    response.signals.flatMap((signal) => recordsFromSignal(signal).evidence),
  );
}

function finalEvidenceCount(response: ResearchResponse | undefined) {
  return acceptedEvidenceRecords(response).length;
}

function acceptedEvidenceCount(response: ResearchResponse | undefined) {
  return finalEvidenceCount(response);
}

function rejectedEvidenceCount(response: ResearchResponse | undefined) {
  if (!response) return 0;
  return Math.max(0, countEvidence(response) - acceptedEvidenceCount(response));
}

function mergeRejectionReasons(
  previous: FilteringSummary["filteredReasons"] | undefined,
  next: FilteringSummary["filteredReasons"] | undefined,
) {
  if (!previous && !next) return undefined;
  return {
    stale: Math.max(previous?.stale ?? 0, next?.stale ?? 0),
    duplicate: Math.max(previous?.duplicate ?? 0, next?.duplicate ?? 0),
    lowReliability: Math.max(previous?.lowReliability ?? 0, next?.lowReliability ?? 0),
    insufficientVerification: Math.max(previous?.insufficientVerification ?? 0, next?.insufficientVerification ?? 0),
    background: Math.max(previous?.background ?? 0, next?.background ?? 0),
    lowNovelty: Math.max(previous?.lowNovelty ?? 0, next?.lowNovelty ?? 0),
    unresolvedConflict: Math.max(previous?.unresolvedConflict ?? 0, next?.unresolvedConflict ?? 0),
    lowActionability: Math.max(previous?.lowActionability ?? 0, next?.lowActionability ?? 0),
    noInformationGain: Math.max(previous?.noInformationGain ?? 0, next?.noInformationGain ?? 0),
    insufficientContent: Math.max(previous?.insufficientContent ?? 0, next?.insufficientContent ?? 0),
  };
}

function mergeResponseSourceOutcomes(previous: ResearchResponse | undefined, next: ResearchResponse) {
  if (!previous?.sourceOutcomes?.length) return next;
  const merged = new Map<string, NonNullable<ResearchResponse["sourceOutcomes"]>[number]>();
  for (const outcome of [...previous.sourceOutcomes, ...(next.sourceOutcomes ?? [])]) {
    const key = `${outcome.sourceType}:${outcome.providerId}`;
    const current = merged.get(key);
    merged.set(key, current
      ? {
          ...outcome,
          executed: current.executed || outcome.executed,
          resultCount: current.resultCount + outcome.resultCount,
          requestCount: (current.requestCount || 0) + (outcome.requestCount || 0),
          newEvidenceCount: current.newEvidenceCount + outcome.newEvidenceCount,
          newClaimCount: current.newClaimCount + outcome.newClaimCount,
          reliabilityGain: Math.max(current.reliabilityGain, outcome.reliabilityGain),
          conflictReduction: Math.max(current.conflictReduction, outcome.conflictReduction),
        }
      : outcome);
  }
  next.sourceOutcomes = [...merged.values()];
  return next;
}

function mergeFilteringSummary(previous: FilteringSummary | undefined, next: FilteringSummary | undefined) {
  if (!previous) return next;
  if (!next) return previous;
  const nextIsEmpty = next.retrievedCount === 0 && next.clusteredCount === 0 && next.displayedCount === 0;
  return nextIsEmpty ? previous : next;
}

function mergeOverview(previous: ResearchOverview, next: ResearchOverview) {
  const nextIsEmpty = next.scanned === 0 && next.events === 0 && next.relevant === 0;
  return nextIsEmpty ? previous : next;
}

export function mergeRoundAttempts(previous: ResearchResponse | undefined, next: ResearchResponse) {
  return mergeResearchResponses(previous, next);
}

function mergeSignals(previous: ResearchSignal, next: ResearchSignal): ResearchSignal {
  const claims = new Map(previous.claims.map((claim) => [claimIdentity(claim), claim]));
  for (const claim of next.claims) {
    const key = claimIdentity(claim);
    const current = claims.get(key);
    claims.set(key, current
      ? {
          ...current,
          ...claim,
          verificationStatus: strongerVerification(current.verificationStatus, claim.verificationStatus),
          independentEvidenceCount: Math.max(current.independentEvidenceCount, claim.independentEvidenceCount),
          evidenceSources: [
            ...current.evidenceSources,
            ...claim.evidenceSources.filter((source) =>
              !current.evidenceSources.some((existing) => existing.sourceUrl === source.sourceUrl && existing.publisher === source.publisher),
            ),
          ],
        }
      : claim);
  }
  const sources = new Map(previous.sources.map((source) => [sourceIdentity(source), source]));
  for (const source of next.sources) sources.set(sourceIdentity(source), source);
  return {
    ...previous,
    ...next,
    verificationStatus: strongerVerification(previous.verificationStatus, next.verificationStatus),
    truth: Math.max(previous.truth, next.truth),
    confidence: Math.max(previous.confidence, next.confidence),
    reliabilityScore: Math.max(previous.reliabilityScore, next.reliabilityScore),
    sourceCount: Math.max(previous.sourceCount, next.sourceCount, sources.size),
    independentEvidenceCount: Math.max(previous.independentEvidenceCount, next.independentEvidenceCount),
    claims: [...claims.values()],
    sources: [...sources.values()],
  };
}

function mergeResearchResponses(previous: ResearchResponse | undefined, next: ResearchResponse): ResearchResponse {
  if (!previous) {
    return {
      ...next,
      evidenceRecords: evidenceRecordsFromResponse(next),
      evidenceAccounting: next.evidenceAccounting
        ? {
            ...next.evidenceAccounting,
            producedEvidenceCount: countEvidence(next),
            cumulativeEvidenceCount: countEvidence(next),
            evaluatedEvidenceCount: countEvidence(next),
            acceptedEvidenceCount: acceptedEvidenceCount(next),
            rejectedEvidenceCount: rejectedEvidenceCount(next),
            finalEvidenceCount: finalEvidenceCount(next),
          }
        : undefined,
    };
  }
  const signals = new Map(previous.signals.map((signal) => [signalIdentity(signal), signal]));
  for (const signal of next.signals) {
    const key = signalIdentity(signal);
    const current = signals.get(key);
    signals.set(key, current ? mergeSignals(current, signal) : signal);
  }
  const mergedSignals = [...signals.values()];
  const mergedEvidenceRecords = mergeEvidenceRecords(
    evidenceRecordsFromResponse(previous),
    evidenceRecordsFromResponse(next),
  );
  const acceptedCount = acceptedEvidenceRecords({ ...next, signals: mergedSignals }).length;
  return mergeResponseSourceOutcomes(previous, {
    ...next,
    signals: mergedSignals,
    evidenceRecords: mergedEvidenceRecords,
    status: [...previous.status, ...next.status],
    progress: [...previous.progress, ...next.progress],
    failures: [...previous.failures, ...next.failures],
    dataMode: previous.dataMode === next.dataMode ? next.dataMode : "mixed",
    sourceDiagnostics: [...(previous.sourceDiagnostics ?? []), ...(next.sourceDiagnostics ?? [])],
    filteringSummary: mergeFilteringSummary(previous.filteringSummary, next.filteringSummary),
    overview: mergeOverview(previous.overview, next.overview),
    evidenceAccounting: {
      discoveredCandidateCount: Math.max(
        previous.evidenceAccounting?.discoveredCandidateCount ?? previous.overview?.deduplicated ?? 0,
        next.evidenceAccounting?.discoveredCandidateCount ?? next.overview?.deduplicated ?? 0,
      ),
      producedEvidenceCount: Math.max(
        mergedEvidenceRecords.length,
      ),
      cumulativeEvidenceCount: mergedEvidenceRecords.length,
      evaluatedEvidenceCount: Math.max(
        mergedEvidenceRecords.length,
      ),
      acceptedEvidenceCount: Math.max(
        acceptedCount,
      ),
      rejectedEvidenceCount: Math.max(
        0,
        mergedEvidenceRecords.length - acceptedCount,
      ),
      finalEvidenceCount: Math.max(
        acceptedCount,
      ),
      rejectionReasons: mergeRejectionReasons(
        previous.evidenceAccounting?.rejectionReasons,
        next.evidenceAccounting?.rejectionReasons,
      ),
    },
  });
}

function verificationOutcome(roundResponse: ResearchResponse, carriedForwardEvidenceCount: number): VerificationOutcome {
  if (roundResponse.signals.length) {
    return roundResponse.signals.some((signal) => signal.verificationStatus === "verified")
      ? "verification_success"
      : "verification_insufficient";
  }
  return carriedForwardEvidenceCount > 0 ? "carried_forward_without_new_verification" : "no_evidence";
}

export class ResearchRunState {
  private response?: ResearchResponse;

  get cumulativeResponse() {
    return this.response;
  }

  get cumulativeEvidenceCount() {
    return countEvidence(this.response);
  }

  get finalEvidenceCount() {
    return finalEvidenceCount(this.response);
  }

  mergeRoundResponse(roundResponse: ResearchResponse): EvidencePreservationSnapshot {
    const carriedForwardEvidenceCount = this.cumulativeEvidenceCount;
    this.response = mergeResearchResponses(this.response, roundResponse);
    const roundEvidenceCount = countEvidence(roundResponse);
    const cumulativeEvidenceCount = countEvidence(this.response);
    return {
      roundEvidenceCount,
      producedEvidenceCount: roundEvidenceCount,
      cumulativeEvidenceCount,
      carriedForwardEvidenceCount,
      acceptedEvidenceCount: acceptedEvidenceCount(this.response),
      rejectedEvidenceCount: rejectedEvidenceCount(this.response),
      verificationOutcome: verificationOutcome(roundResponse, carriedForwardEvidenceCount),
      finalEvidenceCount: finalEvidenceCount(this.response),
      rejectionReason: this.response.evidenceAccounting?.rejectionReasons,
    };
  }

  providerFailureSnapshot(): EvidencePreservationSnapshot {
    const cumulativeEvidenceCount = this.cumulativeEvidenceCount;
    return {
      roundEvidenceCount: 0,
      producedEvidenceCount: 0,
      cumulativeEvidenceCount,
      carriedForwardEvidenceCount: cumulativeEvidenceCount,
      acceptedEvidenceCount: acceptedEvidenceCount(this.response),
      rejectedEvidenceCount: rejectedEvidenceCount(this.response),
      verificationOutcome: "provider_failure_carried_forward",
      finalEvidenceCount: finalEvidenceCount(this.response),
      rejectionReason: this.response?.evidenceAccounting?.rejectionReasons,
    };
  }
}
