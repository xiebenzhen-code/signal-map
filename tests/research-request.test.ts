import assert from "node:assert/strict";
import test from "node:test";

import { createResearchRequest } from "../information/research-request.ts";
import { planQuery } from "../research/query-planner.ts";
import { selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
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
  assert.equal(request.credentials, "same-origin");
  assert.equal(new URL(request.url, "http://localhost").search, "");
  assert.match((request.headers as Record<string, string>)["X-Signal-Map-Request-Id"], /^signals-/);

  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  assert.equal(body.industry, "AI developer tools");
  assert.deepEqual(body.focusAreas, ["Codex", "Claude Code"]);
  assert.deepEqual(body.knownInformation, ["Codex is available"]);
  assert.deepEqual(body.customSources, ["https://developers.openai.com/codex/changelog"]);
});

test("the domestic AI media question reaches both the page request and requestedQuestion", () => {
  const question = "过去7天，36氪快讯和极客公园报道了哪些与国内AI产品或产业有关的新进展？保留原始出处和发布日期，区分已确认信息与待核对线索。";
  const request = createResearchRequest({
    ...knowledge,
    industry: "人工智能与产品工具",
    focusAreas: ["AI 产品", "36氪快讯", "极客公园"],
    currentQuestions: [question],
  });
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  assert.deepEqual(body.currentQuestions, [question]);

  const plan = planQuery({
    ...knowledge,
    industry: String(body.industry),
    focusAreas: (body.focusAreas as string[]).join("\\n"),
    currentQuestions: (body.currentQuestions as string[]).join("\\n"),
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    customSources: "",
  });
  assert.equal(plan.requestedQuestion, question);
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

// --- STEP 2: the fixed domestic-AI question must survive the whole entry path ---

const DOMESTIC_AI_QUESTION = "过去 7 天，36氪快讯和极客公园 AI 报道了哪些国内 AI 产业新进展？";

// Mirrors backend/handlers.ts inputFromRecord: arrays are joined with "\n".
function backendInput(body: Record<string, unknown>) {
  const field = (value: unknown) => Array.isArray(value)
    ? value.map((item) => String(item)).join("\n").trim()
    : typeof value === "string" ? value.trim() : "";
  return {
    identity: field(body.identity),
    industry: field(body.industry),
    focusAreas: field(body.focusAreas),
    currentQuestions: field(body.currentQuestions),
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: field(body.freshnessWindow) || "7d",
    customSources: "",
  };
}

test("the fixed domestic AI question reaches /api/signals and the planner intact", () => {
  const request = createResearchRequest({
    ...knowledge,
    industry: "人工智能与产品工具",
    focusAreas: ["AI 产品"],
    currentQuestions: [DOMESTIC_AI_QUESTION],
    freshnessWindow: "7d",
  });

  // 1. The page posts to /api/signals, never to a query string.
  assert.equal(request.url, "/api/signals");
  assert.equal(request.method, "POST");

  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  // 2. The original question is carried verbatim in currentQuestions.
  assert.deepEqual(body.currentQuestions, [DOMESTIC_AI_QUESTION]);
  // 3. It is not smuggled in through industry.
  assert.notEqual(body.industry, DOMESTIC_AI_QUESTION);
  assert.equal(String(body.industry).includes("36氪"), false);
  // 4. The date window is part of the request, not left to a default.
  assert.equal(body.freshnessWindow, "7d");

  const plan = planQuery(backendInput(body) as never);
  // 5. Downstream planning keeps the whole question, not a truncated keyword.
  assert.equal(plan.requestedQuestion, DOMESTIC_AI_QUESTION);
  // 6. The freshness window survives planning.
  assert.equal(plan.requestedFreshnessWindow, "7d");
  // 7. Both named publishers are still visible in the plan's material.
  assert.ok(plan.originalNeed.includes("36氪"));
  assert.ok(plan.originalNeed.includes("极客公园"));
});

test("a request that only carries industry leaves requestedQuestion empty", () => {
  const request = createResearchRequest({
    ...knowledge,
    industry: "人工智能与产品工具",
    focusAreas: ["AI 产品"],
    currentQuestions: [],
  });
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  assert.deepEqual(body.currentQuestions, []);

  const plan = planQuery(backendInput(body) as never);
  // This is the failure mode the entry contract exists to prevent: with no
  // currentQuestions the planner has no research intent to preserve.
  assert.equal(plan.requestedQuestion, "");
});

test("the fixed question keeps both named publishers selectable as feeds", () => {
  const env = {
    RSSHUB_BASE_URL: "https://relay.example.com",
    RSSHUB_ACCESS_KEY: "test-only-relay-key",
  } as unknown as NodeJS.ProcessEnv;
  const selected = selectRegisteredFeeds({ entities: [], query: DOMESTIC_AI_QUESTION }, env).map((feed) => feed.id);
  assert.ok(selected.includes("geekpark-news"), `selected: ${selected.join(",")}`);
  assert.ok(selected.includes("36kr-flashes"), `selected: ${selected.join(",")}`);
});
