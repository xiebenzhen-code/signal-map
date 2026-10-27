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
type LifecycleEvent = { persisted?: boolean };
function boundary() {
  const states: unknown[] = []; let cursor = 0; let effect: (() => (() => void)) | undefined;
  type Listener = (event: LifecycleEvent) => void;
  const windowListeners = new Map<string, Listener>();
  const documentListeners = new Map<string, Listener>();
  const events = (listeners: Map<string, Listener>) => ({
    addEventListener: (name: string, callback: Listener) => listeners.set(name, callback),
    removeEventListener: (name: string, callback: Listener) => { if (listeners.get(name) === callback) listeners.delete(name); },
  });
  const document = { ...events(documentListeners), visibilityState: "visible" };
  const pending: Array<{ resolve: (user: LocalAccount) => void; reject: (error: Error) => void }> = [];
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  };
  const useEffect = (run: () => (() => void)) => { effect ??= run; };
  const component = new Function("React", "useState", "useEffect", "resolveLocalAccount", "window", "document", js + ";return LocalAccountBoundary;")(
    { createElement, Fragment }, useState, useEffect,
    () => new Promise<LocalAccount>((resolve, reject) => pending.push({ resolve, reject })), events(windowListeners), document,
  );
  const users: LocalAccount[] = [];
  return {
    render: () => { cursor = 0; return component({ children: (user: LocalAccount) => { users.push(user); return createElement("span", { key: user?.id ?? "anonymous" }, user?.id ?? "anonymous"); } }) as ReactElement; },
    start: () => effect!(),
    focus: () => windowListeners.get("focus")?.({}),
    pageShow: (persisted: boolean) => windowListeners.get("pageshow")?.({ persisted }),
    visibility: (state: "visible" | "hidden") => { document.visibilityState = state; documentListeners.get("visibilitychange")?.({}); },
    pending, users,
  };
}
function accountPanel(root: ReactElement) {
  return (root.props as { children: ReactElement[] }).children[0].props as { style: { display?: string; visibility?: string }; children: ReactElement | false };
}
test("no local child loads before authentication, and errors do not fall back to anonymous", async () => {
  const ui = boundary(); ui.render(); assert.deepEqual(ui.users, []); ui.start();
  ui.pending[0].reject(new Error("offline")); await tick(); ui.render(); assert.deepEqual(ui.users, []);
});
test("focus and idle visibility return do not recheck or interrupt the verified page", async () => {
  const ui = boundary(); ui.render(); ui.start();
  const user: LocalAccount = { id: "A", mode: "authenticated" };
  ui.pending[0].resolve(user); await tick(); ui.render();
  for (let i = 0; i < 10; i++) { ui.visibility("hidden"); ui.visibility("visible"); ui.focus(); }
  await tick();
  assert.equal(ui.pending.length, 1, "idle return must not start another account request");
  const root = ui.render(); const panel = accountPanel(root);
  assert.equal(panel.style.visibility, "visible");
  assert.equal((panel as unknown as { inert: boolean }).inert, false);
  assert.equal((root.props as { children: unknown[] }).children[1], false, "no account confirmation notice");
  assert.equal(ui.users.at(-1), user);
});

test("normal pageshow does not duplicate the initial account request", async () => {
  const ui = boundary(); ui.render(); ui.start(); ui.pageShow(false); await tick();
  assert.equal(ui.pending.length, 1);
});
test("BFCache restoration rechecks and retains same-account identity", async () => {
  const ui = boundary(); ui.render(); ui.start();
  const user: LocalAccount = { id: "A", mode: "authenticated" };
  ui.pending[0].resolve(user); await tick(); ui.render();
  ui.visibility("hidden"); await tick(); assert.equal(ui.pending.length, 1);
  ui.visibility("visible"); ui.pageShow(true); await tick();
  assert.equal(ui.pending.length, 2, "one return must cause one revalidation");
  const checking = accountPanel(ui.render());
  assert.equal(checking.style.visibility, "visible", "background checks must not replace the page");
  assert.equal((checking as unknown as { inert: boolean }).inert, true);
  assert.notEqual(checking.style.display, "none");
  assert.ok(checking.children, "keep the mounted account subtree while checking");
  ui.pending[1].resolve({ id: "A", mode: "authenticated" }); await tick();
  assert.equal(accountPanel(ui.render()).style.visibility, "visible");
  assert.equal(ui.users.at(-1), user, "same identity must not reload knowledge and follows");
});
test("an account change during an in-flight check queues one fresh request and discards stale data", async () => {
  const ui = boundary(); ui.render(); ui.start();
  ui.pageShow(true); await tick();
  assert.equal(ui.pending.length, 1, "account checks must not overlap");
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  assert.equal(ui.users.length, 0, "the pre-return account response is obsolete");
  assert.equal(ui.pending.length, 2, "recheck after the older request finishes");
  ui.pending[1].resolve({ id: "B", mode: "authenticated" }); await tick(); ui.render();
  assert.ok(ui.users.length); assert.ok(ui.users.every((user) => user?.id === "B"));
});
test("revalidation failure preserves the mounted draft without opening the anonymous store", async () => {
  const ui = boundary(); ui.render(); ui.start();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  ui.pageShow(true); await tick();
  ui.pending[1].reject(new Error("offline")); await tick();
  const panel = accountPanel(ui.render());
  assert.equal(panel.style.visibility, "visible"); assert.ok(panel.children, "a transient error must not discard the draft subtree");
  assert.equal((panel as unknown as { inert: boolean }).inert, true);
  assert.ok(ui.users.every((user) => user?.id === "A"));
});
test("confirmed logout switches to a separate anonymous subtree", async () => {
  const ui = boundary(); ui.render(); ui.start();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick();
  assert.equal((accountPanel(ui.render()).children as ReactElement).key, "A");
  ui.pageShow(true); await tick();
  ui.pending[1].resolve(null); await tick();
  assert.equal((accountPanel(ui.render()).children as ReactElement).key, "anonymous");
  assert.equal(ui.users.at(-1), null);
});
test("cleanup removes event listeners and ignores already queued revalidation", async () => {
  const ui = boundary(); ui.render(); const cleanup = ui.start();
  ui.visibility("hidden"); ui.visibility("visible"); cleanup();
  ui.pageShow(true); ui.pageShow(true); await tick();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  assert.equal(ui.pending.length, 1); assert.deepEqual(ui.users, []);
});
test("focus while the initial request is pending does not invalidate its response", async () => {
  const ui = boundary(); ui.render(); ui.start();
  ui.focus(); ui.visibility("hidden"); ui.visibility("visible"); await tick();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick();
  assert.equal(ui.pending.length, 1);
  assert.equal((accountPanel(ui.render()).children as ReactElement).key, "A");
});

test("account resolver distinguishes anonymous, authenticated, malformed and unavailable", async () => {
  const request = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;
  assert.equal(await resolveLocalAccount(request({ user: null })), null);
  assert.deepEqual(await resolveLocalAccount(request({ user: { id: "A", mode: "authenticated" } })), { id: "A", mode: "authenticated" });
  await assert.rejects(resolveLocalAccount(request({ user: null }, 503)));
  await assert.rejects(resolveLocalAccount(request({})));
  await assert.rejects(resolveLocalAccount(request({ user: { id: "", mode: "authenticated" } })));
});


test("only initial confirmation occupies the page; BFCache restoration uses a small status", async () => {
  const ui = boundary();
  const notices = (root: ReactElement) => (root.props as { children: ReactElement[] }).children[1];
  assert.equal(notices(ui.render()).type, "main"); ui.start();
  ui.pending[0].resolve({ id: "A", mode: "authenticated" }); await tick(); ui.render();
  ui.pageShow(true); await tick();
  const notice = notices(ui.render());
  assert.equal(notice.type, "aside", "background revalidation must not show the initial full-page confirmation");
  assert.equal((notice.props as { role: string }).role, "status");
  assert.equal((notice.props as { style: { inset?: number } }).style.inset, undefined);
});

test("same-account recovery after a restoration error retains identity and unlocks the existing page", async () => {
  const ui = boundary(); ui.render(); ui.start();
  const user: LocalAccount = { id: "A", mode: "authenticated" };
  ui.pending[0].resolve(user); await tick(); ui.render();
  ui.pageShow(true); await tick(); ui.pending[1].reject(new Error("offline")); await tick(); ui.render();
  assert.equal(ui.users.at(-1), user, "do not erase the resolved account on a transport error");
  ui.pageShow(true); await tick(); ui.pending[2].resolve({ id: "A", mode: "authenticated" }); await tick();
  const panel = accountPanel(ui.render());
  assert.equal(ui.users.at(-1), user);
  assert.equal((panel as unknown as { inert: boolean }).inert, false);
});
