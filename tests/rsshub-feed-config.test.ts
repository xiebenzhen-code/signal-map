import assert from "node:assert/strict";
import test from "node:test";

import { rsshubRelayFeeds, disabledRsshubFeeds, selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
import { retrieveRegisteredFeeds } from "../research/registered-feeds.ts";
import type { readCustomSource } from "../source-enrichment/custom-source.ts";

const QUERY = { entities: [], query: "过去7天，36氪快讯和极客公园 AI 报道了哪些国内 AI 产业新进展？" };

const readableXml = (host: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>relay</title><item><title>一条真实快讯标题</title><link>https://${host}/news/1</link><pubDate>Sat, 24 Oct 2026 04:14:58 GMT</pubDate><description>${"内容摘要。".repeat(40)}</description></item></channel></rss>`;

// --- P2-E/P2-F (2026-10-24): the RSSHub relay base URL and access key are deployment
// configuration. Routes are fixed constants; missing or insecure configuration disables
// the relays with an explicit not_configured report instead of a fabricated fetch. ---

test("missing base disables the relays with missing_base", () => {
  const status = rsshubRelayFeeds({} as never);
  assert.equal(status.reason, "missing_base");
  assert.deepEqual(status.feeds, []);
});

test("non-https base is rejected as insecure_base", () => {
  for (const base of ["http://rsshub.example", "ftp://rsshub.example", "rsshub.example/"]) {
    const status = rsshubRelayFeeds({RSSHUB_BASE_URL: base} as never);
    assert.equal(status.reason, "insecure_base", base);
    assert.deepEqual(status.feeds, [], base);
  }
});

test("https base builds exactly the two fixed routes with the key appended", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example", RSSHUB_ACCESS_KEY: "s3cret key/+:&"} as never);
  assert.equal(status.reason, null);
  assert.equal(status.feeds.length, 2);
  const kr = status.feeds.find(feed => feed.id === "36kr-flashes")!;
  const gp = status.feeds.find(feed => feed.id === "geekpark-ai")!;
  assert.equal(kr.url, `https://rsshub.example/36kr/newsflashes?limit=5&key=${encodeURIComponent("s3cret key/+:&")}`);
  assert.equal(gp.url, `https://rsshub.example/geekpark/304?limit=5&key=${encodeURIComponent("s3cret key/+:&")}`);
  assert.deepEqual(kr.publisherHosts, ["36kr.com"]);
  assert.deepEqual(kr.topics, [], "relays never enter subject-based selection");
});

test("trailing slash on the base is normalized; no key means no key parameter", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example/"} as never);
  assert.equal(status.feeds.find(feed => feed.id === "36kr-flashes")!.url, "https://rsshub.example/36kr/newsflashes?limit=5");
});

test("without configuration the relays are absent from selection and reported disabled", () => {
  const env = {} as never;
  const feeds = selectRegisteredFeeds(QUERY, env);
  assert.equal(feeds.some(feed => feed.id === "36kr-flashes"), false);
  const disabled = disabledRsshubFeeds(QUERY, env);
  assert.equal(disabled.length, 2);
  assert.equal(disabled[0]!.reason, "missing_base");
});

test("with configuration alias selection picks the relay with the built url", () => {
  const env = {RSSHUB_BASE_URL: "https://rsshub.example", RSSHUB_ACCESS_KEY: "K1"} as never;
  const feeds = selectRegisteredFeeds(QUERY, env);
  assert.ok(feeds.some(feed => feed.id === "36kr-flashes" && feed.url.endsWith("&key=K1")));
});

test("a question that never mentions the relays gets no not_configured noise", () => {
  const disabled = disabledRsshubFeeds({entities: [], query: "kdenlive 最近有什么新版本？"}, {} as never);
  assert.deepEqual(disabled, []);
});

test("retrieve reports not_configured relays honestly and leaks no key anywhere", async () => {
  const savedBase = process.env.RSSHUB_BASE_URL;
  const savedKey = process.env.RSSHUB_ACCESS_KEY;
  delete process.env.RSSHUB_BASE_URL;
  delete process.env.RSSHUB_ACCESS_KEY;
  const seenUrls: string[] = [];
  const reader = async (url: string) => {
    seenUrls.push(url);
    return {url, status: "readable" as const, reason: "ok", content: readableXml("36kr.com"), requestCount: 1};
  };
  const disabledRun = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader});
  const disabledOutcome = disabledRun.outcomes.find(outcome => outcome.sourceId === "36kr-flashes");
  assert.ok(disabledOutcome, "relay outcome present");
  assert.equal(disabledOutcome!.execution, "not_configured");
  assert.equal(disabledOutcome!.detailFailureCode, "FEED_RSSHUB_MISSING_BASE");
  assert.equal(seenUrls.length, 0, "nothing fetched for an unconfigured relay");

  process.env.RSSHUB_BASE_URL = "https://rsshub.example";
  process.env.RSSHUB_ACCESS_KEY = "SECRET123";
  try {
    const configuredRun = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader});
    assert.ok(seenUrls.some(url => url.includes("key=SECRET123")), "reader received the keyed url");
    const serialized = JSON.stringify({outcomes: configuredRun.outcomes, items: configuredRun.items, failures: configuredRun.failures});
    assert.ok(!serialized.includes("SECRET123"), "no outcome, candidate, or failure carries the key");
    assert.ok(!serialized.includes("key="), "no query-string key form is observable");
    assert.ok(configuredRun.items.every(item => !item.url.includes("rsshub.example")), "candidates carry upstream article urls, never the relay url");
    assert.equal(configuredRun.outcomes.find(outcome => outcome.sourceId === "36kr-flashes")!.execution, "searched_with_results");
  } finally {
    if (savedBase === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = savedBase;
    if (savedKey === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = savedKey;
  }
});

// --- P2-G (2026-10-24): strict origin parsing, production key policy, and
// cross-transport security behaviors for the relay configuration. ---

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

test("single trailing slash stays acceptable and normalizes to the origin", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example/", RSSHUB_ACCESS_KEY: "K"} as never);
  assert.equal(status.reason, null);
  assert.equal(status.feeds[0]!.url, "https://rsshub.example/36kr/newsflashes?limit=5&key=K");
});

test("production refuses to enable the relays without an access key", () => {
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example", NODE_ENV: "production"} as never);
  assert.equal(status.reason, "missing_key");
  assert.deepEqual(status.feeds, []);
  const dev = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example"} as never);
  assert.equal(dev.reason, null, "non-production may run keyless against a private relay");
});

test("missing key in production disables relays and reports FEED_RSSHUB_MISSING_KEY", async () => {
  const saved = {NODE_ENV: process.env.NODE_ENV, B: process.env.RSSHUB_BASE_URL, K: process.env.RSSHUB_ACCESS_KEY};
  delete process.env.RSSHUB_BASE_URL; delete process.env.RSSHUB_ACCESS_KEY;
  Object.assign(process.env, {NODE_ENV: "production", RSSHUB_BASE_URL: "https://rsshub.example"});
  let fetches = 0;
  const reader: typeof readCustomSource = async url => { fetches++; return {url, status: "readable", reason: "fixture", requestCount: 1, content: readableXml("36kr.com")}; };
  try {
    const run = await retrieveRegisteredFeeds({...QUERY, allowed: true, reader});
    const outcome = run.outcomes.find(o => o.sourceId === "36kr-flashes")!;
    assert.equal(outcome.execution, "not_configured");
    assert.equal(outcome.detailFailureCode, "FEED_RSSHUB_MISSING_KEY");
    assert.equal(fetches, 0, "a production relay without a key never fetches");
    assert.ok(!JSON.stringify(run.outcomes).includes("rsshub.example"));
  } finally {
    if (saved.NODE_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
    if (saved.B === undefined) delete process.env.RSSHUB_BASE_URL; else process.env.RSSHUB_BASE_URL = saved.B;
    if (saved.K === undefined) delete process.env.RSSHUB_ACCESS_KEY; else process.env.RSSHUB_ACCESS_KEY = saved.K;
  }
});

test("a redirect from the relay never carries the key to another origin", async () => {
  const seen: string[] = [];
  const request = async (url: URL) => {
    seen.push(url.href);
    if (url.href.includes("rsshub.example")) {
      return {status: 302, headers: {location: "https://attacker.example/collect"}, body: ""};
    }
    return {status: 200, headers: {"content-type": "text/html"}, body: readableXml("attacker.example")};
  };
  const lookup = async (host: string) => [{address: host === "attacker.example" ? "104.20.23.154" : "93.184.216.34", family: 4}];
  const { readCustomSource } = await import("../source-enrichment/custom-source.ts");
  const result = await readCustomSource("https://rsshub.example/36kr/newsflashes?limit=5&key=SECRET9", {lookup, request} as never);
  assert.equal(result.status, "readable", "the safe reader follows the public cross-origin hop");
  assert.equal(seen.length, 2);
  assert.equal(seen[1], "https://attacker.example/collect", "the hop URL is exactly the redirect target");
  assert.ok(!seen[1]!.includes("SECRET9"), "no key is ever carried to the redirect target");
  assert.ok(!seen[1]!.includes("key="), "no query-string key form survives the hop");
});

test("relay timeouts and cache behavior keep failure codes fixed and leak nothing", async () => {
  const saved = {B: process.env.RSSHUB_BASE_URL, K: process.env.RSSHUB_ACCESS_KEY};
  process.env.RSSHUB_BASE_URL = "https://rsshub.example";
  process.env.RSSHUB_ACCESS_KEY = "SECRET9";
  let calls = 0;
  const timingOut: typeof readCustomSource = async url => {
    calls++;
    return {url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1};
  };
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
