import type { LiveItem, SocialEvidenceChain } from "./providers/types.ts";

export type SocialEvidenceDedupResult<T extends LiveItem = LiveItem> = {
  representatives: T[];
  chains: SocialEvidenceChain[];
  independentEvidenceCount: number;
};

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `social-${Math.abs(hash)}`;
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return `${url.protocol}//${host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}

function claimFingerprint(item: LiveItem) {
  const normalized = `${item.title} ${item.snippet}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:quote|quoted|rt)\s*:?/g, " ")
    .replace(/\b(?:a|an|the|of|to|and|for|with|from)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stableHash(normalized || canonicalUrl(item.url) || item.url);
}

export function deduplicateSocialEvidence<T extends LiveItem>(items: T[]): SocialEvidenceDedupResult<T> {
  const byFingerprint = new Map<string, { representative: T; chain: SocialEvidenceChain }>();
  for (const item of items) {
    const canonicalSourceUrl = canonicalUrl(item.url);
    const canonicalClaimFingerprint = claimFingerprint(item);
    const key = canonicalClaimFingerprint || canonicalSourceUrl || item.url;
    const existing = byFingerprint.get(key);
    if (existing) {
      existing.chain.propagationCount += 1;
      continue;
    }
    const chain: SocialEvidenceChain = {
      evidenceChainId: stableHash(`${canonicalClaimFingerprint}:${canonicalSourceUrl || item.url}`),
      canonicalClaimFingerprint,
      canonicalSourceUrl,
      representativeSourceUrl: item.url,
      propagationCount: 1,
    };
    byFingerprint.set(key, {
      representative: { ...item, socialEvidenceChain: chain },
      chain,
    });
  }
  const entries = [...byFingerprint.values()];
  return {
    representatives: entries.map((entry) => entry.representative),
    chains: entries.map((entry) => entry.chain),
    independentEvidenceCount: entries.length,
  };
}
