import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPublicSourceAddress, publicSourceUrl, type CustomSourceCheck } from "../lib/custom-sources.ts";
import { getSourceDoHResolver } from "./doh-resolver.ts";

type Address = { address: string; family: number };
type PageResponse = { status: number; headers: Record<string, string | undefined>; body: string };
export type CustomSourceResult = CustomSourceCheck & { content?: string };
type ReadOptions = {
  format?: "feed";
  deadlineAt?: number;
  lookup?: (host: string) => Promise<Address[]>;
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<PageResponse>;
};
const MAX_BYTES = 512 * 1024;
const DEFAULT_READ_BUDGET_MS = 5000;
/**
 * A feed is a bulk transfer, not a page fetch: shopify.dev's changelog feed is
 * ~1.87 MB and a complete read takes seconds. The old 5s cap matched the page
 * reader, so a reachable first-party feed was reported as a transport failure
 * (`FEED_TIMEOUT`) before its first byte was judged. The window stays hard-bounded
 * and is still clamped by the run deadline, so this widens no total budget.
 */
const FEED_READ_BUDGET_MS = 12000;
/**
 * Below this there is no honest way to distinguish "slow DNS" from "no budget
 * left", and a read that starts now can only be cut off again. Reporting it as a
 * failure invents an upstream error; `not_searched` lets the caller record the
 * real reason (budget) instead.
 */
const FEED_MIN_USEFUL_MS = 2000;

/** Pin the validated address at socket creation, retaining the original Host/SNI. */
function pinnedRequest(url: URL, address: Address, signal: AbortSignal, feed = false): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal, agent: false,
      headers: { "User-Agent": "SignalMapResearch/0.4", Accept: feed ? "application/rss+xml,application/atom+xml,application/xml,text/xml" : "text/html,text/plain" },
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [address] as never);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode ?? 0;
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) =>
        [key, Array.isArray(value) ? value.join(", ") : value]));
      if (status !== 200) { response.destroy(); resolve({ status, headers, body: "" }); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > (feed ? 2 * 1024 * 1024 : MAX_BYTES)) { response.destroy(new Error("PAGE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

function plainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function extractPage(html: string) {
  const title = plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const date = extractPublishedAt(html);
  const cleaned = html.replace(/<(script|style|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const semantic = cleaned.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const content = plainText(semantic ?? cleaned);
  return { title, ...date, content };
}

// Publication-date extraction for pages that carry no article:published_time
// meta. Priority: meta > JSON-LD datePublished > <time datetime> > labeled date
// cell (e.g. the CardDate blocks used by Edge-Delivery blogs). Dates are never
// taken from the URL path; a page without any of these structures stays unknown.
// The priority order also decides conflicts: the highest-priority source wins
// and the disagreement is flagged instead of silently dropped.
const LABELED_DATE_CELL = /<div>\s*<div>\s*(?:carddate|published[- _]?date|pubdate|date)\s*<\/div>\s*<div>\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9:.-]+Z)?)\s*<\/div>/gi;

function collectDateCandidates(html: string): Array<{ source: CustomSourceCheck["publishedAtSource"]; value: string; time: number }> {
  const candidates: Array<{ source: NonNullable<CustomSourceCheck["publishedAtSource"]>; value: string; time: number }> = [];
  const push = (source: NonNullable<CustomSourceCheck["publishedAtSource"]>, value?: string) => {
    if (!value) return;
    const time = Date.parse(value);
    if (Number.isFinite(time)) candidates.push({ source, value, time });
  };
  for (const meta of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\b(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i.test(meta)) {
      push("meta", meta.match(/\bcontent=["']([^"']+)["']/i)?.[1]);
    }
  }
  for (const block of html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const raw = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed: unknown = JSON.parse(raw);
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        const datePublished = (node as { datePublished?: unknown })?.datePublished;
        if (typeof datePublished === "string") push("jsonld", datePublished);
      }
    } catch { /* malformed JSON-LD stays a non-source, never a page failure */ }
  }
  for (const match of html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/gi)) {
    push("time-element", match[1]);
  }
  for (const match of html.matchAll(LABELED_DATE_CELL)) {
    push("labeled-date", match[1]);
  }
  return candidates;
}

function extractPublishedAt(html: string): { publishedAt?: string; publishedAtSource?: CustomSourceCheck["publishedAtSource"]; publishedAtConflict?: boolean } {
  const candidates = collectDateCandidates(html);
  if (!candidates.length) return {};
  const byPriority = (source: NonNullable<CustomSourceCheck["publishedAtSource"]>) =>
    candidates.find((candidate) => candidate.source === source);
  const best = byPriority("meta") ?? byPriority("jsonld") ?? byPriority("time-element") ?? byPriority("labeled-date");
  if (!best) return {};
  const bestDay = best.value.slice(0, 10);
  const conflict = candidates.some((candidate) => candidate.value.slice(0, 10) !== bestDay);
  // Date-only values (labeled date cells) need a full ISO timestamp; the other
  // sources already carry their own time and pass through verbatim.
  const normalized = best.value.length > 10 ? best.value : new Date(best.time).toISOString();
  return { publishedAt: normalized, publishedAtSource: best.source, ...(conflict ? { publishedAtConflict: true } : {}) };
}

export { getSourceDoHResolver, createDoHLookup, resolveSourceAddresses } from "./doh-resolver.ts";

export async function readCustomSource(value: string, options: ReadOptions = {}): Promise<CustomSourceResult> {
  let requestCount = 0;
  const finish = (status: CustomSourceCheck["status"], reason: string): CustomSourceResult =>
    ({ url: publicSourceUrl(value) ?? "", status, reason, requestCount });
  // The default window is mode-aware on both sides: a caller that passes no
  // deadline must get the feed window too, otherwise the min() below silently
  // collapses a feed read back to the page budget.
  const readBudgetMs = options.format === "feed" ? FEED_READ_BUDGET_MS : DEFAULT_READ_BUDGET_MS;
  const deadlineAt = Math.min(options.deadlineAt ?? Date.now() + readBudgetMs, Date.now() + readBudgetMs);
  const remainingBudgetMs = deadlineAt - Date.now();
  if (remainingBudgetMs <= 0) return finish("not_searched", options.format === "feed" ? "FEED_BUDGET_EXHAUSTED" : "本轮时间不足，尚未读取这个来源。");
  if (options.format === "feed" && remainingBudgetMs < FEED_MIN_USEFUL_MS) return finish("not_searched", "FEED_BUDGET_EXHAUSTED");
  let current = publicSourceUrl(value);
  if (!current) return finish("blocked", "仅支持不含账号密码的公开网页链接。");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<CustomSourceResult> => {
      for (let redirects = 0; redirects <= 2; redirects++) {
        if (controller.signal.aborted) throw new Error("TIMEOUT");
        const url = new URL(current!);
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const sharedResolver = getSourceDoHResolver();
        const systemLookup = sharedResolver.configured
          ? (name: string) => sharedResolver.resolve(name)
          : (name: string) => lookup(name, { all: true });
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
          : await (options.lookup ?? systemLookup)(host);
        if (!addresses.length || addresses.some(item => !isPublicSourceAddress(item.address))) {
          return finish("blocked", options.format === "feed" ? "FEED_PRIVATE_ADDRESS" : "来源解析到非公开地址，未进行抓取。");
        }
        if (controller.signal.aborted) throw new Error("TIMEOUT");
        requestCount++;
        const response = await (options.request ?? ((target, address, signal) => pinnedRequest(target, address, signal, options.format === "feed")))(url, addresses[0], controller.signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.location;
          const next = location ? publicSourceUrl(new URL(location, url).href) : undefined;
          if (!next) return finish("blocked", "来源跳转到不支持的地址，已停止抓取。");
          current = next;
          continue;
        }
        if ([401, 403].includes(response.status)) return finish("login_required", options.format === "feed" ? `FEED_HTTP_${response.status}` : "页面需要登录或限制访问，未读取正文。");
        if (response.status !== 200) return finish("failed", options.format === "feed" ? `FEED_HTTP_${response.status}` : "页面未能读取，请检查链接或稍后再试。");
        const type = response.headers["content-type"] ?? "";
        if (options.format === "feed") {
          if (!/(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(type)) return finish("failed", "FEED_CONTENT_TYPE_UNSUPPORTED");
          if (Buffer.byteLength(response.body) > 2 * 1024 * 1024) return finish("failed", "FEED_TOO_LARGE");
          return {...finish("readable", "订阅内容已读取，仍需解析与筛选。"), canonicalUrl: url.href, content: response.body};
        }
        if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
          return finish("failed", "当前仅支持公开网页正文，不支持这种文件类型。");
        }
        const page = extractPage(response.body);
        if (page.content.length < 160) return finish("too_thin", "页面可访问，但正文太少，暂时不能作为变化依据。");
        return { ...finish("readable", "正文可读取；仍需按相关性、时间和证据进行筛选。"),
          canonicalUrl: url.href, ...page };
      }
      return finish("failed", "页面跳转过多，已停止抓取。");
    };
    return await Promise.race([work(), new Promise<CustomSourceResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(finish("failed", options.format === "feed" ? "FEED_TIMEOUT" : "读取超时，请稍后再检查。")); }, Math.max(1, deadlineAt - Date.now()));
    })]);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "UNKNOWN";
    const safeCode = ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "PAGE_TOO_LARGE", "TIMEOUT"].includes(code) ? code : "READ_FAILED";
    return finish("failed", options.format === "feed" ? `FEED_${safeCode}` : "页面读取失败，可能暂时不可达或正文过大。");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
