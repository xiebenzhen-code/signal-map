import assert from "node:assert/strict";
import test from "node:test";

import { rsshubRelayFeeds, disabledRsshubFeeds, selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
import { retrieveRegisteredFeeds } from "../research/registered-feeds.ts";
import type { readCustomSource } from "../source-enrichment/custom-source.ts";

const QUERY = { entities: [], query: "过去7天，36氪快讯和极客公园 AI 报道了哪些国内 AI 产业新进展？" };

const readableXml = (host: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>relay</title><item><title>一条真实快讯标题</title><link>https://${host}/news/1</link><pubDate>Sat, 24 Oct 2026 04:14:58 GMT</pubDate><description>${"内容摘要。".repeat(40)}</description></item></channel></rss>`;

type ReaderOptions = {relayAuth?: {origin: string; name: string; value: string}; forbidCrossOriginRedirects?: boolean};
type Reader = typeof readCustomSource;

// --- P2-E/P2-F/P2-G/P2-H (2026-10-24): the RSSHub relay base URL and access key are
// deployment configuration. Routes are fixed constants; missing or insecure
// configuration disables the relays with an explicit not_configured report. The key
// rides the X-Relay-Key header on same-origin hops only — never the URL, never a
// cross-origin redirect target, never an outcome. ---

test("missing base disables the relays with missing_base", () => {
  const status = rsshubRelayFeeds({} as never);
  assert.equal(status.reason, "missing_base");
  assert.deepEqual(status.feeds, []);
});

test("non-URL or non-https base is rejected as insecure_base", () => {
  for (const base of ["http://rsshub.example", "ftp://rsshub.example", "rsshub.example/"]) {
    const status = rsshubRelayFeeds({RSSHUB_BASE_URL: base} as never);
    assert.equal(status.reason, "insecure_base", base);
    assert.deepEqual(status.feeds, [], base);
  }
});

test("https base builds the two fixed routes; the key rides relayAuth, never the URL", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example", RSSHUB_ACCESS_KEY: "s3cret key/+:&"} as never);
  assert.equal(status.reason, null);
  assert.equal(status.feeds.length, 2);
  const kr = status.feeds.find(feed => feed.id === "36kr-flashes")!;
  const gp = status.feeds.find(feed => feed.id === "geekpark-ai")!;
  assert.equal(kr.url, "https://rsshub.example/36kr/newsflashes?limit=5");
  assert.equal(gp.url, "https://rsshub.example/geekpark/304?limit=5");
  assert.deepEqual(kr.relayAuth, {origin: "https://rsshub.example", name: "X-Relay-Key", value: "s3cret key/+:&"});
  assert.ok(!JSON.stringify(status.feeds.map(feed => feed.url)).includes("key="));
  assert.deepEqual(kr.publisherHosts, ["36kr.com"]);
  assert.deepEqual(kr.topics, [], "relays never enter subject-based selection");
});

test("trailing slash on the base is normalized; no key means no relayAuth at all", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example/"} as never);
  const kr = status.feeds.find(feed => feed.id === "36kr-flashes")!;
  assert.equal(status.reason, null);
  assert.equal(kr.url, "https://rsshub.example/36kr/newsflashes?limit=5");
  assert.equal(kr.relayAuth, undefined);
});

test("base with user information, path, query, or fragment is rejected as base_not_origin", () => {
  for (const base of [
    "https://user:pass@rsshub.example",
    "https://rsshub.example/relay",
    "https://rsshub.example/relay/",
    "https://rsshub.example/?x=1",
    "https://rsshub.example/#frag",
    "https://rsshub.example//",
  ]) {
    const status = rsshubRelayFeeds({RSSHUB_BASE_URL: base, RSSHUB_ACCESS_KEY: "K"} as never);
    assert.equal(status.reason, "base_not_origin", base);
    assert.deepEqual(status.feeds, [], base);
  }
});

test("production refuses to enable the relays without an access key", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example", NODE_ENV: "production"} as never);
  assert.equal(status.reason, "missing_key");
  assert.deepEqual(status.feeds, []);
  const dev = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example"} as never);
  assert.equal(dev.reason, null, "non-production may run keyless against a private relay");
});

test("without configuration the relays are absent from selection and reported disabled", () => {
  const env = {} as never;
  const feeds = selectRegisteredFeeds(QUERY, env);
  assert.equal(feeds.some(feed => feed.id === "36kr-flashes"), false);
  const disabled = disabledRsshubFeeds(QUERY, env);
  assert.equal(disabled.length, 2);
  assert.equal(disabled[0]!.reason, "missing_base");
});

test("with configuration alias selection picks the relay; the URL stays key-free", () => {
  const env = {RSSHUB_BASE_URL: "https://rsshub.example", RSSHUB_ACCESS_KEY: "K1"} as never;
  const feeds = selectRegisteredFeeds(QUERY, env);
  const kr = feeds.find(feed => feed.id === "36kr-flashes")!;
  assert.equal(kr.url, "https://rsshub.example/36kr/newsflashes?limit=5");
  assert.equal(kr.relayAuth!.value, "K1");
  assert.ok(!kr.url.includes("K1"));
});

test("a question that never mentions the relays gets no not_configured noise", () => {
  const disabled = disabledRsshubFeeds({entities: [], query: "kdenlive 最近有什么新版本？"}, {} as never);
  assert.deepEqual(disabled, []);
});

test("retrieve reports not_configured relays honestly and fetches nothing", async () => {
  const savedBase = process.env.RSSHUB_BASE_URL;
  const savedKey = process.env.RSSHUB_ACCESS_KEY;
  delete process.env.RSSHUB_BASE_URL;
  delete process.env.RSSHUB_ACCESS_KEY;
  let fetches = 0;
  const reader = async (url: string) => {
    fetches++;
    return {url, status: "readable" as const, reason: "ok", content: readableXml("36kr.com"), requestCount: 1};
  };
  try {
    const run = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader: reader as never});
    const outcome = run.outcomes.find(o => o.sourceId === "36kr-flashes")!;
    assert.equal(outcome.execution, "not_configured");
    assert.equal(outcome.detailFailureCode, "FEED_RSSHUB_MISSING_BASE");
    assert.equal(fetches, 0, "nothing fetched for an unconfigured relay");
  } finally {
    if (savedBase === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = savedBase;
    if (savedKey === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = savedKey;
  }
});

test("missing key in production disables relays and reports FEED_RSSHUB_MISSING_KEY", async () => {
  const saved = {NODE_ENV: process.env.NODE_ENV, B: process.env.RSSHUB_BASE_URL, K: process.env.RSSHUB_ACCESS_KEY};
  delete process.env.RSSHUB_BASE_URL;
  delete process.env.RSSHUB_ACCESS_KEY;
  Object.assign(process.env, {NODE_ENV: "production", RSSHUB_BASE_URL: "https://rsshub.example"});
  let fetches = 0;
  const reader: Reader = (async (url: string) => {
    fetches++;
    return {url, status: "readable", reason: "fixture", requestCount: 1, content: readableXml("36kr.com")};
  }) as never;
  try {
    const run = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader});
    const outcome = run.outcomes.find(o => o.sourceId === "36kr-flashes")!;
    assert.equal(outcome.execution, "not_configured");
    assert.equal(outcome.detailFailureCode, "FEED_RSSHUB_MISSING_KEY");
    assert.equal(fetches, 0, "a production relay without a key never fetches");
    assert.ok(!JSON.stringify(run.outcomes).includes("rsshub.example"));
  } finally {
    if (saved.NODE_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
    if (saved.B === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = saved.B;
    if (saved.K === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = saved.K;
  }
});

test("retrieve sends the relay key as a same-origin header and leaks it nowhere", async () => {
  const savedBase = process.env.RSSHUB_BASE_URL;
  const savedKey = process.env.RSSHUB_ACCESS_KEY;
  delete process.env.RSSHUB_BASE_URL;
  delete process.env.RSSHUB_ACCESS_KEY;
  const seenUrls: string[] = [];
  const seenOptions: ReaderOptions[] = [];
  const reader = (async (url: string, options?: ReaderOptions) => {
    seenUrls.push(url);
    seenOptions.push(options ?? {});
    return {url, status: "readable" as const, reason: "ok", content: readableXml("36kr.com"), requestCount: 1};
  }) as never;
  try {
    process.env.RSSHUB_BASE_URL = "https://rsshub.example";
    process.env.RSSHUB_ACCESS_KEY = "SECRET123";
    const run = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader});
    assert.ok(seenUrls.includes("https://rsshub.example/36kr/newsflashes?limit=5"), "reader received the key-free relay url");
    assert.ok(!seenUrls.some(url => url.includes("SECRET123") || url.includes("key=")), "no URL ever carries the key");
    const relayOptions = seenOptions.find(options => options.relayAuth);
    assert.ok(relayOptions, "relay read carries relayAuth");
    assert.equal(relayOptions!.relayAuth!.name, "X-Relay-Key");
    assert.equal(relayOptions!.relayAuth!.value, "SECRET123");
    assert.equal(relayOptions!.relayAuth!.origin, "https://rsshub.example");
    assert.equal(relayOptions!.forbidCrossOriginRedirects, true, "relays refuse cross-origin redirects");
    const serialized = JSON.stringify({outcomes: run.outcomes, items: run.items, failures: run.failures});
    assert.ok(!serialized.includes("SECRET123"), "no outcome, candidate, or failure carries the key");
    assert.ok(!serialized.includes("X-Relay-Key"), "the header name stays internal");
    assert.ok(run.items.every(item => !item.url.includes("rsshub.example")), "candidates carry upstream article urls, never the relay url");
    assert.equal(run.outcomes.find(outcome => outcome.sourceId === "36kr-flashes")!.execution, "searched_with_results");
  } finally {
    if (savedBase === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = savedBase;
    if (savedKey === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = savedKey;
  }
});

test("relay timeouts and cache behavior keep failure codes fixed and leak nothing", async () => {
  const saved = {B: process.env.RSSHUB_BASE_URL, K: process.env.RSSHUB_ACCESS_KEY};
  process.env.RSSHUB_BASE_URL = "https://rsshub.example";
  process.env.RSSHUB_ACCESS_KEY = "SECRET9";
  let calls = 0;
  const timingOut: Reader = (async (url: string) => {
    calls++;
    return {url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1};
  }) as never;
  const cache = new Map();
  try {
    const first = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader: timingOut, cache});
    const outcome = first.outcomes.find(o => o.sourceId === "36kr-flashes")!;
    assert.equal(outcome.execution, "failed");
    assert.equal(outcome.detailFailureCode, "FEED_TIMEOUT");
    assert.ok(first.failures.some(f => f.includes("FEED_TIMEOUT")), "the fixed code reaches the failure list");
    const second = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader: timingOut, cache});
    const cachedOutcome = second.outcomes.find(o => o.sourceId === "36kr-flashes")!;
    assert.equal(calls, 2, "cache is keyed per run, both rounds hit the reader once each");
    assert.ok(!JSON.stringify({outcomes: second.outcomes, failures: second.failures}).includes("SECRET9"), "cache reuse leaks no key");
  } finally {
    if (saved.B === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = saved.B;
    if (saved.K === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = saved.K;
  }
});

test("the cache key is the key-free URL, so credentials never enter cache keys", async () => {
  const saved = {B: process.env.RSSHUB_BASE_URL, K: process.env.RSSHUB_ACCESS_KEY};
  process.env.RSSHUB_BASE_URL = "https://rsshub.example";
  process.env.RSSHUB_ACCESS_KEY = "SECRET9";
  const cache = new Map();
  const reader = (async (url: string) => ({url, status: "readable" as const, reason: "ok", content: readableXml("36kr.com"), requestCount: 1})) as never;
  try {
    await retrieveRegisteredFeeds({...QUERY, allowed: true, reader, cache});
    for (const key of cache.keys()) {
      assert.equal(typeof key, "string");
      assert.ok(!(key as string).includes("SECRET9"), `cache key is credential-free: ${String(key).slice(0, 60)}`);
    }
  } finally {
    if (saved.B === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = saved.B;
    if (saved.K === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = saved.K;
  }
});

test("relay reads refuse cross-origin redirects before any second hop", async () => {
  const { readCustomSource } = await import("../source-enrichment/custom-source.ts");
  const seen: string[] = [];
  const request = async (url: URL) => {
    seen.push(url.href);
    return {status: 302, headers: {location: "https://attacker.example/collect"}, body: ""};
  };
  const lookup = async (host: string) => [{address: host === "attacker.example" ? "104.20.23.154" : "93.184.216.34", family: 4}];
  const result = await readCustomSource("https://rsshub.example/36kr/newsflashes?limit=5", {
    lookup, request, relayAuth: {origin: "https://rsshub.example", name: "X-Relay-Key", value: "SECRET9"}, forbidCrossOriginRedirects: true,
  } as never);
  assert.equal(result.status, "blocked", "cross-origin redirect is refused, not followed");
  assert.equal(result.reason, "FEED_CROSS_ORIGIN_REDIRECT");
  assert.equal(seen.length, 1, "no second hop is ever attempted");
  assert.ok(!seen[0]!.includes("SECRET9"), "the credential never appears in any URL");
});

test("non-relay reads still follow public cross-origin redirects without a credential", async () => {
  const { readCustomSource } = await import("../source-enrichment/custom-source.ts");
  const seen: string[] = [];
  const request = async (url: URL) => {
    seen.push(url.href);
    if (url.href.includes("rsshub.example")) return {status: 302, headers: {location: "https://mirror.example/feed"}, body: ""};
    return {status: 200, headers: {"content-type": "text/html"}, body: readableXml("mirror.example")};
  };
  const lookup = async (host: string) => [{address: host === "mirror.example" ? "104.20.23.154" : "93.184.216.34", family: 4}];
  const result = await readCustomSource("https://rsshub.example/36kr/newsflashes?limit=5", {lookup, request} as never);
  assert.equal(result.status, "readable", "generic reads keep following public redirects");
  assert.equal(seen.length, 2);
  assert.equal(seen[1], "https://mirror.example/feed");
});

test("the auth header is attached on same-origin hops inside the reader", async () => {
  const { readCustomSource } = await import("../source-enrichment/custom-source.ts");
  const headerLog: Array<{origin: string; header?: string}> = [];
  const request = async (url: URL, _address: unknown, _signal: unknown, headers?: Record<string, string>) => {
    headerLog.push({origin: url.origin, header: headers?.["X-Relay-Key"]});
    if (url.pathname.startsWith("/36kr")) return {status: 302, headers: {location: "https://rsshub.example/moved"}, body: ""};
    return {status: 200, headers: {"content-type": "text/html"}, body: readableXml("rsshub.example")};
  };
  const lookup = async () => [{address: "93.184.216.34", family: 4}];
  // Same-origin redirect stays allowed for relays, and BOTH hops carry the header.
  const result = await readCustomSource("https://rsshub.example/36kr/newsflashes?limit=5", {
    lookup, request, relayAuth: {origin: "https://rsshub.example", name: "X-Relay-Key", value: "SECRET9"},
  } as never);
  assert.equal(result.status, "readable");
  assert.equal(headerLog.length, 2);
  assert.deepEqual(headerLog, [
    {origin: "https://rsshub.example", header: "SECRET9"},
    {origin: "https://rsshub.example", header: "SECRET9"},
  ], "same-origin hops keep the header");
});
