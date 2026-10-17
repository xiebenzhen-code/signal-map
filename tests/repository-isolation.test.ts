import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { PersonalKnowledgeRecordInput } from "../information/rag-records.ts";

const a1 = { authenticatedUserId: "user-a", filterId: "filter-a1" };
const a2 = { authenticatedUserId: "user-a", filterId: "filter-a2" };
const b1 = { authenticatedUserId: "user-b", filterId: "filter-b1" };

const knownInput: PersonalKnowledgeRecordInput = {
  type: "KNOWN_INFORMATION",
  text: "Codex is available",
};

test("personal knowledge requires user and filter scoped repository access", () => {
  const repository = new InMemorySignalRepository();

  repository.addPersonalKnowledge(a1, knownInput, "2026-09-05T00:00:00.000Z");
  repository.addPersonalKnowledge(b1, {
    type: "NOTE",
    text: "Private note from user B",
  }, "2026-09-05T00:00:00.000Z");

  assert.deepEqual(repository.listPersonalKnowledge(a1).map((item) => item.text), ["Codex is available"]);
  assert.deepEqual(repository.listPersonalKnowledge(a2), []);
  assert.deepEqual(repository.listPersonalKnowledge(b1).map((item) => item.text), ["Private note from user B"]);
});

test("researchContextRevision changes only for user-controlled research context records", () => {
  const repository = new InMemorySignalRepository();

  assert.equal(repository.getResearchContextRevision(a1), 1);
  repository.addPersonalKnowledge(a1, knownInput, "2026-09-05T00:00:00.000Z");
  assert.equal(repository.getResearchContextRevision(a1), 2);
  repository.addPersonalKnowledge(a1, {
    type: "NOTE",
    text: "A private note that should not invalidate research",
  }, "2026-09-05T00:01:00.000Z");
  assert.equal(repository.getResearchContextRevision(a1), 2);
});

test("public evidence writes do not mutate personal knowledge or revision", () => {
  const repository = new InMemorySignalRepository();
  const before = repository.getResearchContextRevision(a1);

  repository.upsertEvidence({
    id: "evidence-1",
    claimId: "claim-1",
    sourceUrl: "https://example.com",
    canonicalUrl: "https://example.com/",
    publisher: "Example",
    sourceType: "primary",
    sourceRole: "verification",
    sourceTier: "S",
    verificationStatus: "verified",
    evidenceSnippet: "Official evidence.",
    dataMode: "live",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    createdAt: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(repository.getResearchContextRevision(a1), before);
  assert.deepEqual(repository.listPersonalKnowledge(a1), []);
});

test("run metadata is isolated by authenticated user and filter", () => {
  const repository = new InMemorySignalRepository();

  repository.saveRunMetadata(a1, {
    id: "run-a1",
    generatedFromResearchContextRevision: 2,
    dataMode: "live",
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  repository.saveRunMetadata(b1, {
    id: "run-b1",
    generatedFromResearchContextRevision: 1,
    dataMode: "demo",
    createdAt: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(repository.getLatestRunMetadata(a1)?.id, "run-a1");
  assert.equal(repository.getLatestRunMetadata(a2), null);
  assert.equal(repository.getLatestRunMetadata(b1)?.id, "run-b1");
});
