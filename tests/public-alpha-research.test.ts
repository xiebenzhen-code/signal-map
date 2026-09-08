import assert from "node:assert/strict";
import test from "node:test";

import { resolveResearchIdentity } from "../auth/request-identity.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchInput } from "../research/types.ts";

const input: ResearchInput = {
  identity: "AI product builder", industry: "AI developer tools", focusAreas: "Codex",
  currentQuestions: "What changed in Codex?", knownInformation: "", informationGaps: "recent releases",
  trackedEntities: "Codex", trackedEvents: "", userJudgements: "", evidenceHistory: "", freshnessWindow: "24h",
};

function emptyNetworkResponse(target: string | URL | Request) {
  const url = new URL(String(target));
  if (url.hostname === "news.google.com") return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/xml" } });
  if (url.hostname === "www.reddit.com") return Response.json({ data: { children: [] } });
  if (url.hostname === "api.github.com") return Response.json({ message: "not found" }, { status: 404 });
  return new Response("", { status: 404 });
}

test("server-generated guest identities are signed, stable, and isolated", async (t) => {
  const prior = process.env.SIGNAL_MAP_GUEST_SECRET;
  process.env.SIGNAL_MAP_GUEST_SECRET = "test-only-guest-signing-secret";
  t.after(() => { if (prior === undefined) delete process.env.SIGNAL_MAP_GUEST_SECRET; else process.env.SIGNAL_MAP_GUEST_SECRET = prior; });
  const first = await resolveResearchIdentity(new Request("https://signal.benzhenlab.com/api/signals"));
  const second = await resolveResearchIdentity(new Request("https://signal.benzhenlab.com/api/signals"));
  assert.equal(first.mode, "anonymous");
  assert.equal(second.mode, "anonymous");
  assert.notEqual(first.id, second.id);
  const cookie = first.mode === "anonymous" ? first.setCookie?.split(";")[0] : "";
  const restored = await resolveResearchIdentity(new Request("https://signal.benzhenlab.com/api/signals", { headers: { Cookie: cookie || "" } }));
  assert.equal(restored.id, first.id);
  const forged = await resolveResearchIdentity(new Request("https://signal.benzhenlab.com/api/signals", { headers: { Cookie: "signal_map_guest=00000000-0000-4000-8000-000000000000.forged" } }));
  assert.notEqual(forged.id, "00000000-0000-4000-8000-000000000000");
});

test("24h is an upstream retrieval constraint rather than a front-end-only filter", async (t) => {
  const newsUrls: string[] = [];
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = String(target);
    if (url.includes("news.google.com")) newsUrls.push(url);
    return emptyNetworkResponse(target);
  });
  const result = await runResearchPipeline(input);
  assert.equal(result.queryPlan.requestedFreshnessWindow, "24h");
  assert.ok(newsUrls.length > 0);
  assert.ok(newsUrls.every((url) => decodeURIComponent(url).includes("when:1d")));
  assert.ok(newsUrls.every((url) => !decodeURIComponent(url).includes("when:30d")));
  assert.equal(result.dataMode, "live");
});

test("anonymous signals use the real pipeline and never substitute demo records", async (t) => {
  const prior = process.env.SIGNAL_MAP_GUEST_SECRET;
  process.env.SIGNAL_MAP_GUEST_SECRET = "test-only-guest-signing-secret";
  t.after(() => { if (prior === undefined) delete process.env.SIGNAL_MAP_GUEST_SECRET; else process.env.SIGNAL_MAP_GUEST_SECRET = prior; });
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => emptyNetworkResponse(target));
  const response = await handleBackendRequest(new Request("https://signal.benzhenlab.com/api/signals", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://signal.benzhenlab.com" }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { dataMode: string; signals: unknown[] };
  assert.equal(body.dataMode, "live");
  assert.deepEqual(body.signals, []);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("signal_map_guest=") && /HttpOnly/i.test(cookie)));
});
