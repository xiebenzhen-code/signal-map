import assert from "node:assert/strict";
import test from "node:test";

type SessionState = { status: "checking" | "ready" | "error"; userId: string | null };
type SessionKind = "checking" | "anonymous" | "authenticated" | "error";
type LogoutResult = { status: "signed_out" } | { status: "failed"; message: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// The home page decides whether to show the logout control from this module, so
// the assertions below exercise the same logic the header renders — not a string
// match against the component source.
async function loadSessionControls() {
  const mod = await import("../lib/session-controls.ts") as Record<string, unknown>;
  assert.equal(typeof mod.describeSessionControl, "function", "describeSessionControl must be exported");
  assert.equal(typeof mod.performLogout, "function", "performLogout must be exported");
  return {
    describe: mod.describeSessionControl as (state: SessionState) => SessionKind,
    logout: mod.performLogout as (options?: { request?: FetchLike }) => Promise<LogoutResult>,
  };
}

test("a signed-in session shows the logout control and an anonymous one does not", async () => {
  const { describe } = await loadSessionControls();
  assert.equal(describe({ status: "ready", userId: "user-1" }), "authenticated");
  assert.equal(describe({ status: "ready", userId: null }), "anonymous");
});

test("checking and failed session states never resolve to authenticated", async () => {
  const { describe } = await loadSessionControls();
  // A stale user id must not keep the logout control visible while checking,
  // and a failed check must not be rendered as a signed-in or signed-out result.
  assert.equal(describe({ status: "checking", userId: "user-1" }), "checking");
  assert.equal(describe({ status: "checking", userId: null }), "checking");
  assert.equal(describe({ status: "error", userId: "user-1" }), "error");
  assert.equal(describe({ status: "error", userId: null }), "error");
});

test("logout goes through the existing server endpoint with same-origin credentials", async () => {
  const { logout } = await loadSessionControls();
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const result = await logout({
    request: async (input, init) => { calls.push({ input, init }); return new Response("{}", { status: 200 }); },
  });

  assert.deepEqual(result, { status: "signed_out" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "/api/auth/logout");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.credentials, "same-origin");
});

test("logout never issues a research request", async () => {
  const { logout } = await loadSessionControls();
  const seen: string[] = [];
  await logout({
    request: async (input) => { seen.push(input); return new Response("{}", { status: 200 }); },
  });
  assert.deepEqual(seen, ["/api/auth/logout"]);
  assert.equal(seen.some((input) => input.startsWith("/api/signals")), false);
  assert.equal(seen.some((input) => input.startsWith("/api/research")), false);
});

test("a rejected logout stays failed and is never reported as signed out", async () => {
  const { logout } = await loadSessionControls();
  const result = await logout({ request: async () => new Response("nope", { status: 503 }) });
  assert.equal(result.status, "failed");
  assert.ok(result.status === "failed" && result.message.includes("503"), "message must name the HTTP status");
});

test("a transport failure is reported as failed, not swallowed", async () => {
  const { logout } = await loadSessionControls();
  const result = await logout({ request: async () => { throw new Error("network down"); } });
  assert.equal(result.status, "failed");
  assert.ok(result.status === "failed" && result.message.length > 0);
});

test("after a successful logout the session view is anonymous, so account controls disappear", async () => {
  const { describe } = await loadSessionControls();
  assert.equal(describe({ status: "ready", userId: null }), "anonymous");
  // A refresh that fails to restore the session must not show account controls either.
  assert.equal(describe({ status: "error", userId: null }), "error");
});
