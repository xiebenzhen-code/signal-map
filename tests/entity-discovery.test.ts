import assert from "node:assert/strict";
import test from "node:test";
import { buildDiversifiedQueries, planQuery } from "../research/query-planner.ts";
import { normalizeQueryForDedup, resolveResearchEntities, deduplicateQueries } from "../research/entity-resolution.ts";
import { createResearchPlan } from "../agent/query-planner.ts";

const input = (entity: string, question: string) => ({
  identity: "researcher", industry: "AI models", focusAreas: entity,
  currentQuestions: question, knownInformation: "", informationGaps: "",
  trackedEntities: entity, trackedEvents: "", userJudgements: "", evidenceHistory: "", freshnessWindow: "7d",
});

test("90-day questions survive query and retrieval plan normalization", async () => {
  const { normalizeRetrievalFreshness } = await import("../research/research-pipeline.ts");
  const plan = planQuery({ ...input("Node.js", "Node.js 22 security updates past 90 days"), freshnessWindow: "90d" });
  assert.equal(plan.requestedFreshnessWindow, "90d");
  assert.equal(normalizeRetrievalFreshness("90d"), "90d");
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

test("agent queries extract a concise topic from a long quality question", () => {
  const question = "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。";
  const plan = createResearchPlan({
    identity: "researcher",
    industry: "AI video tools",
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

  assert.ok(plan.topicKeywords?.some((keyword) => /自动粗剪|镜头选择|视频剪辑/u.test(keyword)));
  assert.ok(plan.queries.every((query) => query.length < question.length));
  assert.equal(plan.queries.some((query) => query.includes("过去 30 天内")), false);
});

test("topic extraction keeps capability anchors and drops user instructions", () => {
  const plan = planQuery({
    identity: "researcher",
    industry: "AI video tools",
    focusAreas: "AI 辅助视频剪辑、多素材理解、自动粗剪、镜头选择、批量处理、可商用工作流",
    currentQuestions: "排除纯营销。告诉我为什么值得关注，优先可验证的新工具。",
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  });
  const text = plan.topicKeywords?.join(" ") || "";

  assert.ok(plan.topicAnchors?.includes("AI video editing"));
  assert.ok(plan.topicAnchors?.includes("multi-asset understanding"));
  assert.ok(plan.topicAnchors?.includes("automated rough cut"));
  assert.ok(plan.topicAnchors?.includes("shot selection"));
  assert.ok(plan.topicAnchors?.includes("batch processing"));
  assert.ok(plan.topicAnchors?.includes("commercial workflow"));
  assert.doesNotMatch(text, /排除|告诉我|为什么值得关注|优先|纯营销/);
});

test("diversified queries cover different retrieval intents", () => {
  const queries = buildDiversifiedQueries([
    "AI video editing",
    "automated rough cut",
    "multi-asset understanding",
    "shot selection",
    "batch processing",
    "commercial workflow",
  ], [], "AI video tools", 5);

  assert.equal(queries.length, 5);
  assert.ok(queries.some((query) => /product launch|release/i.test(query)));
  assert.ok(queries.some((query) => /workflow|tool/i.test(query)));
  assert.ok(queries.some((query) => /research|model/i.test(query)));
  assert.ok(queries.some((query) => /official|changelog/i.test(query)));
  assert.ok(queries.some((query) => /implementation|commercial/i.test(query)));
  assert.ok(new Set(queries.map((query) => query.replace(/\b(product launch release|workflow tool|research model|official changelog|implementation commercial workflow)\b/gi, "").trim())).size > 2);
});

test("Agent ResearchPlan preserves the generated topic profile", () => {
  const plan = createResearchPlan({
    identity: "researcher",
    industry: "AI video tools",
    focusAreas: "AI video editing, automated rough cut, shot selection",
    currentQuestions: "Find video workflow tools",
    knownInformation: "",
    informationGaps: "",
    trackedEntities: "",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "30d",
  }, 1, 5, [], "INITIAL");

  assert.ok(plan.topicProfile);
  assert.ok(plan.topicProfile.domainAnchors.some((anchor) => /video/i.test(anchor)));
  assert.ok(plan.topicProfile.taskAnchors.some((anchor) => /editing|rough cut|shot selection/i.test(anchor)));
  assert.ok(plan.topicProfile.genericTerms.includes("ai"));
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
