import assert from "node:assert/strict";
import test from "node:test";

import { createResearchRequest } from "../information/research-request.ts";
import type { ActiveKnowledgeContext } from "../information/types.ts";

const knowledge: ActiveKnowledgeContext = {
  identity: "AI product builder",
  industry: "AI developer tools",
  focusAreas: ["Codex", "Claude Code"],
  currentQuestions: ["What changed in coding agent workflows?"],
  knownInformation: ["Codex is available"],
  informationGaps: ["official changelog coverage"],
  trackedEntities: ["OpenAI", "Anthropic"],
  trackedEvents: ["Codex release"],
  userJudgements: ["Workflow changes matter more than launch news"],
  freshnessWindow: "7d",
  sourceScope: "hybrid",
  customSources: ["https://developers.openai.com/codex/changelog"],
  researchContextRevision: 3,
};

test("research request sends knowledge context in POST body, not URL query", () => {
  const request = createResearchRequest(knowledge);

  assert.equal(request.url, "/api/signals");
  assert.equal(request.method, "POST");
  assert.equal(request.cache, "no-store");
  assert.equal(new URL(request.url, "http://localhost").search, "");

  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  assert.equal(body.industry, "AI developer tools");
  assert.deepEqual(body.focusAreas, ["Codex", "Claude Code"]);
  assert.deepEqual(body.knownInformation, ["Codex is available"]);
  assert.deepEqual(body.customSources, ["https://developers.openai.com/codex/changelog"]);
});

test("research request does not expose identity ownership or secrets", () => {
  const request = createResearchRequest(knowledge);
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  const bodyKeys = Object.keys(body).map((key) => key.toLowerCase());

  assert.equal(body.userId, undefined);
  assert.equal(body.evidenceHistory, "");
  assert.equal(bodyKeys.some((key) => key.includes("token")), false);
  assert.equal(bodyKeys.some((key) => key.includes("secret")), false);
  assert.equal(bodyKeys.some((key) => key.includes("password")), false);
});
