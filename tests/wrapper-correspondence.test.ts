// Counterexamples for wrapper correspondence + deadline propagation. All cases
// drive the REAL enrichment entry (enrichGenericDetail) with an injected
// network double that records request order, request count, and abort signals.
import assert from "node:assert/strict";
import test from "node:test";

const WRAPPER_URL = "https://news.google.com/rss/articles/CBMiaEFVX3lxTFBCMXNyVEQ2Z2JsN2UxNV9mc0dYTTZmMTVmSXlDcm9FeVlGWnBZN2tvbDVxeHg5Zm5kSHRYWkpTYU5sZXo5U2I2UnpLUDRWZ1I0WDRMQXdiTWxYWGpuWlE4UE9FOWwyemI4?oc=5";
const REAL_ARTICLE_URL = "https://runway.com/resources/best-short-form-video-editor";
const UNRELATED_ARTICLE_URL = "https://runway.com/about";
const ORIGINAL_TITLE = "Runway Resources | Best Short Form Video Editor: AI or a Human Editor?";

const ARTICLE_BODY = `<!doctype html><html><head><title>${ORIGINAL_TITLE} | Runway Resources</title></head><body>
  <article><h1>Best Short Form Video Editor: AI or a Human Editor?</h1>
  <p>Runway released an update to its AI video editing suite that automates rough-cut
  assembly for short-form teams, adding shot selection and multi-asset understanding.</p>
  <p>The update supports commercial workflow templates and is available on paid plans;
  customers can try the automated rough-cut pipeline from the dashboard today.</p></article>
</body></html>`;

function litePage(entries: Array<{ url: string; anchor: string }>): string {
  return `<html><body>${entries
    .map((e) => `<a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(e.url)}">${e.anchor}</a>`)
    .join("\n")}</body></html>`;
}

const CORRECT_ANCHOR = "Best Short Form Video Editor: AI or a Human Editor? - Runway";

type Harness = {
  fetched: string[];
  signals: Array<AbortSignal | undefined>;
  restore: () => void;
};

function installFetch(handlers: {
  lite?: Array<{ url: string; anchor: string }> | "no-results" | { delayMs: number; entries: Array<{ url: string; anchor: string }> };
  runway?: (url: string, signal?: AbortSignal) => Response | Promise<Response>;
}): Harness {
  const fetched: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(target));
    fetched.push(url.toString());
    signals.push(init?.signal ?? undefined);
    if (url.hostname === "news.google.com") {
      return new Response("<!doctype html><html><head><title>Google News</title></head><body><div id='root'></div></body></html>");
    }
    if (url.hostname === "lite.duckduckgo.com") {
      if (handlers.lite === "no-results") return new Response("<html><body><p>No results.</p></body></html>");
      if (handlers.lite && "delayMs" in handlers.lite) {
        await sleep(handlers.lite.delayMs);
        return new Response(litePage(handlers.lite.entries));
      }
      return new Response(litePage(handlers.lite ?? []));
    }
    if (url.hostname === "runway.com") {
      return handlers.runway ? handlers.runway(url.toString(), init?.signal ?? undefined) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetched, signals, restore: () => { globalThis.fetch = originalFetch; } };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Hostname-based check — a plain string includes() would false-match the
// site:runway.com text inside the lite.duckduckgo query string.
function fetchedFromHost(fetched: string[], hostname: string) {
  return fetched.some((u) => {
    try {
      return new URL(u).hostname === hostname;
    } catch {
      return false;
    }
  });
}

test("RED: a same-domain but unrelated article must not be accepted as the original", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [{ url: UNRELATED_ARTICLE_URL, anchor: "About Runway: Company, Careers and Press" }],
    runway: () => new Response("<html><head><title>About Runway</title></head><body><p>We are a company. Our team builds tools and hires people across many offices worldwide every day.</p></body></html>"),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.notEqual(result.status, "SUCCESS", "an unrelated same-domain page must not pass as the original article");
    assert.equal(result.rawContent, undefined, "no other article's body may be returned");
    assert.equal(result.canonicalUrl, WRAPPER_URL, "the wrapper must not promote an unrelated URL to canonical");
    assert.ok(!fetchedFromHost(harness.fetched, "runway.com"), "the unrelated page must not even be fetched");
  } finally {
    harness.restore();
  }
});

test("RED: the resolver must pick the corresponding result, not the first same-domain URL", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [
      { url: UNRELATED_ARTICLE_URL, anchor: "About Runway: Company, Careers and Press" },
      { url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR },
    ],
    runway: (url) => (url === REAL_ARTICLE_URL ? new Response(ARTICLE_BODY) : new Response("", { status: 404 })),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.canonicalUrl, REAL_ARTICLE_URL, "the corresponding article must win over the first same-domain URL");
    assert.match(result.rawContent || "", /rough-cut|shot selection|commercial workflow/i);
    assert.ok(!harness.fetched.some((u) => u.includes(UNRELATED_ARTICLE_URL)));
  } finally {
    harness.restore();
  }
});

test("RED: a same-topic reworded headline must not be declared resolved", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [{ url: REAL_ARTICLE_URL, anchor: "Choosing Between AI and Human Video Editors for Teams" }],
    runway: () => new Response("<html><head><title>Choosing Between AI and Human Video Editors for Teams</title></head><body><p>Teams compare AI tools and human editors. This comparison covers budgets, turnaround times, and creative control for production teams today.</p></body></html>"),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.notEqual(result.status, "SUCCESS", "a different article on the same topic must not be declared the original");
    assert.equal(result.rawContent, undefined);
  } finally {
    harness.restore();
  }
});

test("RED: a resolved URL whose page is a different article must be rejected by the page check", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }],
    // The indexed anchor looked right, but the page serves a different article.
    runway: () => new Response("<html><head><title>Runway Announces a New Enterprise Plan for Production Studios</title></head><body><article><h1>Runway Announces a New Enterprise Plan</h1><p>Runway introduced enterprise licensing for studios with dedicated support, custom models, and on-premise rendering options for large customers everywhere.</p></article></body></html>"),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.notEqual(result.status, "SUCCESS", "a page that does not correspond to the candidate must not pass");
    assert.equal(result.rawContent, undefined, "the other article's body must not be returned");
    assert.equal(result.canonicalUrl, WRAPPER_URL, "canonical must stay the wrapper, not the wrong page");
  } finally {
    harness.restore();
  }
});

test("RED: the correct article passes with normal title-format differences", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [{ url: REAL_ARTICLE_URL, anchor: "BEST SHORT FORM VIDEO EDITOR: AI OR A HUMAN EDITOR? — Runway Insights" }],
    runway: () => new Response(ARTICLE_BODY),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.equal(result.status, "SUCCESS", `format differences must not cause rejection, got ${result.status}`);
    assert.equal(result.canonicalUrl, REAL_ARTICLE_URL);
    assert.match(result.rawContent || "", /rough-cut|shot selection|commercial workflow/i);
    assert.equal(result.fetchCalls, 2, "one search + one body fetch");
    assert.ok(harness.fetched[0].includes("lite.duckduckgo.com"), "search happens first");
    assert.ok(harness.fetched[1].includes("runway.com"), "body fetch happens second");
  } finally {
    harness.restore();
  }
});

test("RED: missing correspondence materials keeps the wrapper unresolved (no requests)", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harnessNoOrigin = installFetch({ lite: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }] });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: {},
    });
    assert.notEqual(result.status, "SUCCESS");
    assert.equal(result.fetchCalls, 0);
    assert.equal(harnessNoOrigin.fetched.length, 0, "no search may fire without a publisher origin");
  } finally {
    harnessNoOrigin.restore();
  }

  const harnessNoTitle = installFetch({ lite: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }] });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      metadata: { publisherUrl: "https://runway.com" },
    });
    assert.notEqual(result.status, "SUCCESS");
    assert.equal(result.fetchCalls, 0);
    assert.equal(harnessNoTitle.fetched.length, 0, "no search may fire without an original title to confirm against");
  } finally {
    harnessNoTitle.restore();
  }
});

test("RED: an exhausted budget must not fire the search", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({ lite: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }] });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
      deadlineAt: Date.now() - 5,
    });
    assert.notEqual(result.status, "SUCCESS");
    assert.equal(result.fetchCalls, 0);
    assert.equal(harness.fetched.length, 0, "no request at all once the budget is gone");
  } finally {
    harness.restore();
  }
});

test("RED: a search that exhausts the budget blocks the body request", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    // The search response arrives after the deadline — the injected double
    // deliberately ignores the abort signal so the post-search guard is what
    // stops the body fetch.
    lite: { delayMs: 120, entries: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }] },
    runway: () => new Response(ARTICLE_BODY),
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
      deadlineAt: Date.now() + 60,
    });
    assert.notEqual(result.status, "SUCCESS");
    assert.equal(result.fetchCalls, 1, "the search happened, the body fetch must not");
    assert.ok(!fetchedFromHost(harness.fetched, "runway.com"), "no body request after the budget is gone");
  } finally {
    harness.restore();
  }
});

test("RED: a cancelled body request stops and never returns success", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harness = installFetch({
    lite: [{ url: REAL_ARTICLE_URL, anchor: CORRECT_ANCHOR }],
    runway: (_url, signal) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        // Body never completes; it only rejects when the abort signal fires —
        // mimicking a real request whose transfer is cancelled mid-flight.
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const onAbort = () => reject(new DOMException("This operation was aborted", "AbortError"));
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort);
          }),
      }) as unknown as Response,
  });
  try {
    const result = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: WRAPPER_URL,
      title: ORIGINAL_TITLE,
      metadata: { publisherUrl: "https://runway.com" },
      deadlineAt: Date.now() + 120,
    });
    assert.equal(result.status, "FETCH_FAILED", `a cancelled request must surface as FETCH_FAILED, got ${result.status}`);
    assert.equal(result.rawContent, undefined);
    assert.equal(result.fetchCalls, 2);
    const bodySignal = harness.signals[1];
    assert.ok(bodySignal?.aborted, "the abort signal must actually cancel the body request, not just abandon it");
  } finally {
    harness.restore();
  }
});

test("RED: the normal non-wrapper enrichment path does not regress", async () => {
  const { enrichGenericDetail } = await import("./fixtures/detail-read.ts");
  const harnessDirect = installFetch({ runway: (url) => (url === REAL_ARTICLE_URL ? new Response(ARTICLE_BODY) : new Response("", { status: 404 })) });
  try {
    const withoutDeadline = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: REAL_ARTICLE_URL,
      title: ORIGINAL_TITLE,
    });
    assert.equal(withoutDeadline.status, "SUCCESS", "no deadline given: existing behavior");
    assert.equal(withoutDeadline.fetchCalls, 1);

    const withDeadline = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: REAL_ARTICLE_URL,
      title: ORIGINAL_TITLE,
      deadlineAt: Date.now() + 5000,
    });
    assert.equal(withDeadline.status, "SUCCESS", "deadline with remaining time: normal path works");
    assert.equal(withDeadline.fetchCalls, 1);
    assert.equal(harnessDirect.fetched.length, 2);
  } finally {
    harnessDirect.restore();
  }

  const harnessExpired = installFetch({});
  try {
    const expired = await enrichGenericDetail({
      providerId: "primary-web-search",
      url: REAL_ARTICLE_URL,
      title: ORIGINAL_TITLE,
      deadlineAt: Date.now() - 5,
    });
    assert.equal(expired.status, "FETCH_FAILED", "exhausted budget: no fetch, honest failure");
    assert.equal(expired.fetchCalls, 0);
    assert.equal(harnessExpired.fetched.length, 0);
  } finally {
    harnessExpired.restore();
  }
});
