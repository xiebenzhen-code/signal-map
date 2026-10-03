// Full-path red test for Google News RSS wrapper resolution. Real pipeline +
// injected network. Deleted-after-run style assertions; fixture mirrors the
// acceptance-run failure (Runway article reachable only through a wrapper).
import assert from "node:assert/strict";
import test from "node:test";

const WRAPPER_URL = "https://news.google.com/rss/articles/CBMiaEFVX3lxTFBCMXNyVEQ2Z2JsN2UxNV9mc0dYTTZmMTVmSXlDcm9FeVlGWnBZN2tvbDVxeHg5Zm5kSHRYWkpTYU5sZXo5U2I2UnpLUDRWZ1I0WDRMQXdiTWxYWGpuWlE4UE9FOWwyemI4?oc=5";
const REAL_ARTICLE_URL = "https://runway.com/resources/best-short-form-video-editor";
const REAL_ARTICLE_HTML = `<!doctype html><html><head><title>Best Short Form Video Editor</title></head><body>
  <article><h1>Best Short Form Video Editor: AI or a Human Editor?</h1>
  <p>Runway released an update to its AI video editing suite that automates rough-cut
  assembly for short-form teams, adding shot selection and multi-asset understanding.</p>
  <p>The update supports commercial workflow templates and is available on paid plans;
  customers can try the automated rough-cut pipeline from the dashboard today.</p></article>
</body></html>`;

function ddgResults(targetUrl: string): string {
  // lite.duckduckgo.com result pages use uddg redirect parameters.
  return `<html><body>
    <a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(targetUrl)}">Best Short Form Video Editor: AI or a Human Editor? - Runway</a>
  </body></html>`;
}

test("RED: a Google News wrapper candidate resolves to the publisher article and yields extractable content", async () => {
  const { enrichGenericDetail } = await import("../source-enrichment/detail-enricher.ts");
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (target: string | URL | Request) => {
    const url = new URL(String(target));
    fetched.push(url.toString());
    if (url.hostname === "news.google.com") {
      // The wrapper is a 580KB JS shell: NOT an article.
      return new Response("<!doctype html><html><head><title>Google News</title></head><body><div id='root'></div></body></html>");
    }
    if (url.hostname === "lite.duckduckgo.com") {
      return new Response(ddgResults(REAL_ARTICLE_URL));
    }
    if (url.hostname === "runway.com") {
      return new Response(REAL_ARTICLE_HTML);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: "Runway Resources | Best Short Form Video Editor: AI or a Human Editor?",
      metadata: {
        publisher: "Runway",
        publisherUrl: "https://runway.com",
        snippet: "Best Short Form Video Editor: AI or a Human Editor?",
      },
    });
    assert.equal(result.status, "SUCCESS", `wrapper must resolve via publisher-origin lookup, got ${result.status}`);
    assert.equal(
      result.canonicalUrl,
      REAL_ARTICLE_URL,
      `canonicalUrl must be the resolved publisher article, got ${result.canonicalUrl}`,
    );
    const content = result.rawContent || "";
    assert.match(content, /rough-cut|shot selection|commercial workflow/i, "real article body must be extracted");
    // The wrapper's Google shell must never be stored as content.
    assert.doesNotMatch(content, /<div id='root'|Google News/i);
    // The resolution must have gone through the publisher-origin site search.
    assert.ok(
      fetched.some((u) => u.includes("lite.duckduckgo.com") && u.includes("site%3Arunway.com")),
      `a site-restricted publisher lookup must happen, fetched=${JSON.stringify(fetched)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RED: an unresolvable wrapper stays an honest failure (no Google shell stored as content)", async () => {
  const { enrichGenericDetail } = await import("../source-enrichment/detail-enricher.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "news.google.com") {
      return new Response("<!doctype html><html><head><title>Google News</title></head><body><div id='root'></div></body></html>");
    }
    if (url.hostname === "lite.duckduckgo.com") {
      return new Response("<html><body><p>No results.</p></body></html>");
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: "Some Unresolvable Headline",
      metadata: { publisherUrl: "https://unknown-publisher.example" },
    });
    assert.notEqual(result.status, "SUCCESS", "an unresolvable wrapper must not be reported as content success");
    assert.doesNotMatch(result.rawContent ?? "", /Google News/i, "Google shell must not be stored as rawContent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
