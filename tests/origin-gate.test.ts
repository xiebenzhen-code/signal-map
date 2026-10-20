import assert from "node:assert/strict";
import test from "node:test";

import { handleBackendRequest } from "../backend/node-server.ts";

async function post(path: string, origin?: string, body?: object) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Origin"] = origin;
  return handleBackendRequest(
    new Request(`http://localhost:8080${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    }),
  );
}

test("a legal frontend origin (localhost:3000) passes the origin check and enters parameter validation", async () => {
  const r = await post("/api/signals", "http://localhost:3000", { industry: "AI" });
  assert.notEqual(r.status, 403, "must not be blocked by origin check");
  assert.notEqual(r.status, 503, "must not be blocked by session middleware");
});

test("a legal frontend origin using 127.0.0.1 also passes", async () => {
  const r = await post("/api/signals", "http://127.0.0.1:3000", { industry: "AI" });
  assert.notEqual(r.status, 403, "must not be blocked by origin check");
});

test("an unauthorized origin is rejected with 403", async () => {
  const r = await post("/api/signals", "http://evil.example.com", { industry: "AI" });
  assert.equal(r.status, 403);
});

test("no origin header (server-to-server) is not blocked", async () => {
  const r = await post("/api/signals", undefined, { industry: "AI" });
  assert.notEqual(r.status, 403, "no-origin requests are not browser requests");
});

test("through the proxy path the origin check still works correctly", async () => {
  // Simulate: browser sends to :3000 (frontend), frontend proxies to :8080 (backend)
  // The backend receives Origin: http://localhost:3000
  // The origin check should accept it as a trusted local frontend origin
  const r = await post("/api/signals", "http://localhost:3000", {});
  assert.notEqual(r.status, 403, "proxy-forwarded browser origin must not be rejected");
});

test("production mode does not unconditionally trust localhost origins", async () => {
  const prevEnv = process.env.NODE_ENV as string;
  (process.env as Record<string, string>).NODE_ENV = "production";
  (process.env as Record<string, string>).SIGNAL_MAP_ALLOWED_ORIGIN = "";
  try {
    // In production without SIGNAL_MAP_ALLOWED_ORIGIN, the backend's own origin
    // is the only trusted origin; localhost:3000 must be rejected.
    const r = await post("/api/signals", "http://localhost:3000", { industry: "AI" });
    assert.equal(r.status, 403, "production must not trust localhost:3000 without explicit config");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    (process.env as Record<string, string>).SIGNAL_MAP_ALLOWED_ORIGIN = "";
  }
});

test("the web proxy does not forward the browser Origin to the Node upstream", async () => {
  // Contract change (2026-10-20): the web app and the Node API deploy as
  // separate services. The Node backend's withSession gate trusts only its own
  // configured origin, so a forwarded web-domain Origin made every browser
  // POST fail 403 while GETs kept working (research completed server-side, the
  // page only reported failure). The upstream hop is server-to-server and
  // carries no Origin; browser-origin enforcement lives at the web edge
  // (tests/web-edge-origin.test.ts).
  const { proxyApiRequest } = await import("../backend/api-proxy.ts");
  const seenHeaders: Record<string, string> = {};
  const fakeUpstream = async (input: RequestInfo | URL, init?: RequestInit) => {
    for (const [k, v] of (init?.headers instanceof Headers ? init.headers.entries() : [])) seenHeaders[k] = v;
    return new Response(JSON.stringify({ error: "Query Planner 缺少行业或自然语言需求。" }), { status: 400, headers: { "Content-Type": "application/json" } });
  };
  const request = new Request("http://localhost:3000/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://localhost:3000" },
    body: JSON.stringify({}),
  });
  const response = await proxyApiRequest(request, { upstream: "http://127.0.0.1:8080", fetchFn: fakeUpstream });
  assert.equal(response.status, 400, "same-origin browser POST must reach the upstream");
  assert.equal(seenHeaders["origin"] ?? seenHeaders["Origin"], undefined, "proxy must not forward the browser origin");
});
