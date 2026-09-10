import type { CleanedContent, ExtractedClaim } from "./types.ts";

function terms(value: string) {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12);
}

export function buildEvidenceSnippet(cleaned: CleanedContent, claim: ExtractedClaim) {
  if (cleaned.quality !== "VALID" || claim.quality !== "VALID") return "";
  if (cleaned.mainContent.includes(claim.statement)) return claim.statement;
  const claimTerms = terms(claim.statement);
  const ranked = cleaned.mainContent
    .split(/(?<=[。.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((sentence) => ({
      sentence,
      score: claimTerms.filter((term) => sentence.toLowerCase().includes(term)).length,
    }))
    .sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length)
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item) => item.sentence);
  return ranked.join(" ").slice(0, 360);
}
