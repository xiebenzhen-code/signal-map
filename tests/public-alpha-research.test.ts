import assert from "node:assert/strict";
import test from "node:test";

import { resolveResearchIdentity } from "../auth/request-identity.ts";
import { handleBackendRequest } from "../backend/node-server.ts";
import { runResearchPipeline } from "../research/research-pipeline.ts";
import { executeResearch, summarizeAgentFailure } from "../research/research-service.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
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

test("background evidence outside a 24h window cannot become must read", async (t) => {
  const publishedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "api.github.com") {
      return Response.json({
        id: 1,
        name: "Codex workflow update",
        tag_name: "v-test",
        html_url: "https://github.com/openai/codex/releases/tag/v-test",
        body: "A major Codex workflow change with new agent behavior and release details.",
        published_at: publishedAt,
      });
    }
    return emptyNetworkResponse(target);
  });
  const result = await runResearchPipeline(input);
  const background = result.signals.find((signal) => signal.eventStatus === "BACKGROUND");
  assert.ok(background);
  assert.notEqual(background.attentionDecision, "MUST_READ");
});

test("authenticated main research enters the existing persistent Agent loop", async (t) => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request) => {
    const url = new URL(String(target));
    if (url.hostname === "api.github.com") {
      return Response.json({
        id: 2,
        name: "Codex current workflow release",
        tag_name: "v-current",
        html_url: "https://github.com/openai/codex/releases/tag/v-current",
        body: "Codex adds a new documented agent workflow for developers.",
        published_at: new Date().toISOString(),
      });
    }
    return emptyNetworkResponse(target);
  });
  const repository = new InMemorySignalRepository();
  const context = { authenticatedUserId: "account-a", filterId: "filter-a" };
  await repository.saveFilter(context, {
    id: context.filterId,
    userId: context.authenticatedUserId,
    name: "AI tools",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const result = await executeResearch({
    identity: { id: context.authenticatedUserId, mode: "authenticated" },
    input,
    context,
    repository,
  });
  assert.equal(result.dataMode, "live");
  assert.ok((await repository.listPersonalKnowledge(context)).length > 0);
  assert.ok(await repository.getLatestRunMetadata(context));
});

test("agent failure tracing records sanitized early runAgent exceptions", async () => {
  const error = new Error("repository failed token_hash=secret-token password=secret postgresql://user:pass@example/db");
  const repository = {
    listPersonalKnowledge: async () => { throw error; },
  };
  const phases: Array<Parameters<NonNullable<Parameters<typeof executeResearch>[0]["onPhase"]>>[0]> = [];
  await assert.rejects(
    executeResearch({
      identity: { id: "account-trace", mode: "authenticated" },
      input,
      context: { authenticatedUserId: "account-trace", filterId: "account-account-trace" },
      repository: repository as never,
      onPhase: (event) => { phases.push(event); },
    }),
  );
  const failure = phases.find((phase) => phase.phase === "agent_failed_before_source_selection");
  assert.ok(failure);
  assert.equal(failure.failureKind, "throw_exception");
  assert.equal(failure.errorName, "Error");
  assert.match(failure.errorMessage || "", /token_hash=\[redacted\]/);
  assert.match(failure.errorMessage || "", /password=\[redacted\]/);
  assert.doesNotMatch(failure.errorMessage || "", /secret-token|user:pass/);
  assert.ok(failure.topStackFrame);
});

test("agent failure summary distinguishes failure results without exposing secrets", () => {
  const summary = summarizeAgentFailure(
    Object.assign(new Error("Agent returned failure result Authorization=Bearer secret-token"), { code: "UNKNOWN_RESEARCH_FAILURE" }),
    "failure_result",
  );
  assert.equal(summary.phase, "agent_failed_before_source_selection");
  assert.equal(summary.failureKind, "failure_result");
  assert.equal(summary.errorCode, "UNKNOWN_RESEARCH_FAILURE");
  assert.doesNotMatch(summary.errorMessage, /secret-token/);
});
