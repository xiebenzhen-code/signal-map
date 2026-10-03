// Title-based correspondence check for wrapper resolution: does a candidate
// page (or a search-result anchor) actually correspond to the original
// candidate article? Similarity is order-sensitive (character-trigram Dice) so
// a reworded same-topic headline scores far below a format-variant of the same
// headline. Same-domain, keyword overlap, or HTTP 200 alone never confirm a
// match — callers must combine this with hostname and safety checks.

export const TITLE_CORRESPONDENCE_THRESHOLD = 0.6;

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function trigrams(value: string) {
  const padded = ` ${value} `;
  const set = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) set.add(padded.slice(index, index + 3));
  return set;
}

export function titleMatchScore(originalTitle: string, candidateTitle: string): number {
  const original = normalizeTitle(originalTitle);
  const candidate = normalizeTitle(candidateTitle);
  if (!original || !candidate) return 0;
  const originalTrigrams = trigrams(original);
  const candidateTrigrams = trigrams(candidate);
  let shared = 0;
  for (const gram of originalTrigrams) if (candidateTrigrams.has(gram)) shared += 1;
  return (2 * shared) / (originalTrigrams.size + candidateTrigrams.size);
}

// True when any page-title variant (title tag / og:title / h1) corresponds to
// the original candidate title. Missing material on either side is never a
// match — callers stay unresolved instead of guessing.
export function titlesCorrespond(
  originalTitle: string | undefined,
  pageTitleVariants: Array<string | undefined | null>,
): boolean {
  const variants = pageTitleVariants.filter((variant): variant is string => Boolean(variant && variant.trim()));
  if (!originalTitle?.trim() || variants.length === 0) return false;
  return variants.some((variant) => titleMatchScore(originalTitle, variant) >= TITLE_CORRESPONDENCE_THRESHOLD);
}
