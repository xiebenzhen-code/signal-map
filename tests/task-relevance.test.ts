import assert from "node:assert/strict";
import test from "node:test";

import { assessTopicRelevance } from "../research/topic-relevance.ts";
import type { QueryPlan } from "../research/types.ts";

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