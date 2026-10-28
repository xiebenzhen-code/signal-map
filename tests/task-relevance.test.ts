import assert from "node:assert/strict";
import test from "node:test";

import { assessTopicRelevance } from "../research/topic-relevance.ts";
import type { QueryPlan } from "../research/types.ts";
import { planQuery } from "../research/query-planner.ts";

const aiMediaInput = {
  identity: "关注这个方向的用户", industry: "人工智能与产品工具", focusAreas: "AI 产品",
  currentQuestions: "过去7天，36氪快讯和极客公园报道了哪些与国内AI产品或产业有关的新进展？保留原始出处和发布日期，区分已确认信息与待核对线索。",
  knownInformation: "", informationGaps: "", trackedEntities: "", trackedEvents: "",
  userJudgements: "", evidenceHistory: "", freshnessWindow: "7d" as const,
};
const aiMediaPlan = planQuery(aiMediaInput);

test("broad AI media research admits literal AI news without requiring the question's narrative words", () => {
  for (const text of [
    "阅文发布首批AI精品动画项目，将DramaBuddy漫剧助手升级为一站式平台。",
    "国内企业发布人工智能应用，新增中文文档处理能力。",
    "A domestic company released an artificial intelligence assistant for creators.",
  ]) assert.equal(assessTopicRelevance(text, aiMediaPlan).decision, "MATCH", text);
});

test("product vocabulary cannot substitute for the AI subject in a broad AI question", () => {
  for (const text of [
    "公司发布新产品矢量网络分析仪及PCB测试解决方案，推动产业发展。",
    "从电芯、电池管理系统到整机产品集成，本地就能完成研发生产。",
    "A company introduced a new paid product for retail sales.",
  ]) assert.notEqual(assessTopicRelevance(text, aiMediaPlan).decision, "MATCH", text);
});

test("a broad AI fallback never discards concrete or geographic constraints", () => {
  const unrelated = "An AI company in Germany released a paid music generator.";
  for (const question of [
    "过去7天，国内AI产品有哪些新进展？只看字幕制作功能。",
    "过去7天，AI产品在医疗诊断方面有哪些变化？",
    "过去7天，国内AI产品有哪些新进展？",
    "过去7天，只看字幕制作，极客公园报道了哪些与国内AI产品有关的新进展？",
    "过去7天，不要音乐生成，极客公园报道了哪些与国内AI产品有关的新进展？",
  ]) {
    const plan = planQuery({...aiMediaInput, currentQuestions: question});
    assert.notEqual(assessTopicRelevance(unrelated, plan).decision, "MATCH", question);
    if (/只看|不要/.test(question)) assert.notEqual(assessTopicRelevance("国内AI公司发布音乐生成产品，支持商业配乐制作。", plan).decision, "MATCH", question);
  }
  const match = assessTopicRelevance("国内企业发布人工智能助手，新增中文文档处理能力。", aiMediaPlan);
  assert.equal(match.decision, "MATCH");
  assert.ok(match.score > 0);
  assert.notEqual(match.reason, "NO_QUERY_TERM_MATCH");
});

// The real legacy-path plan behind requestId signals-f7f22edd: a named entity
// plus an explicit task constraint (checkout/payment), with no topic profile.
const shopifyCheckoutPlan: QueryPlan = {
  originalNeed: "我经营面向美国消费者的小型独立站。过去30天，Shopify有哪些已发布、与结账或支付有关的变化？排除营销文章和无关应用推荐，说明适用条件。",
  coreKeywords: ["Shopify", "结账", "支付", "checkout", "payment"],
  englishKeywords: ["Shopify", "checkout", "payment"],
  synonyms: ["结账", "支付"],
  entities: ["Shopify"],
  industryKeywords: ["电商"],
  changeKeywords: ["变化", "已发布"],
  knowledgeAwareQueries: [],
  searchCombinations: ["shopify 与结账或支付有关的变化 official changelog"],
  retrievalWindows: ["30d"],
  requestedFreshnessWindow: "30d",
} as QueryPlan;

test("same entity with the requested task constraint passes", () => {
  for (const text of [
    "Shopify checkout payments adds support for a new payment method",
    "Shopify Checkout Extensibility adds a payment option for US merchants",
    "Shopify 结账与支付新增支付方式",
    "Shopify adds UCP buyer consent for checkout",
  ]) {
    assert.equal(assessTopicRelevance(text, shopifyCheckoutPlan).decision, "MATCH", text);
  }
});

test("same entity without the requested task constraint is rejected", () => {
  for (const text of [
    "Shopify AI Toolkit security scan",
    "Shopify adds a new image compression tool",
    "Shopify Hydrogen 2026-10 is now available",
    "Shopify 推出应用安全扫描功能",
  ]) {
    assert.equal(assessTopicRelevance(text, shopifyCheckoutPlan).decision, "TOPIC_MISMATCH", text);
  }
});

test("navigation, subscription and generic introduction text is never task evidence", () => {
  for (const text of [
    "Shopify Developer Changelog",
    "Find the latest news and learn about new platform opportunities.",
    "Recent changes to Shopify's platform",
    "Shopify 开发者中心导航",
  ]) {
    const relevance = assessTopicRelevance(text, shopifyCheckoutPlan);
    assert.equal(relevance.decision, "TOPIC_MISMATCH", text);
    assert.equal(relevance.relevanceGatePassed, false, text);
  }
});

test("another entity's genuinely relevant material never leaks in", () => {
  for (const text of [
    "Anthropic SDK payment documentation",
    "Stripe checkout payments adds a new payment method",
  ]) {
    assert.equal(assessTopicRelevance(text, shopifyCheckoutPlan).decision, "TOPIC_MISMATCH", text);
  }
});

test("task constraints tolerate reasonable synonyms and language variants", () => {
  for (const text of [
    "Shopify adds a payment method for Checkout",
    "Shopify checkout now supports tender types",
    "Shopify 支付方式与结账流程变更",
  ]) {
    assert.equal(assessTopicRelevance(text, shopifyCheckoutPlan).decision, "MATCH", text);
  }
});
