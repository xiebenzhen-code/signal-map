import assert from "node:assert/strict";
import test from "node:test";

import { createEnvironmentModelAdapter } from "../agent/model-adapter.ts";
import { synthesizeTaskResults } from "../agent/task-runner.ts";
import {
  synthesizeEvidenceWithModel,
  validateEvidenceBoundSynthesis,
  type EvidenceBoundSynthesis,
} from "../agent/evidence-synthesis.ts";
import type { EvidenceRecord } from "../information/rag-records.ts";
import type { AgentRunResult } from "../agent/types.ts";

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1",
    claimId: "claim-1",
    sourceUrl: "https://example.com/source",
    canonicalUrl: "https://example.com/source",
    publisher: "Official",
    publishedAt: "2026-09-06T00:00:00.000Z",
    sourceType: "primary",
    sourceRole: "verification",
    sourceTier: "S",
    verificationStatus: "verified",
    evidenceSnippet: "Official evidence confirms the claim.",
    dataMode: "live",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function synthesis(overrides: Partial<EvidenceBoundSynthesis> = {}): EvidenceBoundSynthesis {
  return {
    summary: "Evidence supports the conclusion.",
    conclusions: [{
      claim: "Official evidence confirms the claim.",
      evidenceIds: ["evidence-1"],
      sourceUrls: ["https://example.com/source"],
      confidence: 90,
      verificationStatus: "verified",
      statementType: "FACT",
    }],
    unresolvedItems: [],
    ...overrides,
  };
}

test("ModelAdapter returns not_configured without an API key", async () => {
  const adapter = createEnvironmentModelAdapter({ env: {} });
  assert.equal(adapter.status, "not_configured");

  const plan = await adapter.planResearch({
    userQuery: "What changed in Codex?",
    relatedKnowledge: [],
    existingEvidence: [],
    previousQueries: [],
    round: 1,
  });
  assert.equal(plan.status, "not_configured");

  const result = await adapter.synthesizeEvidence({
    objective: "What changed in Codex?",
    evidence: [evidence()],
    taskResults: [],
    unresolvedConflicts: [],
  });
  assert.equal(result.status, "not_configured");
});

test("FACT without evidenceIds fails validation", () => {
  assert.throws(() => validateEvidenceBoundSynthesis(synthesis({
    conclusions: [{
      claim: "Unsupported fact",
      evidenceIds: [],
      sourceUrls: [],
      confidence: 80,
      verificationStatus: "verified",
      statementType: "FACT",
    }],
  }), [evidence()]), /FACT requires evidenceIds/);
});

test("nonexistent evidenceIds fail validation", () => {
  assert.throws(() => validateEvidenceBoundSynthesis(synthesis({
    conclusions: [{
      claim: "Missing evidence",
      evidenceIds: ["missing"],
      sourceUrls: ["https://example.com/source"],
      confidence: 80,
      verificationStatus: "verified",
      statementType: "FACT",
    }],
  }), [evidence()]), /unknown evidenceId/);
});

test("SOCIAL or Tier C evidence cannot become FACT", () => {
  assert.throws(() => validateEvidenceBoundSynthesis(synthesis(), [
    evidence({ sourceType: "social", sourceTier: "C" }),
  ]), /social evidence can only support SIGNAL/);
});

test("conflicting evidence must remain conflicting", () => {
  assert.throws(() => validateEvidenceBoundSynthesis(synthesis(), [
    evidence({ verificationStatus: "conflicting" }),
  ]), /conflicting evidence must remain conflicting/);
});

test("synthesis creates a no-evidence result when no reliable evidence exists", async () => {
  const adapter = createEnvironmentModelAdapter({ env: {} });
  const result = await synthesizeEvidenceWithModel({
    adapter,
    fallback: () => synthesis({ summary: "fallback should not be used", conclusions: [] }),
    input: {
      objective: "Can we prove this?",
      evidence: [],
      taskResults: [],
      unresolvedConflicts: [],
    },
  });

  assert.equal(result.summary, "No reliable evidence found.");
  assert.deepEqual(result.conclusions, []);
});

test("social-only evidence produces no reliable fact synthesis", async () => {
  const adapter = createEnvironmentModelAdapter({ env: {} });
  const result = await synthesizeEvidenceWithModel({
    adapter,
    fallback: () => synthesis(),
    input: {
      objective: "Can we prove this?",
      evidence: [evidence({ sourceType: "social", sourceTier: "C", verificationStatus: "unverified" })],
      taskResults: [],
      unresolvedConflicts: [],
    },
  });

  assert.equal(result.summary, "No reliable evidence found.");
  assert.deepEqual(result.conclusions, []);
});

test("API errors fall back without breaking the existing research result", async () => {
  const adapter = createEnvironmentModelAdapter({
    env: { OPENAI_API_KEY: "test-key" },
    fetch: async () => new Response("upstream error", { status: 500 }),
  });

  const result = await synthesizeEvidenceWithModel({
    adapter,
    fallback: () => synthesis({ summary: "rules fallback" }),
    input: {
      objective: "What changed?",
      evidence: [evidence()],
      taskResults: [],
      unresolvedConflicts: [],
    },
  });

  assert.equal(result.summary, "rules fallback");
});

test("Task Runner can consume Evidence-bound Synthesis without creating evidence", () => {
  const result: AgentRunResult = {
    status: "completed",
    rounds: 1,
    response: undefined,
    plan: { objective: "task", queries: [], preferredSourceTypes: [], maxQueries: 1 },
    evaluation: {
      decision: "STOP",
      sufficientEvidence: true,
      conflictDetected: false,
      conflictingClaims: [],
      informationGain: 1,
      reason: "done",
    },
    knowledgeChanges: [{
      signalId: "signal-1",
      classification: "NEW",
      supportingEvidenceIds: ["evidence-1"],
      previousRevision: 1,
      currentRevision: 2,
      reason: "test",
    }],
    attention: ["MUST_READ"],
    steps: [],
    trace: [],
  };

  const synthesized = synthesizeTaskResults([{ taskId: "task-1", result }], synthesis());
  assert.equal(synthesized.evidenceBound?.conclusions[0]?.claim, "Official evidence confirms the claim.");
  assert.deepEqual(synthesized.createdEvidenceIds, []);
});

test("model configuration names are server-side env only", () => {
  const adapter = createEnvironmentModelAdapter({
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.6-sol",
      OPENAI_SYNTHESIS_MODEL: "gpt-6-astra",
    },
    fetch: async () => new Response(JSON.stringify({ output_text: "{}" })),
  });
  assert.equal(adapter.status, "configured");
  assert.equal(adapter.models.planning, "gpt-5.6-sol");
  assert.equal(adapter.models.synthesis, "gpt-6-astra");
});

test("synthesis contract retries a reliable-evidence underclaim once", async () => {
  const calls: unknown[] = [];
  const adapter = {
    async synthesizeEvidence(input: unknown) {
      calls.push(input);
      return calls.length === 1
        ? { status: "configured" as const, synthesis: { summary: "No reliable evidence found.", conclusions: [], unresolvedItems: [] } }
        : { status: "configured" as const, synthesis: synthesis() };
    },
  };
  const result = await synthesizeEvidenceWithModel({
    adapter,
    fallback: () => synthesis({ summary: "rules fallback" }),
    input: { objective: "What changed?", evidence: [evidence()], taskResults: [], unresolvedConflicts: [] },
  });
  const contract = calls[0] as { eligibleEvidenceIds: string[]; reliableEvidence: EvidenceRecord[]; signalOnly: boolean; unresolvedConflict: boolean };
  assert.equal(calls.length, 2);
  assert.deepEqual(contract.eligibleEvidenceIds, ["evidence-1"]);
  assert.equal(contract.reliableEvidence.length, 1);
  assert.equal(contract.signalOnly, false);
  assert.equal(contract.unresolvedConflict, false);
  assert.equal(result.conclusions[0]?.statementType, "FACT");
});

test("unresolved conflict mismatch retries once and falls back unresolved", async () => {
  let calls = 0;
  const adapter = {
    async synthesizeEvidence() {
      calls += 1;
      return { status: "configured" as const, synthesis: synthesis({ summary: "confirmed", conclusions: [{ ...synthesis().conclusions[0], verificationStatus: "verified" }] }) };
    },
  };
  const result = await synthesizeEvidenceWithModel({
    adapter,
    fallback: () => synthesis({ summary: "rules fallback" }),
    input: { objective: "Resolve conflict", evidence: [evidence({ verificationStatus: "conflicting" })], taskResults: [], unresolvedConflicts: ["status differs"] },
  });
  assert.equal(calls, 2);
  assert.match(result.summary, /unresolved|conflict/i);
  assert.equal(result.conclusions.some((item) => item.statementType === "FACT" && item.verificationStatus !== "conflicting"), false);
});
