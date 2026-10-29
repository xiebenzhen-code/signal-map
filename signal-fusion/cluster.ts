import { hasOppositeClaims } from "./claim-conflict.ts";
import type { FusionEvidence, SignalCluster, SourceRole } from "./types.ts";

export function normalizeClaim(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an|and|or|to|for|of|in|on|with|latest|update|official|最近|官方|更新|发布)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function canonicalSource(evidence: FusionEvidence) {
  const upstream = evidence.upstreamSource?.trim().toLowerCase();
  if (upstream) return upstream;
  return hostOf(evidence.sourceUrl) || evidence.publisher.trim().toLowerCase();
}

export function sourceRoleForEvidence(evidence: FusionEvidence): SourceRole {
  const value = `${evidence.publisher} ${evidence.sourceUrl}`.toLowerCase();
  if (evidence.sourceType === "primary" || evidence.sourceTier === "S") return "PRIMARY";
  if (evidence.sourceType === "trusted_media") return "AUTHORITATIVE_MEDIA";
  if (/product hunt/.test(value)) return "EARLY_SIGNAL";
  if (/github|huggingface|arxiv|hacker news|news\.ycombinator|stackoverflow|dev\.to/.test(value)) {
    return "TECH_COMMUNITY";
  }
  if (evidence.sourceType === "social" || evidence.sourceTier === "C") return "EARLY_SIGNAL";
  return "BACKGROUND";
}

function timeScope(evidence: FusionEvidence[]) {
  const times = evidence
    .map((item) => item.publishedAt ? new Date(item.publishedAt).getTime() : NaN)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!times.length) return undefined;
  const first = new Date(times[0]).toISOString().slice(0, 10);
  const last = new Date(times[times.length - 1]).toISOString().slice(0, 10);
  return first === last ? first : `${first}/${last}`;
}

function conflictState(evidence: FusionEvidence[]) {
  if (evidence.some((item) => item.verificationStatus === "conflicting")) return "conflicting" as const;
  return hasOppositeClaims(evidence.map(item => item.claim)) ? "unresolved" as const : "none" as const;
}

export function buildSignalCluster(evidence: FusionEvidence[]): SignalCluster {
  const first = evidence[0];
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const independentSources = new Set<string>();
  let duplicateCount = 0;
  for (const item of evidence) {
    let url = item.sourceUrl;
    try { const parsed = new URL(url); parsed.hash = ''; url = parsed.href; } catch { /* retain original identity */ }
    const fullText = item.contentText?.toLowerCase().replace(/\s+/gu, ' ').trim();
    // A title alone cannot establish that two official announcements are copies.
    const content = fullText ? `body:${fullText}` : (sourceRoleForEvidence(item) !== 'PRIMARY' ? `claim:${canonicalSource(item)}:${normalizeClaim(item.claim)}` : undefined);
    const repeated = seenUrls.has(url) || Boolean(content && seenContent.has(content));
    if (repeated) duplicateCount++;
    else independentSources.add(canonicalSource(item));
    seenUrls.add(url);
    if (content) seenContent.add(content);
  }

  const canonicalSources = Array.from(new Set(evidence.map(canonicalSource).filter(Boolean)));
  const sourceRoles = Array.from(new Set(evidence.map(sourceRoleForEvidence)));
  const normalizedClaim = normalizeClaim(first?.claim || "");
  return {
    clusterId: `cluster-${normalizedClaim.replace(/\s+/g, "-").slice(0, 64) || "unknown"}`,
    entity: first?.entity || "unknown",
    topic: first?.topic || "general",
    normalizedClaim,
    timeScope: timeScope(evidence),
    evidenceIds: evidence.map((item) => item.evidenceId),
    sourceRoles,
    independentSourceCount: independentSources.size,
    duplicateCount,
    conflictState: conflictState(evidence),
    canonicalSources,
  };
}
