import assert from "node:assert/strict";
import test from "node:test";

import { reconcileInformationGain } from "../agent/evaluation.ts";
import type { PersonalKnowledgeRecord } from "../information/rag-records.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";

const CLAIM = "adobe adds generative media tool in premiere timeline";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-new",
    title: "Adobe adds Generative Media Tool in Premiere timeline",
    sources: [],
    claims: [],
    sourceUrl: "https://other-source.com/adobe-post",
    ...overrides,
  } as ResearchSignal;
}

function record(verificationStatus: string, overrides: Partial<PersonalKnowledgeRecord> = {}): PersonalKnowledgeRecord {
  return {
    id: "pk-1",
    userId: "user-1",
    filterId: "filter-1",
    type: "KNOWN_INFORMATION",
    text: "Adobe adds Generative Media Tool in Premiere timeline",
    structuredPayload: {
      claimFingerprints: [CLAIM],
      sourceUrls: ["https://blog.adobe.com/en/publish/2026/09/08/post"],
      verificationStatus,
    },
    normalizedText: CLAIM,
    stableId: "stable-1",
    createdAt: "2026-10-04T01:04:46.000Z",
    updatedAt: "2026-10-04T01:04:46.000Z",
    ...overrides,
  } as PersonalKnowledgeRecord;
}

// Bounded repair 2026-10-04: a partially verified record means "the user has
// seen this", not "the fact is settled". Stronger evidence on the same claim
// must upgrade the record (UPDATED_INFORMATION) instead of being suppressed as
// a duplicate.
test("partially verified knowledge does not consume the information gain of stronger evidence", () => {
  const response = reconcileInformationGain(
    { signals: [signal()] } as ResearchResponse,
    [record("partially_verified")],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "UPDATED");
  assert.equal(response.signals[0]?.informationGainStatus, "UPDATED_INFORMATION");
});

test("unverified knowledge behaves the same as partially verified", () => {
  const response = reconcileInformationGain(
    { signals: [signal()] } as ResearchResponse,
    [record("unverified")],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "UPDATED");
});

test("verified knowledge still marks the same claim as a duplicate", () => {
  const response = reconcileInformationGain(
    { signals: [signal()] } as ResearchResponse,
    [record("verified")],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "KNOWN");
  assert.equal(response.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
});

test("a verified record elsewhere does not block an upgrade from a partial record", () => {
  // Two records on unrelated claims: the partial one matches, the verified one
  // does not — the partial match must still upgrade, not duplicate.
  const verifiedOther = record("verified", {
    id: "pk-2",
    structuredPayload: {
      claimFingerprints: ["a completely unrelated known fact"],
      sourceUrls: [],
      verificationStatus: "verified",
    },
  });
  const response = reconcileInformationGain(
    { signals: [signal()] } as ResearchResponse,
    [record("partially_verified"), verifiedOther],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "UPDATED");
});

// Contract check 2026-10-04: the same partial evidence re-seen (same claim, same
// source, same verification strength) must not advance a revision — only
// strictly stronger evidence counts as an update.
test("the same partial evidence re-seen carries no information gain", () => {
  const sameSignal = signal({ sourceUrl: "https://blog.adobe.com/en/publish/2026/09/08/post" });
  const response = reconcileInformationGain(
    { signals: [sameSignal] } as ResearchResponse,
    [record("partially_verified")],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "KNOWN");
  assert.equal(response.signals[0]?.informationGainStatus, "NO_INFORMATION_GAIN");
});

test("a verified claim on the same source still upgrades a partial record", () => {
  const stronger = signal({
    sourceUrl: "https://blog.adobe.com/en/publish/2026/09/08/post",
    verificationStatus: "verified",
  });
  const response = reconcileInformationGain(
    { signals: [stronger] } as ResearchResponse,
    [record("partially_verified")],
    [],
  );
  assert.equal(response.signals[0]?.knowledgeStatus, "UPDATED");
  assert.equal(response.signals[0]?.informationGainStatus, "UPDATED_INFORMATION");
});
