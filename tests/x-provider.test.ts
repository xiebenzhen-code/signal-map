import assert from "node:assert/strict";
import test from "node:test";
import { createXProvider } from "../social/providers/x.ts";
import { isProviderSearchError } from "../social/providers/types.ts";
import { toPublicConnectionStatus } from "../social/access/public-connection.ts";

const responseBody = {
  data: [{
    id: "100",
    text: "Codex receives a public update",
    created_at: "2026-08-28T08:00:00.000Z",
    author_id: "author-1",
  }],
  includes: { users: [{ id: "author-1", username: "openai", name: "OpenAI" }] },
};

function configuredProvider(fetcher: typeof fetch) {
  return createXProvider({
    getToken: () => "test-token",
    fetcher,
    now: () => new Date("2026-08-28T09:00:00.000Z"),
  });
}

test("identical normalized X queries coalesce in flight and use the short cache", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const provider = configuredProvider(async () => {
    calls += 1;
    await pending;
    return Response.json(responseBody);
  });

  const first = provider.search({ query: "Codex update", industry: "AI" });
  const second = provider.search({ query: "  Codex   update  ", industry: "AI" });
  release();
  const [left, right] = await Promise.all([first, second]);
  const cached = await provider.search({ query: "Codex update", industry: "AI" });

  assert.equal(calls, 1);
  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(cached.length, 1);
});

test("X query limits reject invalid complexity before calling the API", async () => {
  let calls = 0;
  const provider = configuredProvider(async () => {
    calls += 1;
    return Response.json(responseBody);
  });

  await assert.rejects(
    () => provider.search({ query: "a OR b OR c OR d", industry: "AI" }),
    (error: unknown) => isProviderSearchError(error) && error.code === "invalid_query",
  );
  assert.equal(calls, 0);
});

test("X 429 respects Retry-After without caching it as a normal success", async () => {
  let calls = 0;
  const provider = configuredProvider(async () => {
    calls += 1;
    return new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => provider.search({ query: "Codex update", industry: "AI" }),
      (error: unknown) =>
        isProviderSearchError(error) &&
        error.code === "rate_limited" &&
        error.retryAfterSeconds === 120,
    );
  }
  assert.equal(calls, 1);
});

test("successful zero-result X searches use the short cache", async () => {
  let calls = 0;
  const provider = configuredProvider(async () => {
    calls += 1;
    return Response.json({ data: [] });
  });

  assert.deepEqual(await provider.search({ query: "Codex update", industry: "AI" }), []);
  assert.deepEqual(await provider.search({ query: "Codex update", industry: "AI" }), []);
  assert.equal(calls, 1);
});

test("timeout failures are not cached as successful results", async () => {
  let calls = 0;
  const provider = configuredProvider(async () => {
    calls += 1;
    const error = new Error("request timed out");
    error.name = "TimeoutError";
    throw error;
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => provider.search({ query: "Codex update", industry: "AI" }),
      (error: unknown) => isProviderSearchError(error) && error.code === "timeout",
    );
  }
  assert.equal(calls, 2);
});

test("public connection DTO never exposes environment or provider diagnostics", () => {
  const publicStatus = toPublicConnectionStatus({
    id: "x",
    label: "X",
    adapter: "official-api",
    state: "not_configured",
    detail: "Set X_BEARER_TOKEN=definitely-not-public on 127.0.0.1:18080",
  });
  const serialized = JSON.stringify(publicStatus);

  assert.equal(serialized.includes("X_BEARER_TOKEN"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);
  assert.equal(serialized.includes("definitely-not-public"), false);
});
