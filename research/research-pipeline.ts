import { parseCustomSources, type CustomSourceCheck } from "../lib/custom-sources.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { retrieveRegisteredFeeds, type FeedReadCache } from "./registered-feeds.ts";
import { socialAccessLayer, type LiveItem } from "../social/providers/index.ts";
import { deduplicateSocialEvidence } from "../social/evidence-dedup.ts";
import {
  earliestValidTimestamp,
  freshnessWindowHours,
  latestValidTimestamp,
  resolveFreshness,
  validateTimestamp,
} from "../information/freshness.ts";
import { planQuery } from "./query-planner.ts";
import {
  selectBoundedCandidates,
  type CandidateEligibilityAudit,
  type CandidateSelectionAudit,
  type CandidateSelectionInput,
  type PreliminaryEligibilityFailure,
  type ProtectedReason,
} from "./candidate-selection.ts";
import {
  discoverOfficialGithubReleases,
  discoverOfficialUpdatePages,
} from "./github-discovery.ts";
import { resolveCompanySources } from "../source-registry/resolver.ts";
import { classifySource } from "./source-classifier.ts";
import { describesRecentChange } from "./recent-signal.ts";
import { buildFilteringSummary } from "./filtering-summary.ts";
import { cleanContent, extractClaim, mapSignalPresentation } from "../content-processing/index.ts";
import {
  assessNoveltyAttribution,
  type NoveltyClusterMember,
} from "./novelty-attribution.ts";
import { translateSignalsForPresentation } from "./translation.ts";
import { buildSourceCoverage, type ProviderRejectionSample, type SourceExecutionOutcome } from "./source-coverage.ts";
import { fuseSignal } from "../signal-fusion/fusion.ts";
import type { FusionEvidence } from "../signal-fusion/types.ts";
import { enrichDetail, maxDetailFetchesPerRound, shouldEnrichDetail, sourceCapability } from "../source-enrichment/index.ts";
import type { DetailEnrichmentSummary } from "../source-enrichment/types.ts";
import { discardResponseBody, throwAfterDiscardingBody } from "../lib/http-response.ts";

// Budget allocation reserves, derived from measured costs rather than a fixed
// percentage:
// - a real canonical detail fetch takes ~3-5s, so reserving ~4s per attempt lets
//   up to 2 eligible canonical URLs be completed within the worker deadline.
// - post-enrichment work (aggregation / evidence / response) measures ~30ms; a
//   2.5s floor gives safe headroom without demanding the old 7s reserve that
//   starved enrichment to zero on tight budgets.
const DETAIL_FETCH_RESERVE_MS = 8000;
const POST_PROCESSING_RESERVE_MS = 2500;
// Luxury web tiers (general web / community) only start new expensive requests
// while this much of the deadline remains, so enrichment + response are
// preserved even after model planning consumes a large share of the 25s budget:
// 2 realistic detail fetches (~4s each) + post-processing floor + planning margin.
const PLANNING_MARGIN_MS = 2500;
const RETRIEVAL_RESERVATION_MS = DETAIL_FETCH_RESERVE_MS + POST_PROCESSING_RESERVE_MS + PLANNING_MARGIN_MS;
import { recordsFromSignal, type EvidenceRecord } from "../information/rag-records.ts";
import { assessTopicRelevance } from "./topic-relevance.ts";
import { isGenericQuestionTerm } from "./topic-relevance.ts";
import { assessSignalActionability } from "./actionability.ts";
import type {
  PipelineCounts,
  PipelineProgress,
  ResearchCandidate,
  ResearchInput,
  ResearchResponse,
  ResearchSignal,
  RetrievalPlan,
  SourceStageDiagnostics,
  QueryPlan,
  SourceType,
  VerificationStatus,
} from "./types.ts";

type ProgressHandler = (progress: PipelineProgress) => void | Promise<void>;

export type ResearchPipelineDebug = {
  feedCache?: FeedReadCache;
  customSourceReader?: typeof readCustomSource;
  onCandidateSelectionAudit?: (audit: CandidateSelectionAudit[]) => void;
  onEligibilityAudit?: (audit: EligibilityAuditFunnel) => void;
  onPhase?: (event: { phase: string; round?: number; attemptId?: string; attemptType?: "primary" | "fallback" | "verification"; success?: boolean; itemCount?: number; errorCode?: string; diagnostic?: Record<string, unknown> }) => void;
  deadlineAt?: number;
};

type LegacySourceSelection = {
  primarySourceType?: string;
  selectedSourceType?: string;
  fallbackSourceTypes?: string[];
  allowedProviderIds?: string[];
  reason?: string;
};

function uniqueEvidenceRecords(records: EvidenceRecord[]) {
  const byIdentity = new Map<string, EvidenceRecord>();
  for (const record of records) {
    const identity = record.id || `${record.claimId}:${record.canonicalUrl}`;
    const current = byIdentity.get(identity);
    if (!current) {
      byIdentity.set(identity, record);
      continue;
    }
    byIdentity.set(identity, {
      ...current,
      ...record,
      verificationStatus:
        current.verificationStatus === "verified" || record.verificationStatus === "verified"
          ? "verified"
          : current.verificationStatus === "partially_verified" || record.verificationStatus === "partially_verified"
            ? "partially_verified"
            : current.verificationStatus === "conflicting" || record.verificationStatus === "conflicting"
              ? "conflicting"
              : "unverified",
    });
  }
  return [...byIdentity.values()];
}

export type PipelinePlanResolution = {
  plan: QueryPlan;
  fallbackUsed: boolean;
  fallbackReason?: string;
  retrievalPlanSource: "upstream_agent_plan" | "pipeline_fallback_plan";
  agentGeneratedQueries?: string[];
};

function deterministicTerms(values: Array<string | undefined>, max = 12) {
  const ignored = new Set(["the", "and", "or", "for", "with", "from", "latest", "recent", "update", "updates"]);
  const terms = values.flatMap((value) => String(value ?? "")
    .split(/[^\p{L}\p{N}._+-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !ignored.has(term.toLocaleLowerCase())));
  return [...new Set(terms)].slice(0, max);
}

function validRetrievalQueries(plan?: RetrievalPlan | LegacySourceSelection) {
  if (!plan || !("queries" in plan) || !Array.isArray(plan.queries)) return [];
  return [...new Set(plan.queries.map((query) => query.trim()).filter(Boolean))];
}

export function normalizeRetrievalFreshness(value?: string): QueryPlan["requestedFreshnessWindow"] {
  const raw = value?.trim().toLowerCase() || "7d";
  if (/90d|90\s*(?:天|days?)|3\s*个月/.test(raw)) return "90d";
  // Order matters: the 30d/month window must be tested before the single-digit
  // "3" branch, otherwise "30d" is truncated to 3d and a one-month question
  // silently searches only the last three days.
  if (raw.includes("30") || raw.includes("month") || raw.includes("月")) return "30d";
  if (raw.includes("24") || raw.includes("day") || raw.includes("today") || raw.includes("小时")) return "24h";
  if (raw.includes("3")) return "3d";
  return "7d";
}

export function resolvePipelinePlan(input: ResearchInput, upstream?: RetrievalPlan | LegacySourceSelection): PipelinePlanResolution {
  const upstreamQueries = validRetrievalQueries(upstream);
  // The derived plan is the exclusion source of truth: a per-question
  // exclusion wins over any positive entity the agent plan may still carry.
  const derivedPlan = planQuery(input);
  const derivedExcludedEntities = derivedPlan.excludedEntities ?? [];
  const derivedExcludedContentTypes = derivedPlan.excludedContentTypes ?? [];
  if (upstreamQueries.length && upstream && "queries" in upstream) {
    const resolvedEntities = upstream.resolvedEntities ?? [];
    const isExcludedTerm = (value: string) => derivedExcludedEntities.some((entity) =>
      value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "") === entity.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ""));
    const mentionsExcluded = (value: string) => derivedExcludedEntities.some((entity) => {
      const escaped = entity.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(` ${value.toLocaleLowerCase()} `);
    });
    const cleanQueries = upstreamQueries.filter((query) => !mentionsExcluded(query));
    const entities = resolvedEntities.map((entity) => entity.canonicalEntity).filter(Boolean)
      .filter((entity) => !isExcludedTerm(entity));
    const aliasesConsidered = [...new Set(resolvedEntities.flatMap((entity) => entity.aliasesConsidered ?? []))];
    const requestedFreshnessWindow = normalizeRetrievalFreshness(upstream.freshnessWindow ?? input.freshnessWindow);
    return {
      fallbackUsed: false,
      retrievalPlanSource: "upstream_agent_plan",
      agentGeneratedQueries: cleanQueries,
      plan: {
        originalNeed: input.currentQuestions?.trim() || input.industry,
        coreKeywords: deterministicTerms([input.focusAreas, input.trackedEntities, input.currentQuestions, ...cleanQueries])
          .filter((term) => !isExcludedTerm(term)),
        topicAnchors: upstream.topicAnchors ?? derivedPlan.topicAnchors,
        topicKeywords: upstream.topicKeywords ?? derivedPlan.topicKeywords,
        topicProfile: upstream.topicProfile,
        englishKeywords: upstream.topicKeywords ? derivedPlan.englishKeywords : [],
        synonyms: [],
        entities,
        industryKeywords: derivedPlan.industryKeywords,
        changeKeywords: [],
        knowledgeAwareQueries: [],
        searchCombinations: cleanQueries,
        retrievalWindows: upstream.retrievalWindows ?? [requestedFreshnessWindow],
        requestedFreshnessWindow,
        selectedSourceType: upstream.selectedSourceType,
        fallbackSourceTypes: upstream.fallbackSourceTypes,
        allowedProviderIds: upstream.allowedProviderIds,
        sourceSelectionReason: upstream.reason,
        resolvedEntities,
        aliasesConsidered,
        queryBudget: cleanQueries.length,
        deduplicatedQueryCount: cleanQueries.length,
        excludedEntities: derivedExcludedEntities,
        excludedContentTypes: derivedExcludedContentTypes,
      },
    };
  }

  const legacy = upstream as LegacySourceSelection | undefined;
  return {
    fallbackUsed: true,
    fallbackReason: upstream ? "upstream_plan_missing_valid_queries" : "upstream_plan_missing",
    retrievalPlanSource: "pipeline_fallback_plan",
    plan: {
      ...derivedPlan,
      selectedSourceType: legacy?.primarySourceType ?? legacy?.selectedSourceType,
      fallbackSourceTypes: legacy?.fallbackSourceTypes,
      allowedProviderIds: legacy?.allowedProviderIds,
      sourceSelectionReason: legacy?.reason,
    },
  };
}

export type EligibilityAuditFunnel = {
  eventClusters: number;
  preliminaryEligible: number;
  preliminaryIgnore: number;
  candidatePool: number;
  mustRead: number;
  worthWatching: number;
  libraryOnly: number;
  preliminaryIgnoreFailureCounts: Partial<Record<PreliminaryEligibilityFailure, number>>;
};

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

function xmlAttribute(block: string, tag: string, attribute: string) {
  return block.match(new RegExp(`<${tag}[^>]*\\s${attribute}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function htmlPublishedAt(html: string) {
  const raw =
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ||
    "";
  if (!raw) return undefined;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
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
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Google News returned ${response.status}`));
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, 12)
    .map((match) => {
      const block = match[1];
      const publisher = xmlValue(block, "source") || "Google News";
      const publisherUrl = xmlAttribute(block, "source", "url");
      return {
        title: xmlValue(block, "title"),
        url: xmlValue(block, "link"),
        snippet: xmlValue(block, "description"),
        source: publisher,
        publisherUrl: publisherUrl || undefined,
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

async function duckDuckGoSearch(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalMapResearch/0.4)" },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`DuckDuckGo returned ${response.status}`));
  const html = await response.text();
  const seen = new Set<string>();
  return [...html.matchAll(/<a[^>]+class=["']?[^"']*result__a[^"']*["']?[^>]+href=["']([^"']+?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .flatMap((match) => {
      const rawUrl = (match[1] || "").trim();
      const uddg = rawUrl.match(/[?&]uddg=([^&]+)/)?.[1];
      const url = uddg ? decodeURIComponent(uddg) : rawUrl;
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
      seen.add(url);
      const title = decodeXml(match[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!title) return [];
      return [{
        id: `ddg-${encodeURIComponent(url).slice(0, 48)}`,
        title,
        url,
        snippet: title,
        source: "DuckDuckGo",
        firstSeenAt: retrievedAt,
        retrievedAt,
        dataOrigin: "live",
        channel: "混合",
        authority: 60,
        origin: "news",
      } satisfies LiveItem];
    })
    .slice(0, 12);
}

type WebSearchWithFallbackResult = { items: LiveItem[]; engine: "google_news" | "duckduckgo"; fallbackTried: boolean; failed?: boolean };

async function webSearchWithFallback(query: string): Promise<WebSearchWithFallbackResult> {
  let googleError: unknown;
  let googleItems: LiveItem[] = [];
  try {
    googleItems = await googleNews(query);
  } catch (error) {
    googleError = error;
  }
  if (!googleError && googleItems.length) {
    return { items: googleItems, engine: "google_news", fallbackTried: false };
  }
  try {
    return { items: await duckDuckGoSearch(query), engine: "duckduckgo", fallbackTried: true };
  } catch {
    // Both engines failed for this query. Keep the result on the fulfilled path so
    // the caller can still record that the fallback was attempted, while flagging
    // the query as failed rather than silently treating it as zero results.
    return { items: [], engine: "duckduckgo", fallbackTried: true, failed: true };
  }
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
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Reddit returned ${response.status}`));
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

async function hackerNewsSearch(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: "8",
  });
  const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Hacker News returned ${response.status}`));
  const payload = (await response.json()) as {
    hits?: Array<{
      objectID: string;
      title?: string;
      story_title?: string;
      url?: string;
      story_url?: string;
      created_at?: string;
      points?: number;
      author?: string;
    }>;
  };
  return (payload.hits || [])
    .map((hit) => ({
      id: hit.objectID,
      title: hit.title || hit.story_title || "",
      url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: `${hit.points || 0} points · ${hit.author || "HN"} · Hacker News discussion`,
      source: "Hacker News",
      publishedAt: hit.created_at,
      firstSeenAt: retrievedAt,
      retrievedAt,
      dataOrigin: "live",
      channel: "社区",
      authority: 58,
      origin: "hn",
    } satisfies LiveItem))
    .filter((item) => item.title && item.url);
}

async function huggingFaceSearch(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const queryVariants = [query.trim()].filter(Boolean);
  const fetchCollection = async (type: "models" | "spaces" | "datasets", search: string) => {
    const params = new URLSearchParams({
      search,
      sort: type === "models" ? "lastModified" : "lastModified",
      direction: "-1",
      limit: "4",
    });
    const response = await fetch(`https://huggingface.co/api/${type}?${params}`, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
    if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Hugging Face ${type} returned ${response.status}`));
    return (await response.json()) as Array<{
    id: string;
    author?: string;
    lastModified?: string;
      createdAt?: string;
    pipeline_tag?: string;
      tags?: string[];
    downloads?: number;
    likes?: number;
  }>;
  };
  const requests = (["models", "spaces", "datasets"] as const).flatMap((type) =>
    queryVariants.map((variant) => ({ type, variant })),
  );
  const settled = await Promise.allSettled(requests.map((request) => fetchCollection(request.type, request.variant)));
  const seen = new Set<string>();
  return settled.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    const collectionType = requests[index].type;
    const type = collectionType === "models" ? "model" : collectionType === "spaces" ? "space" : "dataset";
    return result.value.flatMap((item) => {
      const key = `${type}:${item.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
    return [{
      id: `hf-${type}-${item.id}`,
      title: `Hugging Face ${type} signal: ${item.id}`,
      url: `https://huggingface.co/${type === "dataset" ? "datasets/" : type === "space" ? "spaces/" : ""}${item.id}`,
      snippet: `${item.pipeline_tag || type} · ${(item.tags || []).slice(0, 5).join(", ")} · ${item.downloads || 0} downloads · ${item.likes || 0} likes`,
      source: `Hugging Face · ${type}`,
      publishedAt: item.lastModified || item.createdAt,
    firstSeenAt: retrievedAt,
    retrievedAt,
    dataOrigin: "live",
    channel: "社区",
    authority: 66,
    origin: "community",
    } satisfies LiveItem];
    });
  }).slice(0, 12);
}

async function productHuntSearch(query: string): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const response = await fetch(`https://www.producthunt.com/search?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Product Hunt returned ${response.status}`));
  const html = await response.text();
  const links = [...html.matchAll(/href=["'](\/products\/[^"']+)["'][^>]*>([\s\S]{0,240}?)<\/a>/gi)];
  const seen = new Set<string>();
  return links.flatMap((match) => {
    const path = match[1].split("?")[0].replace(/\/reviews\/?$/i, "");
    if (seen.has(path)) return [];
    seen.add(path);
    const title = decodeXml(match[2] || "").replace(/\s+/g, " ").trim();
    const productName = title || path.split("/").filter(Boolean).pop()?.replace(/-/g, " ") || "Product Hunt product";
    return [{
      id: `product-hunt-${path}`,
      title: `Product Hunt signal: ${productName}`,
      url: `https://www.producthunt.com${path}`,
      snippet: `Product discovery / startup signal from Product Hunt: ${productName}`,
      source: "Product Hunt",
      publishedAt: undefined,
      firstSeenAt: retrievedAt,
      retrievedAt,
      dataOrigin: "live",
      channel: "社区",
      authority: 55,
      origin: "community",
    } satisfies LiveItem];
  }).slice(0, 8);
}

async function companyRegistrySearch(plan: QueryPlan): Promise<LiveItem[]> {
  const retrievedAt = new Date().toISOString();
  const profiles = resolveCompanySources({ entities: plan.entities, query: plan.originalNeed });
  const pages = profiles.flatMap((profile) => [
    ...profile.changelogUrls.map((url) => ({ url, publisher: `${profile.company} · Changelog` })),
    ...profile.newsroomUrls.map((url) => ({ url, publisher: `${profile.company} · Newsroom` })),
    ...profile.docsUrls.map((url) => ({ url, publisher: `${profile.company} · Docs` })),
  ]).slice(0, 8);
  const settled = await Promise.allSettled(pages.map(async (page) => {
    const response = await fetch(page.url, {
      headers: { "User-Agent": "SignalMapResearch/0.4" },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) {
      await discardResponseBody(response);
      return null;
    }
    if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Company registry returned ${response.status}`));
    const html = await response.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const publishedAt = htmlPublishedAt(html);
    return {
      id: `company-registry-${encodeURIComponent(page.url)}`,
      title: decodeXml(title || `${page.publisher} updates`),
      url: page.url,
      snippet: decodeXml(html).slice(0, 500) || `${page.publisher} official source`,
      source: page.publisher,
      publishedAt,
      eventOccurredAt: publishedAt,
      firstSeenAt: retrievedAt,
      retrievedAt,
      dataOrigin: "live",
      channel: "官方",
      authority: 95,
      origin: "official",
    } satisfies LiveItem;
  }));
  return settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export type ArxivRawResult = {
  title?: string;
  url?: string;
  snippet?: string;
  publishedAt?: string;
};

export type ArxivNormalizationResult = {
  items: LiveItem[];
  rawResultCount: number;
  normalizedCandidateCount: number;
  rejectedRawCount: number;
  normalizationRejectionReasons: Record<string, number>;
  normalizationRejectedSamples: ProviderRejectionSample[];
};

function rejectionSample(
  result: { title?: string; url?: string },
  rejectionStage: ProviderRejectionSample["rejectionStage"],
  rejectionReason: string,
): ProviderRejectionSample {
  return {
    title: (result.title || "").replace(/\s+/g, " ").trim().slice(0, 160) || "[untitled]",
    urlPresent: Boolean(result.url?.trim()),
    rejectionStage,
    rejectionReason,
  };
}

export function normalizeArxivResults(rawResults: ArxivRawResult[], retrievedAt = new Date().toISOString()): ArxivNormalizationResult {
  const normalizationRejectionReasons: Record<string, number> = {};
  const normalizationRejectedSamples: ProviderRejectionSample[] = [];
  const incrementRejected = (result: ArxivRawResult, reason: string) => {
    normalizationRejectionReasons[reason] = (normalizationRejectionReasons[reason] || 0) + 1;
    if (normalizationRejectedSamples.length < 3) {
      normalizationRejectedSamples.push(rejectionSample(result, "normalization", reason));
    }
  };
  const items = rawResults.flatMap((result, index) => {
    const title = result.title?.trim() || "";
    const url = result.url?.trim() || "";
    if (!title) {
      incrementRejected(result, "missing_title");
      return [];
    }
    if (!url) {
      incrementRejected(result, "missing_url");
      return [];
    }
    try {
      new URL(url);
    } catch {
      incrementRejected(result, "invalid_url");
      return [];
    }
    return [{
      id: `arxiv-${index}-${url}`,
      title,
      url,
      snippet: result.snippet?.trim() || title,
      source: "arXiv",
      publishedAt: result.publishedAt?.trim() || undefined,
      firstSeenAt: retrievedAt,
      retrievedAt,
      dataOrigin: "live",
      channel: "官方",
      authority: 82,
      origin: "official",
    } satisfies LiveItem];
  });
  return {
    items,
    rawResultCount: rawResults.length,
    normalizedCandidateCount: items.length,
    rejectedRawCount: rawResults.length - items.length,
    normalizationRejectionReasons,
    normalizationRejectedSamples,
  };
}

type DirectProviderSearchResult = ArxivNormalizationResult | LiveItem[];

async function arxivSearch(query: string): Promise<ArxivNormalizationResult> {
  const retrievedAt = new Date().toISOString();
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: "8",
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
    headers: { "User-Agent": "SignalMapResearch/0.4" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) await throwAfterDiscardingBody(response, new Error(`arXiv returned ${response.status}`));
  const xml = await response.text();
  const rawResults = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const block = match[1];
    return {
      title: xmlValue(block, "title"),
      url: xmlValue(block, "id"),
      snippet: xmlValue(block, "summary"),
      publishedAt: xmlValue(block, "published") || xmlValue(block, "updated"),
    } satisfies ArxivRawResult;
  });
  return normalizeArxivResults(rawResults, retrievedAt);
}

async function searchDirectProvider(
  source: string,
  search: () => Promise<DirectProviderSearchResult>,
  sourceType: SourceType,
  plan: QueryPlan,
  failures: string[],
  providerId?: string,
) {
  try {
    const providerResult = await search() as DirectProviderSearchResult;
    const normalization = Array.isArray(providerResult) ? undefined : providerResult;
    const rawItems: LiveItem[] = normalization
      ? normalization.items
      : (providerResult as LiveItem[]);
    const discoveryProvider = providerId ? sourceCapability(providerId) === "DISCOVERY" : false;
    const candidateAdmissionRejectionReasons: Record<string, number> = {};
    const candidateAdmissionRejectedSamples: ProviderRejectionSample[] = [];
    const normalizedItems = rawItems.flatMap((item) => {
      if (discoveryProvider || relevant(item, plan)) {
        return [{
        ...item,
        sourceType,
        providerId,
        sourceCapability: providerId ? sourceCapability(providerId) : undefined,
        }];
      }
      const reason = "TOPIC_MISMATCH";
      candidateAdmissionRejectionReasons[reason] = (candidateAdmissionRejectionReasons[reason] || 0) + 1;
      if (candidateAdmissionRejectedSamples.length < 3) {
        candidateAdmissionRejectedSamples.push(rejectionSample(item, "candidate_admission", reason));
      }
      return [];
    });
    const items = unique(normalizedItems);
    return {
      items,
      outcome: {
        providerId,
        source,
        execution: items.length ? "searched_with_results" as const : "searched_no_results" as const,
        searched: true,
        resultCount: items.length,
        rawResultCount: normalization?.rawResultCount ?? rawItems.length,
        normalizedCandidateCount: normalization?.normalizedCandidateCount ?? rawItems.length,
        rejectedRawCount: normalization?.rejectedRawCount ?? 0,
        normalizationRejectionReasons: normalization?.normalizationRejectionReasons,
        normalizationRejectedSamples: normalization?.normalizationRejectedSamples,
        candidateAdmissionRejectionReasons,
        candidateAdmissionRejectedSamples,
        requestCount: 1,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((message.match(/returned (\d+)/) || [])[1] || 0);
    failures.push(`${source}: 请求失败或超时。`);
    return {
      items: [] as ResearchCandidate[],
      outcome: {
        providerId,
        source,
        execution: "failed" as const,
        searched: true,
        resultCount: 0,
        requestCount: 1,
        failureCode: status === 403 ? "forbidden" as const : "upstream_error" as const,
      },
    };
  }
}

function primaryDomains(plan: QueryPlan) {
  const need = plan.originalNeed;
  if (/IPO|上市|纳指|Nasdaq|股票|投资|证券|募资|财报/i.test(need)) {
    return "(site:sec.gov OR site:nasdaq.com OR site:nyse.com OR site:investor.* OR \"Investor Relations\")";
  }
  // Video editing / creator-tool questions: the AI vendor whitelist above
  // excludes the whole editing ecosystem, so a short primary query plus that
  // whitelist returned zero results. These are the industry's first-hand
  // vendor domains (changelogs/release notes live there); candidates still
  // have to pass topic relevance and freshness downstream.
  if (/视频|剪辑|粗剪|镜头|video edit|rough cut|video workflow/i.test(need)) {
    return "(site:adobe.com OR site:helpx.adobe.com OR site:blackmagicdesign.com OR site:apple.com OR site:descript.com OR site:descript.canny.io OR site:runway.com OR site:topazlabs.com OR site:pika.art OR site:opusclip.canny.io OR site:firecut.ai OR site:timebolt.io)";
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
  // MATCH and UNCERTAIN both stay in the material stream: uncertain evidence is
  // kept as a candidate but cannot become confirmed knowledge (the write path
  // requires an explicit MATCH).
  const decision = assessTopicRelevance(`${item.title} ${item.snippet}`, plan).decision;
  return decision !== "TOPIC_MISMATCH";
}

const providerQueryNoise = new Set([
  "a", "an", "and", "artificial intelligence", "change", "changes",
  "official", "latest", "new", "news", "recent", "release notes",
  "research", "the", "today", "update", "updates", "what", "with",
]);

function retrievalTopicKeywords(plan: QueryPlan) {
  const values = [
    ...(plan.topicAnchors ?? []),
    ...(plan.topicKeywords ?? []),
    ...plan.entities,
    ...plan.coreKeywords,
    ...plan.industryKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
    ...(plan.aliasesConsidered || []),
  ];
  const seen = new Set<string>();
  return values
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (value.length < 3 || value.length > 90 || providerQueryNoise.has(normalized) || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return value.split(/\s+/).some((word) =>
        word.replace(/[^\p{L}\p{N}+#.-]/gu, "").length > 2,
      );
    });
}

function shortQueryFor(plan: QueryPlan, providerId: string, limit = 3): string {
  // Very long natural-language prompts translate to poor full-text matches on
  // Hacker News / Hugging Face. Use a few short topic concepts instead.
  const keywords = retrievalTopicKeywords(plan);
  const short = keywords.filter((value) => value.split(/\s+/).length <= 3);
  const pool = short.length ? short : keywords.slice(0, limit);
  // Cap by total words (not item count): two 2-word anchors plus a 2-word
  // modifier would otherwise exceed the short-query budget this function
  // exists for.
  const pickedWords: string[] = [];
  for (const value of pool) {
    for (const word of value.split(/\s+/)) {
      if (pickedWords.length >= limit * 2) break;
      pickedWords.push(word);
    }
    if (pickedWords.length >= limit * 2) break;
  }
  const picked = pickedWords.join(" ");
  const modifier = (
    {
      "hacker-news": "workflow tool",
      huggingface: "model",
    } as Record<string, string>
  )[providerId] || "";
  return [...new Set([picked, modifier].filter(Boolean))].join(" ").trim();
}

export // Primary (official / first-hand) queries must stay short: joining every task
// anchor into one bag ("AI video editing automated rough cut multi-asset
// understanding shot selection …") matched nothing in the real run — search
// engines treat long conjunction bags as AND-ish filters. Each variant keeps
// at most one task anchor plus a release/official intent word, so the
// release-update intent and the official-source condition survive without
// fusing anchors.
const PRIMARY_QUERY_MAX_WORDS = 6;

function shortPrimaryQuery(topic: string, intent: string): string {
  return [...new Set([topic, intent].filter(Boolean))].join(" ").trim();
}

export function providerQueryFor(plan: QueryPlan, providerId: string): string {
  const query = providerQuery(plan, providerId);
  return query;
}

providerQueryFor.all = function primaryQueryVariants(plan: QueryPlan, providerId: string): string[] {
  if (providerId !== "primary-web-search") {
    const single = providerQuery(plan, providerId);
    return single ? [single] : [];
  }
  const topics = retrievalTopicKeywords(plan);
  const shortTopics = topics.filter((topic) => topic.split(/\s+/).length <= 3);
  const anchors = (shortTopics.length ? shortTopics : topics.slice(0, 4)).slice(0, 4);
  const intents = ["release update", "official changelog", "launch announcement"];
  const variants: string[] = [];
  for (const topic of anchors) {
    for (const intent of intents) {
      const query = shortPrimaryQuery(topic, intent);
      if (query.split(/\s+/).length <= PRIMARY_QUERY_MAX_WORDS + 2) variants.push(query);
    }
    variants.push(shortPrimaryQuery(topic, ""));
  }
  return [...new Set(variants)].filter(Boolean).slice(0, 8);
};

export function providerQuery(plan: QueryPlan, providerId: string, fallbackQuery?: string) {
  if (providerId === "hacker-news" || providerId === "huggingface") {
    return shortQueryFor(plan, providerId, 2);
  }
  if (providerId === "primary-web-search") {
    // Prefer one short anchor + one intent word; never fuse every anchor.
    const topics = retrievalTopicKeywords(plan);
    const shortTopic = topics.find((topic) => topic.split(/\s+/).length <= 3) || topics[0] || "";
    const intent = (shortQueryFor(plan, "primary-web-search", 0) || "release update").split(/\s+/).slice(0, 2).join(" ");
    return shortPrimaryQuery(shortTopic, /release|update|official|launch|changelog|发布|更新/i.test(shortTopic) ? "" : intent);
  }
  const topics = retrievalTopicKeywords(plan).slice(0, 4);
  const topic = topics.join(" ");
  const queryIntent = fallbackQuery
    ?.replace(/\s+/g, " ")
    .trim()
    .split(/\s+(?=(?:product|workflow|research|official|implementation|commercial|tool|model|launch|release|changelog|technical)\b)/i)
    .at(-1)
    ?.trim() || "";
  const modifier = {
    "public-web": "latest",
    "product-hunt": "tool product",
    "hacker-news": "workflow tool implementation",
    huggingface: "model space dataset implementation",
    arxiv: "research paper method",
    "primary-web-search": "official technical",
  }[providerId] || "";
  const intent = ["product-hunt", "hacker-news", "huggingface", "arxiv"].includes(providerId)
    ? ""
    : queryIntent;
  return [...new Set([topic, intent, modifier].filter(Boolean))].join(" ").trim();
}

function providerQueries(plan: QueryPlan, providerId: string, queries: string[], limit: number) {
  const rewritten = queries.map((query) => providerQuery(plan, providerId, query)).filter(Boolean);
  return [...new Set([...rewritten, providerQuery(plan, providerId)].filter(Boolean))].slice(0, limit);
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
    ...(plan.aliasesConsidered || []),
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
  const topic = assessTopicRelevance(`${item.title} ${item.snippet}`, plan);
  const hits = topic.matchedTerms.length;
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
  expected: SourceType | "other",
  plan: QueryPlan,
  failures: string[],
  requestedFreshnessDays: number,
  allowWebFallback = false,
) {
  const candidateSourceType: SourceType = expected === "other" ? "industry_media" : expected;
  const windows = [requestedFreshnessDays];
  const discovered: LiveItem[] = [];
  let failed = 0;
  let attempted = 0;
  let successful = 0;
  let fallbackTried = false;
  let engine: "google_news" | "duckduckgo" | undefined;
  for (const days of windows) {
    attempted += queries.length;
    const settled = await Promise.allSettled(
      queries.map((query) =>
        allowWebFallback
          ? webSearchWithFallback(`${query} when:${days}d`)
          : googleNews(`${query} when:${days}d`).then((items) => ({
              items,
              engine: "google_news" as const,
              fallbackTried: false,
              failed: false,
            })),
      ),
    );
    for (const result of settled) {
      if (result.status === "rejected") {
        failed += 1;
        continue;
      }
      discovered.push(...result.value.items);
      if (result.value.fallbackTried) fallbackTried = true;
      if (engine === undefined) engine = result.value.engine;
      if (result.value.failed) failed += 1;
      else successful += 1;
    }
    const verifiedRecent = unique(
      discovered
        .filter((item) => {
          const result = resolveFreshness(item);
          return result.ageHours !== undefined && result.ageHours <= days * 24;
        })
        .map((item) => ({ ...item, sourceType: candidateSourceType })),
    );
    if (verifiedRecent.length >= 6 && days >= requestedFreshnessDays) break;
  }
  if (failed) failures.push(`${expected}: ${failed} 个搜索组合请求失败或超时。`);
  return {
    scanned: discovered.length,
    attempted,
    successful,
    failed,
    engine,
    fallbackTried,
    items: unique(
      discovered
      .filter((item) => {
        const result = resolveFreshness(item);
        const recent = result.ageHours === undefined || result.ageHours <= requestedFreshnessDays * 24;
        return (
          recent &&
          (expected === "other"
            ? classifySource(item.source, item.publisherUrl || item.url) === "other"
            : classifySource(item.source, item.publisherUrl || item.url) === expected) &&
          relevant(item, plan)
        );
      })
      .map((item) => ({ ...item, sourceType: candidateSourceType })),
    ),
  };
}

function webSearchOutcome(
  source: string,
  result: { items: ResearchCandidate[]; attempted: number; successful: number; engine?: string; fallbackTried?: boolean },
): SourceExecutionOutcome {
  if (!result.attempted) {
    return { source, execution: "not_searched", blockedBy: "budget", searched: false, resultCount: 0, requestCount: 0 };
  }
  if (!result.successful) {
    return {
      source,
      execution: "failed",
      searched: true,
      resultCount: 0,
      requestCount: result.attempted,
      failureCode: "upstream_error",
      fallbackAttempted: result.fallbackTried ?? undefined,
    };
  }
  return {
    source,
    execution: result.items.length ? "searched_with_results" : "searched_no_results",
    searched: true,
    resultCount: result.items.length,
    requestCount: result.attempted,
    engine: result.engine ?? undefined,
    fallbackAttempted: result.fallbackTried ?? undefined,
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
    .split(/[^\p{L}\p{N}.]+/u)
    .filter(Boolean);
  const tokens = parts.flatMap((part) => {
    // Version identifiers ("v0.37.0") are the discriminative part of release
    // titles; keeping them intact lets distinct releases stay distinct events
    // instead of collapsing into one "duplicate" cluster.
    if (/^v?\d+(?:\.\d+)+$/.test(part)) return [part];
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
  // Versioned release URLs of the same repo ("/releases/tag/vX.Y.Z") are
  // distinct events: token overlap on the repo name would otherwise collapse a
  // whole month of releases into one "duplicate" cluster.
  const tagPattern = /\/releases\/tag\/([^/?#]+)/i;
  const leftTag = tagPattern.exec(a.url)?.[1];
  const rightTag = tagPattern.exec(b.url)?.[1];
  if (leftTag && rightTag) {
    const sameBase = a.url.slice(0, a.url.indexOf("/tag/")) === b.url.slice(0, b.url.indexOf("/tag/"));
    if (sameBase) return leftTag.toLowerCase() === rightTag.toLowerCase();
  }
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

async function enrichDiscoveryCandidates(
  candidates: ResearchCandidate[],
  plan: QueryPlan,
  failures: string[],
  remainingBudgetMs = 12000,
) {
  const summary: DetailEnrichmentSummary = {
    detailAttempted: 0,
    detailSucceeded: 0,
    detailFailed: 0,
    stillInsufficient: 0,
  };
  const startedAt = Date.now();
  // One absolute deadline for the whole enrichment share: the per-candidate
  // loop guard and every search / body fetch inside enrichDetail obey it, so a
  // wrapper candidate cannot outlive the budget with its own fixed timeouts.
  const deadlineAt = startedAt + remainingBudgetMs;
  const cache = new Set<string>();
  const candidatesByUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const eligibleCandidates = [...candidates]
    .filter((candidate) =>
      candidate.providerId !== "custom-sources" && shouldEnrichDetail({
        providerId: candidate.providerId,
        title: candidate.title,
        snippet: candidate.snippet,
        potentialScore: usefulness(candidate, plan),
        url: candidate.url,
        // Admitted EVIDENCE candidates already passed topic relevance at
        // admission; DISCOVERY providers bypass relevance in the existing path.
        isRelevant: true,
      }),
    );
  const eligibleByProvider: Record<string, number> = {};
  for (const candidate of eligibleCandidates) {
    const providerId = candidate.providerId || candidate.source;
    eligibleByProvider[providerId] = (eligibleByProvider[providerId] || 0) + 1;
  }
  const enrichmentTargets = eligibleCandidates
    .sort((left, right) => usefulness(right, plan) - usefulness(left, plan))
    .slice(0, maxDetailFetchesPerRound);

  for (const candidate of enrichmentTargets) {
    if (Date.now() - startedAt > remainingBudgetMs) {
      failures.push("Detail Enrichment: 已接近请求时间上限，保留已有候选并跳过剩余详情抓取。");
      break;
    }
    const cacheKey = `${candidate.providerId || candidate.source}:${candidate.id || candidate.url}`;
    if (cache.has(cacheKey)) continue;
    cache.add(cacheKey);
    summary.detailAttempted += 1;
    const result = await enrichDetail({
      providerId: candidate.providerId || candidate.source,
      canonicalId: candidate.id,
      url: candidate.url,
      title: candidate.title,
      deadlineAt,
      metadata: {
        source: candidate.source,
        snippet: candidate.snippet,
        publishedAt: candidate.publishedAt,
        // Publisher origin from the feed (<source url>) — the resolver needs it
        // to locate the real article behind a Google News wrapper URL.
        publisherUrl: candidate.publisherUrl,
      },
    });
    const existing = candidatesByUrl.get(candidate.url);
    if (!existing) continue;
    existing.detailEnrichment = {
      attempted: true,
      status: result.status,
      discoveredBy: result.discoveredBy,
      evidenceFrom: result.evidenceFrom,
      canonicalUrl: result.canonicalUrl,
    };
    if (result.status === "SUCCESS" && result.rawContent) {
      summary.detailSucceeded += 1;
      existing.enrichedRawContent = result.rawContent;
      existing.snippet = result.rawContent;
      existing.title = result.title || existing.title;
      existing.publisherUrl = result.canonicalUrl || existing.publisherUrl;
    } else if (result.status === "FETCH_FAILED") {
      summary.detailFailed += 1;
      failures.push(`${candidate.source}: 详情页抓取失败，已保留 discovery candidate。`);
    }
    // Actual HTTP calls (a wrapper candidate spends one search + one body
    // fetch) are kept separate from the candidate count above.
    summary.detailFetchCalls = (summary.detailFetchCalls ?? 0) + (result.fetchCalls ?? 0);
  }

  return { candidates, summary, eligibleByProvider };
}

function buildSourceDiagnostics(
  sourceOutcomes: SourceExecutionOutcome[],
  candidates: ResearchCandidate[],
  displayedSignals: ResearchSignal[],
  eligibleByProvider: Record<string, number>,
): SourceStageDiagnostics[] {
  const providerIds = new Set([
    ...sourceOutcomes.map((outcome) => outcome.providerId || (outcome.source.toLowerCase() === "product hunt" ? "product-hunt" : ""))
      .filter(Boolean),
    ...candidates.map((candidate) => candidate.providerId).filter(Boolean) as string[],
  ]);
  return [...providerIds].map((providerId) => {
    const matchingOutcomes = sourceOutcomes.filter(candidate => candidate.providerId === providerId ||
      (providerId === "product-hunt" && !candidate.providerId && candidate.source.toLowerCase() === "product hunt"));
    const outcome = matchingOutcomes[0];
    const sumOutcomes = (field: "rawResultCount" | "normalizedCandidateCount" | "rejectedRawCount") => matchingOutcomes.reduce((sum, item) => sum + (item[field] ?? (field === "rejectedRawCount" ? 0 : item.resultCount)), 0);
    const providerCandidates = candidates.filter((candidate) => candidate.providerId === providerId);
    const detailAttempted = providerCandidates.filter((candidate) => candidate.detailEnrichment?.attempted).length;
    const detailSucceeded = providerCandidates.filter((candidate) => candidate.detailEnrichment?.status === "SUCCESS").length;
    const detailFailed = providerCandidates.filter((candidate) => candidate.detailEnrichment?.status === "FETCH_FAILED").length;
    return {
      providerId,
      rawProviderResultCount: sumOutcomes("rawResultCount"),
      normalizedCandidateCount: sumOutcomes("normalizedCandidateCount"),
      rejectedRawCount: sumOutcomes("rejectedRawCount"),
      normalizationRejectionReasons: outcome?.normalizationRejectionReasons,
      normalizationRejectedSamples: outcome?.normalizationRejectedSamples,
      candidateAdmissionRejectionReasons: outcome?.candidateAdmissionRejectionReasons,
      candidateAdmissionRejectedSamples: outcome?.candidateAdmissionRejectedSamples,
      admittedCandidateCount: providerCandidates.length,
      enrichmentEligibleCount: eligibleByProvider[providerId] || 0,
      detailAttempted,
      detailSucceeded,
      detailFailed,
      pipelineRetrievedCount: providerCandidates.length,
      displayedCount: displayedSignals.filter((signal) =>
        providerCandidates.some((candidate) => candidate.url === signal.sourceUrl),
      ).length,
      ...(providerId === "product-hunt" && providerCandidates.length === 0
        ? { rejectionReasons: { no_candidate_after_normalization: 1 } }
        : {}),
    } satisfies SourceStageDiagnostics;
  });
}

// Readable custom-source status copy. "Preserved" (in the result set and
// library) must never be worded as "surfaced" (entering the day-queue reading
// list) — the day queue selects a subset, so the copy points at the cards
// instead of claiming display.
export function customSourceReadReason(included: boolean): string {
  return included
    ? "正文可读取，已保留到本次结果与资料库；是否出现在今日阅读列表取决于相关性、时间与证据，请以今日卡片为准。"
    : "正文可读取，但未通过本次筛选；请结合筛选统计核对相关性、时间与证据要求。";
}

export async function runResearchPipeline(
  input: ResearchInput,
  onProgress?: ProgressHandler,
  debug?: ResearchPipelineDebug,
  retrievalPlanOrSourceSelection?: RetrievalPlan | LegacySourceSelection,
): Promise<ResearchResponse> {
  const progress: PipelineProgress[] = [];
  const failures: string[] = [];
  let scanned = 0;
  let counts = emptyCounts();
  const sourceOutcomes: SourceExecutionOutcome[] = [];
  const customSourceChecks: CustomSourceCheck[] = [];
  const customSources = parseCustomSources(input.customSources);
  const markPhase = (phase: string, success = true, itemCount?: number, errorCode?: string, diagnostic?: Record<string, unknown>) =>
    debug?.onPhase?.({ phase, success, itemCount, errorCode, diagnostic });
  const remainingMs = () => Math.max(0, (debug?.deadlineAt ?? Date.now() + 30000) - Date.now());
  const emit = async (event: PipelineProgress) => {
    progress.push(event);
    await onProgress?.(event);
  };

  const planResolution = resolvePipelinePlan(input, retrievalPlanOrSourceSelection);
  const plan = planResolution.plan;
  const windowDays = freshnessDays(plan.requestedFreshnessWindow);
  const allowedProviderIds = plan.allowedProviderIds?.length
    ? plan.allowedProviderIds
    : undefined;
  const canExecute = (providerId: string) => !allowedProviderIds || allowedProviderIds.includes(providerId);
  const sourceConstrained = Boolean(plan.selectedSourceType || plan.allowedProviderIds?.length);
  const providerPlan = (providerId: string, providerName: string, configured: boolean | "runtime_status") => ({
    providerId,
    providerName,
    configured,
    callAttempted: canExecute(providerId),
    emptyResultReason: canExecute(providerId) ? undefined : "not_allowed_by_source_selection",
  });
  const searchProviderPlan = () => [
    providerPlan("primary-web-search", "Primary Sources", true),
    providerPlan("company-registry", "Company Source Registry", true),
    providerPlan("github-releases", "GitHub Releases", true),
    providerPlan("official-update-pages", "Official Update Pages", true),
    providerPlan("trusted-media", "Trusted Media", true),
    providerPlan("industry-media", "Industry Media", true),
    providerPlan("public-web", "General Web / Public Web Community", true),
    providerPlan("product-hunt", "Product Hunt", true),
    providerPlan("hacker-news", "Hacker News", true),
    providerPlan("huggingface", "Hugging Face", true),
    providerPlan("arxiv", "arXiv", true),
    providerPlan("social-access", "Social Access Layer", "runtime_status"),
    providerPlan("reddit", "Reddit", true),
    providerPlan("reverse-primary", "Reverse Primary", true),
  ];
  const searchEmptyReason = (outcomes: SourceExecutionOutcome[], rawCount: number) => {
    if (rawCount > 0) return undefined;
    if (!outcomes.some((outcome) => outcome.searched)) return "no_provider_call_attempted";
    if (outcomes.some((outcome) => outcome.execution === "failed")) return "all_results_empty_with_provider_failure";
    if (!plan.entities.length && plan.selectedSourceType === "OFFICIAL") return "official_source_selected_but_no_resolved_entities";
    return "providers_returned_zero_results";
  };
  const emptySearchResult = () => ({
    scanned: 0,
    attempted: 0,
    successful: 0,
    failed: 0,
    items: [] as ResearchCandidate[],
  });
  const sourceHint = plan.selectedSourceType === "OFFICIAL"
    ? " official documentation changelog announcement"
    : plan.selectedSourceType === "PRIMARY"
      ? " primary document filing technical specification"
      : plan.selectedSourceType === "INDEPENDENT_MEDIA"
        ? " independent coverage analysis"
        : plan.selectedSourceType === "GENERAL_WEB"
          ? " web coverage"
          : "";
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
  // Primary channel uses short per-anchor variants (one anchor + release/
  // official intent). The official-domain condition and source hint are kept
  // on every variant, so shortening never drops the first-hand requirement.
  // Request budget unchanged: still capped at 5 queries.
  const primaryQueries = (providerQueryFor.all(plan, "primary-web-search").length
    ? providerQueryFor.all(plan, "primary-web-search")
    : providerQueries(plan, "primary-web-search", plan.searchCombinations.slice(0, 5), 5)
  )
    .slice(0, 5)
    .map((query) => `${query}${sourceHint} ${domains}`);
  const primaryWebEnabled = canExecute("primary-web-search");
  markPhase("search_started", true, undefined, undefined, {
    selectedSourceType: plan.selectedSourceType,
    fallbackSourceTypes: plan.fallbackSourceTypes,
    allowedProviderIds: allowedProviderIds ?? "all",
    fallbackUsed: planResolution.fallbackUsed,
    fallbackReason: planResolution.fallbackReason,
    retrievalPlanSource: planResolution.retrievalPlanSource,
    agentGeneratedQueries: planResolution.agentGeneratedQueries,
    pipelineActualQueries: plan.searchCombinations.slice(0, 10),
    generatedSearchQueryCount: plan.searchCombinations.length,
    generatedSearchQueries: plan.searchCombinations.slice(0, 10),
    topicProfile: plan.topicProfile,
    topicProfileSource: plan.topicProfile ? "retrieval_plan" : "unavailable",
    topicProfileApplied: Boolean(plan.topicProfile),
    entityCount: plan.entities.length,
    entities: plan.entities.slice(0, 10),
    resolvedEntities: plan.resolvedEntities?.slice(0, 10),
    providerPlan: searchProviderPlan(),
  });
  const [customSourceResults, primaryResult, companyRegistryResult, githubReleaseResult, officialUpdatePageResult, feedResult] = await Promise.all([
    Promise.all(customSources.urls.map(url => (debug?.customSourceReader ?? readCustomSource)(url, { deadlineAt: debug?.deadlineAt }))),
    primaryWebEnabled
      ? searchQueries(primaryQueries, "primary", plan, failures, windowDays)
      : Promise.resolve(emptySearchResult()),
    canExecute("company-registry")
      ? searchDirectProvider("Company Source Registry", () => companyRegistrySearch(plan), "primary", plan, failures, "company-registry")
      : Promise.resolve({ items: [] as ResearchCandidate[], outcome: { source: "Company Source Registry", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 } }),
    canExecute("github-releases")
      ? discoverOfficialGithubReleases(plan.entities, fetch, plan.originalNeed)
      : Promise.resolve({ items: [], outcome: { source: "GitHub Releases", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 }, failure: undefined }),
    canExecute("official-update-pages")
      ? discoverOfficialUpdatePages(plan.entities)
      : Promise.resolve({ items: [], outcome: { source: "Official Update Pages", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 }, failure: undefined }),
    retrieveRegisteredFeeds({entities: plan.entities, query: plan.originalNeed, selectedSourceType: plan.selectedSourceType,
      excludedEntities: plan.excludedEntities,
      allowed: canExecute("registered-feeds"), reader: debug?.customSourceReader, deadlineAt: debug?.deadlineAt, cache: debug?.feedCache}),
  ]);
  const customCandidates: ResearchCandidate[] = [];
  for (const result of customSourceResults) {
    const { content, ...check } = result;
    customSourceChecks.push(check);
    if (result.status !== "readable" || !content) continue;
    const url = result.canonicalUrl ?? result.url;
    const retrievedAt = new Date().toISOString();
    const item: ResearchCandidate = {
      id: `custom-source-${encodeURIComponent(url)}`, url,
      title: result.title || new URL(url).hostname, snippet: content,
      source: `用户添加 · ${new URL(url).hostname}`, publishedAt: result.publishedAt,
      firstSeenAt: retrievedAt, retrievedAt, dataOrigin: "live", channel: "社区",
      authority: 60, origin: "community", sourceType: "industry_media",
      providerId: "custom-sources", sourceCapability: "EVIDENCE", enrichedRawContent: content,
    };
    if (relevant(item, plan)) customCandidates.push(item);
    else check.reason = "正文可读取，但与本次问题不相关，未进入候选。";
  }
  if (customSourceChecks.length || customSources.errors.length) {
    sourceOutcomes.push({source: "用户添加的来源", providerId: "custom-sources",
      searched: customSourceChecks.some(result => result.requestCount > 0),
      execution: customCandidates.length ? "searched_with_results" : customSourceChecks.some(result => result.status === "readable") ? "searched_no_results" : customSourceChecks.some(result => result.requestCount > 0) ? "failed" : "not_searched",
      resultCount: customCandidates.length, rawResultCount: customSourceResults.filter(result => result.status === "readable").length,
      requestCount: customSourceResults.reduce((sum, result) => sum + result.requestCount, 0),
    });
  }
  failures.push(...customSources.errors.map(reason => `用户添加的来源: ${reason}`));
  scanned += customSourceResults.filter(result => result.status === "readable").length;
  if (githubReleaseResult.failure) failures.push(githubReleaseResult.failure);
  if (officialUpdatePageResult.failure) failures.push(officialUpdatePageResult.failure);
  const primary = unique([
    ...feedResult.items.filter(item => item.sourceType === "primary"),
    ...companyRegistryResult.items,
    ...officialUpdatePageResult.items
      .filter((item) => relevant(item, plan))
      .map((item) => ({ ...item, sourceType: "primary" as const })),
    ...githubReleaseResult.items
      .filter((item) => relevant(item, plan))
      .map((item) => ({ ...item, sourceType: "primary" as const })),
    ...primaryResult.items,
  ]);
  sourceOutcomes.push(primaryWebEnabled
    ? webSearchOutcome("Primary Sources", primaryResult)
    : { source: "Primary Sources", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 });
  sourceOutcomes.push(companyRegistryResult.outcome);
  sourceOutcomes.push(githubReleaseResult.outcome);
  sourceOutcomes.push(officialUpdatePageResult.outcome);
  sourceOutcomes.push(...feedResult.outcomes);
  failures.push(...feedResult.failures);
  scanned += feedResult.outcomes.reduce((sum, outcome) => sum + (outcome.rawResultCount ?? 0), 0);
  scanned += primaryResult.scanned + companyRegistryResult.items.length;
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
  const mediaQueries = providerQueries(plan, "trusted-media", plan.searchCombinations.slice(0, 4).map(
    (query) => `${query}${sourceHint} (Reuters OR Bloomberg OR \"Financial Times\" OR WSJ OR CNBC)`,
  ), 4);
  const trustedMediaResult = canExecute("trusted-media")
    ? await searchQueries(mediaQueries, "trusted_media", plan, failures, windowDays)
    : emptySearchResult();
  const trustedMedia = trustedMediaResult.items;
  sourceOutcomes.push(webSearchOutcome("Trusted Media", trustedMediaResult));
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

  const industryQueries = providerQueries(plan, "industry-media", plan.searchCombinations.slice(0, 3).map(
    (query) =>
      `${query} (TechCrunch OR "The Verge" OR "Ars Technica" OR VentureBeat OR InfoQ OR 机器之心 OR 量子位 OR 36氪)`,
  ), 3);
  const industryMediaResult = canExecute("industry-media")
    ? await searchQueries(industryQueries, "industry_media", plan, failures, windowDays)
    : emptySearchResult();
  const industryMedia = industryMediaResult.items;
  sourceOutcomes.push(webSearchOutcome("Industry Media", industryMediaResult));
  scanned += industryMediaResult.scanned;
  counts = {
    ...counts,
    candidates: counts.candidates + industryMedia.length,
    industryMedia: industryMedia.length,
  };

  const generalWebQueries = providerQueries(plan, "public-web", plan.searchCombinations.slice(0, 4), 4);
  const generalWebResult = canExecute("public-web") && remainingMs() > RETRIEVAL_RESERVATION_MS
    ? await searchQueries(generalWebQueries, "other", plan, failures, windowDays, true)
    : emptySearchResult();
  sourceOutcomes.push(webSearchOutcome("General Web", generalWebResult));
  scanned += generalWebResult.scanned;

  const [productHuntResult, hackerNewsResult, huggingFaceResult, arxivResult] = await Promise.all([
    canExecute("product-hunt") && remainingMs() > RETRIEVAL_RESERVATION_MS
      ? searchDirectProvider("Product Hunt", () => productHuntSearch(providerQuery(plan, "product-hunt", plan.searchCombinations[0])), "social", plan, failures, "product-hunt")
      : Promise.resolve({ items: [] as ResearchCandidate[], outcome: { source: "Product Hunt", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 } }),
    canExecute("hacker-news")
      ? searchDirectProvider("Hacker News", () => hackerNewsSearch(providerQuery(plan, "hacker-news", plan.searchCombinations[0])), "social", plan, failures, "hacker-news")
      : Promise.resolve({ items: [] as ResearchCandidate[], outcome: { source: "Hacker News", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 } }),
    canExecute("huggingface") && remainingMs() > RETRIEVAL_RESERVATION_MS
      ? searchDirectProvider("Hugging Face", () => huggingFaceSearch(providerQuery(plan, "huggingface", plan.searchCombinations[0])), "industry_media", plan, failures, "huggingface")
      : Promise.resolve({ items: [] as ResearchCandidate[], outcome: { source: "Hugging Face", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 } }),
    canExecute("arxiv")
      ? searchDirectProvider("arXiv", () => arxivSearch(providerQuery(plan, "arxiv", plan.searchCombinations[0])), "primary", plan, failures, "arxiv")
      : Promise.resolve({ items: [] as ResearchCandidate[], outcome: { source: "arXiv", execution: "not_searched" as const, blockedBy: "source_selection" as const, searched: false, resultCount: 0 } }),
  ]);
  sourceOutcomes.push(productHuntResult.outcome, hackerNewsResult.outcome, huggingFaceResult.outcome, arxivResult.outcome);
  scanned += productHuntResult.items.length + hackerNewsResult.items.length + huggingFaceResult.items.length + arxivResult.items.length;
  counts = {
    ...counts,
    candidates: counts.candidates + generalWebResult.items.length + productHuntResult.items.length + hackerNewsResult.items.length + huggingFaceResult.items.length + arxivResult.items.length,
    primary: counts.primary + arxivResult.items.length,
    industryMedia: counts.industryMedia + generalWebResult.items.length + huggingFaceResult.items.length,
    social: counts.social + productHuntResult.items.length + hackerNewsResult.items.length,
  };

  const communityWebQueries = providerQueries(plan, "public-web", plan.searchCombinations.slice(0, 3).map(
    (query) =>
      `${query} (site:reddit.com OR site:github.com OR site:news.ycombinator.com OR site:stackoverflow.com OR site:dev.to)`,
  ), 3);
  const communityWebResult = canExecute("public-web") && remainingMs() > RETRIEVAL_RESERVATION_MS && (!sourceConstrained || plan.selectedSourceType === "SOCIAL_SIGNAL")
    ? await searchQueries(communityWebQueries, "social", plan, failures, windowDays, true)
    : emptySearchResult();
  sourceOutcomes.push(webSearchOutcome("Public Web Community", communityWebResult));
  scanned += communityWebResult.scanned;

  const trustedClaims = [...trustedMedia, ...industryMedia]
    .filter((item) => resolveFreshness(item).ageHours !== undefined)
    .slice(0, 3);
  const trustedReverseResult = trustedClaims.length && canExecute("reverse-primary")
    ? await searchQueries(
        trustedClaims.map((item) => `${item.title.slice(0, 140)} ${domains}`),
        "primary",
        plan,
        failures,
        windowDays,
      )
    : { scanned: 0, items: [] as ResearchCandidate[] };
  scanned += trustedReverseResult.scanned;

  await emit({
    stage: "social",
    label: "正在检查社交媒体线索",
    counts,
  });
  const socialQuery = providerQuery(plan, "public-web", plan.searchCombinations.slice(0, 3).join(" OR "));
  const shouldSearchReddit = canExecute("reddit");
  const [socialAccess, redditResult] = await Promise.all([
    canExecute("social-access")
      ? socialAccessLayer.search({ query: socialQuery, industry: input.industry, maxSearchesPerProvider: 1 })
      : Promise.resolve({ items: [] as LiveItem[], outcomes: [], statuses: [] }),
    shouldSearchReddit
      ? Promise.allSettled([redditSearch(socialQuery)])
      : Promise.resolve([{ status: "fulfilled", value: [] as LiveItem[] }] as const),
  ]);
  const reddit =
    redditResult[0].status === "fulfilled" ? redditResult[0].value : [];
  scanned += socialAccess.items.length + reddit.length;
  if (redditResult[0].status === "rejected") {
    failures.push("Social Discovery: Reddit 请求失败或超时。");
  }
  sourceOutcomes.push(
    ...socialAccess.outcomes.map((outcome) => ({
      source: socialAccess.statuses.find((status) => status.id === outcome.provider)?.label || outcome.provider,
      execution: outcome.execution,
      searched: outcome.searched,
      resultCount: outcome.resultCount,
      requestCount: outcome.requestCount,
      failureCode: outcome.failureCode,
    })),
    !shouldSearchReddit
      ? {
          source: "Reddit",
          execution: "not_searched" as const,
          blockedBy: "source_selection" as const,
          searched: false,
          resultCount: 0,
        }
      : redditResult[0].status === "fulfilled"
      ? {
          source: "Reddit",
          execution: reddit.length ? "searched_with_results" as const : "searched_no_results" as const,
          searched: true,
          resultCount: reddit.length,
        }
      : {
          source: "Reddit",
          execution: "failed" as const,
          searched: true,
          resultCount: 0,
          failureCode: "upstream_error" as const,
        },
  );
  const socialCandidates =
    [...socialAccess.items, ...reddit, ...communityWebResult.items]
      .filter((item) => {
        const itemFreshness = resolveFreshness(item);
        return (
          relevant(item, plan) &&
          (itemFreshness.ageHours === undefined || itemFreshness.ageHours <= windowDays * 24)
        );
      })
      .map((item) => ({ ...item, sourceType: "social" as const }));
  const social = deduplicateSocialEvidence(socialCandidates);
  counts = {
    ...counts,
    candidates: counts.candidates + social.representatives.length,
    social: social.representatives.length,
  };

  let reversePrimary: ResearchCandidate[] = [...trustedReverseResult.items];
  if (social.representatives.length) {
    const reverseQueries = social.representatives
      .slice(0, 3)
      .map((item) => `${item.title.slice(0, 120)} ${domains}`);
    const reverseResult = canExecute("reverse-primary") ? await searchQueries(
      reverseQueries,
      "primary",
      plan,
      failures,
      windowDays,
    ) : emptySearchResult();
    reversePrimary = unique([...reversePrimary, ...reverseResult.items]);
    scanned += reverseResult.scanned;
  }
  markPhase("search_finished", true, scanned, undefined, {
    selectedSourceType: plan.selectedSourceType,
    allowedProviderIds: allowedProviderIds ?? "all",
    fallbackUsed: planResolution.fallbackUsed,
    fallbackReason: planResolution.fallbackReason,
    retrievalPlanSource: planResolution.retrievalPlanSource,
    agentGeneratedQueries: planResolution.agentGeneratedQueries,
    pipelineActualQueries: plan.searchCombinations.slice(0, 10),
    providerOutcomes: sourceOutcomes.map((outcome) => ({
      providerName: outcome.source,
      providerId: outcome.providerId,
      sourceId: outcome.sourceId,
      execution: outcome.execution,
      searched: outcome.searched,
      resultCount: outcome.resultCount,
      rawResultCount: outcome.rawResultCount,
      normalizedCandidateCount: outcome.normalizedCandidateCount,
      rejectedRawCount: outcome.rejectedRawCount,
      normalizationRejectionReasons: outcome.normalizationRejectionReasons,
      normalizationRejectedSamples: outcome.normalizationRejectedSamples,
      candidateAdmissionRejectionReasons: outcome.candidateAdmissionRejectionReasons,
      candidateAdmissionRejectedSamples: outcome.candidateAdmissionRejectedSamples,
      requestCount: outcome.requestCount,
      failureCode: outcome.failureCode,
      detailFailureCode: outcome.detailFailureCode,
    })),
    providerResponseCount: scanned,
    failureCount: failures.length,
    providerErrorCodes: sourceOutcomes
      .filter((outcome) => outcome.failureCode)
      .map((outcome) => ({ providerName: outcome.source, failureCode: outcome.failureCode, detailFailureCode: outcome.detailFailureCode })),
    emptyResultReason: searchEmptyReason(sourceOutcomes, scanned),
  });
  const allPrimary = unique([...primary, ...reversePrimary]);
  const primaryOutcome = sourceOutcomes.find((outcome) => outcome.source === "Primary Sources");
  if (primaryOutcome && primaryWebEnabled && primaryResult.items.length > 0) {
    primaryOutcome.execution = "searched_with_results";
    primaryOutcome.searched = true;
    primaryOutcome.resultCount = primaryResult.items.length;
    delete primaryOutcome.failureCode;
  }
  counts = { ...counts, primary: allPrimary.length + arxivResult.items.length };
  await emit({
    stage: "social",
    label: `社交媒体线索 ${social.representatives.length} 条 · 已尝试反向查证`,
    counts,
  });

  markPhase("detail_fetch_started");
  let discoveredCandidates = unique([
    ...customCandidates,
    ...feedResult.items.filter(item => item.sourceType !== "primary"),
    ...allPrimary,
    ...arxivResult.items,
    ...trustedMedia,
    ...industryMedia,
    ...huggingFaceResult.items,
    ...generalWebResult.items,
    ...productHuntResult.items,
    ...hackerNewsResult.items,
    ...social.representatives,
  ]);
  if (discoveredCandidates.length === 0) {
    // Execution-level technical fallback: when discovery yields no candidate,
    // give gated OFFICIAL / PRIMARY / technical sources a chance to contribute.
    // This is not a re-classification and entity-only providers still need an
    // entity match; it only runs when the primary discovery round came up empty.
    const technicalFallback: ResearchCandidate[] = [];
    const recordOutcome = (outcome: SourceExecutionOutcome) => {
      const index = sourceOutcomes.findIndex((entry) =>
        outcome.providerId
          ? entry.providerId === outcome.providerId || (!entry.providerId && entry.source === outcome.source)
          : entry.source === outcome.source,
      );
      if (index >= 0) sourceOutcomes[index] = outcome;
      else sourceOutcomes.push(outcome);
    };
    if (!canExecute("arxiv")) {
      const arxivFall = await searchDirectProvider(
        "arXiv",
        () => arxivSearch(providerQuery(plan, "arxiv", plan.searchCombinations[0])),
        "primary",
        plan,
        failures,
        "arxiv",
      );
      technicalFallback.push(...arxivFall.items);
      recordOutcome(arxivFall.outcome);
    }
    if (!canExecute("github-releases")) {
      const gh = await discoverOfficialGithubReleases(plan.entities, fetch, plan.originalNeed);
      technicalFallback.push(...gh.items.map((item) => ({ ...item, sourceType: "primary" as const })));
      recordOutcome(gh.outcome);
      if (gh.failure) failures.push(gh.failure);
    }
    if (!canExecute("official-update-pages")) {
      const op = await discoverOfficialUpdatePages(plan.entities);
      technicalFallback.push(...op.items.map((item) => ({ ...item, sourceType: "primary" as const })));
      recordOutcome(op.outcome);
      if (op.failure) failures.push(op.failure);
    }
    if (!canExecute("company-registry")) {
      const cr = await searchDirectProvider(
        "Company Source Registry",
        () => companyRegistrySearch(plan),
        "primary",
        plan,
        failures,
        "company-registry",
      );
      technicalFallback.push(...cr.items);
      recordOutcome(cr.outcome);
    }
    if (technicalFallback.length) {
      discoveredCandidates = unique([...discoveredCandidates, ...technicalFallback]);
      scanned += technicalFallback.length;
      counts = {
        ...counts,
        candidates: counts.candidates + technicalFallback.length,
        primary: counts.primary + technicalFallback.length,
      };
    }
  }
  // Enrichment budget: reserved share plus a small floor so late-discovered
  // relevant candidates still get their canonical fetch when any time remains.
  // The floor is clamped to the actual remaining time — an exhausted deadline
  // still yields 0 and skips all fetches (honest degradation, no new fetches).
  const enrichmentBudgetMs = Math.min(
    12000,
    Math.max(
      remainingMs() > POST_PROCESSING_RESERVE_MS ? remainingMs() - POST_PROCESSING_RESERVE_MS : 0,
      remainingMs() > 0 ? 3000 : 0,
    ),
  );
  const { candidates, summary: detailEnrichment, eligibleByProvider } = await enrichDiscoveryCandidates(
    discoveredCandidates,
    plan,
    failures,
    enrichmentBudgetMs,
  );
  markPhase("detail_fetch_finished", true, detailEnrichment.detailSucceeded, undefined, {
    detailAttempted: detailEnrichment.detailAttempted,
    detailSucceeded: detailEnrichment.detailSucceeded,
    detailFailed: detailEnrichment.detailFailed,
    stillInsufficient: detailEnrichment.stillInsufficient,
    detailFetchCalls: detailEnrichment.detailFetchCalls ?? 0,
  });
  markPhase("aggregation_started");
  await emit({
    stage: "deduplication",
    label: `去重完成 · ${scanned} 条扫描结果收敛为 ${candidates.length} 条来源`,
    counts,
  });
  const eventClusters = clusterEvents(candidates);
  markPhase("aggregation_finished", true, eventClusters.length, undefined, {
    inputCount: candidates.length,
    clusteredCount: eventClusters.length,
    deduplicatedCount: eventClusters.length,
  });
  await emit({
    stage: "clustering",
    label: `事件聚合完成 · ${eventClusters.length} 个独立事件`,
    counts,
  });
  markPhase("evidence_started");
  const gapTerms = filterTerms(input.informationGaps);
  const questionTerms = filterTerms(input.currentQuestions).filter((term) => !isGenericQuestionTerm(term));
  // Software-specific presentation wording (upgrade value / license / cost /
  // hardware) requires explicit software-release signals in the user's own
  // question. Generic words like 发布/更新/版本 alone — or a PRODUCT_UPDATE
  // intent — also occur in ordinary announcements, so they never qualify on
  // their own; ambiguous contexts stay neutral.
  const upgradeContext =
    /\bgithub\b|\bchangelog\b|\brelease notes?\b|版本号|\bv\d+(?:\.\d+)+\b/i.test(input.currentQuestions || "") ||
    (/升级|upgrade/i.test(input.currentQuestions || "") &&
      /软件|应用|工具|程序|系统|插件|扩展|驱动|固件|github|版本|version|release/i.test(input.currentQuestions || ""));
  const focusAreaTerms = filterTerms(input.focusAreas);
  const trackedEntityTerms = entityFilterTerms(input.trackedEntities).filter(
    (term) =>
      !/^(ai|agent|model|research|official|update|人工智能|大模型|模型)$/i.test(
        term,
      ),
  );
  const trackedEventTerms = filterTerms(input.trackedEvents);
  // Feedback labels are metadata, not matching terms. A view update is not a
  // negative judgement; unmarked handwritten judgements keep their prior path.
  const judgementTerms = filterTerms(input.userJudgements
    .split(/\r?\n/)
    .filter((line) => !/^\s*Changed after evidence\s*:/i.test(line))
    .map((line) => line.replace(/^\s*Not useful\s*:\s*/i, ""))
    .join("\n"));
  const evaluatedCandidates = eventClusters
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
      const focusAreaMatches = focusAreaTerms.filter((term) =>
        clusterText.includes(term),
      );
      const entityMatches = trackedEntityTerms.filter((term) =>
        clusterText.includes(term),
      );
      const topicRelevance = assessTopicRelevance(clusterText, plan);
      const trackedEventMatches = trackedEventTerms.filter((term) =>
        clusterText.includes(term),
      );
      const judgementMatches = judgementTerms.filter((term) =>
        clusterText.includes(term),
      );
      const socialChains = new Map(
        ordered
          .filter((candidate) => candidate.sourceType === "social" && candidate.socialEvidenceChain)
          .map((candidate) => [candidate.socialEvidenceChain!.evidenceChainId, candidate.socialEvidenceChain!] as const),
      );
      const fusionEvidenceBase: FusionEvidence[] = ordered.map((candidate, index) => ({
        evidenceId: `${stableEventId(candidate.title)}-${index}`,
        entity: plan.entities[0],
        topic: plan.coreKeywords[0] || plan.originalNeed,
        claim: candidate.title,
        sourceUrl: candidate.url,
        publisher: candidate.source,
        publishedAt: isoDate(candidate.publishedAt),
        sourceType: candidate.sourceType,
        sourceTier: sourceTier(candidate.sourceType),
        verificationStatus: conflicting ? "conflicting" : checks[index].status,
        upstreamSource: candidate.socialEvidenceChain?.canonicalSourceUrl,
      }));
      const preliminaryFusion = fuseSignal(fusionEvidenceBase);
      const independentEvidenceCount = preliminaryFusion.independentSourceCount;
      const propagationCount = [...socialChains.values()]
        .reduce((total, chain) => total + chain.propagationCount, 0) +
        preliminaryFusion.cluster.duplicateCount;
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
          : 30) + Math.min(8, Math.max(0, independentEvidenceCount - 1) * 2),
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
      const clusterMembers: NoveltyClusterMember[] = ordered.map((candidate) => ({
        title: candidate.title,
        snippet: candidate.snippet,
        sourceUrl: candidate.url,
        publisher: candidate.source,
      }));
      const noveltyAttribution = assessNoveltyAttribution({
        knownInformation: input.knownInformation,
        evidenceHistory: input.evidenceHistory,
        userJudgements: input.userJudgements,
        title: item.title,
        snippet: item.snippet,
        clusterMembers,
        freshnessScore,
        judgementMatchCount: judgementMatches.length,
      });
      const knownMatches = noveltyAttribution.knownMatches;
      const alreadyKnown = knownMatches.length > 0;
      const noveltyScore = preliminaryFusion.signalType === "NOISE"
        ? Math.min(noveltyAttribution.noveltyScore, 25)
        : noveltyAttribution.noveltyScore;
      const fusion = fuseSignal(fusionEvidenceBase.map((evidence) => ({
        ...evidence,
        reliabilityScore,
        noveltyScore,
      })));
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
      const informationType: ResearchSignal["informationType"] =
        fusion.signalType === "FACT" || verificationStatus === "verified"
          ? "FACT"
          : fusion.signalType === "EARLY_SIGNAL" || socialOnly
            ? "SIGNAL"
            : "INTERPRETATION";
      const processedCandidates = ordered.map((candidate) => {
        const cleaned = cleanContent(`${candidate.title}\n${candidate.enrichedRawContent || candidate.snippet || ""}`, candidate.title);
        const claim = extractClaim(cleaned, candidate.title);
        const presentation = mapSignalPresentation({
          title: candidate.title,
          sourceName: candidate.source,
          sourceUrl: candidate.url,
          publishedAt: isoDate(candidate.publishedAt),
          sourceType: candidate.sourceType,
          verificationStatus,
          informationType,
          userContext: { questionMatches, gapMatches, entityMatches },
          cleaned,
          claim,
          upgradeContext,
        });
        return { candidate, cleaned, claim, presentation };
      });
      const validContent = processedCandidates.some((entry) => entry.presentation.contentQuality === "VALID");
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
      const libraryBranch = {
        reliability: { actual: reliabilityScore, threshold: 55, pass: reliabilityScore >= 55 },
        relevance: { actual: relevanceScore, threshold: 58, pass: relevanceScore >= 58 },
        novelty: { actual: noveltyScore, threshold: 38, pass: noveltyScore >= 38 },
      };
      const signalBranch = {
        eventStatus: { actual: eventStatus, expected: "SIGNAL", pass: eventStatus === "SIGNAL" },
        relevance: { actual: relevanceScore, threshold: 70, pass: relevanceScore >= 70 },
        freshness: { actual: freshnessScore, threshold: 80, pass: freshnessScore >= 80 },
        novelty: { actual: noveltyScore, threshold: 65, pass: noveltyScore >= 65 },
      };
      const canEnterLibrary =
        validContent &&
        topicRelevance.decision === "MATCH" &&
        ((libraryBranch.reliability.pass &&
          libraryBranch.relevance.pass &&
          libraryBranch.novelty.pass) ||
        (signalBranch.eventStatus.pass &&
          signalBranch.relevance.pass &&
          signalBranch.freshness.pass &&
          signalBranch.novelty.pass));
      const preliminaryIgnoreFailures: PreliminaryEligibilityFailure[] = canEnterLibrary
        ? []
        : [
            ...(topicRelevance.decision === "MATCH" ? [] : ["topic_mismatch" as const]),
            ...(libraryBranch.reliability.pass ? [] : ["library_reliability_below_55" as const]),
            ...(libraryBranch.relevance.pass ? [] : ["library_relevance_below_58" as const]),
            ...(libraryBranch.novelty.pass ? [] : ["library_novelty_below_38" as const]),
            ...(signalBranch.eventStatus.pass ? [] : ["signal_event_status_not_signal" as const]),
            ...(signalBranch.relevance.pass ? [] : ["signal_relevance_below_70" as const]),
            ...(signalBranch.freshness.pass ? [] : ["signal_freshness_below_80" as const]),
            ...(signalBranch.novelty.pass ? [] : ["signal_novelty_below_65" as const]),
          ];
      const preliminaryEligible = canEnterLibrary;
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
      const claims = processedCandidates.map(({ candidate, claim, presentation }, index) => {
        const verificationStatus = conflicting
          ? ("conflicting" as const)
          : checks[index].status;
        const tier = sourceTier(candidate.sourceType);
        const evidenceSnippet = presentation.evidence[0]?.snippet || presentation.fact;
        const statement = claim.quality === "VALID" ? claim.statement : presentation.fact;
        const chain = candidate.socialEvidenceChain;
        return {
          claimText: statement,
          originalClaimText: candidate.title,
          sourceUrl: candidate.url,
          publisher: candidate.source,
          publishedAt: isoDate(candidate.publishedAt),
          sourceType: candidate.sourceType,
          sourceTier: tier,
          evidenceSnippet,
          originalEvidenceSnippet: candidate.snippet || candidate.title,
          verificationStatus,
          contentType:
            presentation.contentQuality === "VALID" &&
            checks[index].status === "verified" &&
            validateTimestamp(candidate) === "valid"
              ? ("FACT" as const)
              : ("SIGNAL" as const),
          evidenceSources: [{
            sourceUrl: candidate.url,
            publisher: candidate.source,
            publishedAt: isoDate(candidate.publishedAt),
            sourceType: candidate.sourceType,
            sourceTier: tier,
            evidenceSnippet,
            sourceRole: candidate.sourceType === "social" ? ("discovery" as const) : ("verification" as const),
            verificationStatus,
            discoveredBy: candidate.detailEnrichment?.discoveredBy,
            evidenceFrom: candidate.detailEnrichment?.evidenceFrom,
          }],
          discoveredBy: candidate.detailEnrichment?.discoveredBy,
          evidenceFrom: candidate.detailEnrichment?.evidenceFrom,
          contentQuality: presentation.contentQuality,
          evidenceChainId: chain?.evidenceChainId,
          canonicalClaimFingerprint: chain?.canonicalClaimFingerprint,
          propagationCount: chain?.propagationCount || 1,
          independentEvidenceCount: 1,
        };
      });
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
        `${independentEvidenceCount} 条独立证据链`,
        `融合判断：${fusion.signalType}（${fusion.reason}）`,
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
      const primaryPresentation =
        processedCandidates.find((entry) => entry.presentation.contentQuality === "VALID")?.presentation ||
        processedCandidates[0]?.presentation;
      const id = stableEventId(item.title);
      const knowledgeStatus = alreadyKnown
        ? "KNOWN"
        : knownMatches.length
          ? "UPDATED"
          : "NOVEL";
      const actionability = assessSignalActionability({
        title: primaryPresentation?.headline || item.title,
        summary: primaryPresentation?.oneLineSummary || primaryPresentation?.fact || item.snippet || item.title,
        sourceUrl: item.url,
        tags: [...plan.coreKeywords, ...plan.topicKeywords || [], ...plan.entities],
        sourceType: item.sourceType,
        sourceTier: sourceTier(item.sourceType),
        eventStatus,
        knowledgeStatus,
        noveltyScore,
        relevanceScore,
        reliabilityScore,
        freshnessScore,
        verificationStatus,
        informationType,
        knownMatches: knownMatches.map((match) => match.knownInformationItem),
        evidenceText: ordered.map((candidate) => candidate.snippet).join(" "),
        eventAgeHours: eventFreshness.ageHours,
        requestedFreshnessHours: freshnessWindowHours(input.freshnessWindow),
        changeStatement: primaryPresentation?.changeStatement,
      });
      const protectedReasons: ProtectedReason[] = [
        ...(entityMatches.length ? ["tracked_entity" as const] : []),
        ...(trackedEventMatches.length ? ["tracked_event" as const] : []),
        ...(questionMatches.length ? ["current_question" as const] : []),
        ...(gapMatches.length ? ["information_gap" as const] : []),
        ...(focusAreaMatches.length ? ["focus_area" as const] : []),
      ];
      const eligibilityAudit: CandidateEligibilityAudit = {
        scores: {
          relevance: relevanceScore,
          reliability: reliabilityScore,
          novelty: noveltyScore,
          freshness: freshnessScore,
          eventStatus,
        },
        canEnterLibrary: {
          value: canEnterLibrary,
          libraryBranch,
          signalBranch,
          failedConditions: preliminaryIgnoreFailures,
        },
        contextMatches: {
          topicMatches: topicRelevance.matchedTerms,
          entityMatches,
          trackedEventMatches,
          questionMatches,
          gapMatches,
          focusAreaMatches,
        },
        noveltyAttribution: {
          ...noveltyAttribution,
          clusterId: id,
          title: item.title,
          snippet: item.snippet,
          clusterMembers,
          claims: claims.map((claim) => ({
            claimText: claim.claimText,
            sourceUrl: claim.sourceUrl,
            verificationStatus: claim.verificationStatus,
          })),
          claimAttribution: "unavailable",
        },
      };
      const signal: ResearchSignal = {
        id,
        category: "匹配",
        channel: hasPrimary
          ? "官方"
          : hasTrusted || hasIndustry
            ? "混合"
            : "社区",
        title: primaryPresentation?.headline || item.title,
        originalTitle: primaryPresentation?.headline !== item.title ? item.title : undefined,
        summary: (primaryPresentation?.oneLineSummary || primaryPresentation?.fact || item.snippet || item.title).slice(0, 240),
        originalSummary: item.snippet,
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
          actionability.action,
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
        topicRelevance,
        relevanceScore,
        reliabilityScore,
        freshnessScore,
        noveltyScore,
        judgementImpactScore,
        gapMatchScore,
        overallScore,
        sourceCount: independentEvidenceCount,
        independentEvidenceCount,
        propagationCount,
        signalType: fusion.signalType,
        signalCluster: fusion.cluster,
        sourceRoles: fusion.cluster.sourceRoles,
        sourceRoleDiversity: fusion.sourceRoleDiversity,
        duplicateRatio: fusion.duplicateRatio,
        confirmationGain: fusion.confirmationGain,
        primaryEvidenceIds: fusion.primaryEvidenceIds,
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
        whyItMatters: primaryPresentation?.whyItMatters || whyItMatters,
        eventStatus,
        informationType,
        knowledgeStatus,
        actionabilityStatus: actionability.actionabilityStatus,
        informationGainStatus: actionability.informationGainStatus,
        hasExecutableAction: actionability.hasExecutableAction,
        executionEntry: actionability.executionEntry,
        attentionDecision: preliminaryEligible ? "LIBRARY_ONLY" : "IGNORE",
        presentation: primaryPresentation,
        contentQuality: primaryPresentation?.contentQuality,
        contentFailureReason: primaryPresentation?.failureReason,
      };
      return {
        signal,
        selection: {
          id,
          overallScore,
          preliminaryEligible,
          freshnessEligible: withinWindow,
          timestampValid: eventFreshness.timestampStatus === "valid",
          isBackground: eventStatus === "BACKGROUND",
          isKnown: knowledgeStatus === "KNOWN",
          protectedReasons,
          eligibilityAudit,
        } satisfies Omit<CandidateSelectionInput<ResearchSignal>, "value">,
      };
    })
    ;
  const candidateSelection = selectBoundedCandidates(
    evaluatedCandidates.map(({ signal, selection }) => ({ ...selection, value: signal })),
  );
  debug?.onCandidateSelectionAudit?.(candidateSelection.audit);
  const allSignals = candidateSelection.selected.map((candidate) => candidate.value);

  const selectedEntities = new Set<string>();
  let selectedCount = 0;
  for (const signal of allSignals) {
    const passesGates =
      signal.reliabilityScore >= 70 &&
      signal.topicRelevance?.decision !== "TOPIC_MISMATCH" &&
      signal.relevanceScore >= 75 &&
      signal.noveltyScore >= 60 &&
      signal.judgementImpactScore >= 48 &&
      signal.actionabilityStatus === "TEST_NOW" &&
      signal.informationGainStatus !== "NO_INFORMATION_GAIN" &&
      signal.contentQuality !== "INSUFFICIENT_CONTENT" &&
      signal.knowledgeStatus !== "KNOWN" &&
      signal.verificationStatus !== "unverified" &&
      signal.verificationStatus !== "conflicting" &&
      signal.eventStatus !== "SIGNAL" &&
      signal.eventStatus !== "BACKGROUND" &&
      signal.timestampStatus === "valid" &&
      describesRecentChange(signal.originalTitle || signal.title, signal.originalSummary || signal.summary) &&
      (trackedEntityTerms.length === 0 ||
        signal.entityMatches.length > 0 ||
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
      signal.actionabilityStatus !== "BACKGROUND" &&
      signal.topicRelevance?.decision !== "TOPIC_MISMATCH" &&
      signal.contentQuality !== "INSUFFICIENT_CONTENT" &&
      signal.eventStatus === "SIGNAL" &&
      signal.timestampStatus === "valid" &&
      signal.freshnessScore >= 80 &&
      signal.relevanceScore >= 70 &&
      signal.noveltyScore >= 60 &&
      signal.knowledgeStatus !== "KNOWN" &&
      describesRecentChange(signal.originalTitle || signal.title, signal.originalSummary || signal.summary) &&
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
    .filter((signal) => signal.attentionDecision !== "IGNORE" && signal.contentQuality !== "INSUFFICIENT_CONTENT");
  markPhase("evidence_finished", true, allSignals.length);
  detailEnrichment.stillInsufficient = allSignals.reduce(
    (total, signal) =>
      total +
      signal.claims.filter((claim) =>
        claim.contentQuality === "INSUFFICIENT_CONTENT" &&
        claim.evidenceSources.some((source) => source.discoveredBy),
      ).length,
    0,
  );

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
  // A read failure means the run never finished gathering evidence, so the
  // closing label must not claim a quiet zero-result day. Sources that were
  // searched and legitimately returned nothing keep the honest zero label.
  const sourceReadFailed = sourceOutcomes.some((outcome) => outcome.execution === "failed");
  await emit({
    stage: "complete",
    label: selectedCount
      ? `研究完成 · 今天 ${selectedCount} 条值得注意`
      : sourceReadFailed
        ? "研究未完成 · 来源读取失败或证据不足，请稍后再试"
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
  const filteringSummary = buildFilteringSummary({
    retrievedCount: candidates.length,
    clusteredCount: eventClusters.length,
    allSignals,
    displayedSignals: signals,
    detailEnrichment,
  });
  const evidenceRecords = uniqueEvidenceRecords(
    allSignals.flatMap((signal) => recordsFromSignal(signal).evidence),
  );
  const acceptedEvidenceRecords = uniqueEvidenceRecords(
    signals.flatMap((signal) => recordsFromSignal(signal).evidence),
  );
  const producedEvidenceCount = evidenceRecords.length;
  const acceptedEvidenceCount = acceptedEvidenceRecords.length;
  const evidenceAccounting = {
    discoveredCandidateCount: candidates.length,
    producedEvidenceCount,
    cumulativeEvidenceCount: producedEvidenceCount,
    evaluatedEvidenceCount: producedEvidenceCount,
    acceptedEvidenceCount,
    rejectedEvidenceCount: Math.max(0, producedEvidenceCount - acceptedEvidenceCount),
    finalEvidenceCount: acceptedEvidenceCount,
    rejectionReasons: filteringSummary.filteredReasons,
  };
  const sourceDiagnostics = buildSourceDiagnostics(sourceOutcomes, candidates, signals, eligibleByProvider);

  if (debug?.onEligibilityAudit) {
    const preliminaryIgnoreFailureCounts: Partial<Record<PreliminaryEligibilityFailure, number>> = {};
    for (const audit of candidateSelection.audit) {
      if (audit.eligibility.preliminaryEligible) continue;
      for (const failure of audit.eligibilityAudit?.canEnterLibrary.failedConditions || []) {
        preliminaryIgnoreFailureCounts[failure] =
          (preliminaryIgnoreFailureCounts[failure] || 0) + 1;
      }
    }
    debug.onEligibilityAudit({
      eventClusters: evaluatedCandidates.length,
      preliminaryEligible: candidateSelection.audit.filter(
        (audit) => audit.eligibility.preliminaryEligible,
      ).length,
      preliminaryIgnore: candidateSelection.audit.filter(
        (audit) => !audit.eligibility.preliminaryEligible,
      ).length,
      candidatePool: candidateSelection.selected.length,
      mustRead: allSignals.filter((signal) => signal.attentionDecision === "MUST_READ").length,
      worthWatching: allSignals.filter(
        (signal) => signal.attentionDecision === "WORTH_WATCHING").length,
      libraryOnly: allSignals.filter((signal) => signal.attentionDecision === "LIBRARY_ONLY").length,
      preliminaryIgnoreFailureCounts,
    });
  }

  const coverage = buildSourceCoverage(sourceOutcomes);
  const sourceOutcomesForAgent = coverage.outcomes.map((outcome) => {
    const source = outcome.source.toLowerCase();
    const sourceType = outcome.providerId === "custom-sources" ? "GENERAL_WEB" : source.includes("social") || source.includes("reddit") || source.includes("community") || source.includes("hacker news") || source.includes("product hunt")
      ? "SOCIAL_SIGNAL"
      : source.includes("trusted") || source.includes("industry")
        ? "INDEPENDENT_MEDIA"
      : source.includes("general web")
          ? "GENERAL_WEB"
        : source.includes("github") || source.includes("official") || source.includes("company source")
          ? "OFFICIAL"
          : source.includes("hugging face")
            ? "GENERAL_WEB"
        : "PRIMARY";
    const providerId = outcome.providerId ?? (source.includes("company source")
      ? "company-registry"
      : source.includes("product hunt")
        ? "product-hunt"
        : source.includes("github")
      ? "github-releases"
      : source.includes("official update")
        ? "official-update-pages"
        : source.includes("trusted")
          ? "trusted-media"
          : source.includes("industry")
            ? "industry-media"
            : source.includes("hacker news")
              ? "hacker-news"
              : source.includes("hugging face")
                ? "huggingface"
                : source.includes("arxiv")
                  ? "arxiv"
            : source.includes("general web")
              ? "public-web"
            : source.includes("reddit")
              ? "reddit"
              : source.includes("community")
                ? "public-web"
                : source.includes("social")
                  ? "social-access"
                  : "primary-web-search");
    return {
      sourceType,
      providerId,
      executed: outcome.searched,
      resultCount: outcome.resultCount,
      requestCount: outcome.requestCount,
      newEvidenceCount: outcome.resultCount,
      newClaimCount: 0,
      reliabilityGain: sourceType === "OFFICIAL" ? 90 : sourceType === "PRIMARY" ? 80 : 60,
      conflictReduction: 0,
    };
  });
  for (const check of customSourceChecks) {
    if (check.status !== "readable") continue;
    const url = check.canonicalUrl ?? check.url;
    if (!customCandidates.some(candidate => candidate.url === url)) continue;
    const included = presentation.signals.some(signal => signal.sourceUrl === url || signal.sources.some(source => source.sourceUrl === url));
    check.reason = customSourceReadReason(included);
  }
  return {
    ...(customSourceChecks.length ? { customSourceChecks } : {}),
    signals: presentation.signals,
    status: coverage.outcomes.map((outcome) => ({
      name: outcome.source,
      ok: outcome.execution === "searched_with_results" || outcome.execution === "searched_no_results",
      state: outcome.execution,
    })),
    queryPlan: plan,
    progress,
    failures,
    counts,
    overview,
    coverage,
    filteringSummary,
    evidenceAccounting,
    evidenceRecords,
    fetchedAt: new Date().toISOString(),
    dataMode: "live",
    lastCheckedAt: new Date().toISOString(),
    sourceOutcomes: sourceOutcomesForAgent,
    sourceDiagnostics,
  };
}
