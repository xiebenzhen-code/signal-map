import assert from "node:assert/strict";
import test from "node:test";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { retrieveRegisteredFeeds } from "../research/registered-feeds.ts";

const feedXml = (bytes: number) => {
  const filler = "<item><title>x</title><link>https://shopify.dev/changelog/filler</link></item>".repeat(1);
  const head = `<rss><channel><title>Shopify</title><item><title>Checkout payment update</title><link>https://shopify.dev/changelog/payment</link><pubDate>${new Date().toISOString()}</pubDate><description>Checkout payment API update for US merchants.</description></item>${filler}`;
  const tail = "</channel></rss>";
  const padding = " ".repeat(Math.max(0, bytes - head.length - tail.length));
  return head + padding + tail;
};

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("RED: a slow-but-healthy feed response must not be cut off at the reader's own cap", async () => {
  // Reproduces the production failure: shopify.dev's changelog feed is ~1.87 MB and
  // a full fetch takes seconds. A cap below the real transfer time reports a
  // transport failure for a source that was actually reachable.
  const started = Date.now();
  const result = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed",
    lookup: publicLookup,
    request: async (_url, _address, signal) => {
      // 6.5s of real transfer work, then a normal 200.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 6500);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })); });
      });
      return { status: 200, headers: { "content-type": "application/rss+xml" }, body: feedXml(60000) };
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, "readable", `slow feed was reported as ${result.status}: ${result.reason} (after ${elapsed}ms)`);
  assert.equal(result.requestCount, 1);
  assert.ok(elapsed >= 6500, `the reader must actually allow the transfer window, got ${elapsed}ms`);
});

test("RED: an exhausted budget must not be reported as an upstream failure", async () => {
  let reads = 0;
  const result = await retrieveRegisteredFeeds({
    entities: ["Shopify"], query: "", allowed: true,
    // What the run actually had left when the feed slice was dispatched.
    deadlineAt: Date.now() + 400,
    reader: async (url) => { reads++; return { url, status: "readable", reason: "ok", content: "<rss><channel></channel></rss>", requestCount: 1 }; },
  });
  assert.equal(reads, 0, "no request may be spent when the remaining budget cannot cover a real read");
  assert.equal(result.outcomes[0].execution, "not_searched", `expected a budget outcome, got ${result.outcomes[0].execution}`);
  assert.equal(result.outcomes[0].blockedBy, "budget");
  assert.equal(result.outcomes[0].failureCode, undefined, "a budget decision must not also claim an upstream failure");
  assert.deepEqual(result.failures, [], `budget decisions are not failures: ${JSON.stringify(result.failures)}`);
});