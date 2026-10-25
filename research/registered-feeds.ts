import { publicSourceUrl } from "../lib/custom-sources.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { selectRegisteredFeeds, disabledRsshubFeeds, type RegisteredFeed } from "../source-registry/feed-catalog.ts";
import type { ResearchCandidate } from "./types.ts";
import { formatCoverageNotice } from "./source-coverage.ts";
import type { SourceExecutionOutcome } from "./source-coverage.ts";

/**
 * A feed read that starts with less than this much budget left cannot finish a
 * DNS lookup plus a bulk transfer, so it would only burn the window and report a
 * fabricated upstream failure. Below it the run records a budget decision
 * instead, which the coverage layer already maps to `blockedBy: "budget"`.
 */
const FEED_MIN_USEFUL_BUDGET_MS = 2000;

type XmlNode = {name: string; attributes: Record<string, string>; children: XmlNode[]; text: string};
type FeedEntry = {title: string; url: string; snippet: string; publishedAt?: string};
type FeedRead = {entries: FeedEntry[]; outcome: SourceExecutionOutcome; failure?: string; retrievedAt?: string};
export type FeedReadCache = Map<string, Promise<FeedRead>>;

function decode(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (raw, entity: string) => {
    const names: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'"};
    if (!entity.startsWith("#")) return names[entity.toLowerCase()] ?? raw;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

/**
 * Work budgets for feed parsing. The tokenizer is bounded by the work it may
 * perform, not by document size: tokenizing stops once `FEED_MAX_RECORDS`
 * item/entry records have closed, because the caller never consumes more
 * than that (and returns at most `FEED_MAX_ENTRIES`). A document that cannot
 * yield that many records within `FEED_MAX_TOKENS` fragments is a resource
 * limit and reports FEED_TOO_COMPLEX, never a syntax error.
 */
const FEED_MAX_TOKENS = 30000;
const FEED_MAX_RECORDS = 100;
const FEED_MAX_ENTRIES = 60;

/** Bounded, non-validating XML tree. DTD/entity declarations are never processed. */
function xmlTree(xml: string, itemBudget: number = FEED_MAX_RECORDS): XmlNode {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error("FEED_UNSAFE_XML");
  const root: XmlNode = {name: "document", attributes: {}, children: [], text: ""};
  const stack = [root];
  let cursor = 0;
  let count = 0;
  let records = 0;
  let truncated = false;
  const tokens = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== cursor) throw new Error("FEED_INVALID_XML");
    if (++count > FEED_MAX_TOKENS) throw new Error("FEED_TOO_COMPLEX");
    const token = match[0];
    cursor += token.length;
    const parent = stack[stack.length - 1];
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) { parent.text += token.slice(9, -3); continue; }
    if (!token.startsWith("<")) { if (stack.length === 1 && token.trim()) throw new Error("FEED_INVALID_XML"); parent.text += decode(token); continue; }
    if (token.startsWith("</")) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== parent.name) throw new Error("FEED_INVALID_XML");
      stack.pop();
      if (stack.length > 1) stack[stack.length - 1].text += ` ${parent.text}`;
      if (local(parent) === "item" || local(parent) === "entry") {
        if (++records >= itemBudget) { truncated = true; break; }
      }
      continue;
    }
    const start = token.match(/^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>$/);
    if (!start || stack.length > 32) throw new Error("FEED_INVALID_XML");
    const node: XmlNode = {name: start[1], attributes: {}, children: [], text: ""};
    for (const attribute of start[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attributes[attribute[1]] = decode(attribute[2] ?? attribute[3]);
    parent.children.push(node);
    if (!token.endsWith("/>")) stack.push(node);
  }
  // When tokenizing stopped at the record budget, the head was fully consumed
  // and balanced; the unread tail is deliberately not validated. The document
  // must still END as a complete feed: an O(1) root-close anchor that keeps a
  // truncated body from being parsed as a successful read.
  if (truncated) {
    if (!/<\/\s*(?:rss|feed)\s*>\s*$/i.test(xml)) throw new Error("FEED_INVALID_XML");
  } else if (cursor !== xml.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) throw new Error("FEED_INVALID_XML");
  return root.children[0];
}

function local(node: XmlNode) { return node.name.split(":").at(-1); }
function child(node: XmlNode, name: string) { return node.children.find(value => local(value) === name); }
function text(node: XmlNode, name: string) { return child(node, name)?.text.trim() ?? ""; }
function plain(value: string) {
  return decode(value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseRegisteredFeed(xml: string, feed: RegisteredFeed): {entries: FeedEntry[]; rawCount: number} {
  const root = xmlTree(xml);
  const atom = local(root) === "feed";
  const container = atom ? root : local(root) === "rss" ? child(root, "channel") : undefined;
  if (!container) throw new Error("FEED_UNSUPPORTED_FORMAT");
  const records = container.children.filter(node => local(node) === (atom ? "entry" : "item"));
  const entries = new Map<string, FeedEntry>();
  for (const record of records.slice(0, FEED_MAX_RECORDS)) {
    const snippet = plain(text(record, "description") || text(record, "summary") || text(record, "content") || text(record, "encoded")).slice(0, 12000);
    // Some official release feeds leave <title/> empty. Retain literal source
    // text as a discovery lead; downstream relevance/verification still applies.
    const title = (plain(text(record, "title")) || snippet).slice(0, 500);
    const link = atom ? record.children.find(node => local(node) === "link" && (!node.attributes.rel || node.attributes.rel === "alternate"))?.attributes.href : text(record, "link");
    let url: string | undefined;
    try { url = link ? publicSourceUrl(new URL(link, feed.url).href) : undefined; } catch { continue; }
    if (!url || !title) continue;
    const parsed = new URL(url);
    if (!feed.publisherHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) continue;
    parsed.hash = "";
    if (/^\/$|\/(?:feed|rss|atom)(?:\.xml)?\/?$|\/(?:category|tag|tags)(?:\/|$)/i.test(parsed.pathname) || parsed.href === feed.url) continue;
    const rawDate = text(record, atom ? "published" : "pubDate");
    const date = rawDate ? Date.parse(rawDate) : NaN;
    entries.set(parsed.href, {title, url: parsed.href, snippet,
      ...(Number.isFinite(date) ? {publishedAt: new Date(date).toISOString()} : {})});
  }
  return {entries: [...entries.values()].slice(0, FEED_MAX_ENTRIES), rawCount: records.length};
}

// Only fixed reader/parser codes may enter diagnostics, never arbitrary error text.
function safeFeedFailureCode(value: unknown): string {
  const code = typeof value === "string" ? value : "";
  return /^(?:FEED_HTTP_[1-5][0-9]{2}|FEED_(?:BUDGET_EXHAUSTED|PRIVATE_ADDRESS|CONTENT_TYPE_UNSUPPORTED|TOO_LARGE|TIMEOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|PAGE_TOO_LARGE|READ_FAILED|UNSAFE_XML|TOO_COMPLEX|INVALID_XML|UNSUPPORTED_FORMAT))$/.test(code)
    ? code : "FEED_READ_FAILED";
}

async function readFeed(feed: RegisteredFeed, reader: typeof readCustomSource, deadlineAt?: number): Promise<FeedRead> {
  const source = `${feed.official ? "Official" : "General Web"} Feed · ${feed.name}`;
  const base = {source, providerId: "registered-feeds", sourceId: feed.id, searched: false, resultCount: 0, requestCount: 0};
  let requestCount = 0;
  try {
    const result = await reader(feed.url, {format: "feed", deadlineAt, ...(feed.relayAuth ? {relayAuth: feed.relayAuth, forbidCrossOriginRedirects: true} : {})});
    requestCount = result.requestCount;
    if (result.status !== "readable" || !result.content) {
      const notStarted = result.status === "not_searched";
      return {entries: [], outcome: {...base, execution: notStarted ? "not_searched" : "failed", ...(notStarted ? {blockedBy: "budget" as const} : {failureCode: "upstream_error" as const, detailFailureCode: safeFeedFailureCode(result.reason)}), searched: result.requestCount > 0, requestCount: result.requestCount},
        failure: notStarted ? undefined : `${source}: ${safeFeedFailureCode(result.reason)}`};
    }
    const parsed = parseRegisteredFeed(result.content, feed);
    // P2-N coverage observation: unique-URL entry count, raw request count, and
    // the observed publish-date range. routeLimit comes from the fixed route
    // (limit=5); an earliest date later than the research window start means
    // the route returned only the most recent slice — never full-window coverage.
    const dated = parsed.entries.map(entry => entry.publishedAt).filter(Boolean) as string[];
    const undatedCount = parsed.entries.length - dated.length;
    const routeLimitMatch = feed.url.match(/[?&]limit=(\d+)/);
    const coverage = {
      returnedCount: parsed.entries.length,
      ...(routeLimitMatch ? {routeLimit: Number(routeLimitMatch[1])} : {}),
      undatedCount,
      ...(dated.length ? {
        observedEarliest: new Date(Math.min(...dated.map(d => Date.parse(d)))).toISOString(),
        observedLatest: new Date(Math.max(...dated.map(d => Date.parse(d)))).toISOString(),
      } : {}),
      notice: "",
    };
    coverage.notice = formatCoverageNotice({...coverage, execution: "searched_with_results", searched: true, requestCount: result.requestCount, resultCount: parsed.entries.length});
    return {entries: parsed.entries, retrievedAt: new Date().toISOString(), outcome: {...base, searched: true, execution: parsed.entries.length ? "searched_with_results" : "searched_no_results", requestCount: result.requestCount,
      resultCount: parsed.entries.length, rawResultCount: parsed.rawCount, normalizedCandidateCount: parsed.entries.length, rejectedRawCount: parsed.rawCount - parsed.entries.length, coverage}};
  } catch (error) {
    // Parser errors are fixed codes; never expose an arbitrary transport exception or credential-bearing URL.
    const code = safeFeedFailureCode(error instanceof Error ? error.message : undefined);
    return {entries: [], outcome: {...base, searched: requestCount > 0, requestCount, execution: "failed", failureCode: "upstream_error", detailFailureCode: code}, failure: `${source}: ${code}`};
  }
}

export async function retrieveRegisteredFeeds(input: {entities: string[]; query: string; selectedSourceType?: string; allowed: boolean; deadlineAt?: number; reader?: typeof readCustomSource; cache?: FeedReadCache; excludedEntities?: string[]}) {
  const feeds = selectRegisteredFeeds(input);
  const items: ResearchCandidate[] = [];
  const outcomes: SourceExecutionOutcome[] = [];
  // Relays the question asked for but whose deployment configuration is absent or
  // insecure are reported as not_configured — never silently skipped, never fetched
  // against a fabricated URL. The access key never appears in any outcome field.
  for (const relay of disabledRsshubFeeds(input)) {
    outcomes.push({source: `General Web Feed · ${relay.name}`, providerId: "registered-feeds", sourceId: relay.id, execution: "not_configured", detailFailureCode: `FEED_RSSHUB_${relay.reason.toUpperCase()}`, searched: false, resultCount: 0, requestCount: 0});
  }
  const failures: string[] = [];
  const cache: FeedReadCache = input.cache ?? new Map();
  if (!feeds.length || !input.allowed || (input.deadlineAt !== undefined && input.deadlineAt - Date.now() < FEED_MIN_USEFUL_BUDGET_MS)) {
    outcomes.push({source: "Registered Feeds", providerId: "registered-feeds", execution: "not_searched", blockedBy: !input.allowed ? "source_selection" : !feeds.length ? "no_candidate_source" : "budget", searched: false, resultCount: 0, requestCount: 0});
    return {items, outcomes, failures};
  }
  await Promise.all(feeds.map(async feed => {
    const cached = cache.has(feed.url);
    if (!cached) cache.set(feed.url, readFeed(feed, input.reader ?? readCustomSource, input.deadlineAt));
    const result = await cache.get(feed.url)!;
    outcomes.push({...result.outcome, ...(cached ? {requestCount: 0} : {})});
    if (result.failure) failures.push(result.failure);
    const retrievedAt = result.retrievedAt ?? new Date().toISOString();
    items.push(...result.entries.map(entry => ({...entry, id: `feed-${entry.url}`, source: result.outcome.source, retrievedAt, firstSeenAt: retrievedAt,
      dataOrigin: "live" as const, channel: feed.official ? "官方" as const : "社区" as const, authority: feed.official ? 90 : 60,
      origin: feed.official ? "official" as const : "news" as const, sourceType: feed.official ? "primary" as const : "industry_media" as const,
      providerId: "registered-feeds", sourceCapability: "DISCOVERY" as const})));
  }));
  return {items, outcomes, failures};
}
