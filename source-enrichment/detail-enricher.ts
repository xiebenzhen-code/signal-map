import { cleanContent, extractClaim } from "../content-processing/index.ts";
import type { DetailEnrichmentInput, DetailEnrichmentResult, SourceCapabilityRole } from "./types.ts";
import { enrichHuggingFaceDetail } from "./resolvers/hugging-face.ts";
import { enrichProductHuntDetail } from "./resolvers/product-hunt.ts";
import { htmlTitle, isThinDetail, metaContent, stripHtmlForDetail } from "./resolvers/shared.ts";
import { discardResponseBody } from "../lib/http-response.ts";

export const maxDetailFetchesPerRound = 5;

const LOOPBACK_HOSTS = new Set(["localhost", "localtest.me", "loopback", "0.0.0.0", "::", "::1"]);

function ipLiteralPrivate(host: string) {
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // IPv6 literal: loopback (::1 / ::ffff:127.*), link-local (fe80::), ULA (fc/fd::).
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(":")) {
    const lower = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      lower === "::1" ||
      lower.startsWith("::ffff:7f") ||
      lower.startsWith("fe80") ||
      /^f[c-d]/.test(lower) ||
      lower.startsWith("::")
    ) return true;
  }
  return false;
}

// SSRF guard for outbound detail fetches: only public http(s) URLs, and never
// loopback / private / link-local literals. DNS rebinding to a private address
// is out of scope for this minimal safety surface.
export function isSafeDetailUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (ipLiteralPrivate(host)) return false;
  return true;
}

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
  url?: string;
  /** True when the candidate already passed topic relevance (guaranteed for admitted EVIDENCE candidates). */
  isRelevant?: boolean;
}) {
  if (!input.providerId) return false;
  if (input.potentialScore < 50) return false;
  const cleaned = cleanContent(`${input.title}\n${input.snippet || ""}`, input.title);
  const claim = extractClaim(cleaned, input.title);
  const insufficient = cleaned.quality === "INSUFFICIENT_CONTENT" || claim.quality === "INSUFFICIENT_CONTENT";
  if (!insufficient) return false;
  // Existing DISCOVERY providers keep enrichment (content already insufficient).
  if (sourceCapability(input.providerId) === "DISCOVERY") return true;
  // New: a relevant candidate that needs content completed and has a safe canonicalUrl.
  return Boolean(input.isRelevant && input.url && isSafeDetailUrl(input.url));
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await discardResponseBody(response);
    return undefined;
  }
  return response.text();
}

export async function enrichGenericDetail(input: DetailEnrichmentInput): Promise<DetailEnrichmentResult> {
  if (!input.url) return { status: "NO_DETAIL", discoveredBy: input.providerId || "detail" };
  try {
    const html = await fetchHtml(input.url);
    if (!html) return { status: "FETCH_FAILED", canonicalUrl: input.url, discoveredBy: input.providerId || "detail" };
    const body = [
      htmlTitle(html),
      metaContent(html, "description"),
      metaContent(html, "og:description"),
      stripHtmlForDetail(html).slice(0, 1400),
    ].filter(Boolean).join("\n");
    if (isThinDetail(body)) {
      return { status: "TOO_THIN", canonicalUrl: input.url, rawContent: body, contentType: "html", discoveredBy: input.providerId || "detail", title: input.title };
    }
    return {
      status: "SUCCESS",
      canonicalUrl: input.url,
      title: input.title || htmlTitle(html),
      rawContent: body,
      contentType: "html",
      discoveredBy: input.providerId || "detail",
      evidenceFrom: "Detail page",
    };
  } catch {
    return { status: "FETCH_FAILED", canonicalUrl: input.url, discoveredBy: input.providerId || "detail" };
  }
}

export async function enrichDetail(input: DetailEnrichmentInput): Promise<DetailEnrichmentResult> {
  if (input.providerId === "product-hunt") return enrichProductHuntDetail(input);
  if (input.providerId === "huggingface") return enrichHuggingFaceDetail(input);
  // Generic detail completion for relevant EVIDENCE candidates with a safe canonicalUrl.
  if (input.url && isSafeDetailUrl(input.url)) return enrichGenericDetail(input);
  return {
    status: "UNSUPPORTED",
    canonicalUrl: input.url,
    title: input.title,
    discoveredBy: input.providerId || "detail",
  };
}