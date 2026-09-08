import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import { createResearchPlan } from "../agent/query-planner.ts";
import { selectSource } from "../agent/source-selector.ts";
import { classifyIntent } from "../intent/classifier.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import { assessActionability } from "../intent/actionability.ts";
import { mapIntentOutput } from "../intent/output-mapping.ts";
import type { ResearchInput, ResearchResponse, ResearchSignal } from "../research/types.ts";

const baseInput: ResearchInput = {
  identity: "AI product builder",
  industry: "AI tools",
  focusAreas: "AIGC video, coding agents",
  currentQuestions: "What changed recently?",
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "Claude Code, Codex",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
};

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: overrides.id ?? "event-1",
    category: "匹配",
    channel: "官方",
    title: overrides.title ?? "AIGC video role is open",
    summary: overrides.summary ?? "Company careers page lists an open role with an apply link.",
    time: "1h",
    truth: 90,
    baseUseful: 90,
    lead: 90,
    tags: overrides.tags ?? ["AIGC", "video", "remote"],
    action: "read",
    why: "matches intent",
    official: [],
    social: [],
    sourceType: overrides.sourceType ?? "primary",
    sourceTier: overrides.sourceTier ?? "S",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/careers/apply",
    publisher: overrides.publisher ?? "Company Careers",
    publishedAt: "2026-09-09T00:00:00.000Z",
    firstSeenAt: "2026-09-09T00:00:00.000Z",
    retrievedAt: "2026-09-09T00:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: overrides.confidence ?? 90,
    verificationStatus: overrides.verificationStatus ?? "verified",
    relevanceScore: overrides.relevanceScore ?? 90,
    reliabilityScore: overrides.reliabilityScore ?? 90,
    freshnessScore: overrides.freshnessScore ?? 90,
    noveltyScore: 80,
    judgementImpactScore: 80,
    gapMatchScore: 80,
    overallScore: 88,
    sourceCount: overrides.sourceCount ?? 1,
    independentEvidenceCount: overrides.independentEvidenceCount ?? 1,
    propagationCount: 1,
    claims: [{
      claimText: overrides.title ?? "AIGC video role is open",
      sourceUrl: overrides.sourceUrl ?? "https://example.com/careers/apply",
      publisher: overrides.publisher ?? "Company Careers",
      publishedAt: "2026-09-09T00:00:00.000Z",
      sourceType: overrides.sourceType ?? "primary",
      sourceTier: overrides.sourceTier ?? "S",
      evidenceSnippet: overrides.summary ?? "Company careers page lists an open role with an apply link.",
      verificationStatus: overrides.verificationStatus ?? "verified",
      contentType: overrides.informationType === "SIGNAL" ? "SIGNAL" : "FACT",
      evidenceSources: [],
      independentEvidenceCount: overrides.independentEvidenceCount ?? 1,
    }],
    sources: [{
      sourceUrl: overrides.sourceUrl ?? "https://example.com/careers/apply",
      publisher: overrides.publisher ?? "Company Careers",
      publishedAt: "2026-09-09T00:00:00.000Z",
      sourceType: overrides.sourceType ?? "primary",
      sourceTier: overrides.sourceTier ?? "S",
    }],
    section: "must_know",
    gapMatches: [],
    questionMatches: [],
    entityMatches: ["AIGC"],
    whyItMatters: "It can be acted on now.",
    eventStatus: "NEW",
    informationType: overrides.informationType ?? "FACT",
    knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ",
    ...overrides,
  };
}

function response(signals: ResearchSignal[]): ResearchResponse {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-09-09T00:00:00.000Z",
    dataMode: "live",
  };
}

test("classifier recognizes core intents with deterministic fallback", () => {
  assert.equal(classifyIntent({ userQuery: "最近有哪些适合 AIGC 视频方向的岗位？", relatedKnowledge: [] }).primaryIntent, "JOB_SEARCH");
  assert.equal(classifyIntent({ userQuery: "最近 30 天 AIGC 视频有什么值得进入的新赛道？", relatedKnowledge: [] }).primaryIntent, "AIGC_OPPORTUNITY");
  assert.equal(classifyIntent({ userQuery: "Claude Code 最近 7 天更新了什么？", relatedKnowledge: [] }).primaryIntent, "PRODUCT_UPDATE");
  assert.equal(classifyIntent({ userQuery: "这个技术方案值不值得用于生产？", relatedKnowledge: [] }).primaryIntent, "TECH_RESEARCH");
  assert.equal(classifyIntent({ userQuery: "AI 监管政策什么时候生效，适用范围是什么？", relatedKnowledge: [] }).primaryIntent, "POLICY_REGULATION");
  assert.equal(classifyIntent({ userQuery: "帮我看看这个事情", relatedKnowledge: [] }).primaryIntent, "GENERAL_RESEARCH");
});

test("intent profile influences source selection without replacing SourceSelector", () => {
  const policy = sourceProfileForIntent("POLICY_REGULATION");
  const job = sourceProfileForIntent("JOB_SEARCH");

  assert.equal(selectSource({ strategy: "INITIAL", sourceProfile: policy }).primarySourceType, "PRIMARY");
  assert.equal(selectSource({ strategy: "INITIAL", sourceProfile: job }).primarySourceType, "GENERAL_WEB");
  assert.equal(selectSource({ strategy: "VERIFY_CONFLICT", sourceProfile: sourceProfileForIntent("AIGC_OPPORTUNITY") }).primarySourceType, "OFFICIAL");
});

test("intent profile changes QueryPlanner queries", () => {
  const jobIntent = classifyIntent({ userQuery: "最近有哪些适合 AIGC 视频方向的岗位？", relatedKnowledge: [] });
  const jobProfile = sourceProfileForIntent(jobIntent.primaryIntent);
  const productIntent = classifyIntent({ userQuery: "Claude Code 最近 7 天更新了什么？", relatedKnowledge: [] });
  const productProfile = sourceProfileForIntent(productIntent.primaryIntent);

  const jobPlan = createResearchPlan({ ...baseInput, currentQuestions: "最近有哪些适合 AIGC 视频方向的岗位？" }, 1, 5, [], "INITIAL", undefined, jobIntent, jobProfile);
  const productPlan = createResearchPlan({ ...baseInput, currentQuestions: "Claude Code 最近 7 天更新了什么？" }, 1, 5, [], "INITIAL", undefined, productIntent, productProfile);

  assert.ok(jobPlan.queries.some((query) => /careers|job board|apply/i.test(query)));
  assert.ok(productPlan.queries.some((query) => /changelog|release notes|official/i.test(query)));
});

test("JOB_SEARCH actionability downranks closed roles", () => {
  const open = assessActionability({ intent: "JOB_SEARCH", signal: signal() });
  const closed = assessActionability({
    intent: "JOB_SEARCH",
    signal: signal({ title: "AIGC video role closed", summary: "This job is no longer accepting applications." }),
  });
  assert.equal(open.rating, "high");
  assert.equal(closed.rating, "low");
});

test("AIGC opportunity single signal remains EARLY_SIGNAL while independent verified sources can rise", () => {
  const profile = sourceProfileForIntent("AIGC_OPPORTUNITY");
  const single = mapIntentOutput(response([
    signal({ title: "One social post says AI video avatars are a new market", sourceType: "social", sourceTier: "C", informationType: "SIGNAL", verificationStatus: "unverified" }),
  ]), profile);
  const multiple = mapIntentOutput(response([
    signal({ title: "Multiple companies launch AI video workflow products", independentEvidenceCount: 2, sourceCount: 2 }),
  ]), profile);

  assert.equal(single.mode, "OPPORTUNITY_MAP");
  assert.equal(single.opportunities[0].status, "EARLY_SIGNAL");
  assert.equal(multiple.mode, "OPPORTUNITY_MAP");
  assert.equal(multiple.opportunities[0].status, "FACT");
});

test("AgentRunner records intent and keeps the same research boundary", async () => {
  let calls = 0;
  const result = await runAgent({
    input: { ...baseInput, currentQuestions: "最近有哪些适合 AIGC 视频方向的岗位？" },
    maxRounds: 1,
    research: async (_input, plan) => {
      calls += 1;
      assert.equal(plan.selectedSourceType, "GENERAL_WEB");
      assert.ok(plan.queries.some((query) => /careers|job board|apply/i.test(query)));
      return response([signal()]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.steps.some((step) => step.state === "INTENT"), true);
  assert.equal(result.response?.intent?.primaryIntent, "JOB_SEARCH");
  assert.equal(result.response?.outputMode, "JOB_SHORTLIST");
});

test("personal knowledge changes relevance path but does not replace external research", async () => {
  let receivedKnownInformation = "";
  const result = await runAgent({
    input: { ...baseInput, currentQuestions: "Claude Code 最近 7 天更新了什么？", knownInformation: "Claude Code has planning mode" },
    maxRounds: 1,
    research: async (input) => {
      receivedKnownInformation = input.knownInformation;
      return response([signal({ title: "Claude Code release notes update planning mode" })]);
    },
  });

  assert.match(receivedKnownInformation, /planning mode/);
  assert.equal(result.response?.intent?.primaryIntent, "PRODUCT_UPDATE");
  assert.equal(result.rounds, 1);
});
