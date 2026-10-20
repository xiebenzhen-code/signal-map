import assert from "node:assert/strict";
import test from "node:test";

import { planQuery, parseExclusions } from "../research/query-planner.ts";
import { assessTopicRelevance } from "../research/topic-relevance.ts";
import { resolvePipelinePlan } from "../research/research-pipeline.ts";
import { createResearchPlan } from "../agent/query-planner.ts";
import { toRetrievalPlan } from "../agent/retrieval-plan.ts";
import { selectRegisteredFeeds } from "../source-registry/feed-catalog.ts";
import type { ResearchInput } from "../research/types.ts";

// The real Deploy016 R3 payload (run-DEPLOY016-R3.json): an explicit Node.js
// security question whose exclusion clause ("排除 Shopify 及其他无关产品")
// leaked Shopify into positive entities, queries, feed selection and answers.
const nodeSecurityQuestion =
  "过去30天，Node.js 官方发布了哪些安全修复？请列出受影响版本与修复版本，并给出建议操作。排除 Shopify 及其他无关产品。";
const nodeSecurityInput: ResearchInput = {
  identity: "Node.js 开发者",
  industry: "编程",
  focusAreas: "Node.js 官方安全公告",
  currentQuestions: nodeSecurityQuestion,
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "Node.js",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
  sourceScope: "全部",
};

// Verbatim titles from the R3 response: all four leaked through as answers.
const shopifyR3Entries = [
  "The new Hydrogen is generally available today.",
  "at can mean fetching the collection's products, comparing them with your saved list, and then updating your app.",
  "Polaris 2.0 release candidate",
  "This is the first minor release under the CDN's new semantic versioning model.",
];
// Verbatim Node.js Blog candidates from the same R3 response: real positive material.
const nodeR3Entries = [
  "Node.js Interactive 2026: A Recap",
  "Check out the New Node.js API Documentation Preview",
  "Trip report: Node.js collaboration summit (2026 London)",
  "Evolving the Node.js Release Schedule",
];

test("exclusion clause parses entity targets separately from content-type targets", () => {
  const { entities, contentTypes } = parseExclusions(nodeSecurityQuestion);
  assert.deepEqual(entities, ["Shopify"], `entities=${JSON.stringify(entities)}`);
  assert.deepEqual(contentTypes, [], `contentTypes=${JSON.stringify(contentTypes)}`);

  const marketing = parseExclusions(
    "过去30天 Shopify 有哪些新功能？排除营销文章和无关应用推荐。",
  );
  assert.deepEqual(marketing.entities, [], "营销文章 is a content type, not an entity");
  assert.ok(
    marketing.contentTypes.some((type) => type.includes("营销")),
    `contentTypes=${JSON.stringify(marketing.contentTypes)}`,
  );

  const company = parseExclusions("最近有哪些 AI 编程工具值得关注？排除 OpenAI。");
  assert.deepEqual(company.entities, ["OpenAI"]);
});

test("R3 plan: excluded Shopify never becomes a positive entity or retrieval term", () => {
  const plan = planQuery(nodeSecurityInput);
  assert.equal(plan.excludedEntities?.includes("Shopify"), true, `excludedEntities=${JSON.stringify(plan.excludedEntities)}`);
  assert.equal(plan.entities.includes("Shopify"), false, `entities=${JSON.stringify(plan.entities)}`);
  assert.equal(
    plan.entities.some((entity) => entity.toLowerCase() === "node.js"),
    true,
    `positive entity Node.js must survive: entities=${JSON.stringify(plan.entities)}`,
  );
  assert.equal(
    plan.resolvedEntities?.some((entity) => entity.canonicalEntity === "Shopify"),
    false,
    `resolvedEntities=${JSON.stringify(plan.resolvedEntities)}`,
  );
  assert.equal(plan.englishKeywords.includes("Shopify"), false, `englishKeywords=${JSON.stringify(plan.englishKeywords)}`);
  for (const combination of plan.searchCombinations) {
    assert.equal(/shopify/i.test(combination), false, `query leaked Shopify: ${combination}`);
  }
  for (const keyword of [...plan.coreKeywords, ...(plan.topicKeywords ?? [])]) {
    assert.equal(/shopify/i.test(keyword), false, `planner term leaked Shopify: ${keyword}`);
  }
});

test("R3 plan: feed selection cannot pull the excluded publisher's feed", () => {
  const plan = planQuery(nodeSecurityInput);
  const feeds = selectRegisteredFeeds({
    entities: plan.entities,
    query: plan.originalNeed,
    selectedSourceType: "OFFICIAL",
    excludedEntities: plan.excludedEntities,
  });
  assert.equal(
    feeds.some((feed) => feed.id === "shopify"),
    false,
    `selected=${JSON.stringify(feeds.map((feed) => feed.id))}`,
  );
  assert.equal(
    feeds.some((feed) => feed.id === "nodejs"),
    true,
    `selected=${JSON.stringify(feeds.map((feed) => feed.id))}`,
  );
});

test("R3 plan: excluded-entity material is rejected while Node.js material is not rejected by the exclusion", () => {
  const plan = planQuery(nodeSecurityInput);
  for (const text of shopifyR3Entries) {
    assert.equal(
      assessTopicRelevance(text, plan).decision,
      "TOPIC_MISMATCH",
      `Shopify material must be rejected: ${text}`,
    );
  }
  // Material that literally names the excluded brand is rejected by the
  // exclusion itself (the subject is there but explicitly excluded).
  for (const text of ["Shopify Polaris 2.0 release candidate", "Shopify Hydrogen is now available"]) {
    const relevance = assessTopicRelevance(text, plan);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", `Shopify-named material must be rejected: ${text}`);
    assert.equal(relevance.reason, "EXCLUDED_ENTITY", `rejection must name the exclusion: ${text} (${relevance.reason})`);
  }
  for (const text of nodeR3Entries) {
    assert.notEqual(
      assessTopicRelevance(text, plan).reason,
      "EXCLUDED_ENTITY",
      `the exclusion must not be what rejects Node.js material: ${text}`,
    );
  }
});

test("generic company exclusion works for other companies (no Shopify hardcoding)", () => {
  const aiToolsInput: ResearchInput = {
    ...nodeSecurityInput,
    focusAreas: "AI 编程工具",
    currentQuestions: "最近有哪些 AI 编程工具值得关注？排除 OpenAI。",
    trackedEntities: "",
  };
  const plan = planQuery(aiToolsInput);
  assert.equal(plan.excludedEntities?.includes("OpenAI"), true, `excludedEntities=${JSON.stringify(plan.excludedEntities)}`);
  assert.equal(plan.entities.includes("OpenAI"), false, `entities=${JSON.stringify(plan.entities)}`);
  for (const combination of plan.searchCombinations) {
    assert.equal(/openai/i.test(combination), false, `query leaked OpenAI: ${combination}`);
  }
  assert.equal(
    assessTopicRelevance("OpenAI Codex release notes", plan).decision,
    "TOPIC_MISMATCH",
    "excluded-company material must be rejected",
  );
  assert.notEqual(
    assessTopicRelevance("新 AI 编程工具发布，支持结对编程", plan).decision,
    "TOPIC_MISMATCH",
    "positive AI-tool material must survive",
  );
});

test("feed exclusion is entity-generic, not Shopify-specific", () => {
  const feeds = selectRegisteredFeeds({
    entities: ["Node.js"],
    query: "Node.js security releases",
    selectedSourceType: "OFFICIAL",
    excludedEntities: ["Firefox"],
  });
  assert.equal(
    feeds.some((feed) => feed.id === "mozilla"),
    false,
    `selected=${JSON.stringify(feeds.map((feed) => feed.id))}`,
  );
});

test("positive mention keeps the entity and its changelog material admissible", () => {
  const checkoutInput: ResearchInput = {
    ...nodeSecurityInput,
    focusAreas: "Shopify 结账与支付",
    currentQuestions:
      "过去30天，Shopify有哪些已发布、与结账或支付有关的变化？排除营销文章和无关应用推荐，说明适用条件。",
    trackedEntities: "Shopify",
  };
  const plan = planQuery(checkoutInput);
  assert.equal(plan.entities.includes("Shopify"), true, `entities=${JSON.stringify(plan.entities)}`);
  assert.equal(plan.excludedEntities?.includes("Shopify"), false, `excludedEntities=${JSON.stringify(plan.excludedEntities)}`);
  assert.equal(
    assessTopicRelevance("Shopify Checkout Extensibility adds a payment option", plan).decision,
    "MATCH",
    "positive Shopify checkout material must stay admissible",
  );
  assert.equal(
    assessTopicRelevance("Shopify adds a new image compression tool", plan).decision,
    "TOPIC_MISMATCH",
    "same entity without the requested task stays rejected",
  );
});

test("per-question exclusion overrides the standing tracked entity", () => {
  const conflictingInput: ResearchInput = {
    ...nodeSecurityInput,
    currentQuestions: "过去30天 Node.js 有哪些安全修复？排除 Shopify。",
    trackedEntities: "Shopify",
  };
  const plan = planQuery(conflictingInput);
  assert.equal(plan.entities.includes("Shopify"), false, `entities=${JSON.stringify(plan.entities)}`);
  assert.equal(plan.excludedEntities?.includes("Shopify"), true, `excludedEntities=${JSON.stringify(plan.excludedEntities)}`);
});

// Offline replay of the live agent→pipeline path (runResearchPipeline receives
// resolvePipelinePlan's output), using the R3 payload verbatim.
test("R3 replay through the live agent→pipeline path: no Shopify anywhere", () => {
  const agentPlan = createResearchPlan(nodeSecurityInput, 1, 5);
  const resolution = resolvePipelinePlan(nodeSecurityInput, toRetrievalPlan(agentPlan));
  const plan = resolution.plan;
  assert.equal(plan.excludedEntities?.includes("Shopify"), true, `excludedEntities=${JSON.stringify(plan.excludedEntities)}`);
  assert.equal(plan.entities.includes("Shopify"), false, `entities=${JSON.stringify(plan.entities)}`);
  const allText = [
    ...plan.searchCombinations,
    ...plan.coreKeywords,
    ...(plan.topicKeywords ?? []),
    ...(plan.aliasesConsidered ?? []),
  ].join(" | ");
  assert.equal(/shopify/i.test(allText), false, `planner text leaked Shopify: ${allText.slice(0, 300)}`);
  const feeds = selectRegisteredFeeds({
    entities: plan.entities,
    query: plan.originalNeed,
    selectedSourceType: plan.selectedSourceType,
    excludedEntities: plan.excludedEntities,
  });
  assert.equal(
    feeds.some((feed) => feed.id === "shopify"),
    false,
    `feeds=${JSON.stringify(feeds.map((feed) => feed.id))}`,
  );
  for (const text of shopifyR3Entries) {
    assert.equal(
      assessTopicRelevance(text, plan).decision,
      "TOPIC_MISMATCH",
      `Shopify material must be rejected on the live path: ${text}`,
    );
  }
  for (const text of ["Shopify Polaris 2.0 release candidate", "Shopify Hydrogen is now available"]) {
    const relevance = assessTopicRelevance(text, plan);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", `Shopify-named material must be rejected on the live path: ${text}`);
    assert.equal(relevance.reason, "EXCLUDED_ENTITY", `rejection must name the exclusion on the live path: ${text} (${relevance.reason})`);
  }
  for (const text of nodeR3Entries) {
    assert.notEqual(
      assessTopicRelevance(text, plan).reason,
      "EXCLUDED_ENTITY",
      `the exclusion must not be what rejects Node.js material on the live path: ${text}`,
    );
  }
});
