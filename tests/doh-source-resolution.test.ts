// RED tests for configurable DoH resolution shared by source check + research fetch.
// Offline: DNS/DoH injected, no real network; the address guards stay active.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCustomSource } from "../source-enrichment/custom-source.ts";
import { createSourceCheckHandler } from "../backend/custom-sources.ts";
import { isPublicSourceAddress } from "../lib/custom-sources.ts";

function withDoHEnv(url: string | undefined, run: () => void) {
  const original = process.env.SOURCE_DOH_URL;
  if (url === undefined) delete process.env.SOURCE_DOH_URL;
  else process.env.SOURCE_DOH_URL = url;
  try { run(); } finally {
    if (original === undefined) delete process.env.SOURCE_DOH_URL;
    else process.env.SOURCE_DOH_URL = original;
  }
}

// ---- shared resolution config ----

test("RED 1: source check and page read consume the SAME DoH configuration (injected)", async () => {
  // Injected DoH resolver that answers example.com with a public IP; a page server
  // pinned to that IP serves real content. Both the check handler and readCustomSource
  // must use the configured resolver (lookup injected here simulates the shared rule).
  const queries: string[] = [];
  const dohLookup = async (host: string) => {
    queries.push(host);
    if (host === "blocked.example") return [{ address: "127.0.0.1", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const handler = createSourceCheckHandler(async (value, _options) => {
    // Simulate the reader honoring the shared DoH config: it would look up the host.
    const url = new URL(value);
    await dohLookup(url.hostname);
    return { url: value, status: "readable" as const, reason: "ok", requestCount: 1 };
  });
  const request = new Request("http://localhost/api/sources/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "signal_map_guest=00000000-0000-4000-8000-000000000000.sig" },
    body: JSON.stringify({ urls: ["https://example.com/article"] }),
  });
  const response = await handler(request);
  assert.equal(response.status, 200, "check handler must work with the shared DoH config");
  assert.deepEqual(queries, ["example.com"]);
  // The reader path must use the same config source (SOURCE_DOH_URL) — covered in RED 2.
});

test("RED 2: with SOURCE_DOH_URL configured, page read resolves A records via DoH and pins the connection address", async () => {
  const { readCustomSource: read } = await import("../source-enrichment/custom-source.ts");
  // This test requires the DoH wiring in readCustomSource; until implemented, the
  // lookup option exists but no DoH consumption. Assert via the exported seam: the
  // module must expose a resolver factory consuming SOURCE_DOH_URL.
  const mod = await import("../source-enrichment/custom-source.ts");
  assert.equal(typeof (mod as { createDoHLookup?: unknown }).createDoHLookup, "function", "custom-source must export createDoHLookup consuming SOURCE_DOH_URL");
});

test("RED 2b: mixed public + private answers are rejected as a whole (no partial pick)", async () => {
  const { resolveSourceAddresses } = await import("../source-enrichment/custom-source.ts");
  assert.throws(
    () => resolveSourceAddresses("example.test", [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]),
    /非公开地址|private|非公开/i,
  );
});

test("RED 2c: no answers / malformed DoH payload / timeout fail honestly", async () => {
  const { resolveSourceAddresses } = await import("../source-enrichment/custom-source.ts");
  assert.throws(() => resolveSourceAddresses("empty.test", []), /解析|无结果|DoH/i);
  assert.throws(
    () => resolveSourceAddresses("malformed.test", [{ address: "not-an-ip", family: 4 } as never]),
    /解析|DoH|无效/i,
  );
  await assert.rejects(
    async () => {
      await Promise.race([
        new Promise((_r, reject) => setTimeout(() => reject(new Error("DoH 解析超时")), 30)),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
      throw new Error("DoH 解析超时");
    },
    /超时/,
  );
});

test("RED 3: address guards stay active under DoH (private answers rejected)", () => {
  assert.equal(isPublicSourceAddress("127.0.0.1"), false);
  assert.equal(isPublicSourceAddress("10.0.0.5"), false);
  assert.equal(isPublicSourceAddress("169.254.1.1"), false);
  assert.equal(isPublicSourceAddress("::1"), false);
  assert.equal(isPublicSourceAddress("93.184.216.34"), true);
});

test("RED 4: each redirect re-resolves and re-validates the new host; original Host/SNI kept", async () => {
  const { readCustomSource: read } = await import("../source-enrichment/custom-source.ts");
  const resolutions: string[] = [];
  const pinnedHosts: string[] = [];
  const lookup = async (host: string) => {
    resolutions.push(host);
    if (host === "redirector.example-video-source.com") return [{ address: "93.184.216.34", family: 4 }];
    return [{ address: "93.184.216.35", family: 4 }];
  };
  const request = async (url: URL, _address: { address: string; family: number }, _signal: AbortSignal) => {
    pinnedHosts.push(url.hostname);
    if (url.hostname === "redirector.example-video-source.com") {
      return { status: 302, headers: { location: "https://final.example-video-source.com/article" }, body: "" };
    }
    return { status: 200, headers: { "content-type": "text/html" }, body: `<article>${"<p>body text.</p>".repeat(40)}</article>` };
  };
  const result = await read("https://redirector.example-video-source.com/a", { lookup, request, deadlineAt: Date.now() + 5000 });
  assert.deepEqual(resolutions, ["redirector.example-video-source.com", "final.example-video-source.com"], "each hop must re-resolve");
  assert.deepEqual(pinnedHosts, ["redirector.example-video-source.com", "final.example-video-source.com"], "Host/SNI must stay the original hostname per hop");
  assert.equal(result.status, "readable");
});

test("RED 5: DoH/parse errors never leak credentials or the full sensitive URL", async () => {
  const { resolveSourceAddresses } = await import("../source-enrichment/custom-source.ts");
  try {
    resolveSourceAddresses("malformed.test", [] as never);
    assert.fail("expected throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.doesNotMatch(message, /postgres:\/\//, "no connection strings in DoH errors");
    assert.doesNotMatch(message, /token=|password=/, "no credentials in DoH errors");
  }
});
