import assert from "node:assert/strict";
import test from "node:test";

import { proxyApiRequest } from "../backend/api-proxy.ts";

type Captured = { url: string; init?: RequestInit };

// The product runs as two CloudBase services: the browser talks to the web
// service, whose /api/* handlers proxy DB-backed routes to the Node API
// service. The Node backend's withSession gate trusts only its own configured
// origin, so forwarding the browser's web-domain Origin made every browser
// POST (research submit, saves, control writes) fail with 403 Forbidden origin
// while GETs (account page reads) kept working — "后台完成、首页报错".
const WEB_ORIGIN = "https://signal-map-web-preview-323338-4-1408253594.sh.run.tcloudbase.com";
const UPSTREAM = "http://127.0.0.1:8080";

function browserPost(origin?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return new Request(`${WEB_ORIGIN}/api/signals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ industry: "电商" }),
  });
}

test("server-to-server hop strips the browser Origin (no 403 from the Node gate)", async () => {
  const captured: Captured = { url: "" };
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    return Response.json({ ok: true }, { status: 200 });
  };
  const response = await proxyApiRequest(browserPost(WEB_ORIGIN), { upstream: UPSTREAM, fetchFn: fakeFetch });
  assert.equal(response.status, 200);
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("origin"), null, "upstream hop must not carry the browser origin");
});

test("cross-origin browser POST is rejected at the web edge before the upstream", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return Response.json({ ok: true }, { status: 200 });
  };
  const response = await proxyApiRequest(browserPost("https://evil.example.com"), { upstream: UPSTREAM, fetchFn: fakeFetch });
  assert.equal(response.status, 403, "cross-origin POST must not reach the Node upstream");
  assert.equal(calls, 0);
});

test("same-origin browser POST passes the web edge with auth and cookie headers intact", async () => {
  const captured: Captured = { url: "" };
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    return Response.json({ ok: true }, { status: 200 });
  };
  const request = new Request(`${WEB_ORIGIN}/api/signals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: WEB_ORIGIN,
      Cookie: "sb-auth-token=abc",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify({ industry: "电商" }),
  });
  const response = await proxyApiRequest(request, { upstream: UPSTREAM, fetchFn: fakeFetch });
  assert.equal(response.status, 200);
  assert.equal(captured.url, `${UPSTREAM}/api/signals`);
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("cookie"), "sb-auth-token=abc", "credentials must still reach the Node runtime");
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("origin"), null);
});

test("GET requests are unaffected by the browser-origin handling", async () => {
  const captured: Captured = { url: "" };
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    return Response.json({ user: null }, { status: 200 });
  };
  const response = await proxyApiRequest(
    new Request(`${WEB_ORIGIN}/api/control/knowledge`, { headers: { Origin: "https://evil.example.com" } }),
    { upstream: UPSTREAM, fetchFn: fakeFetch },
  );
  assert.equal(response.status, 200);
  assert.equal(new Headers(captured.init?.headers).get("origin"), null);
});
