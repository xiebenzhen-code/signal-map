import assert from "node:assert/strict";
import test from "node:test";

import { HybridRetriever } from "../information/hybrid-retriever.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import { assessNoveltyAttribution } from "../research/novelty-attribution.ts";

const context = { authenticatedUserId: "user-a", filterId: "filter-a" };

test("lexical retrieval works without embeddings or LLM", () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Model X supports feature A",
  }, "2026-09-05T00:00:00.000Z");
  repository.addPersonalKnowledge(context, {
    type: "QUESTION",
    text: "What changed in Model X features?",
  }, "2026-09-05T00:00:00.000Z");

  const retriever = new HybridRetriever(repository);
  const results = retriever.retrieve(context, "Model X now supports feature B");

  assert.equal(results[0]?.record?.text, "Model X supports feature A");
  assert.ok(results[0]?.lexicalScore);
});

test("retrieval relevance does not replace claim-level novelty", () => {
  const retriever = new HybridRetriever(new InMemorySignalRepository());
  const results = retriever.retrieveFromRecords(
    [
      {
        id: "known-a",
        userId: context.authenticatedUserId,
        filterId: context.filterId,
        type: "KNOWN_INFORMATION",
        text: "Model X supports feature A",
        normalizedText: "model x supports feature a",
        stableId: "known-a",
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ],
    "Model X now supports feature B",
  );

  const novelty = assessNoveltyAttribution({
    knownInformation: "Model X supports feature A",
    evidenceHistory: "",
    userJudgements: "",
    title: "Model X now supports feature B",
    snippet: "The new release adds Feature B.",
    clusterMembers: [],
    freshnessScore: 90,
  });

  assert.ok(results[0]?.lexicalScore);
  assert.ok(novelty.noveltyScore >= 80);
});

test("optional vector scores are fused without making embeddings mandatory", () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Codex release notes",
  }, "2026-09-05T00:00:00.000Z");

  const retriever = new HybridRetriever(repository, {
    score: (_query, record) => record.text.includes("Codex") ? 0.9 : 0,
  });
  const results = retriever.retrieve(context, "OpenAI Codex changelog");

  assert.equal(results[0]?.record?.text, "Codex release notes");
  assert.ok(results[0]?.vectorScore);
  assert.ok(results[0]?.fusedScore);
});

test("RAG retrieval covers knowledge, events, claims, and evidence", () => {
  const repository = new InMemorySignalRepository();
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text: "Codex supports cloud tasks",
  }, "2026-09-05T00:00:00.000Z");
  repository.upsertEvent({
    id: "event-codex-cloud",
    canonicalTitle: "Codex cloud task update",
    normalizedKey: "codex cloud task update",
    entities: ["Codex"],
    tags: ["cloud"],
    firstSeenAt: "2026-09-06T00:00:00.000Z",
    lastSeenAt: "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  });
  repository.upsertClaim({
    id: "claim-codex-cloud",
    eventId: "event-codex-cloud",
    claimText: "Codex cloud tasks can run repository checks.",
    normalizedClaim: "codex cloud tasks can run repository checks",
    entities: ["Codex"],
    tags: ["cloud"],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  });
  repository.upsertEvidence({
    id: "evidence-codex-cloud",
    claimId: "claim-codex-cloud",
    sourceUrl: "https://developers.openai.com/codex/changelog",
    canonicalUrl: "https://developers.openai.com/codex/changelog",
    publisher: "OpenAI",
    publishedAt: "2026-09-06T00:00:00.000Z",
    sourceType: "primary",
    sourceRole: "verification",
    sourceTier: "S",
    verificationStatus: "verified",
    evidenceSnippet: "Codex cloud tasks can run repository checks.",
    dataMode: "live",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-06T00:00:00.000Z",
  });

  const results = new HybridRetriever(repository).retrieve(context, "Codex cloud repository checks");
  const types = new Set(results.map((result) => result.recordType));

  assert.equal(types.has("knowledge"), true);
  assert.equal(types.has("event"), true);
  assert.equal(types.has("claim"), true);
  assert.equal(types.has("evidence"), true);
  assert.ok(results.every((result) => result.recordId && result.matchedText && result.fusedScore > 0));
  assert.equal(results.find((result) => result.recordType === "evidence")?.sourceUrl, "https://developers.openai.com/codex/changelog");
});
