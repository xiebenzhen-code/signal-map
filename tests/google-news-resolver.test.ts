import assert from "node:assert/strict";
import test from "node:test";

import { resolveWrapperViaPublisherOrigin } from "../source-enrichment/google-news-resolver.ts";

// Injected fetcher that simulates lite.duckduckgo.com result pages: each
// result renders as a uddg redirect link whose anchor text is the indexed page
// title (defaults to the URL string when no title is given).
function makeLiteDdgFetcher(results: Array<{ url: string; title?: string }>) {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("lite.duckduckgo.com")) {
      const links = results.map((r) => `<a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${r.title ?? r.url}</a>`).join("\n");
      return new Response(`<html><body>${links}</body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

// Simulate the article page response
function makeArticlePageFetcher(articleUrl: string, articleHtml: string) {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u === articleUrl) return new Response(articleHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

test("resolves a Google News wrapper to the original publisher article URL via lite.duckduckgo", async () => {
  const fetcher = makeLiteDdgFetcher([
    { url: "https://gigazine.net/gsc_news/en/20260911-flux-video-edit/", title: "FLUX Video Edit" },
    { url: "https://example.com/other" },
  ]);
  const result = await resolveWrapperViaPublisherOrigin("https://gigazine.net", "FLUX Video Edit", fetcher);
  assert.equal(result, "https://gigazine.net/gsc_news/en/20260911-flux-video-edit/");
});

test("rejects a resolved URL from a different domain than the publisher origin", async () => {
  const fetcher = makeLiteDdgFetcher([
    { url: "https://evil.example.com/not-gigazine" },
  ]);
  const result = await resolveWrapperViaPublisherOrigin("https://gigazine.net", "FLUX Video Edit", fetcher);
  assert.equal(result, undefined, "must not return a URL from a different domain");
});

test("returns undefined when the search yields no same-domain results", async () => {
  const fetcher = makeLiteDdgFetcher([
    { url: "https://other-site.example.com/article" },
  ]);
  const result = await resolveWrapperViaPublisherOrigin("https://gigazine.net", "FLUX Video Edit", fetcher);
  assert.equal(result, undefined);
});

test("returns undefined when the search fails (non-200)", async () => {
  const failing = (async () => new Response("error", { status: 500 })) as typeof fetch;
  const result = await resolveWrapperViaPublisherOrigin("https://gigazine.net", "FLUX Video Edit", failing);
  assert.equal(result, undefined);
});

test("returns undefined on network timeout", async () => {
  const timing = (async () => { throw new Error("timeout"); }) as typeof fetch;
  const result = await resolveWrapperViaPublisherOrigin("https://gigazine.net", "FLUX Video Edit", timing);
  assert.equal(result, undefined);
});

test("does not resolve to unsafe URLs (private IP, loopback)", async () => {
  const fetcher = makeLiteDdgFetcher([
    { url: "http://127.0.0.1:8080/admin" },
    { url: "http://192.168.1.1/internal" },
  ]);
  const result = await resolveWrapperViaPublisherOrigin("https://127.0.0.1", "test", fetcher);
  assert.equal(result, undefined);
});

test("limits result scanning to prevent excessive parsing", async () => {
  // Generate 100 results — resolver should not crash or hang
  const manyResults = Array.from({ length: 100 }, (_, i) => ({ url: `https://example.com/result-${i}` }));
  const fetcher = makeLiteDdgFetcher(manyResults);
  const result = await resolveWrapperViaPublisherOrigin("https://example.com", "test", fetcher);
  // It may find example.com results but must complete within reasonable time
  assert.ok(result === undefined || result.startsWith("https://example.com/"));
});
