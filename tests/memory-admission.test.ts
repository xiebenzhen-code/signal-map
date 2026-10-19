import assert from "node:assert/strict";
import test from "node:test";

import { updateKnowledgeFromChanges } from "../agent/knowledge-updater.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { ResearchSignal } from "../research/types.ts";

const context = { authenticatedUserId: "user-a", filterId: "filter-1" };

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-1",
    title: "Shopify checkout payments adds support for a new payment method",
    originalTitle: "Shopify checkout payments adds support for a new payment method",
    reliabilityScore: 92,
    topicRelevance: { decision: "MATCH", matchedTerms: ["checkout", "payment"], score: 90 } as never,
    informationGainStatus: "NEW_INFORMATION" as never,
    verificationStatus: "verified" as never,
    informationType: "FACT" as never,
    section: "all",
    attentionDecision: "LIBRARY_ONLY",
    sourceUrl: "https://shopify.dev/changelog/a",
    claims: [],
    sources: [],
    ...overrides,
  } as unknown as ResearchSignal;
}

function response(signals: ResearchSignal[]) {
  return {
    signals,
    status: [],
    queryPlan: {} as never,
    progress: [],
    failures: [],
    counts: {} as never,
    overview: {} as never,
    coverage: {} as never,
    fetchedAt: "2026-10-19T00:00:00.000Z",
    dataMode: "live" as const,
  };
}

const newChange = (signalId = "signal-1") => ({ signalId, classification: "NEW" }) as never;

async function persistedTexts(
  items: ResearchSignal[],
  changes: unknown[] = [newChange()],
) {
  const repository = new InMemorySignalRepository();
  await updateKnowledgeFromChanges({
    context,
    repository,
    response: response(items),
    changes: changes as never,
    runId: "run-1",
    now: "2026-10-19T00:00:00.000Z",
  });
  return (await repository.listPersonalKnowledge(context)).map((record) => record.text);
}

test("navigation text never becomes confirmed knowledge even from an official source", async () => {
  const texts = await persistedTexts([
    signal({
      id: "signal-nav",
      title: "Shopify Developer Changelog",
      originalTitle: "Shopify Developer Changelog",
      sourceUrl: "https://shopify.dev/changelog/feed.xml",
      attentionDecision: "LIBRARY_ONLY",
      section: "all",
    }),
  ]);
  assert.equal(texts.length, 0, "a subscription endpoint is not a confirmed fact");
});

test("generic channel descriptions are not admitted as known information", async () => {
  const texts = await persistedTexts([
    signal({
      id: "signal-generic",
      title: "Find the latest news and learn about new platform opportunities.",
      originalTitle: "Find the latest news and learn about new platform opportunities.",
      sourceUrl: "https://shopify.dev/changelog",
    }),
  ]);
  assert.equal(texts.length, 0);
});

test("missing relevance evidence is never treated as task relevance", async () => {
  const texts = await persistedTexts([
    signal({ topicRelevance: undefined }),
  ]);
  assert.equal(texts.length, 0, "no relevance verdict must not pass as relevant");
});

test("off-task material for the same entity is not admitted", async () => {
  const texts = await persistedTexts([
    signal({
      id: "signal-1",
      title: "Shopify AI Toolkit security scan",
      originalTitle: "Shopify AI Toolkit security scan",
      topicRelevance: { decision: "TOPIC_MISMATCH", matchedTerms: ["shopify"], score: 0 } as never,
    }),
  ]);
  assert.equal(texts.length, 0);
});

test("genuinely relevant new evidence is still admitted", async () => {
  const texts = await persistedTexts([signal()]);
  assert.deepEqual(texts, ["Shopify checkout payments adds support for a new payment method"]);
});

test("re-seen identical evidence does not add a second record", async () => {
  const repository = new InMemorySignalRepository();
  const base = { context, repository, response: response([signal({ id: "signal-1" })]), runId: "run-1", now: "2026-10-19T00:00:00.000Z" };
  await updateKnowledgeFromChanges({ ...base, changes: [newChange()] });
  const afterFirst = (await Promise.resolve(repository.listPersonalKnowledge(context))).length;
  await updateKnowledgeFromChanges({
    ...base,
    runId: "run-2",
    changes: [{ signalId: "signal-1", classification: "DUPLICATE" } as never],
  });
  const afterSecond = (await Promise.resolve(repository.listPersonalKnowledge(context))).length;
  assert.equal(afterFirst, 1);
  assert.equal(afterSecond, afterFirst, "a duplicate must not create another knowledge record");
});

test("two users and two scopes stay isolated", async () => {
  const repository = new InMemorySignalRepository();
  const responseA = response([signal({ id: "s-a", title: "Shopify checkout payments adds a payment method", originalTitle: "Shopify checkout payments adds a payment method" })]);
  await updateKnowledgeFromChanges({ context: { authenticatedUserId: "user-a", filterId: "f1" }, repository, response: responseA, changes: [newChange("s-a")], runId: "r1", now: "2026-10-19T00:00:00.000Z" });
  assert.equal((await Promise.resolve(repository.listPersonalKnowledge({ authenticatedUserId: "user-b", filterId: "f1" }))).length, 0);
  assert.equal((await Promise.resolve(repository.listPersonalKnowledge({ authenticatedUserId: "user-a", filterId: "f2" }))).length, 0);
  assert.equal((await Promise.resolve(repository.listPersonalKnowledge({ authenticatedUserId: "user-a", filterId: "f1" }))).length, 1);
});