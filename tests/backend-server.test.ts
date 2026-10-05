import assert from "node:assert/strict";
import test from "node:test";

import { withOperationTimeout } from "../backend/handlers.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import { sanitizePostgresTransportError } from "../backend/postgres-transport-probe.ts";
import { applyAuthEndpointOutcome, applyTransportFailureOutcome, runSupabaseAuthTransportProbe } from "../backend/supabase-auth-transport-probe.ts";

type QueryPlanResponse = {
  queryPlan: {
    requestedFreshnessWindow: string;
    searchCombinations: string[];
  };
};

type ErrorResponse = {
  error: string;
};

async function withSupabaseEnv<T>(env: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SIGNAL_MAP_DIAGNOSTIC_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function probeRequest(token?: string) {
  return new Request("http://localhost/api/diagnostics/supabase-auth-transport", {
    method: "POST",
    headers: token ? { "x-signal-map-diagnostic-token": token } : {},
  });
}

test("signals persistence setup returns a bounded DB_TIMEOUT instead of hanging", async () => {
  await assert.rejects(
    withOperationTimeout(new Promise(() => undefined), 5, "DB_TIMEOUT"),
    (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", "DB_TIMEOUT");
      assert.equal(error && typeof error === "object" && "code" in error ? error.code : undefined, "DB_TIMEOUT");
      return true;
    },
  );
});

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

test("postgres transport probe is login protected and POST only", async () => {
  const getResponse = await handleBackendRequest(
    new Request("http://localhost/api/diagnostics/postgres-transport"),
  );
  assert.equal(getResponse.status, 405);

  const postResponse = await handleBackendRequest(
    new Request("http://localhost/api/diagnostics/postgres-transport", { method: "POST" }),
  );
  assert.equal(postResponse.status, 401);
});

test("postgres transport probe redacts connection secrets in error text", () => {
  const value = sanitizePostgresTransportError(
    "postgresql://postgres.project:secret@example.supabase.com:6543/postgres password=secret token=abc",
  );
  assert.equal(value.includes("secret"), false);
  assert.equal(value.includes("abc"), false);
  assert.match(value, /\[redacted-database-url\]/);
});

test("supabase auth transport probe is POST only, default-off and token protected", async () => {
  await withSupabaseEnv({ SIGNAL_MAP_DIAGNOSTIC_TOKEN: undefined }, async () => {
    // GET is rejected before any access control decision.
    const getResponse = await handleBackendRequest(
      new Request("http://localhost/api/diagnostics/supabase-auth-transport"),
    );
    assert.equal(getResponse.status, 405);

    // No token configured: the endpoint must not advertise itself at all.
    const disabled = await handleBackendRequest(probeRequest());
    assert.equal(disabled.status, 404);
  });

  await withSupabaseEnv({ SIGNAL_MAP_DIAGNOSTIC_TOKEN: "probe-token" }, async () => {
    const wrongToken = await handleBackendRequest(probeRequest("not-the-token"));
    assert.equal(wrongToken.status, 401);

    const noToken = await handleBackendRequest(probeRequest());
    assert.equal(noToken.status, 401);
  });
});

test("supabase auth transport probe reports missing env without touching the network", async () => {
  const report = await withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
  }, () => runSupabaseAuthTransportProbe());

  assert.equal(report.env.url, "MISSING");
  assert.equal(report.env.key, "MISSING");
  assert.equal(report.errorCategory, "ENV_MISSING");
  assert.equal(report.dns.status, "NOT_RUN");
  assert.equal(report.https.status, "NOT_RUN");
  assert.equal(report.tls.status, "NOT_RUN");
  assert.equal(report.hostnameVerification.status, "NOT_RUN");
  assert.equal(report.authEndpoint.httpStatus, null);
});

test("supabase auth transport probe never leaks hostnames, urls, ips or secrets", async () => {
  const report = await withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-fixture.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  }, () => runSupabaseAuthTransportProbe());

  const serialized = JSON.stringify(report);
  for (const forbidden of ["auth-fixture", "supabase.co", "https://", "test-publishable-key", "apikey", "Bearer"]) {
    assert.equal(serialized.includes(forbidden), false, `report must not contain ${forbidden}`);
  }
  assert.equal(report.env.url, "PRESENT");
  assert.equal(report.env.key, "PRESENT");
});

test("supabase auth transport probe exposes only the documented status shape", async () => {
  const report = await withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-fixture.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  }, () => runSupabaseAuthTransportProbe());

  assert.deepEqual(Object.keys(report).sort(), [
    "authEndpoint", "dns", "env", "errorCategory", "hostnameVerification", "https", "tls",
  ]);
  for (const status of [report.dns.status, report.https.status, report.tls.status, report.hostnameVerification.status, report.authEndpoint.status]) {
    assert.ok(["PASS", "FAIL", "NOT_RUN"].includes(status), `unexpected status ${status}`);
  }
  assert.ok([
    "NONE", "ENV_MISSING", "DNS_FAILURE", "CONNECT_TIMEOUT", "CONNECTION_REFUSED",
    "TLS_FAILURE", "HOSTNAME_FAILURE", "AUTH_HTTP_ERROR", "UPSTREAM_SERVER_ERROR", "UNKNOWN",
  ].includes(report.errorCategory));
});

test("an HTTP error response still counts as a reachable transport path", () => {
  // 401/403/404 prove DNS -> TCP -> TLS -> hostname -> HTTP all succeeded.
  for (const status of [401, 403, 404]) {
    const report = applyAuthEndpointOutcome({
      env: { url: "PRESENT", key: "PRESENT" },
      dns: { status: "PASS", durationMs: 1 },
      https: { status: "PASS", durationMs: 1 },
      tls: { status: "NOT_RUN" },
      hostnameVerification: { status: "NOT_RUN" },
      authEndpoint: { status: "NOT_RUN", httpStatus: null },
      errorCategory: "NONE",
    }, status);

    assert.equal(report.tls.status, "PASS");
    assert.equal(report.hostnameVerification.status, "PASS");
    assert.equal(report.authEndpoint.status, "PASS");
    assert.equal(report.authEndpoint.httpStatus, status);
    // 401/403 mean the endpoint rejected the request; 404 means the path or
    // resource is unavailable. None of them proves anything about the key.
    assert.equal(report.errorCategory, "AUTH_HTTP_ERROR");
  }
});

test("a 5xx upstream response is never reported as a credential or config finding", () => {
  // The transport still succeeded, so DNS/TCP/TLS/hostname all stay PASS, but
  // a server-side or intermediary failure must not be collapsed into the
  // auth/config category.
  for (const status of [500, 502, 503]) {
    const report = applyAuthEndpointOutcome({
      env: { url: "PRESENT", key: "PRESENT" },
      dns: { status: "PASS", durationMs: 1 },
      https: { status: "PASS", durationMs: 1 },
      tls: { status: "NOT_RUN" },
      hostnameVerification: { status: "NOT_RUN" },
      authEndpoint: { status: "NOT_RUN", httpStatus: null },
      errorCategory: "NONE",
    }, status);

    assert.equal(report.tls.status, "PASS");
    assert.equal(report.hostnameVerification.status, "PASS");
    assert.equal(report.authEndpoint.httpStatus, status);
    assert.equal(report.authEndpoint.status, "FAIL");
    assert.equal(report.errorCategory, "UPSTREAM_SERVER_ERROR");
  }
});

test("a hostname mismatch is not reported as a certificate chain failure", () => {
  // Node validates the chain before the name, so an altname mismatch means
  // certificate verification actually succeeded.
  const report = applyTransportFailureOutcome({
    env: { url: "PRESENT", key: "PRESENT" },
    dns: { status: "PASS", durationMs: 1 },
    https: { status: "FAIL", durationMs: 1 },
    tls: { status: "NOT_RUN" },
    hostnameVerification: { status: "NOT_RUN" },
    authEndpoint: { status: "NOT_RUN", httpStatus: null },
    errorCategory: "NONE",
  }, "HOSTNAME_FAILURE");

  assert.equal(report.errorCategory, "HOSTNAME_FAILURE");
  assert.equal(report.tls.status, "PASS");
  assert.equal(report.hostnameVerification.status, "FAIL");
});

test("a certificate chain failure is not reported as a hostname mismatch", () => {
  const report = applyTransportFailureOutcome({
    env: { url: "PRESENT", key: "PRESENT" },
    dns: { status: "PASS", durationMs: 1 },
    https: { status: "FAIL", durationMs: 1 },
    tls: { status: "NOT_RUN" },
    hostnameVerification: { status: "NOT_RUN" },
    authEndpoint: { status: "NOT_RUN", httpStatus: null },
    errorCategory: "NONE",
  }, "TLS_FAILURE");

  assert.equal(report.errorCategory, "TLS_FAILURE");
  assert.equal(report.tls.status, "FAIL");
  assert.equal(report.hostnameVerification.status, "FAIL");
});

test("a non-TLS transport failure leaves TLS and hostname unverified", () => {
  for (const category of ["CONNECT_TIMEOUT", "CONNECTION_REFUSED", "UNKNOWN"] as const) {
    const report = applyTransportFailureOutcome({
      env: { url: "PRESENT", key: "PRESENT" },
      dns: { status: "PASS", durationMs: 1 },
      https: { status: "FAIL", durationMs: 1 },
      tls: { status: "NOT_RUN" },
      hostnameVerification: { status: "NOT_RUN" },
      authEndpoint: { status: "NOT_RUN", httpStatus: null },
      errorCategory: "NONE",
    }, category);

    assert.equal(report.errorCategory, category);
    assert.equal(report.tls.status, "NOT_RUN");
    assert.equal(report.hostnameVerification.status, "NOT_RUN");
  }
});

test("an HTTP error response is not reported as a transport failure", async () => {
  const report = await withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  }, () => runSupabaseAuthTransportProbe());

  // An unreachable loopback port must not be mistaken for an HTTP-level answer.
  assert.notEqual(report.authEndpoint.status, "PASS");
  assert.notEqual(report.errorCategory, "AUTH_HTTP_ERROR");
});

test("standalone backend accepts anonymous POST signal runs without URL query state", async (t) => {
  const prior = process.env.SIGNAL_MAP_GUEST_SECRET;
  process.env.SIGNAL_MAP_GUEST_SECRET = "test-only-guest-signing-secret";
  t.after(() => { if (prior === undefined) delete process.env.SIGNAL_MAP_GUEST_SECRET; else process.env.SIGNAL_MAP_GUEST_SECRET = prior; });
  const response = await handleBackendRequest(
    new Request("http://localhost/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );

  assert.notEqual(response.status, 405);
  assert.equal(response.status, 400);
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

test("preference endpoint exists and rejects unauthenticated access", async () => {
  const post = await handleBackendRequest(
    new Request("http://localhost/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeType: "entity", scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }),
    }),
  );
  assert.equal(post.status, 401);

  const get = await handleBackendRequest(
    new Request("http://localhost/api/preferences"),
  );
  assert.equal(get.status, 401);

  const method = await handleBackendRequest(
    new Request("http://localhost/api/preferences", { method: "DELETE" }),
  );
  assert.equal(method.status, 405);
});
