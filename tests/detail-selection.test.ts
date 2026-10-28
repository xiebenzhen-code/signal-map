import assert from "node:assert/strict";
import test from "node:test";

// Red test: the detail-enrichment selection requires candidate.providerId, but
// web-search candidates (searchQueries path: general web / primary / trusted
// media) carry only a sourceType — no providerId. In the 2026-09-30 acceptance
// run this left the six most relevant news/blog candidates (DuckDuckGo results,
// providerId=undefined) permanently un-enriched while directory pages consumed
// the budget. Contract: enrichment eligibility must not depend on providerId
// when a safe canonical URL exists and the candidate is relevant.
import { shouldEnrichDetail } from "./fixtures/detail-read.ts";

const relevantNewsCandidate = {
  providerId: undefined, // searchQueries path: no providerId, sourceType only
  title: "Digital Nirvana Launches RoughCut AI Video Editing Platform",
  // Real DDG records carry the title as the whole snippet (title-echo →
  // INSUFFICIENT_CONTENT, the exact shape from the acceptance run).
  snippet: "Digital Nirvana Launches RoughCut AI Video Editing Platform",
  potentialScore: 85,
  url: "https://digital-nirvana.com/news/digital-nirvana-launches-roughcut-ai-video-editing-platform/",
  isRelevant: true,
};

test("RED: relevant web-search candidates without providerId are enrichment-eligible when a safe canonical URL exists", () => {
  assert.equal(
    shouldEnrichDetail(relevantNewsCandidate),
    true,
    "providerId-less relevant candidates with a safe URL must be eligible",
  );
});

test("RED: the guard stays closed for unsafe URLs and irrelevant candidates", () => {
  assert.equal(shouldEnrichDetail({ ...relevantNewsCandidate, url: "http://localhost/x" }), false);
  assert.equal(shouldEnrichDetail({ ...relevantNewsCandidate, url: "javascript:alert(1)" }), false);
  assert.equal(shouldEnrichDetail({ ...relevantNewsCandidate, isRelevant: false }), false);
  assert.equal(shouldEnrichDetail({ ...relevantNewsCandidate, potentialScore: 10 }), false);
});

test("RED: enrichGenericDetail extracts article/main content instead of navigation skeleton", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const originalFetch = globalThis.fetch;
  // Realistic news-article structure: nav + header chrome, then a real <article>.
  const navAndChrome = [
    "<nav>",
    "<a href='/'>Home</a> <a href='/products'>Products</a> <a href='/about'>About</a>",
    "Sign in Subscribe Newsroom Events &amp; webinars Ebooks &amp; reports",
    "</nav>",
    "<header><h1>Company</h1></header>",
    "<div class='cookie-banner'>We use cookies. Privacy Policy Terms</div>",
  ].join("\n");
  const articleBody = [
    "<article>",
    "<h1>Digital Nirvana launches RoughCut AI video editing platform</h1>",
    "<p>Digital Nirvana announced the launch of RoughCut AI, a cloud-based video",
    "editing platform that automates rough-cut assembly for broadcast teams.",
    "The platform adds automated multi-asset understanding and shot selection,</p>",
    "<p>and it supports commercial workflow templates for post-production.",
    "Early customers can request a trial of the rough-cut automation today.</p>",
    "</article>",
  ].join("\n");
  const html = `<!doctype html><html><head><title>Digital Nirvana launches RoughCut AI</title>
    <meta name="description" content="RoughCut AI launch announcement"></head>
    <body>${navAndChrome}${articleBody}</body></html>`;
  globalThis.fetch = (async () => new Response(html, { status: 200 })) as typeof fetch;
  try {
    const result = await enrichGenericDetail({
      providerId: "public-web",
      url: "https://digital-nirvana.com/news/digital-nirvana-launches-roughcut-ai-video-editing-platform/",
      title: "Digital Nirvana Launches RoughCut AI Video Editing Platform",
    });
    assert.equal(result.status, "SUCCESS");
    assert.ok(result.rawContent, "rawContent must be present");
    // The extracted content must be dominated by the article, not the nav chrome.
    const content = result.rawContent || "";
    assert.ok(content.includes("RoughCut AI"), "launch subject must be present in extracted content");
    assert.match(content, /launch[esd]*|announced|adds|supports|automates/i, "action-bearing article text must be present");
    // Navigation skeleton must not crowd out the article within the stored body.
    const navShare = (content.match(/Subscribe|Cookie|Privacy Policy|Sign in/gi) || []).length;
    assert.ok(navShare <= 1, `navigation text must not dominate extraction, nav hits=${navShare}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RED: navigation-skeleton-only pages are still rejected (no fabricated content)", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const originalFetch = globalThis.fetch;
  const skeletonHtml = `<!doctype html><html><head><title>AutoKut</title></head><body>
    <nav><a href='/'>Home</a> <a href='/features'>Features</a></nav>
    <header><h1>AutoKut — Revolutionary AI-Powered Video Editing</h1></header>
    <div class='hero'></div>
    <footer>Privacy Policy · Terms · Cookie Preferences</footer>
  </body></html>`;
  globalThis.fetch = (async () => new Response(skeletonHtml, { status: 200 })) as typeof fetch;
  try {
    const result = await enrichGenericDetail({
      providerId: "public-web",
      url: "https://autokut.com/",
      title: "AutoKut - Revolutionary AI-Powered Video Editing",
    });
    // A page with no article/main body must NOT be reported as extractable SUCCESS:
    // it must land in TOO_THIN (status exists) so downstream INSUFFICIENT_CONTENT stays honest.
    assert.notEqual(result.status, "SUCCESS", "skeleton-only pages must not pass as extractable content");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
