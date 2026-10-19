import assert from "node:assert/strict";
import test from "node:test";

import { assessTopicRelevance } from "../research/topic-relevance.ts";
import { updateKnowledgeFromChanges } from "../agent/knowledge-updater.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { QueryPlan, ResearchSignal } from "../research/types.ts";

// Generic-language fixtures: the plans below are constructed contracts (not
// captured production QueryPlans). No Shopify/e-commerce specifics are encoded
// in the implementation; the mechanism must hold for any named entity +
// task-constraint question.

function plan(overrides: Partial<QueryPlan>): QueryPlan {
  return {
    originalNeed: "",
    coreKeywords: [],
    englishKeywords: [],
    synonyms: [],
    entities: [],
    industryKeywords: [],
    changeKeywords: [],
    knowledgeAwareQueries: [],
    searchCombinations: [],
    retrievalWindows: ["30d"],
    requestedFreshnessWindow: "30d",
    ...overrides,
  } as QueryPlan;
}

const context = { authenticatedUserId: "user-a", filterId: "filter-1" };

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-1",
    title: "Signal",
    originalTitle: "Signal",
    reliabilityScore: 92,
    topicRelevance: { decision: "MATCH", matchedTerms: ["shopify"], score: 90 } as never,
    informationGainStatus: "NEW_INFORMATION" as never,
    verificationStatus: "verified" as never,
    informationType: "FACT" as never,
    section: "all",
    attentionDecision: "LIBRARY_ONLY",
    sourceUrl: "https://example.com/item",
    claims: [],
    sources: [],
    ...overrides,
  } as unknown as ResearchSignal;
}

function response(signals: ResearchSignal[]) {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-10-19T00:00:00.000Z",
    dataMode: "live" as const,
  };
}

async function persistedTexts(items: ResearchSignal[]) {
  const repository = new InMemorySignalRepository();
  await updateKnowledgeFromChanges({
    context,
    repository,
    response: response(items),
    changes: [{ signalId: items[0].id, classification: "NEW" } as never],
    runId: "run-1",
    now: "2026-10-19T00:00:00.000Z",
  });
  return (await repository.listPersonalKnowledge(context)).map((record) => record.text);
}

// --- 1. Chinese question, English material -------------------------------

const zhQuestionEnBodies = plan({
  originalNeed: "过去30天，Shopify有哪些与结账或支付有关的变化？",
  coreKeywords: ["Shopify", "结账", "支付"],
  entities: ["Shopify"],
});

test("zh question + en material: genuinely relevant evidence passes", () => {
  assert.equal(
    assessTopicRelevance("Shopify adds UCP buyer consent for checkout", zhQuestionEnBodies).decision,
    "MATCH",
  );
  assert.equal(
    assessTopicRelevance("Shopify now supports new tender types for checkout", zhQuestionEnBodies).decision,
    "MATCH",
  );
});

test("zh question + en material: same entity, unrelated task is rejected", () => {
  assert.equal(
    assessTopicRelevance("Shopify AI Toolkit security scan", zhQuestionEnBodies).decision,
    "TOPIC_MISMATCH",
  );
  assert.equal(
    assessTopicRelevance("Shopify Hydrogen 2026-10 is now available", zhQuestionEnBodies).decision,
    "TOPIC_MISMATCH",
  );
});

// --- 2. English question, Chinese material --------------------------------

const enQuestionZhBodies = plan({
  originalNeed: "Which checkout and payment changes shipped at Shopify?",
  coreKeywords: ["Shopify", "checkout", "payment"],
  entities: ["Shopify"],
});

test("en question + zh material: genuinely relevant evidence passes", () => {
  assert.equal(
    assessTopicRelevance("Shopify 新增结账与支付方式", enQuestionZhBodies).decision,
    "MATCH",
  );
});

test("en question + zh material: same entity, unrelated task is rejected", () => {
  assert.equal(
    assessTopicRelevance("Shopify 推出应用安全扫描功能", enQuestionZhBodies).decision,
    "TOPIC_MISMATCH",
  );
});

// --- 3. Mixed-language body ----------------------------------------------

test("mixed body: English task info is not ignored because a Chinese character appears", () => {
  assert.equal(
    assessTopicRelevance("Shopify checkout now supports buyer consent. 适用美国商家", enQuestionZhBodies).decision,
    "MATCH",
  );
  assert.equal(
    assessTopicRelevance("Shopify 支付方式与结账流程变更", enQuestionZhBodies).decision,
    "MATCH",
  );
});

// --- 4. Long task phrases and reasonable synonyms --------------------------

const longPhrasePlan = plan({
  originalNeed: "Which AI-assisted video editing changes shipped recently?",
  coreKeywords: ["ComfyUI", "video editing"],
  synonyms: ["tender"],
  entities: ["ComfyUI"],
});

test("long latin task phrases survive extraction", () => {
  assert.equal(
    assessTopicRelevance("ComfyUI launches an AI-assisted video editing tool", longPhrasePlan).decision,
    "MATCH",
  );
});

test("synonym expressions pass without the original keyword hiding in the body", () => {
  // Body contains the synonym "tender" but no checkout/payment wording at all.
  assert.equal(
    assessTopicRelevance("ComfyUI adds a new tender type", longPhrasePlan).decision,
    "MATCH",
  );
  // Cross-language synonym: the plan declares 付款 (Chinese), the body is English.
  const zhSynonymPlan = plan({
    originalNeed: "ComfyUI 付款相关更新",
    coreKeywords: ["ComfyUI", "付款"],
    entities: ["ComfyUI"],
  });
  assert.equal(
    assessTopicRelevance("ComfyUI adds a new tender type for buyers", zhSynonymPlan).decision,
    "MATCH",
  );
});

// --- 5. Unrecognizable task constraints must not default to MATCH ---------

const entityOnlyPlan = plan({
  originalNeed: "Shopify 最近有什么变化？",
  coreKeywords: ["Shopify"],
  entities: ["Shopify"],
});

test("tracked-entity-only questions keep the legacy material path", () => {
  // The plan declares no task beyond the entity: legacy subject+topic match
  // stays admissible as material (it still cannot reach confirmed knowledge
  // without an explicit MATCH verdict).
  assert.equal(
    assessTopicRelevance("Shopify AI Toolkit security scan", entityOnlyPlan).decision,
    "MATCH",
  );
});

test("an unbridgeable declared constraint stays UNCERTAIN instead of entity-default MATCH", () => {
  // The plan declares a concrete task ("退货") that has no concept-group
  // bridge into English and no other task context. An entity hit alone must
  // not read as task-relevant, and it must not enter confirmed knowledge.
  const returnsPlan = plan({
    originalNeed: "Shopify 退货政策有什么变化？",
    coreKeywords: ["Shopify", "退货"],
    entities: ["Shopify"],
  });
  const relevance = assessTopicRelevance("Shopify updates its buyer help pages", returnsPlan);
  assert.equal(relevance.decision, "UNCERTAIN");
  assert.equal(relevance.relevanceGatePassed, false);
  // Same plan, Chinese body naming the constraint -> judgeable and relevant.
  assert.equal(
    assessTopicRelevance("Shopify 更新退货政策说明", returnsPlan).decision,
    "MATCH",
  );
});

test("open questions with no task wording keep the legacy material path", () => {
  // A browsing question whose keywords are the question text itself: no task
  // constraint was declared, so the legacy subject+topic match still applies.
  const browsingPlan = plan({
    originalNeed: "ComfyUI 最近有什么新动态？",
    coreKeywords: ["ComfyUI 最近有什么新动态？"],
    entities: ["ComfyUI"],
  });
  assert.equal(
    assessTopicRelevance("ComfyUI v0.37.0 release: video preview node", browsingPlan).decision,
    "MATCH",
  );
});

// --- 6. Navigation boilerplate vs. source-suffixed event titles ------------

test("navigation boilerplate never becomes confirmed knowledge", async () => {
  const texts = await persistedTexts([
    signal({ id: "nav", originalTitle: "Shopify Developer Changelog", title: "Shopify Developer Changelog" }),
  ]);
  assert.equal(texts.length, 0);
});

test("an event title carrying a changelog source suffix is not rejected as navigation", async () => {
  const texts = await persistedTexts([
    signal({
      id: "suffixed",
      originalTitle: "Add shopping and Shop Pay checkout to any agent with Shop MCP - Shopify developer changelog",
      title: "Add shopping and Shop Pay checkout to any agent with Shop MCP - Shopify developer changelog",
    }),
  ]);
  assert.deepEqual(texts, ["Add shopping and Shop Pay checkout to any agent with Shop MCP - Shopify developer changelog"]);
});
