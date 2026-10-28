import type { DetailEnrichmentInput, DetailEnrichmentResult } from "../types.ts";
import { htmlTitle, isThinDetail, metaContent, stripHtmlForDetail } from "./shared.ts";
import { fetchHtml, DetailReadError, type DetailReadOptions } from "../detail-reader.ts";

function isProductHuntTemplate(value: string) {
  return /Launch archive|Most-loved launches|Launch Guide|The best of Product Hunt|Product Hunt, every day|Sign in|Sign up/i.test(value);
}

function sameHost(url: string, host: string) {
  try {
    return new URL(url).hostname.includes(host);
  } catch {
    return false;
  }
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function officialWebsiteFromProductHunt(html: string, baseUrl: string) {
  const candidates = [...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)]
    .map((match) => ({ url: absoluteUrl(match[1], baseUrl), label: stripHtmlForDetail(match[2]) }))
    .filter((item): item is { url: string; label: string } => Boolean(item.url));
  return candidates.find((item) =>
    !sameHost(item.url, "producthunt.com") &&
    !/twitter|x\.com|facebook|linkedin|instagram|youtube|discord|reddit/i.test(item.url) &&
    /website|visit|open|官网|site|launch/i.test(`${item.label} ${item.url}`),
  )?.url;
}

export async function enrichProductHuntDetail(input: DetailEnrichmentInput, options: DetailReadOptions = {}): Promise<DetailEnrichmentResult> {
  if (!input.url) return { status: "NO_DETAIL", discoveredBy: "Product Hunt" };
  const deadlineAt = input.deadlineAt ?? Date.now() + 10000;
  try {
    const productHtml = await fetchHtml(input.url, deadlineAt - Date.now(), options);
    if (!productHtml) {
      return { status: "FETCH_FAILED", canonicalUrl: input.url, discoveredBy: "Product Hunt" };
    }
    const productName = (input.title || htmlTitle(productHtml)).replace(/^Product Hunt signal:\s*/i, "").trim();
    const productDetail = [
      productName ? `Product Hunt lists ${productName} as a product discovery item.` : "",
      metaContent(productHtml, "description"),
      metaContent(productHtml, "og:description"),
    ].filter(Boolean).join("\n");
    if (!isThinDetail(productDetail) && !isProductHuntTemplate(productDetail)) {
      return {
        status: "SUCCESS",
        canonicalUrl: input.url,
        title: input.title || htmlTitle(productHtml),
        rawContent: productDetail,
        contentType: "html",
        discoveredBy: "Product Hunt",
        evidenceFrom: "Product Hunt detail",
        officialUrl: officialWebsiteFromProductHunt(productHtml, input.url),
      };
    }

    const officialUrl = officialWebsiteFromProductHunt(productHtml, input.url);
    if (officialUrl) {
      const officialHtml = await fetchHtml(officialUrl, deadlineAt - Date.now(), options);
      const officialDetail = officialHtml
        ? [
            htmlTitle(officialHtml),
            metaContent(officialHtml, "description"),
            metaContent(officialHtml, "og:description"),
            stripHtmlForDetail(officialHtml).slice(0, 1400),
          ].filter(Boolean).join("\n")
        : "";
      if (!isThinDetail(officialDetail)) {
        return {
          status: "SUCCESS",
          canonicalUrl: officialUrl,
          title: input.title || htmlTitle(productHtml),
          rawContent: officialDetail,
          contentType: "html",
          discoveredBy: "Product Hunt",
          evidenceFrom: "Official Website",
          officialUrl,
        };
      }
    }

    return {
      status: "TOO_THIN",
      canonicalUrl: input.url,
      title: input.title || htmlTitle(productHtml),
      rawContent: productDetail,
      contentType: "html",
      discoveredBy: "Product Hunt",
      evidenceFrom: "Product Hunt detail",
      officialUrl,
    };
  } catch (error) {
    return { status: "FETCH_FAILED", canonicalUrl: input.url, discoveredBy: "Product Hunt",
      ...(error instanceof DetailReadError ? { failureCode: error.code } : {}) };
  }
}
