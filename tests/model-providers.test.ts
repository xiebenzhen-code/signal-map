import assert from "node:assert/strict";
import test from "node:test";

test("per-request usage summary keeps missing tokens unknown and observers isolated", async () => {
  const { createModelUsageCollector } = await import("../agent/models/usage-observation.ts");
  const usage = createModelUsageCollector();
  const adapter = createModelAdapter({ env: { OPENAI_API_KEY: "test" }, onCall: usage.record,
    fetch: async () => Response.json({ output_text: JSON.stringify({ queries: [] }) }) });
  await adapter.planResearch({ userQuery: "q", relatedKnowledge: [], existingEvidence: [], previousQueries: [], round: 1 });
  assert.equal(usage.snapshot().callCount, 1);
  assert.equal(usage.snapshot().usageCompleteness, "none");
  assert.equal(usage.snapshot().reportedTotalTokens, null);
  assert.equal(usage.snapshot().cost, null);
  const isolated = createModelAdapter({ env: { OPENAI_API_KEY: "test" }, onCall: () => { throw new Error("sink failed"); },
    fetch: async () => Response.json({ output_text: JSON.stringify({ queries: [] }) }) });
  assert.equal((await isolated.planResearch({ userQuery: "q", relatedKnowledge: [], existingEvidence: [], previousQueries: [], round: 1 })).status, "configured");
});

test("model transport reports provider usage without prompts or credentials", async () => {
  const events: unknown[] = [];
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "openai", OPENAI_API_KEY: "secret-key" },
    onCall: (event) => events.push(event), fetch: async () => Response.json({
      output_text: JSON.stringify({ objective: "secret-question", queries: ["secret-query"] }),
      usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
    }) });
  await adapter.planResearch({ userQuery: "secret-question", relatedKnowledge: [], existingEvidence: [], previousQueries: [], round: 1 });
  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.provider, "openai");
  assert.equal(event.stage, "planning");
  assert.equal(event.httpStatus, 200);
  assert.deepEqual(event.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  assert.equal(event.cost, null);
  assert.doesNotMatch(JSON.stringify(events), /secret-key|secret-question|secret-query|Bearer/);
});

test("failed calls and unreported token usage remain observable and unknown", async () => {
  const events: unknown[] = [];
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "secret" },
    onCall: (event) => events.push(event), fetch: async () => new Response("provider secret", { status: 503 }) });
  const result = await adapter.planResearch({ userQuery: "q", relatedKnowledge: [], existingEvidence: [], previousQueries: [], round: 1 });
  assert.equal(result.status, "error");
  assert.equal(events.length, 1);
  assert.equal((events[0] as Record<string, unknown>).usage, null);
  assert.equal((events[0] as Record<string, unknown>).errorCode, "model_unavailable");
  assert.doesNotMatch(JSON.stringify(events), /provider secret/);
});
import { createModelAdapter } from "../agent/model-adapter.ts";

const input = { userQuery: "What changed?", relatedKnowledge: [], existingEvidence: [], previousQueries: [], round: 1 };

test("factory selects DeepSeek without changing AgentRunner contract", () => {
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "deepseek" } });
  assert.equal(adapter.provider, "deepseek");
  assert.equal(adapter.status, "not_configured");
  assert.equal(typeof adapter.planResearch, "function");
});

test("factory selects OpenAI", () => {
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "openai", OPENAI_API_KEY: "test" }, fetch: async () => new Response(JSON.stringify({ output_text: "{}" })) });
  assert.equal(adapter.provider, "openai");
  assert.equal(adapter.status, "configured");
});

test("unknown provider returns a safe configuration error", async () => {
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "unknown" } });
  assert.equal(adapter.status, "error");
  assert.equal((await adapter.planResearch(input)).errorCode, "configuration_error");
});

test("DeepSeek without a key does not call the network", async () => {
  let calls = 0;
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "deepseek" }, fetch: async () => { calls += 1; return new Response("{}"); } });
  assert.equal((await adapter.planResearch(input)).status, "not_configured");
  assert.equal(calls, 0);
});

test("DeepSeek normalizes planning JSON and uses its server configuration", async () => {
  let endpoint = "";
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test", DEEPSEEK_MODEL: "deepseek-test" }, fetch: async (url) => { endpoint = url; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: "updated objective", queries: ["q"], preferredSourceTypes: ["OFFICIAL"], maxQueries: 1 }) } }] })); } });
  const result = await adapter.planResearch(input);
  assert.equal(endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(result.status, "configured");
  assert.equal(result.plan?.objective, "updated objective");
});

test("DeepSeek malformed response returns normalized error for deterministic fallback", async () => {
  const adapter = createModelAdapter({ env: { MODEL_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test" }, fetch: async () => new Response(JSON.stringify({ choices: [] })) });
  const result = await adapter.planResearch(input);
  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "malformed_response");
});

test("DeepSeek request timeout returns normalized error for deterministic fallback", async () => {
  const adapter = createModelAdapter({
    env: {
      MODEL_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test",
      MODEL_REQUEST_TIMEOUT_MS: "5",
    },
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  const result = await adapter.planResearch(input);
  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "timeout");
});

test("a third adapter can satisfy the same contract without AgentRunner changes", async () => {
  const third = {
    provider: "none" as const,
    status: "configured" as const,
    models: { planning: "third", synthesis: "third" },
    async planResearch() { return { status: "configured" as const, plan: { objective: "third", queries: [], preferredSourceTypes: [], maxQueries: 1 } }; },
    async synthesizeEvidence() { return { status: "error" as const, errorCode: "provider_error" as const }; },
  };
  assert.equal((await third.planResearch()).plan?.objective, "third");
});

for (const provider of ["deepseek", "openai"]) {
  test(`${provider} planning cancellation reaches HTTP transport without serializing signal`, async () => {
    const controller = new AbortController();
    let aborted = false;
    const adapter = createModelAdapter({env:{MODEL_PROVIDER:provider,DEEPSEEK_API_KEY:"test",OPENAI_API_KEY:"test"},
      fetch:async (_, init) => {
        assert.doesNotMatch(String(init.body), /"signal"/);
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {aborted=true; reject(new DOMException("cancelled", "AbortError"));}, {once:true});
          controller.abort();
        });
      }});
    const result = await adapter.planResearch({...input,signal:controller.signal});
    assert.equal(aborted,true);
    assert.equal(result.errorCode,"timeout");
  });
}

test("model timeout remains active while reading response body", async () => {
  const adapter = createModelAdapter({env:{MODEL_PROVIDER:"deepseek",DEEPSEEK_API_KEY:"test",MODEL_REQUEST_TIMEOUT_MS:"5"},
    fetch: async (_,init) => new Response(new ReadableStream({start(controller){
      init.signal?.addEventListener("abort", () => controller.error(new DOMException("cancelled","AbortError")),{once:true});
    }}))});
  const result = await adapter.planResearch(input);
  assert.equal(result.errorCode,"timeout");
});
