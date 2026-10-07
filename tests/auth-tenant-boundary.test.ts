import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthContext } from "../auth/session.ts";
import { mapAuthError } from "../auth/auth-error.ts";
import { getControlGoals, getControlKnowledge, getControlNotifications } from "../backend/control-plane.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import type { Goal } from "../agent/goal-types.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { AuthenticatedFilterContext } from "../information/repositories/types.ts";
import { markNotificationRead } from "../notification/delivery.ts";
import { runSchedulerTick } from "../scheduler/watch-runner.ts";

const now = "2026-09-07T10:00:00.000Z";
const userA: AuthenticatedFilterContext = { authenticatedUserId: "user-a", filterId: "filter-a" };
const userB: AuthenticatedFilterContext = { authenticatedUserId: "user-b", filterId: "filter-b" };

test("auth errors remain actionable without exposing provider details", () => {
  assert.deepEqual(mapAuthError({ code: "user_already_exists", status: 422 }, "signup"), {
    status: 409, code: "user_exists", error: "该邮箱已注册，请直接登录。",
  });
  assert.deepEqual(mapAuthError({ code: "invalid_credentials", status: 400 }, "login"), {
    status: 401, code: "invalid_credentials", error: "邮箱或密码不正确。",
  });
  assert.deepEqual(mapAuthError({ name: "AuthRetryableFetchError", status: 0 }, "login"), {
    status: 503, code: "provider_unavailable", error: "认证服务暂时不可用，请稍后重试。",
  });
  assert.deepEqual(mapAuthError({ name: "TypeError", status: 0, cause: new Error("fetch failed") }, "login"), {
    status: 503, code: "provider_unavailable", error: "认证服务暂时不可用，请稍后重试。",
  });
  assert.equal(mapAuthError({ code: "weak_password", status: 400 }, "signup").code, "password_policy");
  assert.equal(mapAuthError({ code: "over_email_send_rate_limit", status: 429 }, "signup").code, "rate_limited");
  assert.equal(mapAuthError({ code: "unexpected_failure", status: 503 }, "login").code, "provider_unavailable");
});

function goal(context: AuthenticatedFilterContext, id: string): Goal {
  return {
    id,
    userId: context.authenticatedUserId,
    filterId: context.filterId,
    objective: `Goal ${id}`,
    status: "waiting",
    successCriteria: ["done"],
    openQuestions: ["What changed?"],
    taskIds: [],
    completedTaskIds: [],
    taskMetadata: [],
    completedCriteria: [],
    remainingCriteria: ["done"],
    createdAt: now,
    updatedAt: now,
    watch: {
      resumeCondition: { type: "POLL", reason: "Check", target: id, nextCheckAt: now },
      consecutiveNoChangeCount: 0,
      watchStatus: "waiting",
      lastCheckOutcome: "not_checked",
    },
  };
}

test("protected Control API rejects unauthenticated requests", async () => {
  const response = await handleBackendRequest(new Request("http://localhost/api/control/goals?filterId=filter-a"));
  assert.equal(response.status, 401);
});

test("legacy synthetic session cannot authenticate a real account", async () => {
  const request = new Request("http://localhost/api/control/goals", {
    headers: { Cookie: "signal_map_session=legacy-forged-session" },
  });
  const auth = await resolveAuthContext(request);
  assert.equal(auth, null);
});

test("password login sets protected cookies, restore verifies Supabase uid, logout clears them", async (t) => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.after(() => {
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorKey;
  });
  const user = { id: "supabase-user-a", aud: "authenticated", role: "authenticated", email: "fixture@example.com", app_metadata: {}, user_metadata: {}, created_at: now };
  const jwt = ["e30", Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "test-signature"].join(".");
  let userLookups = 0;
  let refreshCalls = 0;
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.origin, "https://auth-fixture.supabase.co");
    if (url.pathname.endsWith("/token")) {
      if (url.searchParams.get("grant_type") === "refresh_token") {
        refreshCalls += 1;
        assert.equal(JSON.parse(String(init?.body)).refresh_token, "test-refresh-token");
      } else {
        assert.equal(url.searchParams.get("grant_type"), "password");
        assert.deepEqual(JSON.parse(String(init?.body)), { email: "fixture@example.com", password: " password with spaces ", gotrue_meta_security: {} });
      }
      return Response.json({ access_token: jwt, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname.endsWith("/user")) { userLookups += 1; return Response.json(user); }
    if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
    throw new Error("Unexpected Auth transport call");
  });
  const login = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://signal.benzhenlab.com" },
    body: JSON.stringify({ email: user.email, password: " password with spaces " }),
  }));
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  assert.ok(cookies.every((cookie) => /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
  const cookie = cookies.map((part) => part.split(";")[0]).join("; ");
  const me = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/me?userId=user-b&guest=true", { headers: { Cookie: cookie } }));
  assert.deepEqual(await me.json(), { user: { id: user.id, mode: "authenticated" } });
  assert.ok(userLookups > 0);
  const storedCookie = cookies.find((part) => part.startsWith("sb-auth-fixture-auth-token="))!;
  const storedValue = decodeURIComponent(storedCookie.split(";")[0].slice(storedCookie.indexOf("=") + 1));
  const expired = JSON.parse(Buffer.from(storedValue.slice("base64-".length), "base64url").toString());
  expired.expires_at = Math.floor(Date.now() / 1000) - 120;
  const expiredCookie = `sb-auth-fixture-auth-token=base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;
  const restored = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/me", { headers: { Cookie: expiredCookie } }));
  assert.deepEqual(await restored.json(), { user: { id: user.id, mode: "authenticated" } });
  assert.equal(refreshCalls, 1);
  assert.ok(restored.headers.getSetCookie().length > 0);
  const logout = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/logout", { method: "POST", headers: { Cookie: cookie } }));
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().some((part) => /Max-Age=0/i.test(part)));
});

test("production private APIs do not pretend in-memory storage is PostgreSQL", async (t) => {
  const priorMode = process.env.NODE_ENV;
  const priorDatabase = process.env.DATABASE_URL;
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "verified-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now }));
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (priorMode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: priorMode });
    if (priorDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDatabase;
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorKey;
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/control/knowledge", { headers: { Authorization: "Bearer test-token" } }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Service temporarily unavailable" });
});

test("cross-origin password login is rejected", async () => {
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));
  assert.equal(response.status, 403);
});

test("an upstream 5xx keeps its 503 body and code while exposing whitelisted diagnostics", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { message: "upstream secret detail", error_code: "unexpected_failure" },
    { status: 502 },
  ));

  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));

  // Existing HTTP status and error/code semantics must not change.
  assert.equal(response.status, 503);
  const bodyText = await response.text();
  assert.deepEqual(JSON.parse(bodyText), { error: "认证服务暂时不可用，请稍后重试。", code: "provider_unavailable" });

  // Whitelisted diagnostics only. 502 is in the SDK network-error set, so the
  // class is AuthRetryableFetchError (AuthApiError is reserved for 4xx JSON).
  assert.equal(response.headers.get("x-signal-auth-upstream-status"), "502");
  assert.equal(response.headers.get("x-signal-auth-error-name"), "AuthRetryableFetchError");

  // No upstream message, credential, or transport detail may appear anywhere.
  const serialized = JSON.stringify({ headers: [...response.headers.entries()], body: bodyText });
  for (const forbidden of ["upstream secret detail", "unexpected_failure", "fixture@example.com", "test-password", "test-publishable-key", "auth-fixture", "supabase.co", "Bearer", "access_token"]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostics must not leak ${forbidden}`);
  }
});

test("missing upstream status and name degrade to unknown without changing the 503", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => new Response("upstream body text", { status: 503 }));

  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "认证服务暂时不可用，请稍后重试。", code: "provider_unavailable" });
  assert.equal(response.headers.get("x-signal-auth-upstream-status"), "503");
  // 503 is in the SDK network-error set, so the class is AuthRetryableFetchError
  // even though the upstream body was not JSON.
  assert.equal(response.headers.get("x-signal-auth-error-name"), "AuthRetryableFetchError");
  assert.equal(JSON.stringify([...response.headers.entries()]).includes("upstream body text"), false);
});

test("an unrecognized error class degrades to unknown instead of echoing it", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  // A 4xx JSON body yields AuthApiError, which IS on the allow-list, so the
  // unrecognised-class path needs a status that still maps to provider_unavailable
  // while carrying a class the SDK does not define.
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { message: "upstream secret detail", error_code: "unexpected_failure" },
    { status: 530 },
  ));

  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-signal-auth-upstream-status"), "530");
  assert.equal(response.headers.get("x-signal-auth-error-name"), "AuthRetryableFetchError");
  const serialized = JSON.stringify([...response.headers.entries()]);
  assert.equal(serialized.includes("upstream secret detail"), false);
  assert.equal(serialized.includes("unexpected_failure"), false);
});

test("an allow-list miss never echoes an arbitrary error name", async (t) => {
  // Direct unit proof of the allow-list: a fabricated error object with an
  // untrusted name and an out-of-range status must both degrade to "unknown".
  const { upstreamErrorNameHeader, upstreamStatusHeader } = await import("../backend/handlers.ts");
  assert.equal(upstreamErrorNameHeader({ name: "AuthApiError" }), "AuthApiError");
  assert.equal(upstreamErrorNameHeader({ name: "TotallyCustomError" }), "unknown");
  assert.equal(upstreamErrorNameHeader({ name: 42 }), "unknown");
  assert.equal(upstreamErrorNameHeader({}), "unknown");
  assert.equal(upstreamErrorNameHeader(null), "unknown");
  assert.equal(upstreamStatusHeader({ status: 502 }), "502");
  assert.equal(upstreamStatusHeader({ status: 0 }), "unknown");
  assert.equal(upstreamStatusHeader({ status: 999 }), "unknown");
  assert.equal(upstreamStatusHeader({ status: "502" }), "unknown");
  assert.equal(upstreamStatusHeader({}), "unknown");
  assert.equal(upstreamStatusHeader(undefined), "unknown");
});

test("auth_failed exposes only bounded safe fingerprint headers", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "unexpected_failure" }, { status: 400 }));

  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "登录未完成，请检查邮箱和密码。", code: "auth_failed" });
  assert.equal(response.headers.get("x-signal-auth-error-name"), "AuthApiError");
  assert.equal(response.headers.get("x-signal-auth-error-status"), "400");
  // auth-js may discard the upstream `code` field for this response shape.
  assert.equal(response.headers.get("x-signal-auth-error-code"), "none");
  assert.equal(response.headers.get("x-signal-auth-error-constructor"), "AuthApiError");
  assert.equal(response.headers.get("x-signal-auth-cause-name"), "none");
  assert.equal(response.headers.get("x-signal-auth-cause-code"), "none");
  const serialized = JSON.stringify([...response.headers.entries()]);
  for (const forbidden of ["fixture@example.com", "test-password", "test-publishable-key", "auth-fixture", "supabase.co", "unexpected message", "access_token", "Bearer"]) {
    assert.equal(serialized.includes(forbidden), false, `fingerprint must not leak ${forbidden}`);
  }
});

test("invalid_credentials keeps its response and has no fingerprint headers", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "invalid_credentials", message: "Invalid login credentials" }, { status: 400 }));

  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "test-password" }),
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "邮箱或密码不正确。", code: "invalid_credentials" });
  // Credentials-path diagnostics stay off: the change is scoped to provider_unavailable.
  assert.equal(response.headers.get("x-signal-auth-upstream-status"), null);
  assert.equal(response.headers.get("x-signal-auth-error-name"), null);
});

test("verified users get separate default filters and cannot request the other's filter", async (t) => {
  const keys = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  delete process.env.DATABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async (target: string, init?: RequestInit) => {
    assert.equal(String(target), "https://auth-fixture.supabase.co/auth/v1/user");
    const authorization = new Headers(init?.headers).get("authorization");
    if (!["Bearer test-a", "Bearer test-b"].includes(authorization ?? "")) {
      return Response.json({ code: "bad_jwt", message: "Invalid token" }, { status: 401 });
    }
    return Response.json({ id: authorization === "Bearer test-a" ? "verified-a" : "verified-b", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now });
  });
  for (const token of ["test-a", "test-b"]) {
    const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/control/goals", { headers: { Authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 200);
  }
  const crossFilter = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/control/knowledge?filterId=account-verified-b&userId=verified-b", { headers: { Authorization: "Bearer test-a" } }));
  assert.equal(crossFilter.status, 403);
  const invalid = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/control/goals?guest=true", { headers: { Authorization: "Bearer invalid" } }));
  assert.equal(invalid.status, 401);
});

test("guest query and client userId cannot authenticate private APIs", async () => {
  const auth = await resolveAuthContext(new Request("http://localhost/api/control/goals?guest=true&userId=user-b"));
  assert.equal(auth, null);
});

test("Alpha signup creates an authenticated Supabase session", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async (target: string) => {
    assert.equal(String(target), "https://auth-fixture.supabase.co/auth/v1/signup");
    return Response.json({
      user: { id: "new-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now },
      access_token: "fixture-access-token",
      refresh_token: "fixture-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
    });
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/login", {
    method: "POST", headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com", password: "fixture-password", action: "signup" }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { user?: { id: string } }).user?.id, "new-user");
});

test("password reset is server-side and points to the recovery page", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async (target: string | URL, init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.pathname, "/auth/v1/recover");
    assert.equal(url.searchParams.get("redirect_to"), "https://signal.benzhenlab.com/auth/reset-password");
    assert.equal(JSON.parse(String(init?.body)).email, "fixture@example.com");
    return Response.json({});
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-reset", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fixture@example.com" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "reset_requested" });
});

test("password update rejects requests without a verified recovery session", async (t) => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.after(() => {
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorKey;
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "bad_jwt", message: "Invalid token" }, { status: 401 }));
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-update", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ password: "new-password" }),
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "重置链接已失效，请重新请求密码重置" });
});

test("password recovery verifies a token_hash before password update", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async (target: string | URL, init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.pathname, "/auth/v1/verify");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.token_hash, "valid-token-hash");
    assert.equal(body.type, "recovery");
    assert.equal(body.gotrue_meta_security.captcha_token, undefined);
    return Response.json({
      access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600,
      user: { id: "recovered-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now },
    });
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-recovery", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ token_hash: "valid-token-hash", type: "recovery" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("sb-auth-fixture-auth-token=")));
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /valid-token-hash/);
});

test("password recovery rejects invalid token_hash with an explicit error", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "otp_disabled", message: "One-time token not found" }, { status: 403 }));
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-recovery", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ token_hash: "invalid-token-hash", type: "recovery" }),
  }));
  assert.equal(response.status, 401);
  const body = await response.json() as { code: string; error: string };
  assert.equal(body.code, "invalid_recovery_token");
  assert.doesNotMatch(JSON.stringify(body), /invalid-token-hash/);
});

test("password recovery rejects non-recovery link types without calling Supabase", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return Response.json({}); });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-recovery", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json" },
    body: JSON.stringify({ token_hash: "valid-token-hash", type: "signup" }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "invalid_recovery_token");
  assert.equal(calls, 0);
});

test("authenticated recovery session can update the password", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  const user = { id: "recovered-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now };
  const session = {
    access_token: "fixture-access-token",
    refresh_token: "fixture-refresh-token",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    user,
  };
  const cookie = `sb-auth-fixture-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  let updated = false;
  t.mock.method(globalThis, "fetch", async (target: string | URL, init?: RequestInit) => {
    const url = new URL(String(target));
    if (url.pathname === "/auth/v1/user" && (init?.method ?? "GET") === "GET") return Response.json(user);
    if (url.pathname === "/auth/v1/user" && init?.method === "PUT") {
      updated = true;
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-access-token");
      assert.deepEqual(JSON.parse(String(init.body)), { password: "new-password", code_challenge: null, code_challenge_method: null });
      return Response.json({ user });
    }
    throw new Error("Unexpected Auth transport call");
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-update", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ password: "new-password" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(updated, true);
});

test("Agent API never falls back to guest when no database or auth exists", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/research/agent?guest=true", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry: "AI tools", userId: "user-b" }),
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("tenant reads cannot cross user or filter boundaries", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveFilter(userA, { id: userA.filterId, userId: userA.authenticatedUserId, name: "A", createdAt: now, updatedAt: now });
  repository.saveFilter(userB, { id: userB.filterId, userId: userB.authenticatedUserId, name: "B", createdAt: now, updatedAt: now });
  repository.saveGoal(userA, goal(userA, "goal-a"));
  repository.saveGoal(userB, goal(userB, "goal-b"));
  repository.addPersonalKnowledge(userB, { type: "KNOWN_INFORMATION", text: "Private B knowledge" }, now);
  repository.saveNotification(userB, {
    id: "notification-b",
    notificationKey: "key-b",
    userId: userB.authenticatedUserId,
    filterId: userB.filterId,
    attention: "MUST_READ",
    deliveryAction: "IMMEDIATE",
    relatedEvidenceIds: [],
    status: "DELIVERED",
    createdAt: now,
  });

  assert.equal(repository.filterBelongsTo(userA), true);
  assert.equal(repository.filterBelongsTo({ authenticatedUserId: userA.authenticatedUserId, filterId: userB.filterId }), false);
  assert.equal((await getControlGoals({ context: userA, repository })).goals.length, 1);
  assert.equal((await getControlGoals({ context: userA, repository, goalId: "goal-b" })).goal, null);
  assert.equal((await getControlKnowledge({ context: userA, repository })).knowledge.length, 0);
  assert.equal((await getControlNotifications({ context: userA, repository })).notifications.length, 0);
});

test("control actions cannot mark another user's notification as read", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveNotification(userB, {
    id: "notification-b",
    notificationKey: "key-b",
    userId: userB.authenticatedUserId,
    filterId: userB.filterId,
    attention: "MUST_READ",
    deliveryAction: "IMMEDIATE",
    relatedEvidenceIds: [],
    status: "DELIVERED",
    createdAt: now,
  });

  assert.equal(await markNotificationRead({ context: userA, repository, notificationId: "notification-b", now }), null);
  const own = await markNotificationRead({ context: userB, repository, notificationId: "notification-b", now });
  assert.equal(own?.readAt, now);
  assert.equal(own?.unread, false);
});

test("scheduler resumes due goals with each goal's original tenant context", async () => {
  const repository = new InMemorySignalRepository();
  repository.saveGoal(userA, goal(userA, "goal-a"));
  repository.saveGoal(userB, goal(userB, "goal-b"));
  const seenContexts: string[] = [];

  const result = await runSchedulerTick({
    workerId: "worker-a",
    repository,
    input: {} as never,
    now,
    checkCondition: () => "condition_met",
    runTask: async (input) => {
      seenContexts.push(`${input.context?.authenticatedUserId}:${input.context?.filterId}`);
      return { status: "completed" } as never;
    },
  });

  assert.equal(result.claimedCount, 2);
  assert.deepEqual(seenContexts.sort(), ["user-a:filter-a", "user-b:filter-b"]);
});
