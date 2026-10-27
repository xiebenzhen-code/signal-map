import type { DetailEnrichmentInput, DetailEnrichmentResult } from "../types.ts";
import { htmlTitle, isThinDetail, metaContent } from "./shared.ts";
import { fetchHtml, DetailReadError, type DetailReadOptions } from "../detail-reader.ts";

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

export async function enrichHuggingFaceDetail(input: DetailEnrichmentInput, options: DetailReadOptions = {}): Promise<DetailEnrichmentResult> {
  const canonicalUrl = input.url;
  const metadataFallback = [
    input.title ? `Hugging Face updated ${input.title.replace(/^Hugging Face\s+/i, "")}.` : "",
    typeof input.metadata?.publishedAt === "string" ? `The Hugging Face API reports updatedAt ${input.metadata.publishedAt}.` : "",
    typeof input.metadata?.snippet === "string" ? input.metadata.snippet : "",
  ].filter(Boolean).join("\n");
  const readmeUrl = huggingFaceRawReadmeUrl(input);
  const deadlineAt = input.deadlineAt ?? Date.now() + 10000;
  try {
    if (readmeUrl) {
      const markdown = await fetchHtml(readmeUrl, deadlineAt - Date.now(), options);
      if (markdown !== undefined) {
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
      }
    }

    if (!input.url) {
      return { status: "NO_DETAIL", discoveredBy: "Hugging Face" };
    }
    const html = await fetchHtml(input.url, deadlineAt - Date.now(), options);
    if (html === undefined) {
      return { status: "FETCH_FAILED", canonicalUrl, discoveredBy: "Hugging Face" };
    }
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
  } catch (error) {
    const failureCode = error instanceof DetailReadError ? error.code : undefined;
    if (!isThinDetail(metadataFallback)) {
      return {
        status: "SUCCESS",
        canonicalUrl,
        title: input.title,
        rawContent: metadataFallback,
        ...(failureCode ? { failureCode } : {}),
        contentType: "metadata",
        discoveredBy: "Hugging Face",
        evidenceFrom: "Hugging Face API metadata",
      };
    }
    return { status: "FETCH_FAILED", canonicalUrl, discoveredBy: "Hugging Face", ...(failureCode ? { failureCode } : {}) };
  }
}
