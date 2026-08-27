import assert from "node:assert/strict";
import test from "node:test";
import { demoDataset } from "../information/demo-dataset.ts";
import {
  runFilterEngine,
  sourceCoverageExplanation,
  validateFactEvidence,
} from "../information/filter-engine.ts";
import type {
  InformationFilter,
  KnowledgeState,
} from "../information/types.ts";

function filter(overrides: Partial<InformationFilter> = {}): InformationFilter {
  const now = new Date().toISOString();
  return {
    id: "test-filter",
    filterName: "Test Filter",
    identity: "",
    industry: "",
    focusAreas: [],
    knownInformation: [],
    informationGaps: [],
    currentQuestions: [],
    freshnessWindow: "7d",
    sourceScope: "all",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function knowledge(overrides: Partial<KnowledgeState> = {}): KnowledgeState {
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
    evidenceHistory: [],
    freshnessWindow: "7d",
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
      filter: filter({ informationGaps: ["AI 生成内容标识"] }),
      knowledge: knowledge(),
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
