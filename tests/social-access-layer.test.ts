import assert from "node:assert/strict";
import test from "node:test";
import { SocialAccessLayer } from "../social/access/social-access-layer.ts";
import type { SocialProvider, SocialProviderStatus } from "../social/providers/types.ts";

function fakeProvider(id: "x" | "xiaohongshu", status: SocialProviderStatus["state"], options: { failSearch?: boolean; failStatus?: boolean; onSearch?: () => void } = {}): SocialProvider {
  return {
    id,
    label: id,
    async getConnectionStatus() {
      if (options.failStatus) throw new Error("status unavailable");
      return { id, label: id, adapter: id === "x" ? "official-api" : "local-browser", state: status, detail: status };
    },
    async search() {
      options.onSearch?.();
      if (options.failSearch) throw new Error("search failed");
      return [{ title: id, url: `https://example.com/${id}`, snippet: id, source: id, retrievedAt: "2026-08-28T08:00:00.000Z", dataOrigin: "live", channel: "社区", authority: 40, origin: id === "x" ? "x" : "xhs" }];
    },
    async getPost() { return null; },
    async getProfile() { return null; },
  };
}

test("one search failure preserves another provider result", async () => {
  const layer = new SocialAccessLayer([
    fakeProvider("x", "connected", { failSearch: true }),
    fakeProvider("xiaohongshu", "connected"),
  ]);
  const result = await layer.search({ query: "Codex", industry: "AI" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source, "xiaohongshu");
  assert.equal(result.outcomes.find((item) => item.provider === "x")?.execution, "failed");
  assert.equal(result.outcomes.find((item) => item.provider === "xiaohongshu")?.execution, "searched_with_results");
});

test("status exception becomes error without rejecting other statuses", async () => {
  const layer = new SocialAccessLayer([
    fakeProvider("x", "connected", { failStatus: true }),
    fakeProvider("xiaohongshu", "connected"),
  ]);
  const statuses = await layer.getConnectionStatuses();
  assert.equal(statuses.find((item) => item.id === "x")?.state, "error");
  assert.equal(statuses.find((item) => item.id === "xiaohongshu")?.state, "connected");
});

test("not configured and unavailable stay distinct and are not searched", async () => {
  let xCalls = 0;
  let xhsCalls = 0;
  const layer = new SocialAccessLayer([
    fakeProvider("x", "not_configured", { onSearch: () => { xCalls += 1; } }),
    fakeProvider("xiaohongshu", "unavailable", { onSearch: () => { xhsCalls += 1; } }),
  ]);
  const result = await layer.search({ query: "Codex", industry: "AI" });
  assert.deepEqual(result.items, []);
  assert.equal(result.statuses.find((item) => item.id === "x")?.state, "not_configured");
  assert.equal(result.statuses.find((item) => item.id === "xiaohongshu")?.state, "unavailable");
  assert.equal(xCalls, 0);
  assert.equal(xhsCalls, 0);
  assert.equal(result.outcomes.find((item) => item.provider === "x")?.execution, "not_configured");
  assert.equal(result.outcomes.find((item) => item.provider === "xiaohongshu")?.execution, "unavailable");
});

test("per-run query budget can leave connected providers explicitly not searched", async () => {
  let calls = 0;
  const layer = new SocialAccessLayer([
    fakeProvider("x", "connected", { onSearch: () => { calls += 1; } }),
  ]);
  const result = await layer.search({ query: "Codex", industry: "AI", maxSearchesPerProvider: 0 });

  assert.equal(calls, 0);
  assert.equal(result.outcomes[0].execution, "not_searched");
});
