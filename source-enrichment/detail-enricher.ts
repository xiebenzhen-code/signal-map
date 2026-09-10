import { cleanContent, extractClaim } from "../content-processing/index.ts";
import type { DetailEnrichmentInput, DetailEnrichmentResult, SourceCapabilityRole } from "./types.ts";
import { enrichHuggingFaceDetail } from "./resolvers/hugging-face.ts";
import { enrichProductHuntDetail } from "./resolvers/product-hunt.ts";

export const maxDetailFetchesPerRound = 5;

export function sourceCapability(providerId: string): SourceCapabilityRole {
  if (providerId === "product-hunt") return "DISCOVERY";
  if (providerId === "huggingface") return "DISCOVERY";
  if (providerId === "company-registry" || providerId === "official-update-pages") return "EVIDENCE";
  if (providerId === "github-releases") return "BOTH";
  return "EVIDENCE";
}

export function shouldEnrichDetail(input: {
  providerId?: string;
  title: string;
  snippet?: string;
  potentialScore: number;
}) {
  if (!input.providerId || sourceCapability(input.providerId) !== "DISCOVERY") return false;
  if (input.potentialScore < 50) return false;
  const cleaned = cleanContent(`${input.title}\n${input.snippet || ""}`, input.title);
  const claim = extractClaim(cleaned, input.title);
  return cleaned.quality === "INSUFFICIENT_CONTENT" || claim.quality === "INSUFFICIENT_CONTENT";
}

export async function enrichDetail(input: DetailEnrichmentInput): Promise<DetailEnrichmentResult> {
  if (input.providerId === "product-hunt") return enrichProductHuntDetail(input);
  if (input.providerId === "huggingface") return enrichHuggingFaceDetail(input);
  return {
    status: "UNSUPPORTED",
    canonicalUrl: input.url,
    title: input.title,
    discoveredBy: input.providerId,
  };
}
