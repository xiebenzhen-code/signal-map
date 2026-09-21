import assert from "node:assert/strict";
import test from "node:test";

import {
  isDbBackedApiPath,
  proxyApiRequest,
} from "../backend/api-proxy.ts";

type Captured = { url: string; init?: RequestInit };

test("API proxy classifies DB-backed routes and keeps edge-safe routes local", () => {
  const dbBacked = [
    "/api/signals",
    "/api/control/knowledge",
    "/api/control/follows",
    "/api/control/goals",
    "/api/control/goals/abc/resume",
    "/api/control/notifications/abc/read",
    "/api/control/agent-runs",
    "/api/research/agent",
    "/api/diagnostics/postgres-transport",
  ];
  const edgeSafe = [
    "/api/auth/me",
    "/api/auth/login",
    "/api/connections",
    "/api/research/plan",
    "/api/research/stream",
    "/api/social/x/posts/y",
    "/health",
  ];
  for (const path of dbBacked) assert.equal(isDbBackedApiPath(path), true, `expected DB-backed: ${path}`);
  for (const path of edgeSafe) assert.equal(isDbBackedApiPath(path), false, `expected edge-safe: ${path}`);
});

test("API proxy forwards method, path, query, body and auth headers to the Node upstream", async () => {
  const captured: Captured = { url: "" };
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    return new Response(null, { status: 200 });
  };

  const body = JSON.stringify({ industry: "AI infra", currentQuestions: "what changed" });
  const request = new Request("http://localhost:3000/api/signals?summary=1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
      cookie: "sb-auth-token=abc; signal_map_session=xyz",
    },
    body,
  });

  const response = await proxyApiRequest(request, { upstream: "http://127.0.0.1:8080", fetchFn: fakeFetch });

  assert.equal(response.status, 200);
  assert.equal(captured.url, "http://127.0.0.1:8080/api/signals?summary=1");
  assert.equal(captured.init?.method, "POST");
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("cookie"), "sb-auth-token=abc; signal_map_session=xyz");
  assert.equal(headers.get("content-type"), "application/json");
  const sentBody = captured.init?.body;
  assert.equal(
    Buffer.from(sentBody as ArrayBuffer).toString("utf8"),
    body,
  );
});

test("API proxy returns upstream 200 with body and set-cookie unchanged", async () => {
  const fakeFetch = async () => new Response("hello", {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain", "set-cookie": "sid=abc; HttpOnly; Path=/" },
  });

  const response = await proxyApiRequest(
    new Request("http://localhost:3000/api/control/knowledge?summary=1"),
    { upstream: "http://127.0.0.1:8080", fetchFn: fakeFetch },
  );

  assert.equal(response.status, 200);
  assert.equal(response.statusText, "OK");
  assert.equal(await response.text(), "hello");
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(response.headers.get("set-cookie"), "sid=abc; HttpOnly; Path=/");
});

test("API proxy passes upstream 4xx/5xx through without rewriting the status", async () => {
  const fakeFetch = async () => new Response('{"error":"overloaded"}', { status: 503 });
  const response = await proxyApiRequest(
    new Request("http://localhost:3000/api/control/follows"),
    { upstream: "http://127.0.0.1:8080", fetchFn: fakeFetch },
  );
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"error":"overloaded"}');
});

test("API proxy does not surface a database error as a research failure", async () => {
  const fakeFetch = async () => {
    throw new Error("Connection terminated unexpectedly");
  };
  const response = await proxyApiRequest(
    new Request("http://localhost:3000/api/signals"),
    { upstream: "http://127.0.0.1:8080", fetchFn: fakeFetch },
  );
  assert.equal(response.status, 502);
  const payload = (await response.json()) as { code?: string; error?: string };
  assert.equal(payload.code, "API_UPSTREAM_UNAVAILABLE");
  assert.equal(String(payload.error).toLowerCase().includes("unavailable"), true);
  assert.equal(String(payload.error).includes("Connection terminated unexpectedly"), false);
});