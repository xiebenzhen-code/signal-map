import { socialAccessLayer, type LiveItem } from "../social/providers/index.ts";
import {
  earliestValidTimestamp,
  freshnessWindowHours,
  latestValidTimestamp,
  resolveFreshness,
  validateTimestamp,
} from "../information/freshness.ts";
import { planQuery } from "./query-planner";
import { classifySource } from "./source-classifier";
import { translateSignalsForPresentation } from "./translation";
import type {
  PipelineCounts,
  PipelineProgress,
  QueryPlan,
  ResearchCandidate,
  ResearchInput,
  ResearchResponse,
  ResearchSignal,
  SourceType,
  VerificationStatus,
} from "./types";

type ProgressHandler = (progress: PipelineProgress) => void | Promise<void>;

const emptyCounts = (): PipelineCounts => ({
  candidates: 0,
  primary: 0,
  trustedMedia: 0,
  industryMedia: 0,
  social: 0,
  verified: 0,
});

const decodeXml = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function xmlValue(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

async function googleNews(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const mostlyEnglish = (query.match(/[A-Za-z]/g)?.length || 0) > query.length / 3;
  const locale = mostlyEnglish
    ? "hl=en-US&gl=US&ceid=US:en"
    : "hl=zh-CN&gl=CN&ceid=CN:zh-Hans";
  const response = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`,
    {
      headers: { "User-Agent": "SignalMapResearch/0.4" },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, 12)
    .map((match) => {
      const block = match[1];
      const publisher = xmlValue(block, "source") || "Google News";
      return {
        title: xmlValue(block, "title"),
        url: xmlValue(block, "link"),
        snippet: xmlValue(block, "description"),
        source: publisher,
        publishedAt: xmlValue(block, "pubDate"),
        firstSeenAt: retrievedAt,
        retrievedAt,
        dataOrigin: "live",
        channel: "混合",
        authority: 70,
        origin: "news",
      } satisfies LiveItem;
    })
    .filter((item) => item.title && item.url);
}

async function redditSearch(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const params = new URLSearchParams({
    q: query,
    sort: "new",
    limit: "10",
    type: "link",
    raw_json: "1",
  });
  const response = await fetch(`https://www.reddit.com/search.json?${params}`, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: {
      children?: Array<{
        data: {
          id: string;
          title: string;
          selftext?: string;
          permalink: string;
          subreddit: string;
          created_utc: number;
          score?: number;
        };
      }>;
    };
  };
  return (payload.data?.children || []).map(({ data }) => ({
    id: data.id,
    title: data.title,
    url: `https://www.reddit.com${data.permalink}`,
    snippet: `${data.selftext?.slice(0, 220) || "Reddit discussion"} · ${data.score || 0} points`,
    source: `Reddit · r/${data.subreddit}`,
    publishedAt: new Date(data.created_utc * 1000).toISOString(),
    firstSeenAt: retrievedAt,
    retrievedAt,
    dataOrigin: "live",
    channel: "社区",
    authority: 52,
    origin: "reddit",
  }));
}

const officialGithubRepos: Record<string, string[]> = {
  openai: ["openai/codex"],
  codex: ["openai/codex"],
  anthropic: ["anthropics/anthropic-sdk-python", "anthropics/anthropic-sdk-typescript"],
  "google gemini": ["google-gemini/gemini-cli"],
  gemini: ["google-gemini/gemini-cli"],
};

async function githubLatestRelease(repo: string): Promise<LiveItem | null> {
  const retrievedAt = new Date().toISOString();
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
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

async function discoverOfficialGithubReleases(entities: string[], failures: string[]) {
  const repos = Array.from(
    new Set(
      entities.flatMap((entity) => officialGithubRepos[entity.toLowerCase()] || []),
    ),
  ).slice(0, 4);
  const settled = await Promise.allSettled(repos.map(githubLatestRelease));
  const failed = settled.filter((result) => result.status === "rejected").length;
  if (failed) failures.push(`Official GitHub: ${failed} 个 Release 请求失败或超时。`);
  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}

function primaryDomains(plan: QueryPlan) {
  const need = plan.originalNeed;
  if (/IPO|上市|纳指|Nasdaq|股票|投资|证券|募资|财报/i.test(need)) {
    return "(site:sec.gov OR site:nasdaq.com OR site:nyse.com OR site:investor.* OR \"Investor Relations\")";
  }
  if (/AI|人工智能|大模型|Codex|Agent|开发|软件/i.test(need)) {
    return "(site:openai.com OR site:anthropic.com OR site:blog.google OR site:ai.google.dev OR site:github.com OR site:seed.bytedance.com OR site:runwayml.com OR site:microsoft.com)";
  }
  if (/医疗|医药|健康|临床/i.test(need)) {
    return "(site:fda.gov OR site:who.int OR site:nmpa.gov.cn OR site:nhc.gov.cn)";
  }
  if (/教育|考试|考研|院校|学术/i.test(need)) {
    return "(site:moe.gov.cn OR site:yz.chsi.com.cn OR site:edu.cn)";
  }
  return "(site:gov.cn OR site:gov OR site:org OR \"official announcement\")";
}

function relevant(item: LiveItem, plan: QueryPlan) {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const terms = [
    ...plan.coreKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
    ...plan.entities,
  ].filter((term) => term.length > 1);
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function unique(items: ResearchCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title
      .toLowerCase()
      .replace(/[\p{P}\p{S}\s]/gu, "")
      .slice(0, 64);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function related(a: LiveItem, b: LiveItem, plan: QueryPlan) {
  const left = `${a.title} ${a.snippet}`.toLowerCase();
  const right = `${b.title} ${b.snippet}`.toLowerCase();
  const terms = [
    ...plan.entities,
    ...plan.coreKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
  ].filter(
    (term) =>
      term.length > 3 &&
      !/^(IPO|SEC|S-1|Investor|Relations|Nasdaq)$/i.test(term),
  );
  const shared = terms.filter(
    (term) => left.includes(term.toLowerCase()) && right.includes(term.toLowerCase()),
  );
  return shared.length >= 2 || shared.some((term) => /\s/.test(term) && term.length > 8);
}

function isoDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function ageLabel(value?: string) {
  return resolveFreshness({ publishedAt: value }).label;
}

function sourceTier(sourceType: SourceType) {
  return {
    primary: "S",
    trusted_media: "A",
    industry_media: "B",
    social: "C",
  }[sourceType] as "S" | "A" | "B" | "C";
}

function usefulness(item: LiveItem, plan: QueryPlan) {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const hits = [...plan.coreKeywords, ...plan.englishKeywords, ...plan.entities].filter(
    (term) => text.includes(term.toLowerCase()),
  ).length;
  return Math.min(98, 64 + hits * 7);
}

function verification(
  item: ResearchCandidate,
  primary: ResearchCandidate[],
  plan: QueryPlan,
): { status: VerificationStatus; confidence: number; evidence?: ResearchCandidate } {
  if (item.sourceType === "primary") {
    return { status: "verified", confidence: 94, evidence: item };
  }
  const evidence = primary.find((candidate) => related(item, candidate, plan));
  if (item.sourceType === "trusted_media") {
    return evidence
      ? { status: "verified", confidence: 86, evidence }
      : { status: "partially_verified", confidence: 72 };
  }
  if (item.sourceType === "industry_media") {
    return evidence
      ? { status: "partially_verified", confidence: 76, evidence }
      : { status: "partially_verified", confidence: 62 };
  }
  return evidence
    ? { status: "partially_verified", confidence: 76, evidence }
    : { status: "unverified", confidence: 42 };
}

async function searchQueries(
  queries: string[],
  expected: SourceType,
  plan: QueryPlan,
  failures: string[],
  requestedFreshnessDays: number,
) {
  const windows = [1, 3, 7, 30];
  const discovered: LiveItem[] = [];
  let failed = 0;
  for (const days of windows) {
    const settled = await Promise.allSettled(
      queries.map((query) => googleNews(`${query} when:${days}d`)),
    );
    failed += settled.filter((result) => result.status === "rejected").length;
    discovered.push(...settled.flatMap((result) => result.status === "fulfilled" ? result.value : []));
    const verifiedRecent = unique(
      discovered
        .filter((item) => {
          const result = resolveFreshness(item);
          return result.ageHours !== undefined && result.ageHours <= days * 24;
        })
        .map((item) => ({ ...item, sourceType: expected })),
    );
    if (verifiedRecent.length >= 6 && days >= requestedFreshnessDays) break;
  }
  if (failed) failures.push(`${expected}: ${failed} 个搜索组合请求失败或超时。`);
  return {
    scanned: discovered.length,
    items: unique(
      discovered
      .filter((item) => {
        const result = resolveFreshness(item);
        const recent = result.ageHours === undefined || result.ageHours <= 30 * 24;
        return (
          recent &&
          classifySource(item.source, item.url) === expected &&
          relevant(item, plan)
        );
      })
      .map((item) => ({ ...item, sourceType: expected })),
    ),
  };
}

function freshnessDays(value: string) {
  const match = value.match(/\d+/)?.[0];
  const amount = match ? Number(match) : 7;
  if (/h|小时/i.test(value)) return Math.max(1, amount / 24);
  return Math.min(365, Math.max(1, amount));
}

function filterTerms(value: string) {
  const stopwords = /^(and|the|for|with|what|after|recent|recently|change|changes|changed|latest|official|information|update|updates|什么|最近|变化|信息|官方)$/i;
  return Array.from(
    new Set(
      value
        .split(/[,，、；;：:\n\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 1 && !stopwords.test(item)),
    ),
  );
}

function entityFilterTerms(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，、；;\n]+/)
        .flatMap((entry) => {
          const normalized = entry.trim().toLowerCase();
          if (!normalized) return [];
          const slashParts = normalized.split(/\s*\/\s*/).filter(Boolean);
          if (slashParts.length > 1) return slashParts;
          if (normalized === "google gemini") return [normalized, "gemini"];
          return [normalized];
        })
        .filter((item) => item.length > 1),
    ),
  );
}

function titleTokens(title: string) {
  const parts = title
    .toLowerCase()
    .replace(/\b(reuters|bloomberg|cnbc|wsj|financial times|sec\.gov)\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const tokens = parts.flatMap((part) => {
    if (/[\p{Script=Han}]/u.test(part) && part.length > 3) {
      return Array.from(part)
        .slice(0, -1)
        .map((character, index, characters) =>
          `${character}${characters[index + 1]}`,
        );
    }
    return part.length > 2 && !/^(the|and|for|with|from|about)$/.test(part)
      ? [part]
      : [];
  });
  return new Set(tokens);
}

function sameEvent(a: ResearchCandidate, b: ResearchCandidate) {
  const left = titleTokens(a.title);
  const right = titleTokens(b.title);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return shared >= 2 && shared / union >= 0.34;
}

function clusterEvents(items: ResearchCandidate[]) {
  const clusters: ResearchCandidate[][] = [];
  for (const item of items) {
    const cluster = clusters.find((candidate) => sameEvent(candidate[0], item));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

function hasConflict(items: ResearchCandidate[]) {
  if (items.length < 2) return false;
  const opposing = items.filter((item) =>
    /denies|denied|false|incorrect|disputes|否认|不实|反驳|澄清|冲突/i.test(
      `${item.title} ${item.snippet}`,
    ),
  );
  return opposing.length > 0 && opposing.length < items.length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stableEventId(title: string) {
  let hash = 0;
  const normalized = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return `event-${Math.abs(hash).toString(36)}`;
}

export async function runResearchPipeline(
  input: ResearchInput,
  onProgress?: ProgressHandler,
): Promise<ResearchResponse> {
  const progress: PipelineProgress[] = [];
  const failures: string[] = [];
  const windowDays = freshnessDays(input.freshnessWindow);
  let scanned = 0;
  let counts = emptyCounts();
  const emit = async (event: PipelineProgress) => {
    progress.push(event);
    await onProgress?.(event);
  };

  const plan = planQuery(input);
  await emit({
    stage: "planning",
    label: "正在理解需求并扩展中英文搜索词",
    counts,
    detail: `生成 ${plan.searchCombinations.length} 个搜索组合`,
  });
  await emit({
    stage: "candidates",
    label: "搜索候选资料",
    counts,
    detail: plan.searchCombinations.slice(0, 4).join(" · "),
  });

  const domains = primaryDomains(plan);
  const primaryQueries = plan.searchCombinations
    .slice(0, 5)
    .map((query) => `${query} ${domains}`);
  const [primaryResult, githubReleases] = await Promise.all([
    searchQueries(primaryQueries, "primary", plan, failures, windowDays),
    discoverOfficialGithubReleases(plan.entities, failures),
  ]);
  const primary = unique([
    ...githubReleases
      .filter((item) => relevant(item, plan))
      .map((item) => ({ ...item, sourceType: "primary" as const })),
    ...primaryResult.items,
  ]);
  scanned += primaryResult.scanned;
  counts = { ...counts, candidates: primary.length, primary: primary.length };
  if (!primary.length) {
    failures.push("Primary Sources: 扩展查询未命中可识别的监管文件、公司 IR 或官方公告，已继续搜索可信媒体。");
  }
  await emit({
    stage: "primary",
    label: `找到 ${counts.candidates} 条候选资料 · 官方来源 ${counts.primary} 条`,
    counts,
  });

  await emit({
    stage: "trusted_media",
    label: "正在补充可信媒体",
    counts,
  });
  const mediaQueries = plan.searchCombinations.slice(0, 4).map(
    (query) => `${query} (Reuters OR Bloomberg OR \"Financial Times\" OR WSJ OR CNBC)`,
  );
  const trustedMediaResult = await searchQueries(
    mediaQueries,
    "trusted_media",
    plan,
    failures,
    windowDays,
  );
  const trustedMedia = trustedMediaResult.items;
  scanned += trustedMediaResult.scanned;
  counts = {
    ...counts,
    candidates: counts.candidates + trustedMedia.length,
    trustedMedia: trustedMedia.length,
  };
  if (!trustedMedia.length) {
    failures.push("Trusted Media: Reuters、Bloomberg、FT、WSJ、CNBC 索引未返回匹配结果。");
  }
  await emit({
    stage: "trusted_media",
    label: `可信媒体补充完成 · ${trustedMedia.length} 条`,
    counts,
  });

  const industryQueries = plan.searchCombinations.slice(0, 3).map(
    (query) =>
      `${query} (TechCrunch OR "The Verge" OR "Ars Technica" OR VentureBeat OR InfoQ OR 机器之心 OR 量子位 OR 36氪)`,
  );
  const industryMediaResult = await searchQueries(
    industryQueries,
    "industry_media",
    plan,
    failures,
    windowDays,
  );
  const industryMedia = industryMediaResult.items;
  scanned += industryMediaResult.scanned;
  counts = {
    ...counts,
    candidates: counts.candidates + industryMedia.length,
    industryMedia: industryMedia.length,
  };

  await emit({
    stage: "social",
    label: "正在检查社交媒体线索",
    counts,
  });
  const socialQuery = plan.searchCombinations.slice(0, 3).join(" OR ");
  const [socialAccess, redditResult] = await Promise.all([
    socialAccessLayer.search({ query: socialQuery, industry: input.industry }),
    Promise.allSettled([redditSearch(socialQuery)]),
  ]);
  const reddit =
    redditResult[0].status === "fulfilled" ? redditResult[0].value : [];
  scanned += socialAccess.items.length + reddit.length;
  if (redditResult[0].status === "rejected") {
    failures.push("Social Discovery: Reddit 请求失败或超时。");
  }
  const social = unique(
    [...socialAccess.items, ...reddit]
      .filter((item) => {
        const itemFreshness = resolveFreshness(item);
        return (
          relevant(item, plan) &&
          (itemFreshness.ageHours === undefined || itemFreshness.ageHours <= 30 * 24)
        );
      })
      .map((item) => ({ ...item, sourceType: "social" as const })),
  );
  counts = {
    ...counts,
    candidates: counts.candidates + social.length,
    social: social.length,
  };

  let reversePrimary: ResearchCandidate[] = [];
  if (social.length) {
    const reverseQueries = social
      .slice(0, 3)
      .map((item) => `${item.title.slice(0, 120)} ${domains}`);
    const reverseResult = await searchQueries(
      reverseQueries,
      "primary",
      plan,
      failures,
      windowDays,
    );
    reversePrimary = reverseResult.items;
    scanned += reverseResult.scanned;
  }
  const allPrimary = unique([...primary, ...reversePrimary]);
  counts = { ...counts, primary: allPrimary.length };
  await emit({
    stage: "social",
    label: `社交媒体线索 ${social.length} 条 · 已尝试反向查证`,
    counts,
  });

  const candidates = unique([
    ...allPrimary,
    ...trustedMedia,
    ...industryMedia,
    ...social,
  ]);
  await emit({
    stage: "deduplication",
    label: `去重完成 · ${scanned} 条扫描结果收敛为 ${candidates.length} 条来源`,
    counts,
  });
  const eventClusters = clusterEvents(candidates);
  await emit({
    stage: "clustering",
    label: `事件聚合完成 · ${eventClusters.length} 个独立事件`,
    counts,
  });
  const gapTerms = filterTerms(input.informationGaps);
  const questionTerms = filterTerms(input.currentQuestions);
  const knownTerms = filterTerms(
    `${input.knownInformation}\n${input.evidenceHistory}`,
  );
  const trackedEntityTerms = entityFilterTerms(input.trackedEntities).filter(
    (term) =>
      !/^(ai|agent|model|research|official|update|人工智能|大模型|模型)$/i.test(
        term,
      ),
  );
  const trackedEventTerms = filterTerms(input.trackedEvents);
  const judgementTerms = filterTerms(input.userJudgements);
  const allSignals: ResearchSignal[] = eventClusters
    .map((cluster) => {
      const ordered = [...cluster].sort((a, b) => {
        const tier = {
          primary: 4,
          trusted_media: 3,
          industry_media: 2,
          social: 1,
        } as const;
        return (
          tier[b.sourceType] - tier[a.sourceType] ||
          (isoDate(b.publishedAt) ? new Date(isoDate(b.publishedAt)!).getTime() : 0) -
            (isoDate(a.publishedAt) ? new Date(isoDate(a.publishedAt)!).getTime() : 0)
        );
      });
      const item = ordered[0];
      const clusterText = ordered
        .map((candidate) => `${candidate.title} ${candidate.snippet}`)
        .join(" ")
        .toLowerCase();
      const checks = ordered.map((candidate) =>
        verification(candidate, allPrimary, plan),
      );
      const conflicting = hasConflict(ordered);
      const hasPrimary = ordered.some((candidate) => candidate.sourceType === "primary");
      const hasTrusted = ordered.some(
        (candidate) => candidate.sourceType === "trusted_media",
      );
      const hasIndustry = ordered.some(
        (candidate) => candidate.sourceType === "industry_media",
      );
      const verificationStatus: VerificationStatus = conflicting
        ? "conflicting"
        : hasPrimary
          ? "verified"
          : hasTrusted
            ? "partially_verified"
            : checks.some((check) => check.evidence)
              ? "partially_verified"
              : "unverified";
      const gapMatches = gapTerms.filter((term) => clusterText.includes(term));
      const questionMatches = questionTerms.filter((term) =>
        clusterText.includes(term),
      );
      const knownMatches = knownTerms.filter((term) => clusterText.includes(term));
      const alreadyKnown = knownMatches.some((term) => term.length >= 14);
      const entityMatches = trackedEntityTerms.filter((term) =>
        clusterText.includes(term),
      );
      const trackedEventMatches = trackedEventTerms.filter((term) =>
        clusterText.includes(term),
      );
      const judgementMatches = judgementTerms.filter((term) =>
        clusterText.includes(term),
      );
      const relevanceScore = clamp(
        Math.max(...ordered.map((candidate) => usefulness(candidate, plan))) +
          Math.min(12, gapMatches.length * 4) +
          Math.min(9, questionMatches.length * 3) +
          Math.min(8, entityMatches.length * 4),
      );
      const reliabilityScore = clamp(
        (verificationStatus === "verified"
          ? 92
          : verificationStatus === "partially_verified"
            ? hasTrusted
              ? 72
              : 62
            : verificationStatus === "conflicting"
              ? 42
              : 30) + Math.min(8, (ordered.length - 1) * 2),
      );
      const validTimestampCandidates = ordered.filter(
        (candidate) => validateTimestamp(candidate) === "valid",
      );
      const originalOccurredAt = earliestValidTimestamp(
        validTimestampCandidates.map(
          (candidate) => candidate.eventOccurredAt || candidate.publishedAt,
        ),
      );
      const newestPublishedAt = latestValidTimestamp(
        validTimestampCandidates.map((candidate) => candidate.publishedAt),
      );
      const explicitLatestUpdateAt = latestValidTimestamp(
        validTimestampCandidates.map((candidate) => candidate.lastUpdatedAt),
      );
      const originalTime = originalOccurredAt
        ? new Date(originalOccurredAt).getTime()
        : undefined;
      const newestTime = newestPublishedAt
        ? new Date(newestPublishedAt).getTime()
        : undefined;
      const inferredLatestUpdateAt =
        originalTime !== undefined &&
        newestTime !== undefined &&
        newestTime - originalTime > 24 * 60 * 60 * 1000
          ? newestPublishedAt
          : undefined;
      const latestUpdateAt = explicitLatestUpdateAt || inferredLatestUpdateAt;
      const eventFreshness = resolveFreshness(
        latestUpdateAt
          ? { eventOccurredAt: latestUpdateAt }
          : { eventOccurredAt: originalOccurredAt, publishedAt: newestPublishedAt },
      );
      const originalFreshness = resolveFreshness({ eventOccurredAt: originalOccurredAt });
      const freshnessScore = eventFreshness.score;
      const noveltyScore = clamp(
        (alreadyKnown
          ? 18
          : knownTerms.length
            ? 92 - knownMatches.length * 28
            : 86) +
          (freshnessScore >= 85 ? 4 : 0) -
          Math.min(18, judgementMatches.length * 6),
      );
      const gapMatchScore = clamp(
        gapMatches.length || questionMatches.length
          ? 55 + gapMatches.length * 18 + questionMatches.length * 14
          : 24,
      );
      const judgementImpactScore = clamp(
        34 +
          questionMatches.length * 18 +
          gapMatches.length * 14 +
          entityMatches.length * 10 +
          trackedEventMatches.length * 14 +
          (conflicting ? 8 : 0),
      );
      const overallScore = clamp(
        relevanceScore * 0.3 +
          reliabilityScore * 0.25 +
          noveltyScore * 0.15 +
          freshnessScore * 0.1 +
          judgementImpactScore * 0.1 +
          gapMatchScore * 0.1,
      );
      const socialOnly = ordered.every(
        (candidate) => candidate.sourceType === "social",
      );
      const withinWindow =
        eventFreshness.ageHours !== undefined &&
        eventFreshness.ageHours <= freshnessWindowHours(input.freshnessWindow);
      const originalWithinWindow =
        originalFreshness.ageHours !== undefined &&
        originalFreshness.ageHours <= freshnessWindowHours(input.freshnessWindow);
      const hasRecentUpdate = Boolean(latestUpdateAt && withinWindow);
      const eventStatus: ResearchSignal["eventStatus"] =
        socialOnly || verificationStatus === "unverified"
          ? "SIGNAL"
          : trackedEventMatches.length > 0 && hasRecentUpdate
            ? "FOLLOW_UP"
            : hasRecentUpdate && !originalWithinWindow
              ? "UPDATED"
              : originalWithinWindow
                ? "NEW"
                : "BACKGROUND";
      const canEnterLibrary =
        (reliabilityScore >= 55 && relevanceScore >= 58 && noveltyScore >= 38) ||
        (eventStatus === "SIGNAL" &&
          relevanceScore >= 70 &&
          freshnessScore >= 80 &&
          noveltyScore >= 65);
      const sourceMap = new Map(
        ordered.map((candidate) => [candidate.url, candidate]),
      );
      const sources = [...sourceMap.values()].map((candidate) => ({
        sourceUrl: candidate.url,
        publisher: candidate.source,
        publishedAt: isoDate(candidate.publishedAt),
        sourceType: candidate.sourceType,
        sourceTier: sourceTier(candidate.sourceType),
      }));
      const claims = ordered.map((candidate, index) => ({
        claimText: candidate.title,
        sourceUrl: candidate.url,
        publisher: candidate.source,
        publishedAt: isoDate(candidate.publishedAt),
        sourceType: candidate.sourceType,
        sourceTier: sourceTier(candidate.sourceType),
        evidenceSnippet: candidate.snippet || candidate.title,
        verificationStatus: conflicting
          ? ("conflicting" as const)
          : checks[index].status,
         contentType:
          checks[index].status === "verified" &&
          validateTimestamp(candidate) === "valid"
            ? ("FACT" as const)
            : ("SIGNAL" as const),
      }));
      const publishedAt = newestPublishedAt;
      const official = sources
        .filter((source) => source.sourceType !== "social")
        .map((source) => ({
          name: source.publisher,
          url: source.sourceUrl,
          kind: "原文" as const,
        }));
      const socialSources = sources
        .filter((source) => source.sourceType === "social")
        .map((source) => ({
          name: source.publisher,
          url: source.sourceUrl,
          kind: "讨论" as const,
        }));
      const explanation = [
        questionMatches.length
          ? `为未解决问题补充证据：${questionMatches.join("、")}`
          : gapMatches.length
            ? `命中信息缺口：${gapMatches.join("、")}`
            : entityMatches.length
              ? `涉及正在跟踪的实体：${entityMatches.join("、")}`
              : "与当前关注领域匹配",
        `${sources.length} 个原始来源`,
        verificationStatus === "verified"
          ? "包含 Primary Source"
          : verificationStatus === "partially_verified"
            ? "证据尚未完全闭环"
            : verificationStatus === "conflicting"
              ? "来源之间存在冲突"
              : "尚无独立证据",
      ].join("；");
      const whyItMatters = questionMatches.length
        ? `这为你尚未解决的“${questionMatches[0]}”提供了新证据。`
        : gapMatches.length
          ? `这补充了你的信息缺口“${gapMatches[0]}”，可能影响后续判断。`
          : entityMatches.length
            ? `这是你正在跟踪的 ${entityMatches[0]} 的新变化。`
            : knownMatches.length
              ? "这不是一个全新主题，但出现了需要重新核对的证据更新。"
              : verificationStatus === "unverified"
                ? "这是非常早期的线索，目前不能当作事实。"
                : "它与当前问题相关，并包含此前知识状态中没有记录的证据。";
      return {
        id: stableEventId(item.title),
        category: "匹配",
        channel: hasPrimary
          ? "官方"
          : hasTrusted || hasIndustry
            ? "混合"
            : "社区",
        title: item.title,
        summary: (item.snippet || item.title).slice(0, 240),
        time:
          (eventStatus === "UPDATED" || eventStatus === "FOLLOW_UP") && latestUpdateAt
            ? `有更新 · ${ageLabel(latestUpdateAt)}`
            : eventFreshness.label,
        truth: reliabilityScore,
        baseUseful: relevanceScore,
        lead: freshnessScore,
        tags: [
          ...plan.coreKeywords,
          ...plan.englishKeywords,
          ...plan.synonyms,
          ...plan.entities,
        ],
        action:
          verificationStatus === "verified"
            ? "阅读最高权重原文，确认适用范围后再行动。"
            : "先查看证据与冲突点；在补齐独立来源前不要将其当作事实传播。",
        why: explanation,
        official,
        social: socialSources,
        sourceType: item.sourceType,
        sourceTier: sourceTier(item.sourceType),
        sourceUrl: item.url,
        publisher: sources.length > 1 ? `${item.source} 等` : item.source,
        publishedAt,
        eventOccurredAt: originalOccurredAt,
        firstSeenAt:
          earliestValidTimestamp(ordered.map((candidate) => candidate.firstSeenAt)) ||
          new Date().toISOString(),
        lastUpdatedAt: latestUpdateAt,
        retrievedAt:
          latestValidTimestamp(ordered.map((candidate) => candidate.retrievedAt)) ||
          new Date().toISOString(),
        originalOccurredAt,
        latestUpdateAt,
        timestampStatus: eventFreshness.timestampStatus,
        dataOrigin: ordered.some((candidate) => candidate.dataOrigin === "live")
          ? "live"
          : "imported",
        confidence: reliabilityScore,
        verificationStatus,
        relevanceScore,
        reliabilityScore,
        freshnessScore,
        noveltyScore,
        judgementImpactScore,
        gapMatchScore,
        overallScore,
        sourceCount: sources.length,
        claims,
        sources,
        section:
          eventStatus === "SIGNAL" || verificationStatus === "conflicting"
            ? "emerging"
            : gapMatches.length || questionMatches.length
              ? "gap_update"
              : "all",
        gapMatches,
        questionMatches,
        entityMatches,
        whyItMatters,
        eventStatus,
        informationType:
          verificationStatus === "verified"
            ? "FACT"
            : eventStatus === "SIGNAL"
              ? "SIGNAL"
              : "INTERPRETATION",
        knowledgeStatus: alreadyKnown
          ? "KNOWN"
          : knownMatches.length
            ? "UPDATED"
            : "NOVEL",
        attentionDecision: canEnterLibrary ? "LIBRARY_ONLY" : "IGNORE",
      } satisfies ResearchSignal;
    })
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 50);

  const selectedEntities = new Set<string>();
  let selectedCount = 0;
  for (const signal of allSignals) {
    const passesGates =
      signal.reliabilityScore >= 70 &&
      signal.relevanceScore >= 75 &&
      signal.noveltyScore >= 60 &&
      signal.judgementImpactScore >= 48 &&
      signal.knowledgeStatus !== "KNOWN" &&
      signal.verificationStatus !== "unverified" &&
      signal.verificationStatus !== "conflicting" &&
      signal.eventStatus !== "SIGNAL" &&
      signal.timestampStatus === "valid" &&
      (trackedEntityTerms.length === 0 ||
        signal.entityMatches.length > 0 ||
        (signal.gapMatchScore >= 80 && signal.judgementImpactScore >= 80)) &&
      (signal.eventStatus !== "BACKGROUND" ||
        (signal.gapMatchScore >= 80 && signal.judgementImpactScore >= 80));
    const repeatsEntity = signal.entityMatches.some((entity) =>
      selectedEntities.has(entity),
    );
    if (passesGates && selectedCount < 5 && !repeatsEntity) {
      signal.attentionDecision = "MUST_READ";
      signal.section = "must_know";
      signal.entityMatches.forEach((entity) => selectedEntities.add(entity));
      selectedCount += 1;
    }
  }
  const watchedEntities = new Set<string>();
  let worthWatchingCount = 0;
  for (const signal of allSignals) {
    const canWatch =
      signal.attentionDecision !== "MUST_READ" &&
      signal.eventStatus === "SIGNAL" &&
      signal.timestampStatus === "valid" &&
      signal.freshnessScore >= 80 &&
      signal.relevanceScore >= 70 &&
      signal.noveltyScore >= 60 &&
      signal.knowledgeStatus !== "KNOWN" &&
      (trackedEntityTerms.length === 0 ||
        signal.entityMatches.length > 0 ||
        signal.gapMatchScore >= 80);
    const repeatsEntity = signal.entityMatches.some((entity) => watchedEntities.has(entity));
    if (canWatch && worthWatchingCount < 3 && !repeatsEntity) {
      signal.attentionDecision = "WORTH_WATCHING";
      signal.section = "emerging";
      signal.entityMatches.forEach((entity) => watchedEntities.add(entity));
      worthWatchingCount += 1;
    }
  }
  const signals = allSignals
    .filter((signal) => signal.attentionDecision !== "IGNORE");

  counts = {
    ...counts,
    verified: allSignals.filter(
      (signal) => signal.verificationStatus === "verified",
    ).length,
  };
  await emit({
    stage: "claim_extraction",
    label: `Claim 提取完成 · ${allSignals.reduce((total, signal) => total + signal.claims.length, 0)} 条有来源 Claim`,
    counts,
  });
  await emit({
    stage: "verification",
    label: `已验证 ${counts.verified} 个事件 · ${allSignals.length - counts.verified} 个需继续核查`,
    counts,
  });
  await emit({
    stage: "gap_matching",
    label: `信息缺口匹配完成 · ${signals.filter((signal) => signal.gapMatches.length > 0).length} 个更新`,
    counts,
  });
  await emit({
    stage: "novelty",
    label: "已对照 Known Information 检查新颖度",
    counts,
  });
  await emit({
    stage: "scoring",
    label: "七维评分完成 · Gate 优先于 Overall",
    counts,
  });
  await emit({
    stage: "filtering",
    label: `注意力决策完成 · ${selectedCount} 条 Must Read，${worthWatchingCount} 条 Worth Watching`,
    counts,
  });
  await emit({
    stage: "explanation",
    label: "已生成仅基于现有证据的解释",
    counts,
  });
  const presentation = await translateSignalsForPresentation(signals);
  await emit({
    stage: "translation",
    label: presentation.failed
      ? `翻译完成 · ${presentation.translated} 条中文呈现，${presentation.failed} 条保留原文`
      : `翻译完成 · ${presentation.translated} 条中文呈现`,
    counts,
  });
  if (!allSignals.length) {
    failures.push("Result: 四级来源均未返回与扩展关键词相关的资料；建议加入公司名、人物名、产品名或监管机构名后重试。");
  }
  await emit({
    stage: "complete",
    label: selectedCount
      ? `研究完成 · 今天 ${selectedCount} 条值得注意`
      : "研究完成 · 今天没有重要变化",
    counts,
  });

  const overview = {
    scanned,
    deduplicated: candidates.length,
    events: allSignals.length,
    verified: allSignals.filter((signal) => signal.verificationStatus === "verified")
      .length,
    relevant: signals.length,
    mustKnow: selectedCount,
    worthWatching: worthWatchingCount,
    libraryOnly: signals.filter(
      (signal) => signal.attentionDecision === "LIBRARY_ONLY",
    ).length,
    ignored: allSignals.filter(
      (signal) => signal.attentionDecision === "IGNORE",
    ).length,
    noiseReductionRate: scanned
      ? clamp(((scanned - selectedCount) / scanned) * 100)
      : 0,
    novelInformationRate: signals.length
      ? clamp(
          (signals.filter((signal) => signal.noveltyScore >= 60).length /
            signals.length) *
            100,
        )
      : 0,
  };

  return {
    signals: presentation.signals,
    status: [
      { name: "Primary Sources", ok: allPrimary.length > 0 },
      { name: "Trusted Media", ok: trustedMedia.length > 0 },
      { name: "Industry Media", ok: industryMedia.length > 0 },
      { name: "Reddit", ok: reddit.length > 0 },
      ...socialAccess.statuses.map((provider) => ({
        name: provider.label,
        ok: provider.state === "connected",
        state: provider.state,
      })),
    ],
    queryPlan: plan,
    progress,
    failures,
    counts,
    overview,
    fetchedAt: new Date().toISOString(),
    dataMode: "LIVE",
    lastCheckedAt: new Date().toISOString(),
  };
}
