import type { ResearchResponse, ResearchSignal, VerificationStatus } from "../research/types.ts";

export type VerificationOutcome =
  | "verification_success"
  | "verification_insufficient"
  | "carried_forward_without_new_verification"
  | "provider_failure_carried_forward"
  | "no_evidence";

export type EvidencePreservationSnapshot = {
  roundEvidenceCount: number;
  cumulativeEvidenceCount: number;
  carriedForwardEvidenceCount: number;
  verificationOutcome: VerificationOutcome;
  finalEvidenceCount: number;
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

export function countEvidence(response: ResearchResponse | undefined) {
  return response?.signals.reduce((count, signal) => count + signal.claims.length, 0) ?? 0;
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

export function mergeRoundAttempts(previous: ResearchResponse | undefined, next: ResearchResponse) {
  return mergeResponseSourceOutcomes(previous, next);
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
  if (!previous) return next;
  const signals = new Map(previous.signals.map((signal) => [signalIdentity(signal), signal]));
  for (const signal of next.signals) {
    const key = signalIdentity(signal);
    const current = signals.get(key);
    signals.set(key, current ? mergeSignals(current, signal) : signal);
  }
  return mergeResponseSourceOutcomes(previous, {
    ...next,
    signals: [...signals.values()],
    status: [...previous.status, ...next.status],
    progress: [...previous.progress, ...next.progress],
    failures: [...previous.failures, ...next.failures],
    dataMode: previous.dataMode === next.dataMode ? next.dataMode : "mixed",
    sourceDiagnostics: [...(previous.sourceDiagnostics ?? []), ...(next.sourceDiagnostics ?? [])],
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

  mergeRoundResponse(roundResponse: ResearchResponse): EvidencePreservationSnapshot {
    const carriedForwardEvidenceCount = this.cumulativeEvidenceCount;
    this.response = mergeResearchResponses(this.response, roundResponse);
    const roundEvidenceCount = countEvidence(roundResponse);
    const cumulativeEvidenceCount = countEvidence(this.response);
    return {
      roundEvidenceCount,
      cumulativeEvidenceCount,
      carriedForwardEvidenceCount,
      verificationOutcome: verificationOutcome(roundResponse, carriedForwardEvidenceCount),
      finalEvidenceCount: cumulativeEvidenceCount,
    };
  }

  providerFailureSnapshot(): EvidencePreservationSnapshot {
    const cumulativeEvidenceCount = this.cumulativeEvidenceCount;
    return {
      roundEvidenceCount: 0,
      cumulativeEvidenceCount,
      carriedForwardEvidenceCount: cumulativeEvidenceCount,
      verificationOutcome: "provider_failure_carried_forward",
      finalEvidenceCount: cumulativeEvidenceCount,
    };
  }
}
