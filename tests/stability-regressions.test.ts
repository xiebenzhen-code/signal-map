import assert from "node:assert/strict";
import test from "node:test";

import { selectRelatedKnowledge } from "../agent/memory-selection.ts";
import { assessTopicRelevance } from "../research/topic-relevance.ts";
import type { PersonalKnowledgeRecord } from "../information/rag-records.ts";
import type { QueryPlan } from "../research/types.ts";

// Stability closeout regressions — one suite for the three selection/relevance
// defects found after bb842cb (cross-entity subject leak, empty-constraint
// default MATCH, verification status standing in for fact freshness). Red cases
// reproduce the reviewed failures; green cases keep genuinely-related memory,
// aliases, cross-language matches and stable facts readable. No paid model is
// called and nothing is sent to production.

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

function record(text: string, overrides: Partial<PersonalKnowledgeRecord> = {}): PersonalKnowledgeRecord {
  return {
    id: `rec-${text.length}-${text.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "")}`,
    type: "KNOWN_INFORMATION",
    text,
    structuredPayload: { verificationStatus: "verified" },
    userId: "u",
    filterId: "f",
    normalizedText: text.toLowerCase(),
    stableId: "s",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as PersonalKnowledgeRecord;
}

// --- Defect 1: cross-entity subject leak -----------------------------------

test("RED: a generic word inside another entity's memory must not select it (Node.js vs Shopify billing)", () => {
  const nodePlan = plan({ originalNeed: "What changed in Node.js?", coreKeywords: ["Node.js"], entities: ["Node.js"] });
  const selection = selectRelatedKnowledge({
    records: [record("Shopify billing supports a new payment method")],
    query: "What changed in Node.js?",
    entities: ["Node.js"],
    plan: nodePlan,
  });
  assert.equal(selection.selected.length, 0, "a Shopify billing memory must not enter a Node.js question's context");
  assert.equal(selection.entries[0]?.reason, "no_shared_subject");
});

test("GREEN: an entity alias still selects a genuinely same-entity memory", () => {
  const nodePlan = plan({
    originalNeed: "What changed in Node.js?",
    coreKeywords: ["Node.js"],
    synonyms: ["NodeJS"],
    entities: ["Node.js"],
    aliasesConsidered: ["NodeJS", "Node"],
  });
  const selection = selectRelatedKnowledge({
    records: [record("NodeJS 22 is now the active LTS release line")],
    query: "What changed in Node.js?",
    entities: ["Node.js"],
    plan: nodePlan,
  });
  assert.equal(selection.selected.length, 1, "an alias of the declared entity is the same subject");
});

test("GREEN: a cross-language same-entity memory stays readable", () => {
  const nodePlan = plan({ originalNeed: "What changed in Node.js?", coreKeywords: ["Node.js"], entities: ["Node.js"] });
  const selection = selectRelatedKnowledge({
    records: [record("Node.js 发布了 v22 新版本")],
    query: "What changed in Node.js?",
    entities: ["Node.js"],
    plan: nodePlan,
  });
  assert.equal(selection.selected.length, 1, "the record names the declared entity in Chinese; it shares the subject");
});

// --- Defect 2: empty task constraints must not default to MATCH ------------

test("RED: an entity-only plan without browsing intent must stay UNCERTAIN", () => {
  // Reproduces the review probe: originalNeed is the bare entity, so an
  // unrelated body cannot be confirmed as task-relevant through the entity hit.
  const bareEntityPlan = plan({ originalNeed: "Shopify", coreKeywords: ["Shopify"], entities: ["Shopify"] });
  const relevance = assessTopicRelevance("Shopify AI Toolkit security scan", bareEntityPlan);
  assert.equal(relevance.decision, "UNCERTAIN");
  assert.equal(relevance.relevanceGatePassed, false);
});

test("RED: a declared task whose constraints fail extraction stays UNCERTAIN", () => {
  const extractionFailurePlan = plan({
    originalNeed: "Shopify 有什么新变化？",
    coreKeywords: ["Shopify", "AI Toolkit security scan"],
    entities: ["Shopify"],
  });
  const relevance = assessTopicRelevance("Shopify AI Toolkit security scan", extractionFailurePlan);
  assert.equal(relevance.decision, "UNCERTAIN", "extraction failure must not read as open browsing");
});

test("GREEN: an explicit open-browsing question keeps the legacy material path", () => {
  const browsingPlan = plan({ originalNeed: "Shopify 最近有什么变化？", coreKeywords: ["Shopify"], entities: ["Shopify"] });
  assert.equal(
    assessTopicRelevance("Shopify AI Toolkit security scan", browsingPlan).decision,
    "MATCH",
    "explicit open browsing stays admissible as material",
  );
  const keywordBrowsing = plan({
    originalNeed: "ComfyUI 最近有什么新动态？",
    coreKeywords: ["ComfyUI 最近有什么新动态？"],
    entities: ["ComfyUI"],
  });
  assert.equal(
    assessTopicRelevance("ComfyUI v0.37.0 release: video preview node", keywordBrowsing).decision,
    "MATCH",
  );
});

// --- Defect 3: verification status vs. fact freshness ----------------------

test("RED: a verified 2022 price is not a today-fact (must be re-verified)", () => {
  const pricingPlan = plan({ originalNeed: "Shopify payment pricing today", coreKeywords: ["Shopify", "payment"], entities: ["Shopify"] });
  const selection = selectRelatedKnowledge({
    records: [record("Shopify payment processing price is 2 percent in 2022", {
      structuredPayload: { verificationStatus: "verified" },
      createdAt: "2022-01-01T00:00:00.000Z",
      updatedAt: "2022-01-01T00:00:00.000Z",
    })],
    query: "Shopify payment pricing today",
    entities: ["Shopify"],
    plan: pricingPlan,
  });
  assert.equal(selection.selected.length, 0, "a four-year-old verified price must not enter as settled knowledge");
  assert.equal(selection.entries[0]?.reason, "needs_reverification");
});

test("GREEN: a stable non-time-sensitive fact does not mechanically expire", () => {
  const shopifyPlan = plan({ originalNeed: "Who owns Shopify?", coreKeywords: ["Shopify"], entities: ["Shopify"] });
  const selection = selectRelatedKnowledge({
    records: [record("Shopify's head office is in Ottawa", {
      createdAt: "2022-01-01T00:00:00.000Z",
      updatedAt: "2022-01-01T00:00:00.000Z",
    })],
    query: "Who owns Shopify?",
    entities: ["Shopify"],
    plan: shopifyPlan,
  });
  assert.equal(selection.selected.length, 1, "a stable fact is not time-sensitive and stays readable");
});

test("GREEN: a recently recorded time-sensitive fact stays readable", () => {
  const pricingPlan = plan({ originalNeed: "Shopify payment pricing today", coreKeywords: ["Shopify", "payment"], entities: ["Shopify"] });
  const selection = selectRelatedKnowledge({
    records: [record("Shopify Plus plan price is 299 USD per month", {
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z",
    })],
    query: "Shopify payment pricing today",
    entities: ["Shopify"],
    plan: pricingPlan,
  });
  assert.equal(selection.selected.length, 1, "a five-day-old price is still fresh enough to read");
});

// --- Compound-subject contract: "Model X" must survive as a full subject -------
// A question that explicitly names a compound subject ("Model X") must select a
// record about that subject even when the planner treats the head noun
// ("Model") as generic and drops it as an entity. The full qualified phrase,
// not the single token, is the subject — "model" alone is a generic word and
// "launch" is a generic task word that must never stand in for a subject.
// A stale tracked-entity list from an older question ("Codex") must not
// override the current question's explicit subject.

test("RED: asking about Model X selects a Model X record (full subject phrase survives token filtering)", () => {
  const nodePlan = plan({
    originalNeed: "Did Model X launch?",
    coreKeywords: ["Model X"],
    entities: ["Model X"],
    resolvedEntities: [],
    aliasesConsidered: [],
  });
  const selection = selectRelatedKnowledge({
    records: [record("Model X is now released")],
    query: "Did Model X launch?",
    // A leftover tracked-entity list from an older question must not override
    // the current question's explicit "Model X" subject.
    entities: ["Codex"],
    plan: nodePlan,
  });
  assert.equal(selection.selected.length, 1, "a record about the explicitly asked Model X subject is selected");
});

test("RED: asking about Model X excludes releases of other products", () => {
  const nodePlan = plan({
    originalNeed: "Did Model X launch?",
    coreKeywords: ["Model X"],
    entities: ["Model X"],
    resolvedEntities: [],
    aliasesConsidered: [],
  });
  const selection = selectRelatedKnowledge({
    records: [
      record("Model Y is now released"),
      record("Shopify launches a new billing portal"),
    ],
    query: "Did Model X launch?",
    entities: ["Codex"],
    plan: nodePlan,
  });
  assert.equal(selection.selected.length, 0, "releases of other products (Model Y, Shopify) must not enter a Model X question");
  assert.equal(selection.entries.every((entry) => !entry.selected), true);
  assert.equal(selection.entries.every((entry) => entry.reason === "no_shared_subject"), true);
});
