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

test("quality harness scaffolding does not pollute query entities or agent queries", () => {
  const qualityQuery = "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。告诉我发生了什么、为什么值得关注，以及我现在能具体测试什么。";
  const pollutedInput = {
    identity: "Signal Map quality acceptance reviewer",
    industry: qualityQuery,
    focusAreas: qualityQuery,
    currentQuestions: qualityQuery,
    knownInformation: "Use only the authenticated test account state and live public evidence. Do not use fixtures or mocks.",
    informationGaps: "What evidence-backed changes or opportunities should a user pay attention to?",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  };
  const plan = planQuery(pollutedInput);
  const agentPlan = createResearchPlan(pollutedInput, 1, 5, [], "INITIAL");
  const polluted = new Set(["Signal", "Map", "What", "Use", "Do"]);
  const entities = plan.resolvedEntities?.map((entity) => entity.canonicalEntity) ?? [];
  const queryText = agentPlan.queries.join(" ");

  assert.equal(entities.some((entity) => polluted.has(entity)), false);
  assert.equal(/Signal Map|What evidence|Use only|Do not/.test(queryText), false);
});

test("agent query subject does not duplicate the same user question", () => {
  const question = "最近有什么值得测试的 AI 视频工具？";
  const plan = createResearchPlan({
    identity: "researcher",
    industry: question,
    focusAreas: question,
    currentQuestions: question,
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  }, 1, 5, [], "INITIAL");
  const repeated = `${question} ${question}`;

  assert.equal(plan.queries.some((query) => query.includes(repeated)), false);
});

test("valid company and product names remain entity candidates", () => {
  const plan = planQuery({
    identity: "researcher",
    industry: "AI video tools",
    focusAreas: "OpenAI Anthropic Runway",
    currentQuestions: "OpenAI, Anthropic, and Runway video updates",
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  });
  const entities = plan.resolvedEntities?.map((entity) => entity.canonicalEntity) ?? [];

  assert.ok(entities.includes("OpenAI"));
  assert.ok(entities.includes("Anthropic"));
  assert.ok(entities.includes("Runway"));
});
