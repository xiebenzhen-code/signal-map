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
  assert.equal(mapAuthError({ code: "invalid_credentials", status: 400 }, "login").code, "invalid_credentials");
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

test("password recovery exchanges the email code before password update", async (t) => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  t.mock.method(globalThis, "fetch", async (target: string | URL, init?: RequestInit) => {
    const url = new URL(String(target));
    assert.equal(url.pathname, "/auth/v1/token");
    assert.equal(url.searchParams.get("grant_type"), "pkce");
    assert.deepEqual(JSON.parse(String(init?.body)), { auth_code: "recovery-code", code_verifier: "test-verifier" });
    return Response.json({
      access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600,
      user: { id: "recovered-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now },
    });
  });
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/auth/password-recovery", {
    method: "POST",
    headers: { Origin: "https://signal.benzhenlab.com", "Content-Type": "application/json", Cookie: `sb-auth-fixture-auth-token-code-verifier=base64-${Buffer.from(JSON.stringify("test-verifier/recovery")).toString("base64url")}` },
    body: JSON.stringify({ code: "recovery-code" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("sb-auth-fixture-auth-token=")));
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
