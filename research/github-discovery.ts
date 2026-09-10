import type { LiveItem } from "../social/providers/types.ts";
import type { SourceExecutionOutcome } from "./source-coverage.ts";

type OfficialUpdateTarget = {
  aliases: string[];
  githubRepos?: string[];
  updatePages?: Array<{ url: string; publisher: string }>;
};

// This is deliberately a small product-entity mapping, not a release registry.
// It gives tracked entities a stable official update surface (release, changelog,
// or product documentation) in addition to general web discovery.
const officialUpdateTargets: OfficialUpdateTarget[] = [
  {
    aliases: ["openai", "codex"],
    githubRepos: ["openai/codex"],
  },
  {
    aliases: ["anthropic", "claude code"],
    githubRepos: ["anthropics/anthropic-sdk-python", "anthropics/anthropic-sdk-typescript"],
    updatePages: [
      { url: "https://code.claude.com/docs/en/changelog", publisher: "Anthropic · Claude Code" },
    ],
  },
  {
    aliases: ["google gemini", "gemini"],
    githubRepos: ["google-gemini/gemini-cli"],
  },
  {
    aliases: ["deepseek", "deep seek"],
    githubRepos: ["deepseek-ai/DeepSeek-V3"],
  },
];

type Fetcher = typeof fetch;

function matchedTargets(entities: string[]) {
  const normalized = new Set(entities.map((entity) => entity.trim().toLowerCase()).filter(Boolean));
  return officialUpdateTargets.filter((target) => target.aliases.some((alias) => normalized.has(alias)));
}

function decodeHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function updatePageTitle(html: string, fallback: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeHtml(title).slice(0, 180) : fallback;
}

function updatePagePublishedAt(html: string) {
  const datetime = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  if (datetime) {
    const date = new Date(datetime);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const text = decodeHtml(html);
  const dateText = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
  )?.[0];
  if (!dateText) return undefined;
  const date = new Date(dateText);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

async function githubLatestRelease(repo: string, fetcher: Fetcher): Promise<LiveItem | null> {
  const retrievedAt = new Date().toISOString();
  const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "SignalMapResearch/0.5",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const release = (await response.json()) as {
    id: number;
    name?: string;
    tag_name: string;
    html_url: string;
    body?: string;
    published_at?: string;
    created_at?: string;
  };
  const publishedAt = release.published_at || release.created_at;
  return {
    id: `github-release-${release.id}`,
    title: `${repo} ${release.name || release.tag_name}`,
    url: release.html_url,
    snippet: (release.body || `Official GitHub release ${release.tag_name}`).slice(0, 500),
    source: `GitHub · ${repo}`,
    publishedAt,
    eventOccurredAt: publishedAt,
    firstSeenAt: retrievedAt,
    retrievedAt,
    dataOrigin: "live",
    channel: "官方",
    authority: 94,
    origin: "github",
  };
}

export async function discoverOfficialGithubReleases(
  entities: string[],
  fetcher: Fetcher = fetch,
): Promise<{ items: LiveItem[]; outcome: SourceExecutionOutcome; failure?: string }> {
  const repos = Array.from(
    new Set(matchedTargets(entities).flatMap((target) => target.githubRepos || [])),
  ).slice(0, 4);
  if (!repos.length) {
    return {
      items: [],
      outcome: {
        source: "GitHub Releases",
        execution: "not_searched",
        searched: false,
        resultCount: 0,
        requestCount: 0,
      },
    };
  }
  const settled = await Promise.allSettled(repos.map((repo) => githubLatestRelease(repo, fetcher)));
  const items = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const succeeded = settled.filter((result) => result.status === "fulfilled").length;
  const failed = settled.length - succeeded;
  const outcome: SourceExecutionOutcome = succeeded
    ? {
        source: "GitHub Releases",
      execution: items.length ? "searched_with_results" : "searched_no_results",
      searched: true,
      resultCount: items.length,
      requestCount: repos.length,
      }
    : {
        source: "GitHub Releases",
      execution: "failed",
      searched: true,
      resultCount: 0,
      requestCount: repos.length,
        failureCode: "upstream_error",
      };
  return {
    items,
    outcome,
    failure: failed ? `GitHub Releases: ${failed} 个 Release 请求失败或超时。` : undefined,
  };
}

async function officialUpdatePage(
  page: { url: string; publisher: string },
  fetcher: Fetcher,
): Promise<LiveItem | null> {
  const retrievedAt = new Date().toISOString();
  const response = await fetcher(page.url, {
    headers: { "User-Agent": "SignalMapResearch/0.6" },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Official update page returned ${response.status}`);
  const html = await response.text();
  const publishedAt = updatePagePublishedAt(html);
  return {
    id: `official-update-${encodeURIComponent(page.url)}`,
    title: updatePageTitle(html, `${page.publisher} updates`),
    url: page.url,
    snippet: decodeHtml(html).slice(0, 500) || "Official product update page.",
    source: page.publisher,
    publishedAt,
    eventOccurredAt: publishedAt,
    firstSeenAt: retrievedAt,
    retrievedAt,
    dataOrigin: "live",
    channel: "官方",
    authority: 95,
    origin: "official",
  };
}

export async function discoverOfficialUpdatePages(
  entities: string[],
  fetcher: Fetcher = fetch,
): Promise<{ items: LiveItem[]; outcome: SourceExecutionOutcome; failure?: string }> {
  const pages = Array.from(
    new Map(
      matchedTargets(entities)
        .flatMap((target) => target.updatePages || [])
        .map((page) => [page.url, page]),
    ).values(),
  ).slice(0, 4);
  if (!pages.length) {
    return {
      items: [],
      outcome: {
        source: "Official Update Pages",
        execution: "not_searched",
        searched: false,
        resultCount: 0,
        requestCount: 0,
      },
    };
  }
  const settled = await Promise.allSettled(pages.map((page) => officialUpdatePage(page, fetcher)));
  const items = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const succeeded = settled.filter((result) => result.status === "fulfilled").length;
  const failed = settled.length - succeeded;
  return {
    items,
    outcome: succeeded
      ? {
          source: "Official Update Pages",
          execution: items.length ? "searched_with_results" : "searched_no_results",
          searched: true,
          resultCount: items.length,
          requestCount: pages.length,
        }
      : {
          source: "Official Update Pages",
          execution: "failed",
          searched: true,
          resultCount: 0,
          requestCount: pages.length,
          failureCode: "upstream_error",
        },
    failure: failed ? `Official Update Pages: ${failed} 个页面请求失败或超时。` : undefined,
  };
}
