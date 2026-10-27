import assert from "node:assert/strict";
import test from "node:test";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { rsshubRelayFeeds, registeredFeeds, selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
import { parseRegisteredFeed, retrieveRegisteredFeeds, type FeedReadCache } from "../research/registered-feeds.ts";

const publishedAt = new Date(Date.now() - 3600_000).toISOString();

test("offline media replay keeps AI material provenance but navigation cannot become valid evidence", async () => {
  const before = globalThis.fetch;
  const date = new Date(Date.now() - 3600_000).toISOString();
  const nav = "媒体品牌 企业号 企业服务 核心服务 城市之窗 政府服务 创投发布 投资人认证 投资人服务 项目推荐";
  const xml = `<rss><channel>
    <item><title>国内AI产品更新</title><link>https://www.geekpark.net/news/navigation-fixture</link><pubDate>${date}</pubDate><description>${nav}</description></item>
    <item><title>阅文AI动画发布</title><link>https://www.geekpark.net/news/ai-fixture</link><pubDate>${date}</pubDate><description>阅文发布首批AI精品动画项目，将DramaBuddy漫剧助手升级为一站式平台，新增从文字到影像的制作流程。</description></item>
    <item><title>新产品发布</title><link>https://www.geekpark.net/news/pcb-fixture</link><pubDate>${date}</pubDate><description>企业发布矢量网络分析仪新产品及PCB测试解决方案，推动测试产业发展。</description></item>
  </channel></rss>`;
  let detailFetches = 0;
  globalThis.fetch = async () => { detailFetches++; return new Response(`<html><body>${nav}</body></html>`, {status: 200}); };
  try {
    const result = await runResearchPipeline({...input,
      trackedEntities: "", industry: "人工智能与产品工具", focusAreas: "AI 产品",
      currentQuestions: "过去7天，极客公园报道了哪些与国内AI产品或产业有关的新进展？", freshnessWindow: "7d",
    }, undefined, {deadlineAt: Date.now() + 20000,
      customSourceReader: async url => ({url, status: "readable", requestCount: 1, reason: "offline fixture", content: xml}),
    }, {queries: ["极客公园"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "INDEPENDENT_MEDIA"});
    assert.ok(result.coverage.outcomes.some(o => o.sourceId === "geekpark-news" && o.rawResultCount === 3));
    assert.ok(result.signals.every(s => !s.sources.some(source => /navigation-fixture|pcb-fixture/.test(source.sourceUrl))), "menus and unrelated products must never become displayed signals");
    const ai = result.signals.find(s => s.sources.some(source => source.sourceUrl.endsWith("/ai-fixture")));
    assert.ok(ai, "literal AI report remains in the material stream");
    assert.equal(ai.topicRelevance?.decision, "MATCH");
    assert.equal(ai.sources[0].publishedAt, date);
    assert.ok(detailFetches <= 5, "existing detail budget stays bounded");
  } finally { globalThis.fetch = before; }
});
const checkoutFeed = `<rss version="2.0"><channel><title>Shopify</title><item>
<title>Shopify checkout payment API released for US merchants</title>
<link>https://shopify.dev/changelog/checkout-payment-update</link>
<pubDate>${publishedAt}</pubDate><description><![CDATA[<p>Shopify released a checkout payment API update for US merchants. The change adds documented payment validation for eligible checkout extensions and requires the current API version.</p>]]></description>
</item></channel></rss>`;
const input = {
  identity: "开发者", trackedEntities: "Shopify", trackedEvents: "", userJudgements: "", evidenceHistory: "", industry: "电商", focusAreas: "Shopify checkout payment", currentQuestions: "Shopify checkout payment updates",
  knownInformation: "", informationGaps: "US merchant applicability", freshnessWindow: "30d" as const,
};

test("allowed registered feed supplies real Shopify material when other discovery returns nothing", async () => {
  const fetchBefore = globalThis.fetch;
  const reads: string[] = [];
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  try {
    const result = await runResearchPipeline(input, undefined, {
      deadlineAt: Date.now() + 20000,
      customSourceReader: async (url) => {
        reads.push(url);
        return {url, status: "readable", requestCount: 1, reason: "fixture", canonicalUrl: url, content: checkoutFeed};
      },
    }, {queries: ["Shopify checkout payment"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "OFFICIAL"});
    assert.ok(result.overview.scanned >= 1, "a real feed entry must reach retrieval accounting");
    assert.deepEqual(reads, ["https://shopify.dev/changelog/feed.xml"], "unrelated domestic/science feeds must not run for Shopify");
    assert.ok(result.coverage.outcomes.some(outcome => outcome.providerId === "registered-feeds" && outcome.rawResultCount === 1));
  } finally { globalThis.fetch = fetchBefore; }
});

test("catalogue broadens subjects without sending unknown entities to every feed", () => {
  assert.ok(registeredFeeds.length >= 17);
  assert.deepEqual(selectRegisteredFeeds({entities: ["Shopify"], query: "美国商户结账变化"}).map(feed => feed.id), ["shopify"]);
  assert.deepEqual(selectRegisteredFeeds({entities: [], query: "国内数码和数字生活近期变化"}).map(feed => feed.id), ["ithome", "sspai"]);
  assert.deepEqual(selectRegisteredFeeds({entities: ["DaVinci"], query: "剪辑插件价格"}), []);
  assert.deepEqual(selectRegisteredFeeds({entities: [], query: "documentation updates"}), []);
  assert.deepEqual(selectRegisteredFeeds({entities: [], query: "数码", selectedSourceType: "OFFICIAL"}), []);
});

test("industry questions select every relevant feed without a total cap", () => {
  const film = selectRegisteredFeeds({entities: [], query: "过去30天面向独立电影人的后期制作软件有哪些正式更新"});
  assert.ok(film.some(feed => feed.id === "kdenlive"));
  const commerce = selectRegisteredFeeds({entities: [], query: "小型独立站建站与支付工具正式更新"});
  assert.ok(commerce.some(feed => feed.id === "woocommerce"));
  const programming = selectRegisteredFeeds({entities: [], query: "程序开发工具近期发布"});
  assert.ok(programming.length > 0);
  // No arbitrary total cap: each question keeps every matching feed. Relevance
  // still bounds the result, so an unmatched question selects nothing.
  for (const feeds of [film, commerce, programming]) assert.ok(feeds.length >= 1);
  assert.equal(selectRegisteredFeeds({entities: [], query: "未归类的面包配方 documentation"}).length, 0);
});

test("new publishers respect entity exclusion and official-only selection", () => {
  assert.deepEqual(selectRegisteredFeeds({entities: ["WooCommerce"], query: "WooCommerce checkout"}).map(feed => feed.id), ["woocommerce"]);
  assert.equal(selectRegisteredFeeds({entities: ["WooCommerce"], query: "WooCommerce checkout", excludedEntities: ["WooCommerce"]}).length, 0);
  const media = selectRegisteredFeeds({entities: [], query: "国内技术资讯和开源社区动态"});
  assert.ok(media.some(feed => feed.id === "infoq" || feed.id === "oschina"));
  assert.ok(selectRegisteredFeeds({entities: [], query: "国内技术资讯和开源社区动态", selectedSourceType: "OFFICIAL"}).every(feed => feed.official));
});

test("new commerce feed entries enter the same candidate and coverage contract", async () => {
  const feed = registeredFeeds.find(feed => feed.id === "woocommerce");
  assert.ok(feed, "new source must exist in the runtime catalogue");
  const xml = `<rss><channel><item><title>WooCommerce checkout update</title><link>https://developer.woocommerce.com/2026/10/19/checkout-update/</link><pubDate>${publishedAt}</pubDate><description>Released checkout improvements.</description></item></channel></rss>`;
  const result = await retrieveRegisteredFeeds({entities: ["WooCommerce"], query: "checkout", allowed: true, reader: async url => ({url, status: "readable", content: xml, reason: "fixture", requestCount: 1})});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceType, "primary");
  assert.equal(result.items[0].publishedAt, publishedAt);
  assert.equal(result.outcomes[0].execution, "searched_with_results");
  assert.equal(result.outcomes[0].requestCount, 1);
});

test("a real release with an empty feed title retains its literal description as a discovery lead", () => {
  const feed = {id: "kdenlive", name: "Kdenlive", url: "https://kdenlive.org/news/index.xml", publisherHosts: ["kdenlive.org"], aliases: [], topics: [], official: true, cloudVerified: false};
  const description = "The second maintenance release of the 26.08 series is out with stability fixes.";
  const parsed = parseRegisteredFeed(`<rss><channel><item><title/><link>https://kdenlive.org/news/releases/26.08.2/</link><pubDate>${publishedAt}</pubDate><description>${description}</description></item><item><title/><link>https://kdenlive.org/empty/</link></item></channel></rss>`, feed);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].title, description);
  assert.equal(parsed.entries[0].publishedAt, publishedAt);
  assert.equal(parsed.entries[0].snippet, description);
});

test("Atom uses alternate article links and explicit publication, never updated or retrieval time", () => {
  const feed = registeredFeeds.find(feed => feed.id === "nodejs")!;
  const result = parseRegisteredFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Node.js &amp; security</title><link rel="self" href="https://nodejs.org/en/feed/blog.xml"/><link rel="alternate" href="/en/blog/release/v22"/><updated>2026-10-18T00:00:00Z</updated><summary>Security update.</summary></entry></feed>`, feed);
  assert.equal(result.rawCount, 1);
  assert.equal(result.entries[0].url, "https://nodejs.org/en/blog/release/v22");
  assert.equal(result.entries[0].title, "Node.js & security");
  assert.equal(result.entries[0].publishedAt, undefined);
  assert.equal(parseRegisteredFeed(checkoutFeed, registeredFeeds[0]).entries[0].publishedAt, publishedAt);
});

test("RSS records exclude navigation, foreign and private links, and duplicate article URLs", () => {
  const xml = `<rss><channel>${["https://shopify.dev/changelog/feed.xml", "https://shopify.dev/category/payments", "https://shopify.dev/", "http://127.0.0.1/admin", "https://evil.test/post", "https://shopify.dev/changelog/payment", "https://shopify.dev/changelog/payment#ref"].map(url => `<item><title>Payment change</title><link>${url}</link></item>`).join("")}</channel></rss>`;
  const result = parseRegisteredFeed(xml, registeredFeeds[0]);
  assert.equal(result.rawCount, 7);
  assert.equal(result.entries.length, 1);
  for (const malformed of [`<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>`, `<rss><channel><item></channel></rss>`, `<html><a href="/news">News</a></html>`]) assert.throws(() => parseRegisteredFeed(malformed, registeredFeeds[0]), /FEED_/);
});

test("deadline and source gating prevent feed IO; failures keep actual attempts", async () => {
  let reads = 0;
  const reader: typeof readCustomSource = async url => {reads++; return {url, status: "failed", reason: "FEED_HTTP_403", requestCount: 1};};
  for (const options of [{allowed: false}, {allowed: true, deadlineAt: Date.now() - 1}]) {
    const result = await retrieveRegisteredFeeds({entities: ["Shopify"], query: "", reader, ...options});
    assert.equal(result.outcomes[0].execution, "not_searched");
  }
  assert.equal(reads, 0);
  const failure = await retrieveRegisteredFeeds({entities: ["Shopify"], query: "", reader, allowed: true});
  assert.equal(failure.outcomes[0].execution, "failed");
  assert.equal(failure.outcomes[0].requestCount, 1);
  assert.match(failure.failures[0], /FEED_HTTP_403/);
  const malformed = await retrieveRegisteredFeeds({entities: ["Shopify"], query: "", allowed: true, reader: async url => ({url, status: "readable", reason: "read", content: "<broken>", requestCount: 1})});
  assert.equal(malformed.outcomes[0].requestCount, 1, "a parser failure must not erase the completed HTTP request");
});

test("one research shares feed reads across slices, a different research gets a fresh read", async () => {
  let reads = 0;
  const cache: FeedReadCache = new Map();
  const reader: typeof readCustomSource = async url => {reads++; return {url, status: "readable", content: checkoutFeed, reason: "read", requestCount: 1};};
  const options = {entities: ["Shopify"], query: "payments", allowed: true, reader, cache};
  const first = await retrieveRegisteredFeeds(options);
  const second = await retrieveRegisteredFeeds(options);
  assert.equal(reads, 1);
  assert.equal(second.outcomes[0].requestCount, 0);
  assert.equal(first.items[0].retrievedAt, second.items[0].retrievedAt);
  await retrieveRegisteredFeeds({...options, cache: new Map()});
  assert.equal(reads, 2);
});

test("media entries remain media and combined diagnostic counts include both feeds", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  try {
    const result = await runResearchPipeline({...input, trackedEntities: "", industry: "数码", focusAreas: "数字生活", currentQuestions: "数码近期变化"}, undefined, {
      customSourceReader: async url => ({url, status: "readable", reason: "read", requestCount: 1, content: `<rss><channel><item><title>数码硬件发布</title><link>${new URL(url).origin}/post/hardware-change</link><description>数码硬件近期发布了新的变化。</description><pubDate>${publishedAt}</pubDate></item></channel></rss>`}),
    }, {queries: ["数码近期变化"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "INDEPENDENT_MEDIA"});
    assert.equal(result.sourceDiagnostics?.find(item => item.providerId === "registered-feeds")?.rawProviderResultCount, 2);
    const acquired = await retrieveRegisteredFeeds({entities: [], query: "数码", allowed: true, reader: async url => ({url, status: "readable", reason: "read", requestCount: 1, content: `<rss><channel><item><title>硬件发布</title><link>${new URL(url).origin}/post/new</link></item></channel></rss>`})});
    assert.ok(acquired.items.every(item => item.sourceType === "industry_media" && item.origin === "news"));
  } finally {globalThis.fetch = before;}
});

test("feed mode retains DNS and redirect protection", async () => {
  let reads = 0;
  const result = await readCustomSource("https://shopify.dev/changelog/feed.xml", {format: "feed", lookup: async () => [{address: "10.0.0.1", family: 4}], request: async () => {reads++; return {status: 200, headers: {}, body: ""};}});
  assert.equal(result.status, "blocked");
  assert.equal(reads, 0);
  const redirect = await readCustomSource("https://shopify.dev/changelog/feed.xml", {format: "feed", lookup: async () => [{address: "93.184.216.34", family: 4}], request: async () => ({status: 302, headers: {location: "http://127.0.0.1/private"}, body: ""})});
  assert.equal(redirect.status, "blocked");
  assert.equal(redirect.requestCount, 1);
});

test("ordinary public-source reader can read XML only in explicit internal feed mode", async () => {
  const options = {
    format: "feed" as const,
    lookup: async () => [{address: "93.184.216.34", family: 4}],
    request: async () => ({status: 200, headers: {"content-type": "application/rss+xml"}, body: checkoutFeed}),
  };
  const result = await readCustomSource("https://shopify.dev/changelog/feed.xml", options);
  assert.equal(result.status, "readable");
  assert.equal(result.content, checkoutFeed);
  const htmlOnly = await readCustomSource("https://shopify.dev/changelog/feed.xml", {...options, format: undefined});
  assert.equal(htmlOnly.status, "failed", "ordinary custom pages must not silently accept an XML document as article text");
});

test("stale and off-topic feed entries never reach the candidate pool", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  const stale = new Date(Date.now() - 400 * 86400_000).toISOString();
  try {
    const result = await runResearchPipeline(input, undefined, {
      customSourceReader: async url => ({url, status: "readable", reason: "fixture", requestCount: 1,
        content: `<rss><channel>
<item><title>Shopify checkout payment update</title><link>https://shopify.dev/changelog/old-payment</link><pubDate>${stale}</pubDate><description>Shopify checkout payment change from years ago.</description></item>
<item><title>Coffee brewing temperature guide</title><link>https://shopify.dev/changelog/coffee-brewing</link><pubDate>${publishedAt}</pubDate><description>A guide about brewing coffee at the right temperature.</description></item>
</channel></rss>`}),
    }, {queries: ["Shopify checkout payment"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "OFFICIAL"});
    // Both records are counted as scanned and normalized, so the run can explain what it saw.
    assert.ok(result.overview.scanned >= 2, "raw feed records must still be accounted for");
    assert.equal(result.coverage.outcomes.find(o => o.providerId === "registered-feeds")?.normalizedCandidateCount, 2,
      "parsing produced two usable records before relevance and freshness screening");
    // Neither may survive into a signal: the stale one fails the content gate, the
    // off-topic one fails topic relevance. Feed records must pass the same existing
    // filtering as every other discovery source.
    assert.equal(result.signals.length, 0, "stale and off-topic feed entries must not become research signals");
    const reasons = new Set((result.filteringSummary?.filteringDetails ?? []).map(detail => detail.reason));
    assert.ok(reasons.has("TOPIC_MISMATCH"), `expected the off-topic record to be rejected, got ${[...reasons]}`);
  } finally { globalThis.fetch = before; }
});

test("one broken feed never aborts the research or contaminates its peers", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  try {
    const reads: string[] = [];
    const result = await runResearchPipeline({...input, trackedEntities: "", industry: "数码", focusAreas: "数码", currentQuestions: "数码硬件近期变化"}, undefined, {
      customSourceReader: async url => {
        reads.push(url);
        if (url.includes("ithome")) return {url, status: "failed", reason: "FEED_HTTP_403", requestCount: 1};
        if (url.includes("sspai")) return {url, status: "readable", reason: "malformed", requestCount: 1, content: "<rss><channel><item></channel>"};
        return {url, status: "readable", reason: "read", requestCount: 1, content: `<rss><channel><item><title>数码硬件发布</title><link>${new URL(url).origin}/post/hardware-change</link><description>数码硬件近期发布了新的变化。</description><pubDate>${publishedAt}</pubDate></item></channel></rss>`};
      },
    }, {queries: ["数码硬件近期变化"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "INDEPENDENT_MEDIA"});
    assert.deepEqual(reads.sort(), ["https://sspai.com/feed", "https://www.ithome.com/rss/"], "both subscribed feeds must be attempted");
    const outcomes = result.coverage.outcomes.filter(o => o.providerId === "registered-feeds");
    assert.equal(outcomes.length, 2, "one outcome per subscribed feed, so failures stay attributable");
    assert.ok(outcomes.some(o => o.execution === "failed"), "a transport failure is recorded as failed");
    assert.ok(outcomes.every(o => o.requestCount === 1), "a completed HTTP attempt is never erased by a later parse error");
    assert.ok(result.coverage.outcomes.some(o => o.providerId !== "registered-feeds"), "the run continues past feed failures");
  } finally { globalThis.fetch = before; }
});

// Fixture builders for documents whose legal size exceeds the historical
// per-document fragment budget. The real Shopify changelog captured on
// 2026-10-19 (1,874,367 bytes, 773 items, 35,777 tokens) is exactly this
// profile: valid XML, far below 2 MiB, rejected only by the fragment cap.
const tokenCount = (xml: string) => xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)?.length ?? 0;
const largeFeedItem = (index: number, descriptionBytes: number) => {
  const part = "x".repeat(Math.floor(descriptionBytes / 12));
  const description = Array.from({length: 10}, (_, i) => `${i ? ` <em>${i}</em> ` : ""}${part}-${i}`).join("");
  return `<item><title>Shopify change ${index}</title><link>https://shopify.dev/changelog/change-${index}</link><guid isPermaLink="false">https://shopify.dev/changelog/change-${index}</guid><pubDate>${publishedAt}</pubDate><category>checkout</category><description>${description}</description></item>`;
};
const largeFeed = (items: number, descriptionBytes: number) =>
  `<rss version="2.0"><channel><title>Shopify</title><link>https://shopify.dev/changelog</link><description>changelog</description>${Array.from({length: items}, (_, i) => largeFeedItem(i, descriptionBytes)).join("")}</channel></rss>`;

test("a legal large feed parses with bounded work instead of a fragment-cap error", () => {
  const reviewScale = largeFeed(2500, 150);
  const realFeedScale = largeFeed(773, 2100);
  for (const xml of [reviewScale, realFeedScale]) {
    assert.ok(Buffer.byteLength(xml) <= 2 * 1024 * 1024, "the fixture stays under the 2 MiB read limit");
    assert.ok(tokenCount(xml) > 30000, "the fixture exceeds the historical 30k fragment budget");
  }
  for (const xml of [reviewScale, realFeedScale]) {
    const result = parseRegisteredFeed(xml, registeredFeeds[0]);
    assert.equal(result.rawCount, 100, "processing stays bounded to the first 100 records");
    assert.equal(result.entries.length, 60, "at most 60 entries are returned");
    assert.equal(result.entries[0].url, "https://shopify.dev/changelog/change-0", "the head of the document is kept");
  }
});

test("token exhaustion reports a bounded-work limit, not invalid XML", () => {
  const junk = "<x/>".repeat(31_000);
  const xml = `<rss><channel>${junk}<item><title>t</title><link>https://shopify.dev/changelog/a</link></item></channel></rss>`;
  assert.throws(() => parseRegisteredFeed(xml, registeredFeeds[0]), /FEED_TOO_COMPLEX/,
    "a resource limit must not be reported as a syntax error");
});

test("a truncated document still fails as invalid XML", () => {
  const xml = largeFeed(2500, 150);
  assert.throws(() => parseRegisteredFeed(xml.slice(0, Math.floor(xml.length * 0.6)), registeredFeeds[0]), /FEED_INVALID_XML/);
  assert.throws(() => parseRegisteredFeed("<rss><channel><item><title>x", registeredFeeds[0]), /FEED_INVALID_XML/);
});

test("a failed source ends the run as incomplete, never as a quiet zero-result day", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  try {
    const failed = await runResearchPipeline(input, undefined, {
      customSourceReader: async url => ({url, status: "failed", reason: "FEED_HTTP_403", requestCount: 1}),
    }, {queries: ["Shopify checkout payment"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "OFFICIAL"});
    const failedLabel = failed.progress.find(entry => entry.stage === "complete")?.label ?? "";
    assert.doesNotMatch(failedLabel, /今天没有重要变化/, "a failed source must not be reported as a quiet zero-result day");
    assert.match(failedLabel, /未完成|证据不足/);
    const quiet = await runResearchPipeline(input, undefined, {
      customSourceReader: async url => ({url, status: "readable", reason: "read", requestCount: 1, content: "<rss><channel></channel></rss>"}),
    }, {queries: ["Shopify checkout payment"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "OFFICIAL"});
    assert.match(quiet.progress.find(entry => entry.stage === "complete")?.label ?? "", /研究完成 · 今天没有重要变化/,
      "sources that searched and legitimately found nothing keep the honest zero label");
  } finally { globalThis.fetch = before; }
});



/**
 * Trimmed fixtures from the two RSSHub pilot responses read on 2026-10-22
 * (docs/verification/rsshub-pilot-20261023.md). Titles, original article URLs
 * and publication dates are verbatim; descriptions are truncated so the
 * repository never carries article bodies. The double-escaped HTML in the
 * Geekpark description mirrors the real response.
 */
const rsshub36krXml = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel><title>36氪 - 快讯</title><link>https://www.36kr.com/newsflashes</link><atom:link href="https://signal-map-rsshub-323338-4-1408253594.sh.run.tcloudbase.com/36kr/newsflashes?limit=5" rel="self" type="application/rss+xml"></atom:link><description>36氪 - 快讯 - Powered by RSSHub</description><lastBuildDate>Thu, 22 Oct 2026 21:04:01 GMT</lastBuildDate><ttl>60</ttl><item><title>沃尔沃集团宣布设立Volvo Mining</title><description>沃尔沃集团宣布设立Volvo Mining。根据规划，Volvo Mining将面向矿业客户及其承包商，提供沃尔沃卡车…（摘要截断）</description><link>https://www.36kr.com/newsflashes/4036991939826561</link><pubDate>Thu, 22 Oct 2026 12:57:24 GMT</pubDate></item><item><title>Meta信用风险指标创纪录新高，AI扩产发债预期引发市场担忧</title><description>Meta Platforms一项信用风险指标飙升至历史新高，公司债券同步下跌…（摘要截断）</description><link>https://www.36kr.com/newsflashes/4037043141661831</link><pubDate>Thu, 22 Oct 2026 12:52:38 GMT</pubDate></item><item><title>东阳光：第三季度实现营收52.97亿元，同比增长37.7%</title><description>36氪获悉，东阳光公告，第三季度实现营收52.97亿元…（摘要截断）</description><link>https://www.36kr.com/newsflashes/4036985032921987</link><pubDate>Thu, 22 Oct 2026 12:50:20 GMT</pubDate></item></channel></rss>`;
const rsshubGeekparkXml = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel><title>AI新浪潮观察 | 极客公园</title><link>https://geekpark.net/column/304</link><atom:link href="https://signal-map-rsshub-323338-4-1408253594.sh.run.tcloudbase.com/geekpark/304?limit=5" rel="self" type="application/rss+xml"></atom:link><description>极客公园AI系列文章 - Powered by RSSHub</description><lastBuildDate>Thu, 22 Oct 2026 21:04:08 GMT</lastBuildDate><ttl>60</ttl><item><title>宇树 10 周年，王兴兴：我劝你相信 AI</title><description>&lt;figure&gt;&lt;img src=&quot;https://imgslim.geekpark.net/uploads/image/file/d3/02/d302.png&quot;/&gt;&lt;/figure&gt;&lt;p&gt;（摘要截断）&lt;/p&gt;</description><link>https://geekpark.net/news/372759</link><pubDate>Thu, 22 Oct 2026 11:56:03 GMT</pubDate></item><item><title>AI 漫剧越做越快，赚钱却没那么容易了</title><description>&lt;p&gt;（摘要截断）&lt;/p&gt;</description><link>https://geekpark.net/news/372746</link><pubDate>Thu, 22 Oct 2026 08:20:34 GMT</pubDate></item><item><title>大模型内卷之后，AI 竞争进入搜索基础设施时代</title><description>&lt;p&gt;（摘要截断）&lt;/p&gt;</description><link>https://geekpark.net/news/372743</link><pubDate>Thu, 22 Oct 2026 08:15:50 GMT</pubDate></item></channel></rss>`;
process.env.RSSHUB_BASE_URL = "https://relay.test";
test.after(() => { delete process.env.RSSHUB_BASE_URL; });
const rsshubFeed = (id: string) => rsshubRelayFeeds().feeds.find(feed => feed.id === id)!;

test("RSSHub pilot feeds enter the catalogue as media with publisher hosts and no topic broadening", () => {
  assert.equal(registeredFeeds.length, 18, "static catalogue stays configuration-free (geekpark official RSS included)");
  assert.equal(rsshubRelayFeeds().feeds.length, 1, "only the 36kr relay remains configuration-gated");
  const kr = rsshubFeed("36kr-flashes");
  assert.equal(kr.url, "https://relay.test/36kr/newsflashes?limit=5");
  assert.deepEqual(kr.publisherHosts, ["36kr.com"], "publisher hosts stay with the publisher, never the relay host");
  assert.equal(kr.official, false, "a relayed media feed is never an official source");
  assert.equal(kr.cloudVerified, true, "transport was verified from the API runtime, nothing more");
  assert.deepEqual(kr.topics, [], "the trial feed must not broaden subject selection");
  const gp = registeredFeeds.find(feed => feed.id === "geekpark-news")!;
  assert.equal(gp.url, "https://www.geekpark.net/rss", "geekpark official RSS is a static catalogue entry");
  assert.equal(gp.official, false);
  assert.equal(gp.cloudVerified, true);
  assert.deepEqual(gp.topics, []);
  assert.deepEqual(selectRegisteredFeeds({entities: [], query: "未归类的面包配方"}).map(feed => feed.id), [], "the additions are not default sources");
});

test("named publishers select their RSSHub feed; official-only and explicit exclusion keep it unread", async () => {
  assert.deepEqual(selectRegisteredFeeds({entities: ["36氪"], query: ""}).map(feed => feed.id), ["36kr-flashes"]);
  assert.deepEqual(selectRegisteredFeeds({entities: [], query: "36kr 今天有什么新变化"}).map(feed => feed.id), ["36kr-flashes"]);
  assert.deepEqual(selectRegisteredFeeds({entities: ["极客公园"], query: ""}).map(feed => feed.id), ["geekpark-news"]);
  assert.deepEqual(selectRegisteredFeeds({entities: ["36氪", "极客公园"], query: ""}).map(feed => feed.id), ["geekpark-news", "36kr-flashes"]);
  assert.deepEqual(selectRegisteredFeeds({entities: ["36氪", "极客公园"], query: "", selectedSourceType: "OFFICIAL"}), [], "media feeds never satisfy an official-only request");
  let reads = 0;
  const reader: typeof readCustomSource = async url => {reads++; return {url, status: "readable", reason: "fixture", requestCount: 1, content: rsshub36krXml};};
  const excluded = await retrieveRegisteredFeeds({entities: ["36氪"], query: "", allowed: true, reader, excludedEntities: ["36氪"]});
  assert.equal(reads, 0, "an excluded publisher's feed must not be fetched at all");
  assert.equal(excluded.items.length, 0);
  assert.equal(excluded.outcomes[0].execution, "not_searched");
  assert.equal(excluded.outcomes[0].blockedBy, "no_candidate_source");
});

test("RSSHub bodies keep original article URLs, dates and publisher identity", () => {
  const kr = rsshubFeed("36kr-flashes");
  const parsed = parseRegisteredFeed(rsshub36krXml, kr);
  assert.equal(parsed.rawCount, 3);
  assert.deepEqual(parsed.entries.map(entry => entry.url), [
    "https://www.36kr.com/newsflashes/4036991939826561",
    "https://www.36kr.com/newsflashes/4037043141661831",
    "https://www.36kr.com/newsflashes/4036985032921987",
  ]);
  assert.deepEqual(parsed.entries.map(entry => entry.publishedAt), [
    "2026-10-22T12:57:24.000Z",
    "2026-10-22T12:52:38.000Z",
    "2026-10-22T12:50:20.000Z",
  ]);
  assert.equal(parsed.entries[0].title, "沃尔沃集团宣布设立Volvo Mining");
  const gp = registeredFeeds.find(feed => feed.id === "geekpark-news")!;
  const gpParsed = parseRegisteredFeed(rsshubGeekparkXml, gp);
  assert.equal(gpParsed.rawCount, 3);
  assert.equal(gpParsed.entries[0].publishedAt, "2026-10-22T11:56:03.000Z");
  assert.equal(gpParsed.entries[0].title, "宇树 10 周年，王兴兴：我劝你相信 AI");
  assert.ok(!gpParsed.entries[0].snippet.includes("&lt;"), "escaped markup is decoded once, not left as entities");
  assert.ok(gpParsed.entries[0].snippet.includes("（摘要截断）"));
});

test("RSSHub duplicates, foreign hosts and unsafe documents are rejected before candidates exist", () => {
  const kr = rsshubFeed("36kr-flashes");
  const duplicated = rsshub36krXml.replace("</channel>", `<item><title>沃尔沃集团宣布设立Volvo Mining</title><link>https://www.36kr.com/newsflashes/4036991939826561#ref</link></item></channel>`);
  const parsed = parseRegisteredFeed(duplicated, kr);
  assert.equal(parsed.rawCount, 4);
  assert.equal(parsed.entries.length, 3, "the same article URL must not create a second candidate");
  const throughRssHub = rsshub36krXml.replace("https://www.36kr.com/newsflashes/4036991939826561", "https://signal-map-rsshub-323338-4-1408253594.sh.run.tcloudbase.com/36kr/newsflashes/4036991939826561");
  const filtered = parseRegisteredFeed(throughRssHub, kr);
  assert.equal(filtered.entries.length, 2, "a link on the relay host is not the publisher's article");
  assert.ok(filtered.entries.every(entry => new URL(entry.url).hostname.endsWith("36kr.com")));
  assert.throws(() => parseRegisteredFeed(`<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>${rsshub36krXml}`, kr), /FEED_UNSAFE_XML/);
  const credentialed = rsshub36krXml.replace("https://www.36kr.com/newsflashes/4036991939826561", "https://user:pass@www.36kr.com/newsflashes/4036991939826561");
  assert.equal(parseRegisteredFeed(credentialed, kr).entries.length, 2, "credentials in an article URL are never accepted");
});

test("RSSHub candidates stay industry media and a failed feed never reads as empty results", async () => {
  const reader: typeof readCustomSource = async url => ({url, status: "readable", reason: "fixture", requestCount: 1, content: url.includes("36kr") ? rsshub36krXml : rsshubGeekparkXml});
  const both = await retrieveRegisteredFeeds({entities: ["36氪", "极客公园"], query: "", allowed: true, reader});
  assert.equal(both.items.length, 6);
  assert.ok(both.items.every(item => item.sourceType === "industry_media" && item.origin === "news" && item.authority === 60 && item.channel === "社区"));
  assert.ok(both.items.every(item => item.dataOrigin === "live" && item.providerId === "registered-feeds"));
  assert.equal(both.items.filter(item => new URL(item.url).hostname.endsWith("36kr.com")).length, 3);
  assert.equal(both.items.filter(item => new URL(item.url).hostname.endsWith("geekpark.net")).length, 3);
  assert.deepEqual(both.failures, []);
  const failed = await retrieveRegisteredFeeds({entities: ["36氪"], query: "", allowed: true, reader: async url => ({url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1})});
  assert.equal(failed.items.length, 0);
  assert.equal(failed.outcomes[0].execution, "failed", "a transport failure is never recorded as an empty result");
  assert.equal(failed.outcomes[0].sourceId, "36kr-flashes");
  assert.match(failed.failures[0], /FEED_TIMEOUT/);
  const empty = await retrieveRegisteredFeeds({entities: ["36氪"], query: "", allowed: true, reader: async url => ({url, status: "readable", reason: "read", requestCount: 1, content: "<rss><channel></channel></rss>"})});
  assert.equal(empty.outcomes[0].execution, "searched_no_results");
  assert.deepEqual(empty.failures, [], "a healthy empty feed is not a failure");
});

test("RSSHub media feed flows through the existing pipeline gates and freshness screening", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response("<rss><channel></channel></rss>", {status: 200});
  try {
    const reads: string[] = [];
    const question = {queries: ["36氪快讯近期有哪些变化"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "INDEPENDENT_MEDIA"};
    const entityInput = {...input, trackedEntities: "36氪", industry: "科技媒体", focusAreas: "36氪快讯", currentQuestions: "36氪快讯近期有哪些变化"};
    const result = await runResearchPipeline(entityInput, undefined, {
      customSourceReader: async url => {reads.push(url); return {url, status: "readable", reason: "fixture", requestCount: 1, content: rsshub36krXml};},
    }, question);
    assert.deepEqual(reads, [rsshubFeed("36kr-flashes").url], "only the named publisher feed is fetched");
    const outcome = result.coverage.outcomes.find(item => item.providerId === "registered-feeds")!;
    assert.equal(outcome.rawResultCount, 3);
    assert.equal(outcome.normalizedCandidateCount, 3);
    assert.equal(outcome.execution, "searched_with_results");
    const stale = rsshub36krXml.replace(/<pubDate>[^<]+<\/pubDate>/g, new Date(Date.now() - 400 * 86400_000).toUTCString());
    const staleRun = await runResearchPipeline(entityInput, undefined, {
      customSourceReader: async url => ({url, status: "readable", reason: "fixture", requestCount: 1, content: stale}),
    }, question);
    assert.equal(staleRun.signals.length, 0, "stale entries from the pilot feed must not become research signals");
  } finally { globalThis.fetch = before; }
});

test("feed failures preserve safe detailed codes through search phase diagnostics", async () => {
  for (const [reason, expected] of [["FEED_PRIVATE_ADDRESS", "FEED_PRIVATE_ADDRESS"], ["FEED_TIMEOUT", "FEED_TIMEOUT"], ["FEED_HTTP_503", "FEED_HTTP_503"], ["https://user:password@example.com/?token=secret", "FEED_READ_FAILED"]]) {
    const phases: Array<{phase: string; diagnostic?: Record<string, unknown>}> = [];
    const result = await runResearchPipeline(input, undefined, {
      deadlineAt: Date.now() + 20000,
      onPhase: phase => { phases.push(phase); },
      customSourceReader: async url => ({url, status: "failed", reason, requestCount: reason === "FEED_PRIVATE_ADDRESS" ? 0 : 1}),
    }, {queries: ["Shopify checkout payment"], allowedProviderIds: ["registered-feeds"], selectedSourceType: "OFFICIAL"});
    const outcome = result.coverage.outcomes.find(o => o.providerId === "registered-feeds")!;
    assert.equal((outcome as unknown as {detailFailureCode: string}).detailFailureCode, expected);
    const diagnostic = phases.find(p => p.phase === "search_finished")?.diagnostic;
    const providers = diagnostic?.providerOutcomes as Array<{providerId?: string; sourceId?: string; detailFailureCode?: string}>;
    const feedOutcome = providers.find(provider => provider.providerId === "registered-feeds");
    assert.equal(feedOutcome?.detailFailureCode, expected);
    assert.equal(feedOutcome?.sourceId, "shopify");
    assert.ok(!JSON.stringify(diagnostic).includes("token=secret"));
  }
});

// --- STEP 3: one failing feed must not suppress another feed's readable items ---

const DOMESTIC_AI_QUESTION = "过去 7 天，36氪快讯和极客公园 AI 报道了哪些国内 AI 产业新进展？";

function geekparkFeed(count: number) {
  const items = Array.from({ length: count }, (_, index) =>
    `<item><title>国内AI产品进展 ${index + 1}</title><link>https://www.geekpark.net/news/ai-${index + 1}</link>` +
    `<pubDate>${publishedAt}</pubDate><description>国内企业发布人工智能产品的新进展。</description></item>`).join("");
  return `<rss><channel>${items}</channel></rss>`;
}

async function withRelayEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const keys = ["RSSHUB_BASE_URL", "RSSHUB_ACCESS_KEY"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a failing 36kr relay keeps the readable geekpark feed and its items", async () => {
  await withRelayEnv({ RSSHUB_BASE_URL: "https://relay.example.com", RSSHUB_ACCESS_KEY: "test-only-relay-key" }, async () => {
    const reader: typeof readCustomSource = async (url) => {
      if (url.includes("/36kr/")) return { url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1 };
      return { url, status: "readable", reason: "read", requestCount: 1, content: geekparkFeed(2) };
    };

    const result = await retrieveRegisteredFeeds({ entities: [], query: DOMESTIC_AI_QUESTION, allowed: true, reader });
    const geekpark = result.outcomes.find((outcome) => outcome.sourceId === "geekpark-news");
    const kr36 = result.outcomes.find((outcome) => outcome.sourceId === "36kr-flashes");
    assert.ok(geekpark && kr36, `outcomes: ${result.outcomes.map((outcome) => outcome.sourceId).join(",")}`);

    // The healthy source keeps reading and keeps its items.
    assert.equal(geekpark.execution, "searched_with_results");
    assert.equal(geekpark.resultCount, 2);
    // The failing source keeps its own failure state and is never relabelled.
    assert.equal(kr36.execution, "failed");
    assert.equal(kr36.failureCode, "upstream_error");
    assert.equal(kr36.detailFailureCode, "FEED_TIMEOUT");
    assert.equal(kr36.searched, true);
    assert.equal(kr36.resultCount, 0);

    // Items come only from the readable source; a failure never pads the count.
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((item) => item.source.includes("极客公园")));
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /36氪/);
  });
});

test("an unconfigured relay is not_configured, never a fabricated success", async () => {
  await withRelayEnv({ RSSHUB_BASE_URL: undefined, RSSHUB_ACCESS_KEY: undefined }, async () => {
    const reader: typeof readCustomSource = async (url) => ({ url, status: "readable", reason: "read", requestCount: 1, content: geekparkFeed(1) });
    const result = await retrieveRegisteredFeeds({ entities: [], query: DOMESTIC_AI_QUESTION, allowed: true, reader });

    const kr36 = result.outcomes.find((outcome) => outcome.sourceId === "36kr-flashes");
    assert.ok(kr36, `outcomes: ${result.outcomes.map((outcome) => outcome.sourceId).join(",")}`);
    assert.equal(kr36.execution, "not_configured");
    assert.equal(kr36.searched, false);
    assert.equal(kr36.resultCount, 0);
    assert.equal(result.items.length, 1);
  });
});

test("a readable but empty feed stays searched_no_results, distinct from failure", async () => {
  await withRelayEnv({ RSSHUB_BASE_URL: "https://relay.example.com", RSSHUB_ACCESS_KEY: "test-only-relay-key" }, async () => {
    const reader: typeof readCustomSource = async (url) => {
      if (url.includes("/36kr/")) return { url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1 };
      return { url, status: "readable", reason: "read", requestCount: 1, content: "<rss><channel></channel></rss>" };
    };
    const result = await retrieveRegisteredFeeds({ entities: [], query: DOMESTIC_AI_QUESTION, allowed: true, reader });

    const geekpark = result.outcomes.find((outcome) => outcome.sourceId === "geekpark-news");
    assert.ok(geekpark);
    assert.equal(geekpark.execution, "searched_no_results");
    assert.equal(geekpark.searched, true);
    assert.equal(geekpark.resultCount, 0);
    // No card is invented to compensate for either source.
    assert.equal(result.items.length, 0);
  });
});

// --- No source-count cap: every matching publisher must be selected and read ---

const MULTI_PUBLISHER_QUESTION = "Kdenlive、OBS、Krita、Node.js 和 Shopify 近期有哪些正式更新？";
const MULTI_PUBLISHER_IDS = ["kdenlive", "nodejs", "obs", "shopify", "krita"];

function feedForHost(url: string) {
  const host = new URL(url).hostname;
  return `<rss><channel><item><title>${host} official update</title>` +
    `<link>https://${host}/post/release-1</link><pubDate>${publishedAt}</pubDate>` +
    `<description>Official release announcement for this publisher.</description></item></channel></rss>`;
}

test("every matching publisher is selected, not only the first three", () => {
  const selected = selectRegisteredFeeds({ entities: [], query: MULTI_PUBLISHER_QUESTION }).map((feed) => feed.id);
  assert.deepEqual([...selected].sort(), [...MULTI_PUBLISHER_IDS].sort(), `selected: ${selected.join(",")}`);
});

test("the fourth and later selected feeds still execute and report their own outcome", async () => {
  const reader: typeof readCustomSource = async (url) => ({
    url, status: "readable", reason: "read", requestCount: 1, content: feedForHost(url),
  });
  const result = await retrieveRegisteredFeeds({
    entities: [], query: MULTI_PUBLISHER_QUESTION, allowed: true, reader,
  });

  const executed = result.outcomes.map((outcome) => outcome.sourceId).filter(Boolean) as string[];
  for (const id of MULTI_PUBLISHER_IDS) {
    assert.ok(executed.includes(id), `missing outcome for ${id}; executed: ${executed.join(",")}`);
    const outcome = result.outcomes.find((entry) => entry.sourceId === id);
    assert.equal(outcome?.execution, "searched_with_results", id);
    assert.equal(outcome?.resultCount, 1, id);
  }
  // One candidate per publisher: the extra feeds are not silently dropped.
  assert.equal(result.items.length, MULTI_PUBLISHER_IDS.length);
  const hosts = new Set(result.items.map((item) => new URL(item.url).hostname));
  assert.equal(hosts.size, MULTI_PUBLISHER_IDS.length);
});

test("dropping the cap still keeps unrelated, excluded and unconfigured sources out", async () => {
  assert.deepEqual(selectRegisteredFeeds({ entities: [], query: "面包配方" }).map((feed) => feed.id), []);

  const excluded = selectRegisteredFeeds({
    entities: [], query: MULTI_PUBLISHER_QUESTION, excludedEntities: ["Shopify"],
  }).map((feed) => feed.id);
  assert.equal(excluded.includes("shopify"), false, `selected: ${excluded.join(",")}`);
  assert.ok(excluded.includes("kdenlive"), "an unrelated exclusion must not remove other publishers");

  await withRelayEnv({ RSSHUB_BASE_URL: undefined, RSSHUB_ACCESS_KEY: undefined }, async () => {
    const selected = selectRegisteredFeeds({ entities: [], query: "36氪快讯和极客公园的国内 AI 报道" }).map((feed) => feed.id);
    assert.equal(selected.includes("36kr-flashes"), false, "an unconfigured relay must never be selected");
  });
});
