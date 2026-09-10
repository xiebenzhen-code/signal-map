import assert from "node:assert/strict";
import test from "node:test";
import { planQuery } from "../research/query-planner.ts";
import { normalizeQueryForDedup, resolveResearchEntities, deduplicateQueries } from "../research/entity-resolution.ts";
import { createResearchPlan } from "../agent/query-planner.ts";

const input = (entity: string, question: string) => ({
  identity: "researcher", industry: "AI models", focusAreas: entity,
  currentQuestions: question, knownInformation: "", informationGaps: "",
  trackedEntities: entity, trackedEvents: "", userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
});

test("DeepSeek, OpenAI, and Anthropic use the same registry-backed entity resolution", () => {
  for (const entity of ["DeepSeek", "OpenAI", "Anthropic"]) {
    const plan = planQuery(input(entity, `${entity} updates`));
    assert.equal(plan.resolvedEntities?.[0]?.canonicalEntity, entity);
    assert.ok((plan.resolvedEntities?.[0]?.aliasesConsidered.length ?? 0) >= 1);
    assert.ok((plan.deduplicatedQueryCount ?? 0) <= (plan.queryBudget ?? 0));
  }
});

test("alias and punctuation variants consume one query budget slot", () => {
  const entities = resolveResearchEntities({ entities: ["DeepSeek"] });
  const queries = deduplicateQueries([
    "DeepSeek latest update",
    "deep seek recent update",
    "DeepSeek，最新更新",
    "DeepSeek pricing",
  ], entities, 10);
  assert.deepEqual(queries, ["DeepSeek latest update", "DeepSeek pricing"]);
  assert.equal(normalizeQueryForDedup(queries[0], entities), normalizeQueryForDedup("deep seek recent update", entities));
});

test("INITIAL and REFRESH retain different query intent with the same general planner", () => {
  const data = input("DeepSeek", "what changed");
  const initial = createResearchPlan(data, 1, 5, [], "INITIAL");
  const refresh = createResearchPlan(data, 2, 5, ["DeepSeek has an API"], "REFRESH");
  assert.ok(initial.queries.some((query) => /recent changes|documentation|release notes/i.test(query)));
  assert.ok(refresh.queries.some((query) => /latest update|official announcement|recent release notes/i.test(query)));
  assert.notDeepEqual(initial.queries, refresh.queries);
});

test("query budget is hard bounded after dedupe", () => {
  const plan = planQuery(input("DeepSeek", "latest changes"));
  assert.ok(plan.searchCombinations.length <= 24);
  assert.equal(plan.deduplicatedQueryCount, plan.searchCombinations.length);
});
