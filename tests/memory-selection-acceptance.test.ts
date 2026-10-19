import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { ResearchInput, ResearchSignal } from "../research/types.ts";

// Cross-industry acceptance for the knowledge read-back -> selection -> research
// context -> comparison -> write chain. Every case runs the real runAgent with a
// deterministic research stub and the in-memory repository; the Postgres path
// (tests/postgres-agent-memory-e2e) is skipped when no database is configured
// and reported as such in the closeout.

const baseInput = (overrides: Partial<ResearchInput> = {}): ResearchInput => ({
  identity: "builder",
  industry: "software",
  focusAreas: "",
  currentQuestions: "",
  knownInformation: "",
  informationGaps: "",
  trackedEntities: "",
  trackedEvents: "",
  userJudgements: "",
  evidenceHistory: "",
  freshnessWindow: "30d",
  ...overrides,
} as ResearchInput);

const context = { authenticatedUserId: "user-x", filterId: "filter-x" };

function signal(overrides: Partial<ResearchSignal> = {}): ResearchSignal {
  return {
    id: "signal-1",
    title: "Signal",
    originalTitle: "Signal",
    summary: "Summary",
    reliabilityScore: 92,
    topicRelevance: { decision: "MATCH", matchedTerms: [], score: 90 } as never,
    informationGainStatus: "NEW_INFORMATION" as never,
    verificationStatus: "verified" as never,
    informationType: "FACT" as never,
    sourceUrl: "https://example.com/item",
    sourceType: "primary",
    sourceTier: "S",
    claims: [],
    sources: [],
    knowledgeStatus: "NOVEL",
    eventStatus: "NEW",
    attentionDecision: "MUST_READ",
    section: "all",
    ...overrides,
  } as unknown as ResearchSignal;
}

function response(signals: ResearchSignal[]) {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: {} as never, fetchedAt: new Date().toISOString(), dataMode: "live",
  } as never;
}

function claimSignal(id: string, text: string) {
  return signal({
    id,
    title: text,
    originalTitle: text,
    summary: text,
    sourceUrl: `https://example.com/${id}`,
    claims: [{
      claimText: text,
      sourceUrl: `https://example.com/${id}`,
      publisher: "Official",
      sourceType: "primary",
      sourceTier: "S",
      evidenceSnippet: text,
      verificationStatus: "verified",
      contentType: "FACT",
      independentEvidenceCount: 1,
      evidenceSources: [],
    }] as never,
  });
}

function retrieveStep(result: { steps: Array<{ state: string; input?: unknown; output?: unknown }> }) {
  return result.steps.find((step) => step.state === "RETRIEVE");
}

function seed(repository: InMemorySignalRepository, text: string, revision?: { status: string }) {
  repository.addPersonalKnowledge(context, {
    type: "KNOWN_INFORMATION",
    text,
    ...(revision ? { structuredPayload: { verificationStatus: revision.status } } : {}),
  } as never, "2026-10-01T00:00:00.000Z");
}

// --- Film/video industry -----------------------------------------------------

test('film: a relevant re-seen fact is read back, selected, then classified as duplicate', async () => {
  const repository = new InMemorySignalRepository();
  const claim = 'Palmier Pro launched an open-source AI video editor for macOS.';
  const run = () => runAgent({
    input: baseInput({ trackedEntities: 'Palmier Pro', currentQuestions: 'Palmier Pro macOS AI video editor updates' }),
    userQuery: 'Palmier Pro macOS AI video editor updates',
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal('same-claim', claim)]),
  });
  const first = await run();
  assert.equal(first.knowledgeChanges[0]?.classification, 'NEW');
  assert.equal(repository.listPersonalKnowledge(context).length, 1);
  const second = await run();
  assert.match(String(retrieveStep(second)?.output), /Palmier Pro/);
  assert.equal(second.knowledgeChanges.length, 0, 'a duplicate is not persisted as a change');
  assert.equal(second.response?.signals[0]?.informationGainStatus, 'NO_INFORMATION_GAIN');
  assert.equal(repository.listPersonalKnowledge(context).length, 1, 'no duplicate record was written');
});

test("film: an off-task same-entity memory is excluded with a recorded reason", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, 'Palmier Pro 安全扫描功能上线');
  const fresh = claimSignal("video-new", "Palmier Pro adds a new timeline editing feature");
  const result = await runAgent({
    input: baseInput({ trackedEntities: 'Palmier Pro', currentQuestions: 'Palmier Pro 结账与支付变化' }),
    userQuery: 'Palmier Pro 结账与支付变化',
    context, repository, maxRounds: 1,
    research: async () => response([fresh]),
  });
  const retrieve = retrieveStep(result);
  const diagnostics = retrieve?.input as { task?: { selected: Array<{ recordId: string; reason: string }>; excluded: Array<{ recordId: string; reason: string }> } };
  assert.equal(diagnostics?.task?.selected.length ?? 0, 0, 'an off-task memory must not enter the context');
  assert.equal(diagnostics?.task?.excluded.length ?? 0, 1, 'exclusion must be recorded with a reason');
  assert.equal(diagnostics?.task?.excluded[0]?.reason, 'task_concepts_disjoint');
  // The fresh (task-relevant) evidence is NEW: the off-task memory did not
  // suppress it, and it was not rewritten into the question's topic.
  assert.equal(result.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
});

// --- E-commerce industry ------------------------------------------------------

test("e-commerce: a related memory is selected for the same task, a same-entity different-task memory is not", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, "Shopify 新增结账与支付方式");
  seed(repository, "Shopify 推出应用安全扫描功能");
  const result = await runAgent({
    input: baseInput({ trackedEntities: "Shopify", currentQuestions: "Shopify 支付变化" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("shopify-payment", "Shopify checkout payments adds a new payment method")]),
  });
  const diagnostics = retrieveStep(result)?.input as { task?: { selected: Array<{ recordId: string; reason: string }>; excluded: Array<{ recordId: string; reason: string }> } };
  assert.equal(diagnostics?.task?.selected.length ?? 0, 1, 'the checkout/payment memory is on-task for this question');
  assert.equal(diagnostics?.task?.excluded.some((entry) => entry.reason === 'task_concepts_disjoint') ?? false, true, 'the security-scan memory is off-task');
});

// --- Programming industry -----------------------------------------------------

test("programming: an outdated (unverified) memory is not treated as settled knowledge", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, "ComfyUI video preview node supports frame-accurate scrubbing", { status: "partially_verified" });
  const result = await runAgent({
    input: baseInput({ trackedEntities: "ComfyUI", currentQuestions: "ComfyUI video preview changes" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("comfy-recheck", "ComfyUI video preview node supports frame-accurate scrubbing")]),
  });
  const diagnostics = retrieveStep(result)?.input as { task?: { excluded: Array<{ recordId: string; reason: string }> } };
  assert.equal(diagnostics?.task?.excluded[0]?.reason, 'needs_reverification');
  // The time-sensitive fact must not suppress re-verification of fresh evidence.
  assert.equal(result.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
});

test("programming: a conflicted memory stays unread but is never deleted", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, "ComfyUI is available", { status: "conflicting" });
  await runAgent({
    input: baseInput({ trackedEntities: "ComfyUI", currentQuestions: "ComfyUI availability" }),
    context, repository, maxRounds: 1,
    research: async () => response([]),
  });
  const stored = repository.listPersonalKnowledge(context);
  assert.equal(stored.length, 1, "existing records are never rewritten or deleted by selection");
  assert.equal(stored[0].text, "ComfyUI is available");
});

// --- Follow-up, duplicate and unrelated-question behaviour ---------------------

test("follow-up: the previous question's fact is selected and updates provenance without a second record", async () => {
  const repository = new InMemorySignalRepository();
  const claim = "Shopify checkout now supports Shop Pay installments.";
  const first = await runAgent({
    input: baseInput({ trackedEntities: "Shopify", currentQuestions: "Shopify checkout changes" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("s1", claim)]),
  });
  assert.equal(first.knowledgeChanges[0]?.classification, "NEW");
  const second = await runAgent({
    input: baseInput({ trackedEntities: "Shopify", currentQuestions: "Shopify checkout payment changes" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("s2", claim)]),
  });
  assert.match(String(retrieveStep(second)?.output), /Shop Pay installments/);
  assert.equal(second.knowledgeChanges.length, 0, 'no duplicate knowledge record is written');
  assert.equal(repository.listPersonalKnowledge(context).length, 1);
});

test("unrelated question: another scope's research does not leak into this one's context", async () => {
  const repository = new InMemorySignalRepository();
  seed(repository, "Shopify checkout payments adds a new payment method");
  const other = { authenticatedUserId: "user-y", filterId: "filter-y" };
  repository.addPersonalKnowledge(other, { type: "KNOWN_INFORMATION", text: "ComfyUI video preview node released" } as never, "2026-10-02T00:00:00.000Z");
  const result = await runAgent({
    input: baseInput({ trackedEntities: "ComfyUI", currentQuestions: "ComfyUI video preview changes" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("comfy-follow", "ComfyUI video preview node released")]),
  });
  const diagnostics = retrieveStep(result)?.input as { subject?: { excluded: Array<{ recordId: string; reason: string }> } };
  assert.equal(diagnostics?.subject?.excluded.every((entry) => entry.reason === 'no_shared_subject') ?? true, true);
  assert.deepEqual(repository.listPersonalKnowledge(context).map((r) => r.text).sort(), ['ComfyUI video preview node released', 'Shopify checkout payments adds a new payment method']);
  assert.equal(repository.listPersonalKnowledge(other).length, 1);
});

test("no memory at all still researches normally without fabricating history", async () => {
  const repository = new InMemorySignalRepository();
  const result = await runAgent({
    input: baseInput({ trackedEntities: "ComfyUI", currentQuestions: "ComfyUI video preview changes" }),
    context, repository, maxRounds: 1,
    research: async () => response([claimSignal("comfy-fresh", "ComfyUI video preview node released")]),
  });
  assert.equal(retrieveStep(result)?.output, "none");
  assert.equal(result.response?.signals[0]?.informationGainStatus, "NEW_INFORMATION");
  assert.equal(result.knowledgeChanges[0]?.classification, "NEW");
});

// --- Postgres backend ----------------------------------------------------------

test("postgres knowledge chain requires a configured database (skipped when absent)", (t) => {
  const configured = Boolean(process.env.DATABASE_URL);
  if (!configured) {
    t.skip("DATABASE_URL not configured in this environment; covered by tests/postgres-agent-memory-e2e when a database is available");
    return;
  }
});
