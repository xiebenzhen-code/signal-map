import { fetchHtml, DetailReadError, type DetailReadOptions } from "./detail-reader.ts";
export { fetchHtml, DetailReadError, type DetailReadOptions } from "./detail-reader.ts";
import { cleanContent, extractClaim } from "../content-processing/index.ts";
import type { DetailEnrichmentInput, DetailEnrichmentResult, SourceCapabilityRole } from "./types.ts";
import { enrichHuggingFaceDetail } from "./resolvers/hugging-face.ts";
import { enrichProductHuntDetail } from "./resolvers/product-hunt.ts";
import { htmlTitle, isThinDetail, metaContent, stripHtmlForDetail } from "./resolvers/shared.ts";
import { isSafeDetailUrl } from "./safe-url.ts";
import { resolveWrapperViaPublisherOrigin } from "./google-news-resolver.ts";
import { titlesCorrespond } from "./title-correspondence.ts";

export const maxDetailFetchesPerRound = 5;

export function sourceCapability(providerId: string | undefined): SourceCapabilityRole {
  // Web-search candidates (searchQueries path) carry no providerId; they are
  // EVIDENCE-role candidates gated by relevance + a safe canonical URL.
  if (providerId === undefined) return "EVIDENCE";
  if (providerId === "product-hunt") return "DISCOVERY";
  if (providerId === "huggingface") return "DISCOVERY";
  if (providerId === "registered-feeds") return "DISCOVERY";
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
  // Web-search candidates (searchQueries path) carry sourceType but no
  // providerId. The 2026-09-30 acceptance run left its six most relevant news
  // candidates permanently un-enriched because of that missing field while
  // directory pages consumed the budget. Eligibility now rests on relevance +
  // a safe canonical URL, not on providerId.
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

// Google News RSS wraps every article in a news.google.com URL whose page is a
// JS shell. The wrapper is resolved via the google-news-resolver module (one
// lite.duckduckgo.com search, anchor-verified against the candidate title),
// which is fail-soft and shares the caller's deadline. After fetching the
// resolved page, its own title must correspond to the candidate title before
// its content is accepted.
const GOOGLE_NEWS_WRAPPER = /https?:\/\/news\.google\.com\/rss\/articles\//i;

function isGoogleNewsWrapper(url: string): boolean {
  return GOOGLE_NEWS_WRAPPER.test(url);
}

export async function enrichGenericDetail(input: DetailEnrichmentInput, options: DetailReadOptions = {}): Promise<DetailEnrichmentResult> {
  if (!input.url) return { status: "NO_DETAIL", discoveredBy: input.providerId || "detail" };
  // Counted across the whole candidate: one wrapper search and/or one body
  // fetch — deliberately distinct from candidate-level counts upstream.
  let fetchCalls = 0;
  try {
    const remainingMs = () => (input.deadlineAt === undefined ? undefined : Math.max(0, input.deadlineAt - Date.now()));
    const budgetExhausted = () => {
      const remaining = remainingMs();
      return remaining !== undefined && remaining <= 0;
    };
    // Resolve Google News wrappers FIRST: fetching the wrapper yields a JS
    // shell that must never be stored as article content.
    let targetUrl = input.url;
    let wrapperResolved = false;
    if (isGoogleNewsWrapper(input.url)) {
      const publisherOrigin =
        (typeof input.metadata?.publisherUrl === "string" && isSafeDetailUrl(input.metadata.publisherUrl)
          ? input.metadata.publisherUrl
          : undefined);
      const originalTitle = input.title?.trim() || "";
      // Correspondence needs a publisher origin and the original candidate
      // title; with either missing — or no budget left — the wrapper stays
      // unresolved and no request is issued at all.
      if (!publisherOrigin || !originalTitle || budgetExhausted()) {
        return {
          status: "TOO_THIN",
          canonicalUrl: input.url,
          discoveredBy: input.providerId || "detail",
          title: input.title,
          fetchCalls,
        };
      }
      const resolved = await resolveWrapperViaPublisherOrigin(publisherOrigin, originalTitle, fetch, { deadlineAt: input.deadlineAt });
      fetchCalls += 1;
      // Honest failure: unresolvable, or the search consumed the remaining
      // budget — the body request must not fire.
      if (!resolved || budgetExhausted()) {
        return {
          status: "TOO_THIN",
          canonicalUrl: input.url,
          discoveredBy: input.providerId || "detail",
          title: input.title,
          fetchCalls,
        };
      }
      targetUrl = resolved;
      wrapperResolved = true;
    }
    if (budgetExhausted()) {
      return { status: "FETCH_FAILED", canonicalUrl: targetUrl, discoveredBy: input.providerId || "detail", fetchCalls };
    }
    // Counted at initiation: a call cancelled mid-transfer still happened.
    fetchCalls += 1;
    const html = await fetchHtml(targetUrl, remainingMs() ?? 10000, options);
    if (!html) return { status: "FETCH_FAILED", canonicalUrl: targetUrl, discoveredBy: input.providerId || "detail", fetchCalls };
    // A resolved wrapper is only accepted when the page behind the URL
    // corresponds to the original candidate (title tag / og:title / h1).
    // Otherwise the result stays unresolved instead of stitching the original
    // title onto another article's body.
    if (wrapperResolved && !titlesCorrespond(input.title, [
      htmlTitle(html),
      metaContent(html, "og:title"),
      stripHtmlForDetail(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ""),
    ])) {
      return {
        status: "TOO_THIN",
        canonicalUrl: input.url,
        discoveredBy: input.providerId || "detail",
        title: input.title,
        fetchCalls,
      };
    }
    // Prefer the semantic body (article/main) so navigation chrome cannot crowd
    // out the real content within the stored length. When no semantic block
    // exists, fall back to the full-page text; the thin check below keeps
    // skeleton-only pages from passing as extractable content.
    const semanticHtml =
      html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ||
      html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ||
      html.match(/<div[^>]+(?:class|id)=["'][^"']*(?:post-content|entry-content|article-body|release-notes|changelog)[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] ||
      "";
    // Without a semantic block, strip structural chrome (nav / header / footer
    // / aside / cookie banners) before extraction so a skeleton-only landing
    // page fails the thin check honestly instead of passing on navigation
    // text. This mirrors the cleaner's chrome rules at the HTML level.
    const fallbackHtml = semanticHtml || html
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
      .replace(/<div[^>]+(?:class|id)=["'][^"']*(?:cookie|banner|hero)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ");
    const bodySource = semanticHtml && stripHtmlForDetail(semanticHtml).trim().length >= 80 ? semanticHtml : fallbackHtml;
    const body = [
      htmlTitle(html),
      metaContent(html, "description"),
      metaContent(html, "og:description"),
      stripHtmlForDetail(bodySource).slice(0, 1400),
    ].filter(Boolean).join("\n");
    // A resolved wrapper reports the ORIGINAL publisher article as canonical,
    // keeping the wrapper URL provenance out of the evidence link.
    const canonicalUrl = wrapperResolved ? targetUrl : input.url;
    if (isThinDetail(body)) {
      return { status: "TOO_THIN", canonicalUrl, rawContent: body, contentType: "html", discoveredBy: input.providerId || "detail", title: input.title, fetchCalls };
    }
    return {
      status: "SUCCESS",
      canonicalUrl,
      title: input.title || htmlTitle(html),
      rawContent: body,
      contentType: "html",
      discoveredBy: input.providerId || "detail",
      evidenceFrom: wrapperResolved ? "Publisher article (resolved from Google News wrapper)" : "Detail page",
      fetchCalls,
    };
  } catch (error) {
    return { status: "FETCH_FAILED", canonicalUrl: input.url, discoveredBy: input.providerId || "detail", fetchCalls, ...(error instanceof DetailReadError ? { failureCode: error.code } : {}) };
  }
}

export async function enrichDetail(input: DetailEnrichmentInput, options: DetailReadOptions = {}): Promise<DetailEnrichmentResult> {
  if (input.providerId === "product-hunt") return enrichProductHuntDetail(input, options);
  if (input.providerId === "huggingface") return enrichHuggingFaceDetail(input, options);
  // Generic detail completion for relevant candidates (with or without a
  // providerId — searchQueries candidates carry sourceType only) with a safe
  // canonicalUrl.
  if (input.url && isSafeDetailUrl(input.url)) return enrichGenericDetail(input, options);
  return {
    status: "UNSUPPORTED",
    canonicalUrl: input.url,
    title: input.title,
    discoveredBy: input.providerId || "detail",
  };
}
