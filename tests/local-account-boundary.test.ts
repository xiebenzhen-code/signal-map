import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, Fragment, type ReactElement } from "react";
import ts from "typescript";
import { resolveLocalAccount, type LocalAccount } from "../lib/local-account.ts";

const source = readFileSync(new URL("../app/components/local-account-boundary.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("boundary.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "LocalAccountBoundary");
assert.ok(declaration);
const js = ts.transpileModule(declaration.getText(ast).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function boundary() {
  const states: unknown[] = []; let cursor = 0; let effect: (() => void) | undefined;
  const listeners = new Map<string, () => void>();
  const pending: Array<{ resolve: (user: LocalAccount) => void; reject: (error: Error) => void }> = [];
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  };
  const useEffect = (run: () => void) => { effect ??= run; };
  const events = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener() {} };
  const component = new Function("React", "useState", "useEffect", "resolveLocalAccount", "window", "document", `${js};return LocalAccountBoundary;`)(
    { createElement, Fragment }, useState, useEffect,
    () => new Promise<LocalAccount>((resolve, reject) => pending.push({ resolve, reject })), events, { ...events, visibilityState: "visible" },
  );
  const users: LocalAccount[] = [];
  return {
    render: () => { cursor = 0; return component({ children: (user: LocalAccount) => { users.push(user); return createElement("span", { key: user?.id ?? "anonymous" }, user?.id ?? "anonymous"); } }) as ReactElement; },
    start: () => effect!(), focus: () => listeners.get("focus")!(), pending, users,
  };
}
test("no local child loads before authentication, and errors do not fall back to anonymous", async () => {
  const ui = boundary(); ui.render(); assert.deepEqual(ui.users, []); ui.start();
  ui.pending[0].reject(new Error("offline")); await tick(); ui.render(); assert.deepEqual(ui.users, []);
});
test("a late old-account response cannot replace a newer account", async () => {
  const ui = boundary(); ui.render(); ui.start(); ui.focus();
  ui.pending[1].resolve({ id: "B", mode: "authenticated" }); await tick(); ui.render();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  assert.ok(ui.users.length); assert.ok(ui.users.every((user) => user?.id === "B"));
});
test("same-account focus checks hide but preserve the mounted local child", async () => {
  const ui = boundary(); ui.render(); ui.start();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  ui.focus(); const before = ui.users.length; const checking = ui.render();
  assert.equal(ui.users.length, before + 1, "checking must retain A's child rather than discard in-progress work");
  assert.match(JSON.stringify(checking), /none/);
});
test("account resolver distinguishes anonymous, authenticated, malformed and unavailable", async () => {
  const request = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;
  assert.equal(await resolveLocalAccount(request({ user: null })), null);
  assert.deepEqual(await resolveLocalAccount(request({ user: { id: "A", mode: "authenticated" } })), { id: "A", mode: "authenticated" });
  await assert.rejects(resolveLocalAccount(request({ user: null }, 503)));
  await assert.rejects(resolveLocalAccount(request({})));
  await assert.rejects(resolveLocalAccount(request({ user: { id: "", mode: "authenticated" } })));
});
