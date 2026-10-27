export type RegisteredFeed = {
  id: string;
  name: string;
  url: string;
  publisherHosts: string[];
  aliases: string[];
  topics: string[];
  official: boolean;
  /** Transport evidence only, never a claim-quality certification. */
  cloudVerified: boolean;
  /**
   * Server-configured relay credential (P2-H). Constructed only by this catalog from
   * deployment environment; rides the X-Relay-Key request header on same-origin hops
   * and must never be serialized into outcomes, logs, or client-facing payloads.
   */
  relayAuth?: {origin: string; name: string; value: string};
};

const staticFeeds: RegisteredFeed[] = [
  {id: "shopify", name: "Shopify Developer Changelog", url: "https://shopify.dev/changelog/feed.xml", publisherHosts: ["shopify.dev"], aliases: ["shopify"], topics: ["独立站", "电商建站", "ecommerce", "e-commerce", "online store"], official: true, cloudVerified: false},
  {id: "nodejs", name: "Node.js Blog", url: "https://nodejs.org/en/feed/blog.xml", publisherHosts: ["nodejs.org"], aliases: ["node.js", "nodejs"], topics: [], official: true, cloudVerified: false},
  {id: "nasa", name: "NASA", url: "https://www.nasa.gov/feed/", publisherHosts: ["nasa.gov"], aliases: ["nasa", "美国宇航局"], topics: ["天文", "航天", "astronomy", "space exploration"], official: true, cloudVerified: true},
  {id: "github", name: "GitHub Blog", url: "https://github.blog/feed/", publisherHosts: ["github.blog"], aliases: ["github", "copilot"], topics: ["程序开发", "开发工具", "developer tools"], official: true, cloudVerified: false},
  {id: "mozilla", name: "Mozilla Hacks", url: "https://hacks.mozilla.org/feed/", publisherHosts: ["mozilla.org"], aliases: ["mozilla", "firefox"], topics: ["web standards", "浏览器标准"], official: false, cloudVerified: false},
  {id: "openai", name: "OpenAI News", url: "https://openai.com/news/rss.xml", publisherHosts: ["openai.com"], aliases: ["openai", "chatgpt"], topics: [], official: true, cloudVerified: false},
  {id: "ithome", name: "IT之家", url: "https://www.ithome.com/rss/", publisherHosts: ["ithome.com"], aliases: ["it之家", "ithome"], topics: ["国内科技", "国产手机", "数码", "新能源汽车", "人工智能", "ai行业"], official: false, cloudVerified: true},
  {id: "sspai", name: "少数派", url: "https://sspai.com/feed", publisherHosts: ["sspai.com"], aliases: ["少数派", "sspai"], topics: ["数字生活", "效率工具", "数码", "软件体验", "digital lifestyle"], official: false, cloudVerified: true},
  {id: "gcores", name: "机核", url: "https://www.gcores.com/rss", publisherHosts: ["gcores.com"], aliases: ["机核", "gcores"], topics: ["游戏", "电子游戏", "独立游戏", "video games"], official: false, cloudVerified: false},
  {id: "ruanyifeng", name: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml", publisherHosts: ["ruanyifeng.com"], aliases: ["阮一峰", "ruanyifeng"], topics: ["科技周刊", "程序员", "前端开发", "开源工具"], official: false, cloudVerified: false},
  {id: "kdenlive", name: "Kdenlive News", url: "https://kdenlive.org/news/index.xml", publisherHosts: ["kdenlive.org"], aliases: ["kdenlive"], topics: ["后期制作", "剪辑软件", "影视制作", "视频制作", "post-production", "video editing"], official: true, cloudVerified: false},
  {id: "obs", name: "OBS Studio Blog", url: "https://obsproject.com/blog/rss", publisherHosts: ["obsproject.com"], aliases: ["obs", "obs studio"], topics: ["直播软件", "视频录制", "live streaming", "screen recording"], official: true, cloudVerified: false},
  {id: "krita", name: "Krita News", url: "https://krita.org/en/index.xml", publisherHosts: ["krita.org"], aliases: ["krita"], topics: ["动画制作", "数字绘画", "digital painting", "animation software"], official: true, cloudVerified: false},
  {id: "woocommerce", name: "WooCommerce Developer Blog", url: "https://developer.woocommerce.com/feed/", publisherHosts: ["woocommerce.com"], aliases: ["woocommerce", "woo commerce"], topics: ["独立站", "电商建站", "ecommerce", "e-commerce", "online store"], official: true, cloudVerified: false},
  {id: "chrome", name: "Chrome Releases", url: "https://chromereleases.googleblog.com/feeds/posts/default", publisherHosts: ["chromereleases.googleblog.com"], aliases: ["chrome", "chromium", "谷歌浏览器"], topics: ["浏览器安全", "browser security"], official: true, cloudVerified: false},
  {id: "infoq", name: "InfoQ 中文", url: "https://www.infoq.cn/feed", publisherHosts: ["infoq.cn"], aliases: ["infoq"], topics: ["国内技术资讯", "软件架构", "技术管理", "云原生"], official: false, cloudVerified: false},
  {id: "oschina", name: "开源中国资讯", url: "https://www.oschina.net/news/rss", publisherHosts: ["oschina.net"], aliases: ["oschina", "开源中国"], topics: ["国内技术资讯", "开源社区", "开源软件", "开源工具"], official: false, cloudVerified: false},
  // 极客公园官方全站 RSS（P2-I 2026-10-24 实测：生产 API 网络可达 200/application/xml，
  // 真实 30 条含标题/日期/链接）。综合源不做预过滤：AI 主题筛选由既有逐条相关性门承担，
  // 相关性判定仍存在边缘放行与误拒，不能保证全站 RSS 的所有 AI 条目均被选中。
  {id: "geekpark-news", name: "极客公园（官方 RSS）", url: "https://www.geekpark.net/rss", publisherHosts: ["geekpark.net"], aliases: ["极客公园", "geekpark"], topics: [], official: false, cloudVerified: true},
];

function contains(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /[\u3400-\u9fff]/u.test(term) ? text.includes(term) : new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}

const feedKey = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").trim();

export type RsshubRelayStatus = { feeds: RegisteredFeed[]; reason: null | "missing_base" | "insecure_base" | "base_not_origin" | "missing_key" };

// RSSHub relay feeds are environment-gated (P2-E/P2-F, 2026-10-24). RSSHUB_BASE_URL and
// RSSHUB_ACCESS_KEY are deployment configuration and never live in this repository. The
// route(s) below are FIXED constants: the environment configures the origin, never the
// path, so no configuration can redirect reads to arbitrary routes. Publisher hosts stay
// with the publishers, and topics stay empty so relays never enter subject selection.
const RSSHUB_FEED_DEFS = [
  // 已测试的 36氪 feed-newsflash 等地址返回 SPA HTML，尚未找到可用官方 RSS。
  // 仅此一个来源仍需 RSSHub 中继；极客公园已于 2026-10-24 改走官方 RSS 直连。
  {id: "36kr-flashes", name: "36氪快讯（RSSHub 转接）", route: "/36kr/newsflashes?limit=5", publisherHosts: ["36kr.com"], aliases: ["36氪", "36kr"]},
] as const;

/** Public identities only: no deployment config or relay credentials. */
export const registeredPublisherNames = [...staticFeeds, ...RSSHUB_FEED_DEFS]
  .flatMap(feed => [feed.name.replace(/[（(].*$/, "").trim(), ...feed.aliases]);

/**
 * Reads deployment config at call time so tests and runtime share one behavior.
 *
 * Strict base parsing (P2-G): the base must be a bare HTTPS origin — no user
 * information, no path, no query, no fragment. Anything else is rejected so
 * configuration can never smuggle request components past the fixed routes.
 * The runtime SSRF/DNS/TLS gates in the shared safe reader stay fully in force.
 *
 * Production key policy: when NODE_ENV=production the relays refuse to enable
 * without RSSHUB_ACCESS_KEY (reason "missing_key") — no silent open-proxy mode.
 * Credentials use the X-Relay-Key header on same-origin requests only.
 * A fixed HTTPS gateway authenticates and strips the header before proxying.
 * The safe reader rejects cross-origin relay redirects; URLs never carry keys.
 */
export function rsshubRelayFeeds(env: NodeJS.ProcessEnv = process.env): RsshubRelayStatus {
  const base = env.RSSHUB_BASE_URL?.trim() ?? "";
  const key = env.RSSHUB_ACCESS_KEY?.trim() ?? "";
  if (!base) return {feeds: [], reason: "missing_base"};
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return {feeds: [], reason: "insecure_base"};
  }
  if (parsed.protocol !== "https:") return {feeds: [], reason: "insecure_base"};
  if (parsed.username || parsed.password) return {feeds: [], reason: "base_not_origin"};
  if (parsed.pathname !== "/" && parsed.pathname !== "") return {feeds: [], reason: "base_not_origin"};
  if (parsed.search || parsed.hash) return {feeds: [], reason: "base_not_origin"};
  if (env.NODE_ENV === "production" && !key) return {feeds: [], reason: "missing_key"};
  const origin = parsed.origin;
  const feeds: RegisteredFeed[] = RSSHUB_FEED_DEFS.map(def => ({
    id: def.id,
    name: def.name,
    url: `${origin}${def.route}`,
    ...(key ? {relayAuth: {origin, name: "X-Relay-Key", value: key}} : {}),
    publisherHosts: [...def.publisherHosts],
    aliases: [...def.aliases],
    topics: [],
    official: false,
    cloudVerified: true,
  }));
  return {feeds, reason: null};
}

/** Static catalogue only; relays are merged per selection from live configuration. */
export const registeredFeeds: RegisteredFeed[] = staticFeeds;

/** Alias-matched relays that are disabled because of missing or insecure configuration. */
export function disabledRsshubFeeds(input: {entities: string[]; query: string}, env: NodeJS.ProcessEnv = process.env): Array<{id: string; name: string; reason: Exclude<RsshubRelayStatus["reason"], null>}> {
  const status = rsshubRelayFeeds(env);
  const reason = status.reason;
  if (!reason) return [];
  const text = `${input.entities.join(" ")} ${input.query}`.toLowerCase();
  return RSSHUB_FEED_DEFS
    .filter(def => def.aliases.some(alias => contains(text, alias)))
    .map(def => ({id: def.id, name: def.name, reason}));
}

export function selectRegisteredFeeds(input: {entities: string[]; query: string; selectedSourceType?: string; excludedEntities?: string[]}, env: NodeJS.ProcessEnv = process.env): RegisteredFeed[] {
  const excluded = (input.excludedEntities ?? []).map(feedKey).filter(Boolean);
  const text = `${input.entities.join(" ")} ${input.query}`.toLowerCase();
  // Relays join the catalogue only when their deployment configuration is present;
  // a missing base never fabricates a URL to fetch.
  const catalogue = [...registeredFeeds, ...rsshubRelayFeeds(env).feeds];
  // A publisher the question explicitly excluded ("排除 Shopify") is removed
  // from source selection: exclusion must apply before discovery, not only at
  // admission, so its feed is never even fetched.
  const available = catalogue.filter(feed => !["OFFICIAL", "PRIMARY"].includes(input.selectedSourceType ?? "") || feed.official)
    .filter(feed => !excluded.some(entity => feed.aliases.some(alias => feedKey(alias) === entity)));
  const exact = available.filter(feed => feed.aliases.some(alias => contains(text, alias)));
  // Named publishers outrank broad subject matches. An unknown question never
  // selects the entire catalogue. Every feed that matches the question is
  // returned: there is no total cap, because dropping the 4th+ relevant source
  // silently hid material the question explicitly asked for. Relevance, entity
  // precedence, exclusion, official-only mode and relay configuration still
  // bound the result; callers own execution concurrency, not the list.
  return exact.length ? exact : available.filter(feed => feed.topics.some(topic => contains(text, topic)));
}
