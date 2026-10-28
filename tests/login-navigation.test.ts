import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual page handler with browser/network boundaries substituted.
const source = readFileSync(new URL("../app/control/page.tsx", import.meta.url), "utf8");
const handler = source.match(/  async function authenticate\([\s\S]*?(?=\n  async function requestPasswordReset)/)?.[0];
assert.ok(handler, "page authentication handler must exist");
const javascript = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function authenticate(result: unknown, search = "", action = "login", failure?: Error) {
  const destinations: string[] = [];
  const statuses: string[] = [];
  const run = new Function("readJson", "setStatus", "setState", "setPassword", "emptyState", "loginName", "password", "window", `${javascript}; return authenticate;`)(
    async () => { if (failure) throw failure; return result; },
    (status: string) => statuses.push(status), () => {}, () => {}, {}, "test@example.com", "fixture",
    { location: { search, replace: (url: string) => destinations.push(url), assign: (url: string) => destinations.push(url) } },
  );
  await run(action);
  return { destinations, statuses };
}

test("successful login goes home", async () => {
  const result = await authenticate({ user: { id: "fixture", mode: "authenticated" } });
  assert.deepEqual(result.destinations, ["/"]);
});

test("successful login preserves observation mode without forwarding arbitrary URLs", async () => {
  const result = await authenticate({ user: { id: "fixture", mode: "authenticated" } }, "?observe=1&next=https://example.com");
  assert.deepEqual(result.destinations, ["/?observe=1"]);
});

test("verification-required signup stays on the form", async () => {
  const result = await authenticate({ user: null, status: "verification_required" }, "", "signup");
  assert.deepEqual(result.destinations, []);
  assert.ok(result.statuses.includes("注册成功，请先完成邮箱验证再登录"));
});

test("failed or sessionless authentication never navigates", async () => {
  assert.deepEqual((await authenticate(null, "", "login", new Error("登录失败"))).destinations, []);
  assert.deepEqual((await authenticate({ user: null })).destinations, []);
});

test("already signed-in control entry returns home without loading the account dashboard", async () => {
  const load = source.match(/  async function load\(\)[\s\S]*?(?=\n  async function authenticate)/)?.[0];
  assert.ok(load);
  const js = ts.transpileModule(load, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const destinations: string[] = [];
  let dashboards = 0;
  const run = new Function("readJson", "setStatus", "setState", "setUser", "emptyState", "loadDashboardState", "window", `${js};return load;`)(
    async () => ({ user: { id: "test-a", mode: "authenticated" } }), () => {}, () => {}, () => {}, {},
    async () => { dashboards++; return {}; },
    { location: { search: "?observe=1", replace: (url: string) => destinations.push(url) } },
  );
  await run();
  assert.deepEqual(destinations, ["/?observe=1"]);
  assert.equal(dashboards, 0);
});
