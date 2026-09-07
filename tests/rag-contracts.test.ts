import assert from "node:assert/strict";
import test from "node:test";

import { recordsFromSignal } from "../information/rag-records.ts";
import type { ResearchSignal } from "../research/types.ts";

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  const base: ResearchSignal = {
    id: "event-model-x-release",
    category: "匹配",
    channel: "混合",
    title: "Model X release update",
    summary: "Model X added more capabilities.",
    time: "1小时前",
    truth: 92,
    baseUseful: 88,
    lead: 80,
    tags: ["model x", "release"],
    action: "Check official evidence",
    why: "It changes the release understanding.",
    official: [],
    social: [],
    sourceType: "primary",
    sourceTier: "S",
    sourceUrl: "https://example.com/release",
    publisher: "Example IR",
    publishedAt: "2026-09-05T01:00:00.000Z",
    firstSeenAt: "2026-09-05T02:00:00.000Z",
    retrievedAt: "2026-09-05T02:00:00.000Z",
    timestampStatus: "valid",
    dataOrigin: "live",
    confidence: 92,
    verificationStatus: "verified",
    relevanceScore: 90,
    reliabilityScore: 92,
    freshnessScore: 90,
    noveltyScore: 88,
    judgementImpactScore: 70,
    gapMatchScore: 65,
    overallScore: 86,
    sourceCount: 2,
    independentEvidenceCount: 2,
    propagationCount: 1,
    claims: [
      {
        claimText: "Model X supports Feature A.",
        sourceUrl: "https://example.com/release",
        publisher: "Example IR",
        publishedAt: "2026-09-05T01:00:00.000Z",
        sourceType: "primary",
        sourceTier: "S",
        evidenceSnippet: "Feature A is listed in the release notes.",
        verificationStatus: "verified",
        contentType: "FACT",
        independentEvidenceCount: 1,
        evidenceSources: [
          {
            sourceUrl: "https://example.com/release",
            publisher: "Example IR",
            publishedAt: "2026-09-05T01:00:00.000Z",
            sourceType: "primary",
            sourceTier: "S",
            sourceRole: "verification",
            evidenceSnippet: "Feature A is listed in the release notes.",
            verificationStatus: "verified",
          },
        ],
      },
      {
        claimText: "Model X added Feature B.",
        sourceUrl: "https://x.com/example/status/1",
        publisher: "X",
        publishedAt: "2026-09-05T01:20:00.000Z",
        sourceType: "social",
        sourceTier: "C",
        evidenceSnippet: "A developer reported Feature B.",
        verificationStatus: "unverified",
        contentType: "SIGNAL",
        evidenceChainId: "chain-feature-b",
        canonicalClaimFingerprint: "model-x-feature-b",
        propagationCount: 8,
        independentEvidenceCount: 1,
        evidenceSources: [
          {
            sourceUrl: "https://x.com/example/status/1",
            publisher: "X",
            publishedAt: "2026-09-05T01:20:00.000Z",
            sourceType: "social",
            sourceTier: "C",
            sourceRole: "discovery",
            evidenceSnippet: "A developer reported Feature B.",
            verificationStatus: "unverified",
          },
        ],
      },
    ],
    sources: [],
    section: "must_know",
    gapMatches: ["release details"],
    questionMatches: [],
    entityMatches: ["Model X"],
    whyItMatters: "It updates the user's tracked release question.",
    eventStatus: "NEW",
    informationType: "FACT",
    knowledgeStatus: "NOVEL",
    attentionDecision: "MUST_READ",
  };
  return { ...base, ...overrides };
}

test("maps existing ResearchSignal to Event, Claim, and Evidence records", () => {
  const mapped = recordsFromSignal(signal());

  assert.equal(mapped.event.id, "event-model-x-release");
  assert.equal(mapped.claims.length, 2);
  assert.equal(mapped.evidence.length, 2);
  assert.ok(mapped.claims.every((claim) => claim.eventId === mapped.event.id));
  assert.ok(mapped.evidence.every((evidence) =>
    mapped.claims.some((claim) => claim.id === evidence.claimId),
  ));
});

test("keeps social discovery evidence unverified after persistence mapping", () => {
  const mapped = recordsFromSignal(signal());
  const socialEvidence = mapped.evidence.find((evidence) => evidence.sourceType === "social");

  assert.ok(socialEvidence);
  assert.equal(socialEvidence.sourceRole, "discovery");
  assert.equal(socialEvidence.verificationStatus, "unverified");
  assert.equal(socialEvidence.socialChainId, "chain-feature-b");
});

test("creates stable evidence ids so repeated URL retrieval is deduplicated", () => {
  const first = recordsFromSignal(signal());
  const second = recordsFromSignal(signal({
    retrievedAt: "2026-09-05T03:00:00.000Z",
  }));

  assert.deepEqual(
    second.evidence.map((evidence) => evidence.id),
    first.evidence.map((evidence) => evidence.id),
  );
});
