import assert from "node:assert/strict";
import test from "node:test";
import { assessNoveltyAttribution } from "../research/novelty-attribution.ts";

function assess(overrides: Partial<Parameters<typeof assessNoveltyAttribution>[0]> = {}) {
  return assessNoveltyAttribution({
    knownInformation: "",
    evidenceHistory: "",
    userJudgements: "",
    title: "Product Alpha update",
    snippet: "Product Alpha update details.",
    clusterMembers: [],
    freshnessScore: 65,
    ...overrides,
  });
}

test("entity and generic-word overlap do not mark a Claude Code update as known", () => {
  const result = assess({
    knownInformation: "Codex is available",
    title: "Claude Code introduces a GitHub integration",
    snippet: "The documentation index lists all available pages for the new integration.",
  });

  assert.deepEqual(result.knownTerms, ["codex", "is", "available"]);
  assert.deepEqual(result.tokenMatches.map((match) => match.matchedTerm), ["is", "available"]);
  assert.deepEqual(result.tokenMatches.map((match) => match.legacyPenaltyContribution), [28, 28]);
  assert.deepEqual(result.knownMatches, []);
  assert.equal(result.noveltyScore, 92);
});

test("knowing that a product exists does not consume novelty for a new capability", () => {
  const result = assess({
    knownInformation: "Product Alpha exists",
    title: "Product Alpha launches a new integration",
  });

  assert.equal(result.noveltyScore, 92);
  assert.deepEqual(result.knownMatches, []);
});

test("the same substantive known fact remains low novelty", () => {
  const result = assess({
    knownInformation: "Product Alpha is available",
    title: "Product Alpha is available",
  });

  assert.equal(result.noveltyScore, 18);
  assert.equal(result.knownMatches.length, 1);
  assert.equal(result.knownMatches[0].penaltyContribution, 74);
});

test("a complete known event containing and remains low novelty", () => {
  const title = "Introducing the Admin plugin for ChatGPT Work and Codex - OpenAI";
  const result = assess({ knownInformation: title, title });

  assert.equal(result.noveltyScore, 18);
  assert.equal(result.knownMatches.length, 1);
});

test("an old state does not swallow a new version delta", () => {
  const result = assess({
    knownInformation: "Product Alpha version 1 is available",
    title: "Product Alpha version 2 adds a new workflow",
  });

  assert.equal(result.noveltyScore, 92);
  assert.deepEqual(result.knownMatches, []);
});

test("a known base capability does not cover an unknown workflow delta", () => {
  const result = assess({
    knownInformation: "Use multiple accounts",
    title: "Use multiple accounts with account switching",
  });

  assert.equal(result.noveltyScore, 92);
  assert.deepEqual(result.knownMatches, []);
});

test("unrelated knowledge does not change event novelty", () => {
  const baseline = assess({
    knownInformation: "AI systems exist",
    title: "Product Alpha adds account switching",
  });
  const withUnrelatedKnowledge = assess({
    knownInformation: "AI systems exist\nSourdough bread starter fermentation protocol",
    title: "Product Alpha adds account switching",
  });

  assert.equal(withUnrelatedKnowledge.noveltyScore, baseline.noveltyScore);
  assert.deepEqual(withUnrelatedKnowledge.knownMatches, []);
});

test("low-information overlap cannot create a knowledge penalty", () => {
  const result = assess({
    knownInformation: "is available",
    title: "A new developer workflow is available",
  });

  assert.equal(result.noveltyScore, 92);
  assert.deepEqual(result.knownMatches, []);
});

test("multiple substantive known facts remain low novelty when both facts are present", () => {
  const result = assess({
    knownInformation: "Product Alpha is available\nProduct Beta is available",
    title: "Product Alpha is available and Product Beta is available",
  });

  assert.equal(result.noveltyScore, 18);
  assert.equal(result.knownMatches.length, 2);
});
