import type { DetailEnrichmentInput, DetailEnrichmentResult } from "../types.ts";
import { htmlTitle, isThinDetail, metaContent } from "./shared.ts";
import { discardResponseBody } from "../../lib/http-response.ts";

function huggingFaceRawReadmeUrl(input: DetailEnrichmentInput) {
  const canonicalId =
    input.canonicalId ||
    input.url?.replace(/^https:\/\/huggingface\.co\//, "").replace(/^(models|spaces|datasets)\//, "") ||
    "";
  if (!canonicalId) return undefined;
  const path = input.url?.includes("/spaces/")
    ? `spaces/${canonicalId}`
    : input.url?.includes("/datasets/")
      ? `datasets/${canonicalId}`
      : canonicalId;
  return `https://huggingface.co/${path}/raw/main/README.md`;
}

export async function enrichHuggingFaceDetail(input: DetailEnrichmentInput): Promise<DetailEnrichmentResult> {
  const canonicalUrl = input.url;
  const metadataFallback = [
    input.title ? `Hugging Face updated ${input.title.replace(/^Hugging Face\s+/i, "")}.` : "",
    typeof input.metadata?.publishedAt === "string" ? `The Hugging Face API reports updatedAt ${input.metadata.publishedAt}.` : "",
    typeof input.metadata?.snippet === "string" ? input.metadata.snippet : "",
  ].filter(Boolean).join("\n");
  const readmeUrl = huggingFaceRawReadmeUrl(input);
  try {
    if (readmeUrl) {
      const response = await fetch(readmeUrl, {
        headers: { "User-Agent": "SignalMapResearch/0.4" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const markdown = await response.text();
        const body = markdown
          .replace(/^---[\s\S]*?---/, " ")
          .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
          .replace(/\[[^\]]+]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
          .trim();
        const rawContent = [metadataFallback, body].filter(Boolean).join("\n");
        if (!isThinDetail(rawContent)) {
          return {
            status: "SUCCESS",
            canonicalUrl,
            title: input.title,
            rawContent,
            contentType: "markdown",
            discoveredBy: "Hugging Face",
            evidenceFrom: "Hugging Face README",
          };
        }
      } else {
        await discardResponseBody(response);
      }
    }

    if (!input.url) {
      return { status: "NO_DETAIL", discoveredBy: "Hugging Face" };
    }
    const page = await fetch(input.url, {
      headers: { "User-Agent": "SignalMapResearch/0.4" },
      signal: AbortSignal.timeout(10000),
    });
    if (!page.ok) {
      await discardResponseBody(page);
      return { status: "FETCH_FAILED", canonicalUrl, discoveredBy: "Hugging Face" };
    }
    const html = await page.text();
    const description = [
      htmlTitle(html),
      metaContent(html, "description"),
      metaContent(html, "og:description"),
    ].filter(Boolean).join("\n");
    const rawContent = isThinDetail(description) ? metadataFallback : [metadataFallback, description].filter(Boolean).join("\n");
    return {
      status: isThinDetail(rawContent) ? "TOO_THIN" : "SUCCESS",
      canonicalUrl,
      title: input.title || htmlTitle(html),
      rawContent,
      contentType: isThinDetail(description) ? "metadata" : "html",
      discoveredBy: "Hugging Face",
      evidenceFrom: isThinDetail(description) ? "Hugging Face API metadata" : "Hugging Face page",
    };
  } catch {
    if (!isThinDetail(metadataFallback)) {
      return {
        status: "SUCCESS",
        canonicalUrl,
        title: input.title,
        rawContent: metadataFallback,
        contentType: "metadata",
        discoveredBy: "Hugging Face",
        evidenceFrom: "Hugging Face API metadata",
      };
    }
    return { status: "FETCH_FAILED", canonicalUrl, discoveredBy: "Hugging Face" };
  }
}
