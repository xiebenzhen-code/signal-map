import assert from "node:assert/strict";
import test from "node:test";

import { handleBackendRequest } from "../backend/node-server.ts";

type QueryPlanResponse = {
  queryPlan: {
    requestedFreshnessWindow: string;
    searchCombinations: string[];
  };
};

type ErrorResponse = {
  error: string;
};

test("standalone backend refuses Knowledge State in GET query parameters", async () => {
  const response = await handleBackendRequest(
    new Request("http://localhost/api/research/plan?industry=AI%20developer%20tools&focusAreas=Codex"),
  );

  assert.equal(response.status, 405);
});

test("standalone backend accepts authenticated research input from POST body", async (t) => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  });
  t.mock.method(globalThis, "fetch", async (target: string) => {
    assert.equal(String(target), "https://auth-fixture.supabase.co/auth/v1/user");
    return Response.json({ id: "supabase-user-a", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-07T00:00:00Z" });
  });
  const response = await handleBackendRequest(
    new Request("http://localhost/api/research/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-user-token" },
      body: JSON.stringify({
        identity: "AI product builder",
        industry: "AI developer tools",
        focusAreas: ["Codex"],
        knownInformation: ["Codex is available"],
        freshnessWindow: "24h",
        sourceScope: "hybrid",
        customSources: ["https://developers.openai.com/codex/changelog"],
      }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as QueryPlanResponse;
  assert.equal(body.queryPlan.requestedFreshnessWindow, "24h");
  assert.ok(body.queryPlan.searchCombinations.some((query: string) => query.includes("Codex")));
});

test("standalone backend refuses GET signals requests", async () => {
  const response = await handleBackendRequest(
    new Request("http://localhost/api/signals"),
  );

  assert.equal(response.status, 405);
  const body = await response.json() as ErrorResponse;
  assert.match(body.error, /Method not allowed/);
});

test("standalone backend allows POST signal runs without URL query state", async () => {
  const response = await handleBackendRequest(
    new Request("http://localhost/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );

  assert.notEqual(response.status, 405);
  assert.equal(response.status, 401);
});

test("standalone backend allows POST research stream requests", async () => {
  const response = await handleBackendRequest(
    new Request("http://localhost/api/research/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );

  assert.notEqual(response.status, 405);
  assert.equal(response.status, 401);
});

test("standalone backend exposes a thin agent research POST route", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleBackendRequest(
      new Request("http://localhost/api/research/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: "AI product builder",
          industry: "AI developer tools",
          focusAreas: ["Codex"],
          currentQuestions: ["What changed?"],
          freshnessWindow: "7d",
        }),
      }),
    );

    assert.notEqual(response.status, 404);
    assert.match(response.headers.get("Cache-Control") || "", /no-store/);
    assert.equal(response.status, 401);
  } finally {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});

test("complex Agent requests require a real account before decomposition", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleBackendRequest(
      new Request("http://localhost/api/research/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: "AI product builder",
          industry: "AI developer tools",
          focusAreas: ["Codex", "Claude Code"],
          currentQuestions: ["Compare Codex and Claude Code recent release limitations"],
          freshnessWindow: "7d",
        }),
      }),
    );

    assert.equal(response.status, 401);
  } finally {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});

test("standalone backend rejects unknown routes and providers", async () => {
  const unknownRoute = await handleBackendRequest(
    new Request("http://localhost/api/unknown"),
  );
  assert.equal(unknownRoute.status, 404);

  const unknownProvider = await handleBackendRequest(
    new Request("http://localhost/api/social/unknown/posts/1"),
  );
  assert.equal(unknownProvider.status, 404);
});
