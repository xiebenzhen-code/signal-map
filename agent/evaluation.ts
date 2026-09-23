import type { ResearchResponse, ResearchSignal } from "../research/types.ts";
import type { EvidenceEvaluation, KnowledgeChange } from "./types.ts";
import {
  canonicalizeUrl,
  claimFingerprint,
  type EvidenceRecord,
  type PersonalKnowledgeRecord,
} from "../information/rag-records.ts";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const FACT_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with",
  "支持", "可以", "能够", "的", "了", "和", "与", "在", "是", "为",
]);

function factTokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token && !FACT_STOPWORDS.has(token)));
}

function equivalentClaim(left: string, right: string) {
  const leftTokens = factTokens(left);
  const rightTokens = factTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size) >= 0.8;
}

function relatedToKnowledge(signal: ResearchSignal, known: string[]) {
  const text = normalize(`${signal.originalTitle || signal.title} ${signal.originalSummary || signal.summary}`);
  return known.some((item) => {
    const normalized = normalize(item);
    return normalized.length > 8 && (text.includes(normalized) || normalized.includes(text));
  });
}

type KnowledgeIdentity = {
  sourceUrls: Set<string>;
  claimFingerprints: Set<string>;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function recordPayload(record: PersonalKnowledgeRecord) {
  return record.structuredPayload && typeof record.structuredPayload === "object"
    ? record.structuredPayload as Record<string, unknown>
    : undefined;
}

function identityFromRecord(
  record: PersonalKnowledgeRecord,
  evidenceById: Map<string, EvidenceRecord>,
): KnowledgeIdentity {
  const payload = recordPayload(record);
  const sourceUrls = new Set(
    [
      ...stringArray(payload?.sourceUrls),
      ...stringArray(payload?.supportingSourceUrls),
      ...stringArray(payload?.sourceUrl),
      ...stringArray(payload?.supportingEvidenceIds)
        .map((id) => evidenceById.get(id)?.canonicalUrl || evidenceById.get(id)?.sourceUrl)
        .filter((url): url is string => Boolean(url)),
    ]
      .map(canonicalizeUrl)
      .filter(Boolean),
  );
  const claimFingerprints = new Set([
    ...stringArray(payload?.claimFingerprints),
    ...stringArray(payload?.supportingClaimIds),
  ].map(normalize).filter(Boolean));
  return { sourceUrls, claimFingerprints };
}

function identityFromSignal(signal: ResearchSignal): KnowledgeIdentity {
  const sourceUrls = new Set(
    [
      signal.sourceUrl,
      ...signal.sources.map((source) => source.sourceUrl),
      ...signal.claims.map((claim) => claim.sourceUrl),
      ...signal.claims.flatMap((claim) => claim.evidenceSources.map((source) => source.sourceUrl)),
    ]
      .map(canonicalizeUrl)
      .filter(Boolean),
  );
  const claimFingerprints = new Set(
    (signal.claims.length
      ? signal.claims.map(claimFingerprint)
      : [normalize(signal.originalTitle || signal.title)])
      .map(normalize)
      .filter(Boolean),
  );
  return { sourceUrls, claimFingerprints };
}

function intersects(left: Set<string>, right: Set<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

type InformationGainMatch = "DUPLICATE" | "UPDATE" | undefined;

function matchPersistedKnowledge(
  signal: ResearchSignal,
  records: PersonalKnowledgeRecord[],
  evidenceById: Map<string, EvidenceRecord>,
): InformationGainMatch {
  const current = identityFromSignal(signal);
  for (const record of records.filter((candidate) => candidate.type === "KNOWN_INFORMATION")) {
    const persisted = identityFromRecord(record, evidenceById);
    if (!persisted.claimFingerprints.size) continue;
    const sameClaim = intersects(current.claimFingerprints, persisted.claimFingerprints);
    const equivalentClaimMatch = [...current.claimFingerprints].some((currentClaim) =>
      [...persisted.claimFingerprints].some((persistedClaim) => equivalentClaim(currentClaim, persistedClaim)),
    );
    if (sameClaim || equivalentClaimMatch) return "DUPLICATE";
    if (intersects(current.sourceUrls, persisted.sourceUrls)) return "UPDATE";
  }
  return undefined;
}

export function reconcileInformationGain(
  response: ResearchResponse,
  persistedKnowledge: PersonalKnowledgeRecord[] = [],
  persistedEvidence: EvidenceRecord[] = [],
) {
  const evidenceById = new Map(persistedEvidence.map((record) => [record.id, record]));
  for (const signal of response.signals) {
    const match = matchPersistedKnowledge(signal, persistedKnowledge, evidenceById);
    if (match === "DUPLICATE") {
      signal.informationGainStatus = "NO_INFORMATION_GAIN";
      signal.knowledgeStatus = "KNOWN";
    } else if (match === "UPDATE") {
      signal.informationGainStatus = "UPDATED_INFORMATION";
      signal.knowledgeStatus = "UPDATED";
    } else if (!signal.informationGainStatus) {
      signal.informationGainStatus = "NEW_INFORMATION";
    }
  }
  return response;
}

// Provisional research-stage attention may be stale once knowledge reconciliation
// has determined the signal carries no new information. Downgrade high-priority
// attention for such signals instead of surfacing an already-known fact as urgent.
export function reconcileAttentionDecision(signal: ResearchSignal): void {
  if (
    signal.informationGainStatus === "NO_INFORMATION_GAIN" &&
    (signal.attentionDecision === "MUST_READ" || signal.attentionDecision === "WORTH_WATCHING")
  ) {
    signal.attentionDecision = "LIBRARY_ONLY";
  }
}

// A user preference (e.g. "don't actively notify me about this entity") is a
// personal-attention modifier: it lowers how loudly a matching signal is surfaced,
// but it never rewrites whether the underlying fact is true. Factual knowledge,
// evidence and verification are untouched.
export function applyAttentionPreferences(
  response: ResearchResponse,
  preferences: Array<{ scopeType: string; scopeValue: string; feedbackType: string }>,
): void {
  if (!preferences.length) return;
  const lowerAttention = preferences.filter((pref) => pref.feedbackType === "LOWER_ATTENTION");
  if (!lowerAttention.length) return;
  for (const signal of response.signals) {
    const matches = lowerAttention.some((pref) =>
      pref.scopeType === "entity"
        ? signal.entityMatches.some((entity) => entity.toLowerCase() === pref.scopeValue.toLowerCase())
        : pref.scopeType === "topic"
          ? `${signal.originalTitle || signal.title} ${signal.originalSummary || signal.summary}`
            .toLowerCase()
            .includes(pref.scopeValue.toLowerCase())
          : false,
    );
    if (matches && (signal.attentionDecision === "MUST_READ" || signal.attentionDecision === "WORTH_WATCHING")) {
      signal.attentionDecision = "LIBRARY_ONLY";
    }
  }
}

export function evaluateEvidence(response: ResearchResponse, round: number, maxRounds: number): EvidenceEvaluation {
  const signals = response.signals;
  const topicRelevant = signals.filter((signal) => signal.topicRelevance?.decision !== "TOPIC_MISMATCH");
  const conflictSignals = topicRelevant.filter((signal) => signal.verificationStatus === "conflicting");
  const conflictDetected = conflictSignals.length > 0;
  const reliable = topicRelevant.filter((signal) => signal.verificationStatus === "verified");
  const socialOnly = topicRelevant.length > 0 && topicRelevant.every((signal) => signal.informationType === "SIGNAL" || signal.sourceType === "social");
  const informationGain = topicRelevant.filter((signal) =>
    signal.informationGainStatus !== "NO_INFORMATION_GAIN" &&
    signal.knowledgeStatus !== "KNOWN" &&
    signal.noveltyScore >= 38,
  ).length;
  const sufficientEvidence = reliable.length > 0 && !conflictDetected;
  const shouldContinue = round < maxRounds && (!sufficientEvidence || conflictDetected || socialOnly) && informationGain > 0;
  let reason = sufficientEvidence ? "已有一致的高可靠证据" : "当前证据尚不足以确认结论";
  if (conflictDetected) reason = "检测到冲突 Claim，下一轮优先补充更可靠来源";
  if (socialOnly) reason = "当前只有 Social/Signal 线索，继续寻找官方或可信来源";
  if (!informationGain && round > 1) reason = "连续一轮没有明显新增信息";
  return {
    decision: shouldContinue ? "CONTINUE" : "STOP",
    sufficientEvidence,
    conflictDetected,
    conflictingClaims: conflictSignals.flatMap((signal) => signal.claims.map((claim) => claim.claimText)),
    preferredNextSourceType: conflictDetected || socialOnly ? "primary" : undefined,
    informationGain,
    reason: round >= maxRounds && shouldContinue ? "达到最大研究轮数" : reason,
  };
}

export function compareKnowledge(
  response: ResearchResponse,
  knownInformation: string,
  previousRevision: number,
  persistedKnowledge: PersonalKnowledgeRecord[] = [],
  persistedEvidence: EvidenceRecord[] = [],
): KnowledgeChange[] {
  const known = knownInformation.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean);
  const evidenceById = new Map(persistedEvidence.map((record) => [record.id, record]));
  return response.signals.map((signal) => {
    const knownMatch = relatedToKnowledge(signal, known);
    const identityMatch = matchPersistedKnowledge(signal, persistedKnowledge, evidenceById);
    const isConflict = signal.verificationStatus === "conflicting";
    const isUpdate = signal.eventStatus === "UPDATED" || signal.knowledgeStatus === "UPDATED";
    const noInformationGain =
      identityMatch === "DUPLICATE" ||
      signal.informationGainStatus === "NO_INFORMATION_GAIN" ||
      signal.knowledgeStatus === "KNOWN";
    const classification = isConflict
      ? "CONTRADICTS"
      : noInformationGain
        ? "DUPLICATE"
      : identityMatch === "UPDATE" || isUpdate
        ? "UPDATES"
          : knownMatch
            ? "CONFIRMS"
            : "NEW";
    return {
      signalId: signal.id,
      classification,
      supportingEvidenceIds: signal.claims.map((claim) => claim.sourceUrl),
      previousRevision,
      currentRevision: classification === "NEW" || classification === "UPDATES" || classification === "CONTRADICTS" ? previousRevision + 1 : previousRevision,
      reason: classification === "DUPLICATE"
        ? "NO_INFORMATION_GAIN：与已有 Knowledge State 高度重合"
        : `基于 ${signal.verificationStatus} evidence 与事件状态判断`,
    };
  });
}
