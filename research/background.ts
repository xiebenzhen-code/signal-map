import { freshnessWindowHours, resolveFreshness } from "../information/freshness.ts";
import type { BackgroundMaterial, ResearchCandidate } from "./types.ts";

/** Split before clustering/scoring; missing or invalid dates are not historical background. */
export function partitionBackground(candidates: ResearchCandidate[], window: string) {
  const current: ResearchCandidate[] = [];
  const background = new Map<string, BackgroundMaterial>();
  for (const candidate of candidates) {
    const freshness = resolveFreshness(candidate);
    const published = Date.parse(candidate.publishedAt ?? "");
    if (freshness.timestampStatus === "valid" && freshness.ageHours !== undefined &&
        freshness.ageHours > freshnessWindowHours(window) && Number.isFinite(published)) {
      background.set(candidate.url, {title: candidate.title, source: candidate.source,
        url: candidate.url, publishedAt: new Date(published).toISOString()});
    } else {
      current.push(candidate);
    }
  }
  return {current, background: [...background.values()]};
}
