import assert from "node:assert/strict";
import test from "node:test";
import { demoDataset } from "../information/demo-dataset.ts";
import {
  evaluateDemoEvent,
  runFilterEngine,
  sourceCoverageExplanation,
  validateFactEvidence,
} from "../information/filter-engine.ts";
import type {
  ActiveKnowledgeContext,
  InformationFilter,
} from "../information/types.ts";
import type { DemoSource } from "../information/types.ts";
import { planQuery } from "../research/query-planner.ts";
import { classifySource } from "../research/source-classifier.ts";
import { describesRecentChange } from "../research/recent-signal.ts";

const regressionNow = new Date("2026-08-28T12:00:00.000Z");

function source(overrides: Partial<DemoSource> = {}): DemoSource {
  return {
    id: "source-1",
    eventKey: "timestamp-event",
    title: "Technology IPO update",
    summary: "A timestamp regression fixture.",
    claimText: "The company published an IPO update.",
    publisher: "Company Investor Relations",
    sourceUrl: "https://example.com/ir/update",
    sourceType: "primary",
    sourceTier: "S",
    publishedAt: "2026-08-28T08:00:00.000Z",
    eventOccurredAt: "2026-08-28T08:00:00.000Z",
    firstSeenAt: "2026-08-28T12:00:00.000Z",
    retrievedAt: "2026-08-28T12:00:00.000Z",
    dataOrigin: "demo",
    evidenceSnippet: "The official filing records the event and its date.",
    tags: ["IPO", "technology"],
    entities: ["Example Co"],
    reliability: 94,
    ...overrides,
  };
}

function evaluate(
  sources: DemoSource[],
  filterOverrides: Partial<InformationFilter> = {},
  knowledgeOverrides: Partial<ActiveKnowledgeContext> = {},
) {
  return evaluateDemoEvent(
    {
      filter: filter({ focusAreas: ["IPO"], ...filterOverrides }),
      knowledge: knowledge(knowledgeOverrides),
    },
    sources,
    regressionNow,
  );
}

function filter(overrides: Partial<InformationFilter> = {}): InformationFilter {
  const now = new Date().toISOString();
  return {
    id: "test-filter",
    filterName: "Test Filter",
    industry: "",
    focusAreas: [],
    freshnessWindow: "7d",
    sourceScope: "hybrid",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function knowledge(overrides: Partial<ActiveKnowledgeContext> = {}): ActiveKnowledgeContext {
  return {
    identity: "",
    industry: "",
    focusAreas: [],
    currentQuestions: [],
    knownInformation: [],
    informationGaps: [],
    trackedEntities: [],
    trackedEvents: [],
    userJudgements: [],
    freshnessWindow: "7d",
    sourceScope: "hybrid",
    customSources: [],
    researchContextRevision: 1,
    ...overrides,
  };
}

test("duplicate sources are removed before event clustering", () => {
  const result = runFilterEngine({
    filter: filter({ focusAreas: ["Codex"] }),
    knowledge: knowledge(),
  });
  const event = result.signals.find((signal) => signal.id === "demo-codex-workflow-update");
  assert.ok(event);
  assert.equal(event.sourceCount, 2);
  assert.ok(result.overview.deduplicated < result.overview.scanned);
});

test("known information lowers novelty enough to remove duplicate attention", () => {
  const unknown = runFilterEngine({
    filter: filter({ focusAreas: ["Codex"] }),
    knowledge: knowledge(),
  });
  const known = runFilterEngine({
    filter: filter({ focusAreas: ["Codex"] }),
    knowledge: knowledge({ knownInformation: ["Codex 更新多步骤任务协作与可审查结果"] }),
  });
  const freshEvent = unknown.signals.find((signal) => signal.id === "demo-codex-workflow-update");
  const knownEvent = known.signals.find((signal) => signal.id === "demo-codex-workflow-update");
  assert.ok(freshEvent);
  assert.ok(!knownEvent || knownEvent.noveltyScore < freshEvent.noveltyScore);
  assert.notEqual(knownEvent?.attentionDecision, "MUST_READ");
});

test("low reliability social content is blocked from Must Read", () => {
  const result = runFilterEngine({
    filter: filter({ focusAreas: ["设计", "Agent"] }),
    knowledge: knowledge(),
  });
  const rumor = result.signals.find((signal) => signal.id === "demo-viral-agent-rumor");
  assert.notEqual(rumor?.attentionDecision, "MUST_READ");
  assert.ok(!rumor || rumor.informationType === "SIGNAL");
});

test("an information gap improves relevance", () => {
  const dataset = demoDataset.filter((source) => source.eventKey === "creator-ai-label-policy");
  const withoutGap = runFilterEngine(
    { filter: filter(), knowledge: knowledge() },
    dataset,
  );
  const withGap = runFilterEngine(
    {
      filter: filter(),
      knowledge: knowledge({ informationGaps: ["AI 生成内容标识"] }),
    },
    dataset,
  );
  const baseline = withoutGap.signals[0];
  const matched = withGap.signals[0];
  assert.ok(baseline);
  assert.ok(matched);
  assert.ok(matched.relevanceScore > baseline.relevanceScore);
  assert.ok(matched.gapMatchScore > baseline.gapMatchScore);
});

test("a FACT without evidence fails validation", () => {
  const invalid = demoDataset.find((source) => source.id === "missing-evidence-fact");
  assert.ok(invalid);
  assert.equal(validateFactEvidence(invalid), false);
  const result = runFilterEngine(
    { filter: filter({ focusAreas: ["增长"] }), knowledge: knowledge() },
    [invalid],
  );
  assert.equal(
    result.signals.flatMap((signal) => signal.claims).some((claim) => claim.contentType === "FACT"),
    false,
  );
});

test("an unavailable source is not described as having no information", () => {
  const result = runFilterEngine({ filter: filter(), knowledge: knowledge() });
  assert.ok(result.coverage.unavailableProviders.includes("ImportedDataProvider"));
  assert.equal(result.failures.length, 0);
  assert.match(sourceCoverageExplanation, /不代表该来源没有信息/);
});

test("old article retrieved today is BACKGROUND, not NEW", () => {
  const event = evaluate([
    source({
      publishedAt: "2026-01-09T09:00:00.000Z",
      eventOccurredAt: "2026-01-09T09:00:00.000Z",
      firstSeenAt: "2026-08-28T12:00:00.000Z",
      retrievedAt: "2026-08-28T12:00:00.000Z",
    }),
  ], {}, { informationGaps: ["IPO"], currentQuestions: ["Technology IPO update"] });
  assert.equal(event.eventStatus, "BACKGROUND");
  assert.equal(event.time.includes("24小时"), false);
  assert.match(event.time, /个月前/);
});

test("new article published today is NEW", () => {
  const event = evaluate([source()]);
  assert.equal(event.eventStatus, "NEW");
  assert.ok(event.freshnessScore >= 80);
});

test("old event with important new evidence today is UPDATED", () => {
  const original = source({
    id: "original",
    publishedAt: "2026-07-29T08:00:00.000Z",
    eventOccurredAt: "2026-07-29T08:00:00.000Z",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    firstSeenAt: "2026-07-29T12:00:00.000Z",
  });
  const update = source({
    id: "update",
    sourceUrl: "https://example.com/ir/update-2",
    claimText: "The company added a material update.",
    publishedAt: "2026-08-28T10:00:00.000Z",
    eventOccurredAt: "2026-07-29T08:00:00.000Z",
    lastUpdatedAt: "2026-08-28T10:00:00.000Z",
  });
  const event = evaluate([original, update]);
  assert.equal(event.eventStatus, "UPDATED");
  assert.equal(event.originalOccurredAt, "2026-07-29T08:00:00.000Z");
  assert.equal(event.latestUpdateAt, "2026-08-28T10:00:00.000Z");
  assert.match(event.time, /^有更新/);
});

test("very new low reliability social content remains SIGNAL, not FACT", () => {
  const event = evaluate([
    source({
      sourceType: "social",
      sourceTier: "C",
      publisher: "X Community",
      sourceUrl: "https://x.com/example/status/1",
      evidenceSnippet: undefined,
      reliability: 24,
      publishedAt: "2026-08-28T11:50:00.000Z",
      eventOccurredAt: "2026-08-28T11:50:00.000Z",
    }),
  ], {}, { informationGaps: ["Technology IPO update"], currentQuestions: ["Technology IPO update"] });
  assert.equal(event.eventStatus, "SIGNAL");
  assert.equal(event.informationType, "SIGNAL");
  assert.equal(event.claims.some((claim) => claim.contentType === "FACT"), false);
  assert.notEqual(event.attentionDecision, "MUST_READ");
  assert.equal(event.attentionDecision, "WORTH_WATCHING");
});

test("a fresh GitHub discussion can be Worth Watching without becoming a FACT", () => {
  const event = evaluate([
    source({
      sourceType: "social",
      sourceTier: "C",
      publisher: "GitHub Discussions · openai/codex",
      sourceUrl: "https://github.com/openai/codex/discussions/42",
      evidenceSnippet: undefined,
      reliability: 38,
      publishedAt: "2026-08-28T11:50:00.000Z",
      eventOccurredAt: "2026-08-28T11:50:00.000Z",
    }),
  ], {}, {
    informationGaps: ["Technology IPO update"],
    currentQuestions: ["Technology IPO update"],
  });
  assert.equal(event.eventStatus, "SIGNAL");
  assert.equal(event.informationType, "SIGNAL");
  assert.equal(event.claims.some((claim) => claim.contentType === "FACT"), false);
  assert.equal(event.attentionDecision, "WORTH_WATCHING");
});

test("one claim can retain both discovery and verification evidence sources", () => {
  const claimText = "The company confirmed a material API change.";
  const event = evaluate([
    source({
      id: "social-discovery",
      claimText,
      sourceType: "social",
      sourceTier: "C",
      publisher: "Community Post",
      sourceUrl: "https://x.com/example/status/2",
      reliability: 35,
    }),
    source({
      id: "official-verification",
      claimText,
      publisher: "Company Documentation",
      sourceUrl: "https://example.com/docs/api-change",
      sourceType: "primary",
      sourceTier: "S",
      reliability: 95,
    }),
  ]);
  const claim = event.claims.find((candidate) => candidate.claimText === claimText);
  assert.ok(claim);
  assert.deepEqual(
    claim.evidenceSources.map((evidence) => evidence.sourceRole),
    ["discovery", "verification"],
  );
  assert.equal("sourceRole" in claim, false);
});

test("fresh information already known has high Freshness but low Novelty", () => {
  const article = source();
  const event = evaluate([article], {}, {
    knownInformation: ["Technology IPO update"],
  });
  assert.ok(event.freshnessScore >= 80);
  assert.ok(event.noveltyScore < 40);
  assert.notEqual(event.attentionDecision, "MUST_READ");
});

test("old information filling a critical gap stays BACKGROUND evidence", () => {
  const event = evaluate([
    source({
      title: "Archived IPO proceeds filing",
      summary: "The archived filing explains the use of proceeds.",
      claimText: "The filing specifies how IPO proceeds were allocated.",
      tags: ["IPO proceeds", "use of proceeds"],
      publishedAt: "2026-01-09T09:00:00.000Z",
      eventOccurredAt: "2026-01-09T09:00:00.000Z",
    }),
  ], { focusAreas: ["IPO proceeds"] }, {
    informationGaps: ["use of proceeds", "IPO proceeds"],
    currentQuestions: ["IPO proceeds allocated"],
  });
  assert.equal(event.eventStatus, "BACKGROUND");
  assert.notEqual(event.eventStatus, "NEW");
  assert.notEqual(event.attentionDecision, "IGNORE");
});

test("recent query planner searches windows from 24h to 30d", () => {
  const plan = planQuery({
    identity: "AI product manager",
    industry: "AI creator tools",
    focusAreas: "video generation",
    currentQuestions: "What changed in the API?",
    knownInformation: "Seedance 2.5 已发布",
    informationGaps: "pricing and copyright restrictions",
    trackedEntities: "Seedance",
    trackedEvents: "Seedance 2.5 launch",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "24h",
  });
  assert.deepEqual(plan.retrievalWindows, ["24h", "3d", "7d", "30d"]);
  assert.equal(plan.requestedFreshnessWindow, "24h");
  assert.ok(plan.changeKeywords.includes("changelog"));
  assert.ok(plan.changeKeywords.includes("new limitation"));
});

test("known release produces change-after-knowledge queries", () => {
  const plan = planQuery({
    identity: "creator",
    industry: "AI video",
    focusAreas: "Seedance",
    currentQuestions: "API availability",
    knownInformation: "Seedance 2.5 已发布",
    informationGaps: "pricing copyright",
    trackedEntities: "Seedance",
    trackedEvents: "",
    userJudgements: "",
    evidenceHistory: "",
    freshnessWindow: "7d",
  });
  assert.ok(plan.knowledgeAwareQueries.includes("Seedance latest update"));
  assert.ok(plan.knowledgeAwareQueries.includes("Seedance API"));
  assert.ok(plan.knowledgeAwareQueries.includes("Seedance new limitation"));
  assert.equal(plan.searchCombinations.some((query) => query === "Seedance 2.5 已发布"), false);
});

test("demo runs are explicitly distinguishable from live research", () => {
  const result = runFilterEngine({
    filter: filter({ focusAreas: ["Codex"] }),
    knowledge: knowledge(),
  });
  assert.equal(result.dataMode, "demo");
  assert.ok(result.signals.every((signal) => signal.dataOrigin === "demo"));
});

test("a community GitHub result remains a social discovery source", () => {
  assert.equal(
    classifySource("GitHub", "https://news.google.com/rss/articles/community-repository"),
    "social",
  );
});

test("generic entity pages do not qualify as recent change events", () => {
  assert.equal(describesRecentChange("ChatGPT Work and Codex", "Product documentation"), false);
  assert.equal(describesRecentChange("Codex MCP server command deprecated"), true);
  assert.equal(describesRecentChange("gemini-cli release v0.57.0"), true);
});
