import assert from "node:assert/strict";
import test from "node:test";

import { toRetrievalPlan } from "../agent/retrieval-plan.ts";
import type { ResearchPlan } from "../agent/types.ts";
import { resolvePipelinePlan } from "../research/research-pipeline.ts";
import type { ResearchInput, RetrievalPlan } from "../research/types.ts";

const input: ResearchInput = {
  identity: "AI product builder",
  industry: "AI video tools",
  focusAreas: "AI video editing automation",
  currentQuestions: "recent AI video editing workflow updates",
  knownInformation: "",
  informationGaps: "new tools worth testing",
  trackedEntities: "",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
};

const upstreamPlan: RetrievalPlan = {
  queries: [
    "AI video editing automation official changelog",
    "AI video editing workflow release notes",
  ],
  topicAnchors: ["AI video editing", "automated rough cut"],
  selectedSourceType: "GENERAL_WEB",
  fallbackSourceTypes: ["PRIMARY"],
  allowedProviderIds: ["public-web", "product-hunt"],
  reason: "Agent selected broad web plus primary fallback",
  resolvedEntities: [{ canonicalEntity: "Runway", aliasesConsidered: ["RunwayML", "Runway"] }],
  freshnessWindow: "30d",
  retrievalWindows: ["30d"],
};

test("upstream RetrievalPlan queries are the pipeline's actual queries", () => {
  const resolved = resolvePipelinePlan(input, upstreamPlan);

  assert.equal(resolved.fallbackUsed, false);
  assert.equal(resolved.retrievalPlanSource, "upstream_agent_plan");
  assert.deepEqual(resolved.agentGeneratedQueries, upstreamPlan.queries);
  assert.deepEqual(resolved.plan.searchCombinations, upstreamPlan.queries);
  assert.equal(resolved.plan.selectedSourceType, "GENERAL_WEB");
  assert.deepEqual(resolved.plan.allowedProviderIds, ["public-web", "product-hunt"]);
  assert.deepEqual(resolved.plan.topicAnchors, upstreamPlan.topicAnchors);
});

test("deterministically derived query-planner fields are not required for upstream plan validity", () => {
  const minimalPlan: RetrievalPlan = {
    queries: ["official AI video model release notes"],
  };

  const resolved = resolvePipelinePlan(input, minimalPlan);

  assert.equal(resolved.fallbackUsed, false);
  assert.deepEqual(resolved.plan.searchCombinations, minimalPlan.queries);
  assert.deepEqual(resolved.plan.englishKeywords, []);
  assert.deepEqual(resolved.plan.synonyms, []);
});

test("missing or empty upstream queries trigger fallback self-planning", () => {
  const missing = resolvePipelinePlan(input);
  const empty = resolvePipelinePlan(input, { queries: [] });

  assert.equal(missing.fallbackUsed, true);
  assert.equal(missing.fallbackReason, "upstream_plan_missing");
  assert.equal(missing.retrievalPlanSource, "pipeline_fallback_plan");
  assert.ok(missing.plan.searchCombinations.length > 0);
  assert.equal(empty.fallbackUsed, true);
  assert.equal(empty.fallbackReason, "upstream_plan_missing_valid_queries");
});

test("source and provider routing survive plan resolution", () => {
  const resolved = resolvePipelinePlan(input, upstreamPlan);

  assert.equal(resolved.plan.selectedSourceType, upstreamPlan.selectedSourceType);
  assert.deepEqual(resolved.plan.fallbackSourceTypes, upstreamPlan.fallbackSourceTypes);
  assert.deepEqual(resolved.plan.allowedProviderIds, upstreamPlan.allowedProviderIds);
  assert.equal(resolved.plan.sourceSelectionReason, upstreamPlan.reason);
});

test("ResearchPlan converts to RetrievalPlan without inheriting runtime-only fields", () => {
  const researchPlan: ResearchPlan = {
    objective: "Find important AI video updates",
    queries: upstreamPlan.queries,
    preferredSourceTypes: ["primary", "trusted_media"],
    maxQueries: 5,
    selectedSourceType: "GENERAL_WEB",
    fallbackSourceTypes: ["PRIMARY"],
    allowedProviderIds: ["public-web"],
    reason: "selected by Agent",
    resolvedEntities: upstreamPlan.resolvedEntities,
    freshnessWindow: "30d",
    retrievalWindows: ["30d"],
  };

  const retrievalPlan = toRetrievalPlan(researchPlan);
  const roundTrip = JSON.parse(JSON.stringify(retrievalPlan)) as RetrievalPlan;

  assert.deepEqual(roundTrip.queries, researchPlan.queries);
  assert.equal(roundTrip.selectedSourceType, researchPlan.selectedSourceType);
  assert.deepEqual(roundTrip.allowedProviderIds, researchPlan.allowedProviderIds);
  assert.deepEqual(roundTrip.resolvedEntities, researchPlan.resolvedEntities);
  assert.equal(Object.hasOwn(roundTrip, "preferredSourceTypes"), false);
  assert.equal(Object.hasOwn(roundTrip, "maxQueries"), false);
});

test("runtime environment changes do not alter query or routing contract", () => {
  const before = process.env.MODEL_PROVIDER;
  process.env.MODEL_PROVIDER = "runtime-a";
  const a = resolvePipelinePlan(input, upstreamPlan);
  process.env.MODEL_PROVIDER = "runtime-b";
  const b = resolvePipelinePlan(input, upstreamPlan);
  if (before === undefined) {
    delete process.env.MODEL_PROVIDER;
  } else {
    process.env.MODEL_PROVIDER = before;
  }

  assert.deepEqual(a.plan.searchCombinations, b.plan.searchCombinations);
  assert.equal(a.plan.selectedSourceType, b.plan.selectedSourceType);
  assert.deepEqual(a.plan.allowedProviderIds, b.plan.allowedProviderIds);
  assert.equal(a.fallbackUsed, b.fallbackUsed);
});
