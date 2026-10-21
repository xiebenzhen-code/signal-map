import assert from "node:assert/strict";
import test from "node:test";
import * as storage from "../lib/alpha-storage.ts";

// The old implementation ignores ownership: run the same operations against it
// so the red result demonstrates actual A/B data sharing, not a missing import.
const accountStorage = (owner: string | null) =>
  (storage as typeof storage & { createAlphaStorage?: (owner: string | null) => typeof storage })
    .createAlphaStorage?.(owner) ?? storage;

test("local account storage boundaries", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const databases = new Map<string, Map<string, unknown>>();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open(name: string) {
      if (!databases.has(name)) databases.set(name, new Map());
      const values = databases.get(name)!;
      const database = {
        close() {},
        transaction() {
          const transaction = {
            oncomplete: undefined as undefined | (() => void),
            objectStore: () => ({
              get(key: string) {
                const request = { result: structuredClone(values.get(key)), onsuccess: undefined as undefined | (() => void) };
                queueMicrotask(() => request.onsuccess?.());
                return request;
              },
              put(value: unknown, key: string) { values.set(key, structuredClone(value)); },
              clear() { values.clear(); },
            }),
          };
          setTimeout(() => transaction.oncomplete?.(), 0);
          return transaction;
        },
      };
      const request = { result: database, onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, "indexedDB", prior); else Reflect.deleteProperty(globalThis, "indexedDB"); });

  await t.test("A -> B -> A never shares notes or previous research", async () => {
    const a = accountStorage("account-A"), b = accountStorage("account-B");
    await a.setAlphaValue("notes", { marker: "A-only" });
    await a.setAlphaValue("lastRunByFilterId", { marker: { filterId: "A" } } as never);
    const bView = await b.loadAlphaSnapshot();
    assert.deepEqual(bView.notes, {}, "B must not read A's local notes");
    assert.deepEqual(bView.lastRunByFilterId, {});
    await b.setAlphaValue("notes", { marker: "B-only" });
    assert.deepEqual((await accountStorage("account-A").loadAlphaSnapshot()).notes, { marker: "A-only" });
  });
  await t.test("anonymous legacy data is preserved but never adopted by an account", async () => {
    await storage.setAlphaValue("notes", { legacy: "anonymous-only" });
    assert.deepEqual((await accountStorage("new-account").loadAlphaSnapshot()).notes, {});
    assert.deepEqual((await accountStorage(null).loadAlphaSnapshot()).notes, { legacy: "anonymous-only" });
  });
  await t.test("clearing B leaves A and anonymous data intact", async () => {
    await accountStorage("account-B").clearAlphaData();
    assert.deepEqual((await accountStorage("account-A").loadAlphaSnapshot()).notes, { marker: "A-only" });
    assert.deepEqual((await accountStorage(null).loadAlphaSnapshot()).notes, { legacy: "anonymous-only" });
  });
  await t.test("an old A write remains bound to A while B is active", async () => {
    const a = accountStorage("account-A");
    const delayed = Promise.resolve().then(() => a.setAlphaValue("notes", { delayed: "A" }));
    await accountStorage("account-B").setAlphaValue("notes", { fresh: "B" });
    await delayed;
    assert.deepEqual((await accountStorage("account-B").loadAlphaSnapshot()).notes, { fresh: "B" });
  });
});
