import { isSafeDetailUrl } from "./safe-url.ts";
import { TITLE_CORRESPONDENCE_THRESHOLD, titleMatchScore } from "./title-correspondence.ts";
import { stripHtmlForDetail } from "./resolvers/shared.ts";

type Fetcher = typeof fetch;

export type WrapperResolutionOptions = {
  /** Absolute epoch-ms deadline shared with the caller. The search is skipped entirely once exhausted. */
  deadlineAt?: number;
};

// Google News RSS wraps every article in a news.google.com URL whose page is
// a JS shell. The real article URL can be resolved via a single
// site-restricted lookup on lite.duckduckgo.com, which is not subject to
// the anomaly challenge that blocks the html.duckduckgo.com endpoint.
//
// This resolver is called by enrichGenericDetail for Google News wrapper
// candidates. It makes exactly ONE search request and returns the URL of the
// same-publisher-origin result whose anchor text corresponds to the original
// candidate title (never merely the first same-domain URL). All failures
// return undefined (honest degradation, no fabricated content).

const LITE_RESULT_LINK = /<a\b[^>]*\bhref=(["'])([^"']*\buddg=([^"']*))\1[^>]*>([\s\S]*?)<\/a>/gi;

async function resolveViaLiteDuckDuckGo(
  hostname: string,
  originalTitle: string,
  query: string,
  fetcher: Fetcher,
  deadlineAt?: number,
): Promise<string | undefined> {
  const remainingMs = deadlineAt === undefined ? undefined : deadlineAt - Date.now();
  if (remainingMs !== undefined && remainingMs <= 0) return undefined;
  const response = await fetcher(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0" },
      signal: AbortSignal.timeout(remainingMs ?? 10000),
    },
  );
  if (!response.ok) return undefined;
  const html = await response.text();
  // lite.duckduckgo.com result pages expose links as uddg redirect parameters;
  // the anchor text is the indexed page title used for correspondence scoring.
  const links = [...html.matchAll(LITE_RESULT_LINK)]
    .map((match) => {
      try {
        return { url: decodeURIComponent(match[3]), anchor: stripHtmlForDetail(match[4]) };
      } catch {
        return null;
      }
    })
    .filter((link): link is { url: string; anchor: string } => link !== null && link.url.startsWith("http"))
    .slice(0, 20);
  return links
    .filter((link) => {
      try {
        return new URL(link.url).hostname === hostname && isSafeDetailUrl(link.url);
      } catch {
        return false;
      }
    })
    .map((link) => ({ ...link, score: titleMatchScore(originalTitle, link.anchor) }))
    .filter((link) => link.score >= TITLE_CORRESPONDENCE_THRESHOLD)
    .sort((left, right) => right.score - left.score)[0]?.url;
}

export async function resolveWrapperViaPublisherOrigin(
  publisherOrigin: string,
  title: string,
  fetcher: Fetcher = fetch,
  options: WrapperResolutionOptions = {},
): Promise<string | undefined> {
  const originalTitle = title.trim();
  // Without the original title there is nothing to confirm correspondence
  // against, so the wrapper stays unresolved.
  if (!originalTitle) return undefined;
  try {
    const origin = new URL(publisherOrigin);
    const query = `site:${origin.hostname} ${originalTitle.replace(/[\\|^]/g, " ").slice(0, 120)}`;
    return await resolveViaLiteDuckDuckGo(origin.hostname, originalTitle, query, fetcher, options.deadlineAt);
  } catch {
    return undefined;
  }
}
