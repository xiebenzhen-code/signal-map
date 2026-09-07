import assert from "node:assert/strict";
import test from "node:test";
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
