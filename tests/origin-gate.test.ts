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

test("proxyApiRequest forwards browser origin to the backend", async () => {
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
  await proxyApiRequest(request, { upstream: "http://127.0.0.1:8080", fetchFn: fakeUpstream });
  assert.equal(seenHeaders["origin"] ?? seenHeaders["Origin"], "http://localhost:3000", "proxy must forward browser origin");
});
