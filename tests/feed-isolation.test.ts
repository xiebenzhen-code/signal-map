import assert from "node:assert/strict";
import test from "node:test";
import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { retrieveRegisteredFeeds } from "../research/registered-feeds.ts";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const item = (origin: string, slug: string, extra = "") =>
  `<item><title>Checkout payment update</title><link>${origin}${slug}</link><pubDate>${new Date().toISOString()}</pubDate><description>Checkout payment API update for US merchants.${extra}</description></item>`;

test("a hanging feed neither blocks nor contaminates a healthy feed, and the stage stays inside the run deadline", async () => {
  const deadlineAt = Date.now() + 8000;
  const cache = new Map();
  const options = {
    entities: [], query: "数码", allowed: true, deadlineAt, cache,
    // Mirrors the real reader contract: a read never outlives the deadline it is
    // handed, so one unreachable source cannot stall the feed stage.
    reader: (async (url: string, opts?: { deadlineAt?: number }) => {
      if (url.includes("ithome")) {
        return await new Promise((resolve) => setTimeout(() => resolve({ url, status: "failed", reason: "FEED_TIMEOUT", requestCount: 1 }),
          Math.max(1, (opts?.deadlineAt ?? Date.now()) - Date.now())));
      }
      return { url, status: "readable", reason: "ok", requestCount: 1, content: `<rss><channel>${item(new URL(url).origin, "/post/a")}</channel></rss>` };
    }) as typeof readCustomSource,
  };
  const started = Date.now();
  const result = await retrieveRegisteredFeeds(options);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 12000, `the feed stage must stay inside its budget: ${elapsed}ms`);
  assert.ok(result.items.length > 0, "the healthy feed's entry must reach the candidate pool");
  assert.equal(result.items[0].sourceType, "industry_media", "media stays media while the peer is failing");
  assert.equal(result.outcomes.length, 2, "one outcome per subscribed feed");
  assert.ok(result.outcomes.some((o) => o.execution === "searched_with_results"), "the healthy feed reports results");
  assert.ok(result.outcomes.some((o) => o.providerId === "registered-feeds" && o.requestCount === 1),
    "the failing feed still records the attempt it actually made");
});

test("timeout classification distinguishes DNS from budget without leaking transport text", async () => {
  const dnsFailure = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed",
    lookup: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); },
    request: async () => ({ status: 200, headers: {}, body: "" }),
  });
  assert.equal(dnsFailure.status, "failed");
  assert.equal(dnsFailure.reason, "FEED_ENOTFOUND", "DNS failures must be labelled as DNS, not as a timeout");
  assert.equal(dnsFailure.requestCount, 0, "no socket was opened, so no request may be counted");

  const exhausted = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed",
    deadlineAt: Date.now() + 500,
    lookup: publicLookup,
    request: async () => ({ status: 200, headers: {}, body: "" }),
  });
  assert.equal(exhausted.status, "not_searched", `expected a budget decision, got ${exhausted.status}: ${exhausted.reason}`);
  assert.equal(exhausted.reason, "FEED_BUDGET_EXHAUSTED");
  assert.match(exhausted.reason, /^FEED_[A-Z_]+$/, "reason must stay a fixed code");
});

test("feed reading keeps its SSRF, size and content-type limits", async () => {
  // A literal private address is refused by the URL policy before any lookup.
  const literalPrivate = await readCustomSource("http://10.0.0.5/feed.xml", {
    format: "feed", lookup: async () => [{ address: "10.0.0.5", family: 4 }], request: async () => ({ status: 200, headers: {}, body: "" }),
  });
  assert.equal(literalPrivate.status, "blocked");

  // A public hostname that resolves to a private address is refused after DNS.
  const privateAddress = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed", lookup: async () => [{ address: "10.0.0.5", family: 4 }],
    request: async () => ({ status: 200, headers: {}, body: "" }),
  });
  assert.equal(privateAddress.status, "blocked");
  assert.equal(privateAddress.reason, "FEED_PRIVATE_ADDRESS");
  assert.equal(privateAddress.requestCount, 0, "a blocked address must not count as a request");

  const tooLarge = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed", lookup: publicLookup,
    request: async () => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: "x".repeat(2 * 1024 * 1024 + 10) }),
  });
  assert.equal(tooLarge.reason, "FEED_TOO_LARGE", "the 2 MiB feed ceiling must still hold");

  const wrongType = await readCustomSource("https://shopify.dev/changelog/feed.xml", {
    format: "feed", lookup: publicLookup,
    request: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" }),
  });
  assert.equal(wrongType.reason, "FEED_CONTENT_TYPE_UNSUPPORTED", "HTML must not be accepted as a feed");
});