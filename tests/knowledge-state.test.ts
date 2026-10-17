import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDefaultIdentity,
  composeActiveKnowledgeContext,
  createEmptyFilterKnowledge,
  recordEvidence,
  updateFilterResearchConfig,
  updateResearchContext,
} from "../information/knowledge-state.ts";
import type { InformationFilter } from "../information/types.ts";

const now = "2026-08-28T08:00:00.000Z";
const later = "2026-08-28T09:00:00.000Z";
const filter: InformationFilter = {
  id: "ai",
  filterName: "AI 产品",
  industry: "AI",
  focusAreas: ["Agent"],
  freshnessWindow: "7d",
  sourceScope: "hybrid",
  createdAt: now,
  updatedAt: now,
};

test("research changes only the selected filter", () => {
  const ai = createEmptyFilterKnowledge(now);
  const fashion = createEmptyFilterKnowledge(now);
  const updated = updateResearchContext(ai, { knownInformation: ["Codex 已更新"] }, later);
  assert.equal(updated.researchContextRevision, 2);
  assert.equal(fashion.researchContextRevision, 1);
  assert.deepEqual(fashion.knownInformation, []);
});

test("array inputs normalize before revision comparison", () => {
  const known = updateResearchContext(createEmptyFilterKnowledge(now), { knownInformation: ["  已知 ", "", "已知"] }, later);
  const noOp = updateResearchContext(known, { knownInformation: ["已知", "  "] }, later);
  assert.deepEqual(known.knownInformation, ["已知"]);
  assert.equal(noOp, known);
});

test("automatic evidence does not invalidate research context", () => {
  const updated = recordEvidence(createEmptyFilterKnowledge(now), "OpenAI Release Notes", later);
  assert.equal(updated.researchContextRevision, 1);
  assert.deepEqual(updated.evidenceHistory, ["OpenAI Release Notes"]);
});

test("explicitly promoting evidence increments research context once", () => {
  const recorded = recordEvidence(createEmptyFilterKnowledge(now), "OpenAI Release Notes", later);
  const promoted = updateResearchContext(recorded, { knownInformation: ["Codex 已更新"] }, later);
  assert.equal(recorded.researchContextRevision, 1);
  assert.equal(promoted.researchContextRevision, 2);
});

test("context contains source configuration and only resolved identity", () => {
  const context = composeActiveKnowledgeContext(
    { defaultIdentity: "默认身份" },
    { ...filter, identityOverride: "研究身份", sourceScope: "custom", customSources: [" source ", "source", ""] },
    createEmptyFilterKnowledge(now),
  );
  assert.equal(context.identity, "研究身份");
  assert.equal(context.sourceScope, "custom");
  assert.deepEqual(context.customSources, ["source"]);
  assert.equal("defaultIdentity" in context, false);
  assert.equal("evidenceHistory" in context, false);
});

test("empty identity override normalizes to undefined", () => {
  const result = updateFilterResearchConfig(filter, createEmptyFilterKnowledge(now), { identityOverride: "   " }, later);
  assert.equal(result.filter.identityOverride, undefined);
  assert.equal(result.knowledge.researchContextRevision, 1);
});

test("query changes increment only the edited filter", () => {
  const result = updateFilterResearchConfig(
    filter,
    createEmptyFilterKnowledge(now),
    { freshnessWindow: "24h", sourceScope: "global", customSources: [" one ", "one", ""] },
    later,
  );
  assert.equal(result.knowledge.researchContextRevision, 2);
  assert.deepEqual(result.filter.customSources, ["one"]);
});

test("default identity invalidates only inheriting filters", () => {
  const result = applyDefaultIdentity(
    { defaultIdentity: "旧身份" },
    [filter, { ...filter, id: "design", identityOverride: "设计师" }],
    { ai: createEmptyFilterKnowledge(now), design: createEmptyFilterKnowledge(now) },
    "新身份",
    later,
  );
  assert.equal(result.knowledgeByFilterId.ai.researchContextRevision, 2);
  assert.equal(result.knowledgeByFilterId.design.researchContextRevision, 1);
});
