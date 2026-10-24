import assert from "node:assert/strict";
import test from "node:test";

import { rsshubRelayFeeds, disabledRsshubFeeds, selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
import { retrieveRegisteredFeeds } from "../research/registered-feeds.ts";

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
  for (const base of ["http://rsshub.example", "ftp://rsshub.example", "https:/broken"]) {
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
  const status = rsshubRelayFeeds({RSSHUB_BASE_URL: "https://rsshub.example//"} as never);
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
