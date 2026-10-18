// Targeted regression coverage for the two gaps left open by
// docs/reliability/source-coverage-fallback-review-20261017.md:
//
//   Gap 1 — "there is still a usable fallback" was inferred from any
//           not_searched / any failed provider, without intersecting with
//           sources that are actually configured, allowed and unattempted.
//   Gap 2 — de-duplication was per round and only tracked
//           plan.selectedSourceType, so the same provider + query + params
//           could be requested again in a later round, and providers that ran
//           inside a discovery attempt were never recorded at all.
//
// Only the missing behaviors are asserted here. Deployment, login, TLS and the
// fifteen-question suite are out of scope and are not re-tested.
import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../agent/runner.ts";
import { chooseResearchStrategy } from "../agent/research-policy.ts";
import type { EvidenceEvaluation, ResearchPolicyInput } from "../agent/types.ts";
import type { ResearchResponse, ResearchSignal } from "../research/types.ts";
import type { SourceExecutionOutcome } from "../research/source-coverage.ts";

const input = {
  identity: "shop-owner", industry: "个人关注方向", focusAreas: "值得关注的新变化",
  currentQuestions: "过去30天 Shopify 有哪些与结账或支付有关的变化",
  knownInformation: "", informationGaps: "优先关注地区：美国",
  trackedEntities: "Shopify", trackedEvents: "", userJudgements: "", evidenceHistory: "",
  freshnessWindow: "30d",
};

function outcome(overrides: Partial<SourceExecutionOutcome> & { source: string }): SourceExecutionOutcome {
  return { execution: "not_searched", searched: false, resultCount: 0, ...overrides };
}

function coverageOf(outcomes: SourceExecutionOutcome[]) {
  const names = (execution: SourceExecutionOutcome["execution"]) => outcomes
    .filter((item) => item.execution === execution).map((item) => item.source);
  const usedProviders = outcomes
    .filter((item) => item.execution === "searched_with_results" || item.execution === "searched_no_results")
    .map((item) => item.source);
  return {
    level: usedProviders.length >= 2 ? "Broad" as const : usedProviders.length === 1 ? "Partial" as const : "Limited" as const,
    usedProviders,
    zeroResultProviders: names("searched_no_results"),
    notSearchedProviders: names("not_searched"),
    unavailableProviders: names("unavailable"),
    notConfiguredProviders: names("not_configured"),
    failedProviders: names("failed"),
    outcomes,
  };
}

function responseWith(outcomes: SourceExecutionOutcome[], signals: ResearchSignal[] = []): ResearchResponse {
  return {
    signals, status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never,
    overview: {} as never, coverage: coverageOf(outcomes), fetchedAt: new Date().toISOString(),
    dataMode: "live",
  };
}

const stopEvaluation: EvidenceEvaluation = {
  decision: "STOP", sufficientEvidence: false, conflictDetected: false,
  conflictingClaims: [], informationGain: 0, reason: "no signal",
};

function policyInput(overrides: Partial<ResearchPolicyInput> = {}): ResearchPolicyInput {
  const currentEvidence = responseWith([]);
  return {
    currentEvidence,
    relatedKnowledge: [],
    conflictState: stopEvaluation,
    sourceCoverage: currentEvidence.coverage,
    freshnessState: "unknown",
    reliabilityState: "unknown",
    informationGain: 0,
    round: 1,
    maxRounds: 3,
    previousStrategies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Counterexample 1 — a failure plus exhausted sources must stop, and must say
// the run failed. It must not be reported as "goal satisfied", and it must not
// invent a fallback that does not exist.
// ---------------------------------------------------------------------------

test("failed retrieval with every executable source already spent stops and reports the failure", () => {
  const decision = chooseResearchStrategy(policyInput({
    currentEvidence: responseWith([
      outcome({ source: "Primary Sources", execution: "failed", searched: true, requestCount: 1, failureCode: "upstream_error" }),
      outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
    ]),
    sourceCoverage: coverageOf([
      outcome({ source: "Primary Sources", execution: "failed", searched: true, requestCount: 1, failureCode: "upstream_error" }),
      outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
    ]),
  }));

  assert.equal(decision.strategy, "STOP");
  assert.doesNotMatch(decision.reason, /已满足当前研究目标/);
  assert.match(decision.reason, /失败|未返回/);
});

// ---------------------------------------------------------------------------
// Counterexample 2 — not_searched can mean "not configured", "unavailable" or
// "not allowed by source selection". None of those is a usable fallback.
// ---------------------------------------------------------------------------

test("not_searched entries that are unconfigured or unavailable are not a usable fallback", () => {
  const outcomes = [
    outcome({ source: "Company Source Registry", execution: "not_configured" }),
    outcome({ source: "Xiaohongshu", execution: "unavailable" }),
    outcome({ source: "Product Hunt", execution: "not_searched", providerId: "product-hunt", blockedBy: "source_selection" }),
  ];
  const decision = chooseResearchStrategy(policyInput({
    currentEvidence: responseWith(outcomes),
    sourceCoverage: coverageOf(outcomes),
  }));

  assert.equal(decision.strategy, "STOP");
  assert.doesNotMatch(decision.reason, /仍有未执行的来源可以检索|尚有未执行的来源可尝试/);
});

// ---------------------------------------------------------------------------
// Counterexample 3 — a genuinely unattempted, allowed, configured source must
// still produce ESCALATE_SOURCE, and the runner must really execute it.
// ---------------------------------------------------------------------------

test("an unattempted allowed source still escalates and is actually executed", async () => {
  const executed: Array<{ selected?: string; allowed: string[] }> = [];
  const result = await runAgent({
    input,
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    research: async (_researchInput, plan) => {
      executed.push({ selected: plan?.selectedSourceType, allowed: plan?.allowedProviderIds ?? [] });
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  assert.ok(
    executed.length > 1,
    `a declared fallback must really run; executed: ${JSON.stringify(executed)}`,
  );
  assert.ok(
    new Set(executed.flatMap((attempt) => attempt.allowed)).size > new Set(executed[0].allowed).size,
    `the fallback attempt must reach providers the first attempt could not: ${JSON.stringify(executed)}`,
  );
  assert.notEqual(result.status, "failed");
});

// ---------------------------------------------------------------------------
// Counterexample 4 — the same provider + normalized query + result-affecting
// params must be requested once for the whole research, including across
// rounds and including providers that already ran inside a discovery attempt.
// ---------------------------------------------------------------------------

// Reproduces the recorded defect shape: a discovery-mode first attempt already
// allows the verification providers (public-web + company-registry /
// official-update-pages / github-releases in one attempt), and the subsequent
// fallback walk then re-pins those same source types with the same queries.
// Before the fix the attempt record only held plan.selectedSourceType and was
// rebuilt every round, so the same provider + query pair was requested again
// (observed: 19 recorded signatures with 6 duplicates in a single round).
// The question deliberately targets an official page (pricing) for an entity
// that has no dedicated official adapter, which is what turns on discovery.
const discoveryInput = {
  ...input,
  industry: "电商",
  focusAreas: "Shopify 定价",
  currentQuestions: "Shopify 定价页最近 30 天有哪些变化",
  informationGaps: "",
};

test("the same provider and query is requested only once across the whole research", async () => {
  const signatures: string[] = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    research: async (_researchInput, plan) => {
      const queries = (plan?.queries ?? []).map((query) => query.trim().toLowerCase()).sort();
      // Every provider the plan allows is a provider the pipeline may execute
      // for that attempt, so all of them belong in the attempt record.
      for (const provider of plan?.allowedProviderIds ?? []) signatures.push(`${provider}|${queries.join(" ")}`);
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  assert.ok(signatures.length >= 2, `the fixture must actually request providers: ${JSON.stringify(signatures)}`);
  const repeated = signatures.filter((signature, index) => signatures.indexOf(signature) !== index);
  assert.deepEqual(
    Array.from(new Set(repeated)),
    [],
    `the same provider + query combination was requested more than once: ${JSON.stringify(signatures)}`,
  );
});

// ---------------------------------------------------------------------------
// Counterexample 5 — different queries on the same provider may still run, but
// never beyond the research-wide request cap.
// ---------------------------------------------------------------------------

test("distinct queries on one provider run, and the run-wide unit cap still holds", async () => {
  const dispatched: string[] = [];
  await runAgent({
    input,
    maxRounds: 3,
    maxResearchRequests: 4,
    maxExecutionTimeMs: 25000,
    research: async (_researchInput, plan) => {
      for (const provider of plan?.allowedProviderIds ?? ["*"]) {
        for (const query of plan?.queries ?? []) dispatched.push(`${provider}|${query.trim().toLowerCase()}`);
      }
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  // The cap counts provider-query units, not research calls, so the observable
  // boundary is what actually reached the provider chain.
  assert.ok(dispatched.length <= 4, `run-wide provider-query cap was exceeded: ${dispatched.length} > 4: ${JSON.stringify(dispatched)}`);
  assert.ok(new Set(dispatched.map((unit) => unit.split("|")[1])).size >= 2,
    `distinct queries should still get a chance: ${JSON.stringify(dispatched)}`);
});

// ---------------------------------------------------------------------------
// Log honesty. `fallback_exhausted` is not in the cloud Handler's phase
// whitelist, so anything reported under that name never reaches the trace.
// Every fallback / dedup / request-cap outcome must therefore ride on a phase
// the Handler actually records, otherwise the field cannot be claimed as
// existing in the cloud log.
// ---------------------------------------------------------------------------

test("fallback and request-budget outcomes are reported on a recorded phase", async () => {
  const phases: Array<{ phase: string; errorCode?: string }> = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 1,
    maxResearchRequests: 2,
    maxExecutionTimeMs: 25000,
    onPhase: (event) => { phases.push({ phase: event.phase, errorCode: event.errorCode }); },
    research: async () => responseWith([
      outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
    ]),
  });

  const reported = phases.filter((event) => [
    "FALLBACK_BUDGET_EXHAUSTED",
    "FALLBACK_SOURCES_NOT_EXECUTED",
    "DUPLICATE_ATTEMPT_SKIPPED",
    "RESEARCH_REQUEST_BUDGET_EXHAUSTED",
  ].includes(event.errorCode ?? ""));
  assert.ok(reported.length > 0, `expected a fallback / budget outcome to be reported: ${JSON.stringify(phases)}`);
  assert.equal(
    phases.some((event) => event.phase === "fallback_exhausted"),
    false,
    "fallback_exhausted is not in the Handler whitelist, so it must not be emitted as a phase name",
  );
  assert.ok(
    reported.every((event) => event.phase === "budget_checked"),
    `these outcomes must ride on the recorded budget_checked phase: ${JSON.stringify(reported)}`,
  );
});
// ===========================================================================
// Round-10 partial closure — docs/reliability/source-fallback-closeout-review-20261017.md
//
// Two gaps remained after the first closure:
//
//   Gap 3 — de-duplication still hashed a whole query set into one signature,
//            and admit() released the entire unfiltered plan whenever any one
//            provider looked new. A/q1 then A/[q1,q2] re-requested q1, and
//            A/q1 then A+B/q1 re-requested A. "Allowed" was also recorded as
//            "executed".
//   Gap 4 — maxResearchRequests was documented as provider+query+params but
//            actually incremented once per admit(plan) call, so it bounded plan
//            calls, and it was reported as if it bounded HTTP.
//
// Only these behaviors are asserted. Nothing else from the earlier evidence is
// re-tested here.
// ===========================================================================

import { AttemptLedger, scopePlansByProvider } from "../agent/runner.ts";
import type { ResearchPlan } from "../agent/types.ts";

function planOf(overrides: Partial<ResearchPlan>): ResearchPlan {
  return {
    objective: "objective",
    queries: ["q1"],
    preferredSourceTypes: [],
    maxQueries: 5,
    freshnessWindow: "30d",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Counterexample 1 — same provider, partially overlapping queries: only the new
// query may be dispatched, and it must reach the execution chain scoped to it.
// ---------------------------------------------------------------------------

test("a partially overlapping query batch only dispatches the new query", () => {
  const ledger = new AttemptLedger(10, 10);
  const first = ledger.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1"] }));
  assert.equal(first.allowed, true);
  ledger.markSliceStarted(first.admitted);

  const second = ledger.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1", "q2"] }));
  assert.equal(second.allowed, true);
  assert.deepEqual(second.admitted.map((unit) => unit.query), ["q2"]);
  assert.deepEqual(scopePlansByProvider(planOf({ allowedProviderIds: ["A"], queries: ["q1", "q2"] }), second.admitted), [
    planOf({ allowedProviderIds: ["A"], queries: ["q2"] }),
  ]);
});

// ---------------------------------------------------------------------------
// Counterexample 2 — mixed old/new providers: only the new combination runs.
// ---------------------------------------------------------------------------

test("a mixed old-and-new provider batch only dispatches the new combination", () => {
  const ledger = new AttemptLedger(10, 10);
  const first = ledger.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1"] }));
  ledger.markSliceStarted(first.admitted);

  const second = ledger.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1"] }));
  assert.deepEqual(second.admitted.map((unit) => `${unit.providerId}/${unit.query}`), ["B/q1"]);
  const scoped = scopePlansByProvider(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1"] }), second.admitted);
  assert.deepEqual(scoped.map((item) => item.allowedProviderIds), [["B"]]);
});

// ---------------------------------------------------------------------------
// Counterexample 3 — discovery, fallback and later rounds share one record, so
// the same provider/query combination is never dispatched twice.
// ---------------------------------------------------------------------------

test("the same combination is never dispatched twice across discovery, fallback and rounds", async () => {
  const dispatched: string[] = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 3,
    maxExecutionTimeMs: 25000,
    research: async (_researchInput, plan) => {
      for (const provider of plan?.allowedProviderIds ?? ["*"]) {
        for (const query of plan?.queries ?? []) {
          dispatched.push(`${provider}|${query.trim().toLowerCase().replace(/\s+/g, " ")}`);
        }
      }
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  assert.ok(dispatched.length > 0, `the fixture must actually dispatch something: ${JSON.stringify(dispatched)}`);
  assert.deepEqual(
    Array.from(new Set(dispatched.filter((unit, index) => dispatched.indexOf(unit) !== index))),
    [],
    `a provider+query combination was dispatched more than once: ${JSON.stringify(dispatched)}`,
  );
});

// ---------------------------------------------------------------------------
// Counterexample 4 — the cap counts admitted combinations. A batch larger than
// the remaining budget is truncated, never over-admitted, and a batch that
// merely *contains* duplicates cannot use them to buy extra units.
// ---------------------------------------------------------------------------

test("a multi-combination batch is charged per admitted combination and never exceeds the cap", () => {
  const ledger = new AttemptLedger(3, 10);
  const first = ledger.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1", "q2", "q3"] }));
  assert.equal(first.allowed, true);
  assert.equal(first.admitted.length, 3);
  assert.equal(first.reason, "truncated_by_unit_budget");
  ledger.markSliceStarted(first.admitted);
  assert.equal(ledger.providerQueryUnits, 3);

  const second = ledger.admit(planOf({ allowedProviderIds: ["A", "C"], queries: ["q1", "q4"] }));
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "request_budget_exhausted");

  // Duplicates inside a batch do not grant budget: only new combinations count.
  const other = new AttemptLedger(5, 10);
  const a = other.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1"] }));
  other.markSliceStarted(a.admitted);
  const b = other.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1", "q1"] }));
  assert.deepEqual(b.admitted.map((unit) => `${unit.providerId}/${unit.query}`), ["B/q1"]);
  other.markSliceStarted(b.admitted);
  assert.equal(other.providerQueryUnits, 2);
});

// ---------------------------------------------------------------------------
// Counterexample 5 — admission reserves nothing. A source the plan merely
// allowed but that never started must not be recorded as executed, so a later
// attempt can still use it.
// ---------------------------------------------------------------------------

test("an admitted-but-never-started combination is not recorded as executed", () => {
  const ledger = new AttemptLedger(10, 10);
  const admitted = ledger.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1"] }));
  assert.equal(admitted.allowed, true);
  assert.equal(admitted.admitted.length, 2);
  // Nothing started yet: neither provider may be treated as executed.
  assert.equal(ledger.providerQueryUnits, 0);
  assert.equal(ledger.startedSliceCount, 0);

  const retry = ledger.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1"] }));
  assert.equal(retry.allowed, true);
  assert.equal(retry.admitted.length, 2);
  assert.equal(retry.reason, undefined);

  // Only a real start consumes it.
  ledger.markSliceStarted(retry.admitted);
  assert.equal(ledger.providerQueryUnits, 2);
  const after = ledger.admit(planOf({ allowedProviderIds: ["A", "B"], queries: ["q1"] }));
  assert.equal(after.allowed, false);
  assert.equal(after.reason, "duplicate_attempt");
});

// ---------------------------------------------------------------------------
// Counterexample 6 — a started combination is spent even when it fails or the
// result is unknown, and it is never automatically retried inside the run.
// ---------------------------------------------------------------------------

test("a failed or unknown combination still spends its unit and is not retried", () => {
  const ledger = new AttemptLedger(2, 10);
  const first = ledger.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1"] }));
  ledger.markSliceStarted(first.admitted);
  // The provider call failed, or its result never came back. Either way the
  // unit is spent: markSliceStarted already happened before the call.
  assert.equal(ledger.providerQueryUnits, 1);

  const retry = ledger.admit(planOf({ allowedProviderIds: ["A"], queries: ["q1"] }));
  assert.equal(retry.allowed, false);
  assert.equal(retry.reason, "duplicate_attempt");

  const remaining = ledger.admit(planOf({ allowedProviderIds: ["B"], queries: ["q1"] }));
  assert.equal(remaining.allowed, true);
  assert.equal(ledger.maxProviderQueryUnits, 2);
});

// ===========================================================================
// Round-11 local fix — docs/reliability/source-fallback-round10-review-20261018.md
//
// The only remaining problem: both the primary and the fallback path called
// ledger.markSliceStarted(allAdmittedUnits) once, before the first slice ran. Slices
// that never started — because an earlier slice threw, or the budget ran out —
// were still recorded as started. Counting is also per batch instead of per
// actual executeResearch slice call.
//
// Only these two behaviors are asserted; nothing else is re-tested.
// ===========================================================================

// A truncated admission leaves providers with different admitted query sets,// which is what produces two slices out of one plan. Verified against the real
// fixture: with a 6-unit cap the discovery plan admits public-web with all 5
// queries plus product-hunt with 1, i.e. two slices totalling 6 units. A cap of
// 5 admits only one slice, which would make these counterexamples vacuous.
const twoSliceBudget = { maxResearchRequests: 6, maxResearchRetrievalSlices: 10 };

/** Occupies the thread so the shared deadline actually advances. */
const busyWait = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
};

test("a slice that never starts is not recorded as started when an earlier slice throws", async () => {
  const observedUnits: number[] = [];
  let calls = 0;
  await runAgent({
    input: discoveryInput,
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    ...twoSliceBudget,
    onPhase: (event) => {
      if (typeof event.diagnostic?.researchProviderQueryUnits === "number") {
        observedUnits.push(event.diagnostic.researchProviderQueryUnits);
      }
    },
    research: async () => {
      calls += 1;
      // The first slice throws. The second slice must never run.
      throw Object.assign(new Error("slice one failed"), { code: "SLICE_ONE_FAILED" });
    },
  });

  assert.equal(calls, 1, `only the first slice may execute: ${calls}`);
  // Only the dispatched slice's two units may be charged. Charging the whole
  // admitted batch would report 3 and would mark the second slice as started.
  assert.ok(
    observedUnits.length > 0,
    "the run must report its provider-query unit count after the failure",
  );
  assert.equal(
    Math.max(...observedUnits),
    5,
    `only the slice that actually started may be charged: ${JSON.stringify(observedUnits)}`,
  );
});

test("a slice that does not fit the remaining plan allowance is not executed and the stop reason is accurate", async () => {
  const executed: string[] = [];
  const errorCodes: string[] = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 1,
    maxExecutionTimeMs: 25000,
    // Six units fit, so the admission splits into two slices, but only one
    // plan/slice attempt is allowed for the whole run.
    maxResearchRequests: 6,
    maxResearchRetrievalSlices: 1,
    onPhase: (event) => { if (event.errorCode) errorCodes.push(event.errorCode); },
    research: async (_researchInput, plan) => {
      executed.push((plan?.allowedProviderIds ?? ["*"]).join(","));
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  assert.equal(executed.length, 1, `the second slice must not run past the plan allowance: ${JSON.stringify(executed)}`);
  assert.ok(
    errorCodes.includes("RESEARCH_REQUEST_BUDGET_EXHAUSTED"),
    `the stop reason must name the exhausted allowance: ${JSON.stringify(errorCodes)}`,
  );
});

// ---------------------------------------------------------------------------
// Counterexample 7 — the last execution bypass: `primaryRun.merged ??
// prepareRoundResponse(await executeResearch(plan))` re-entered the research
// pipeline directly when the slice executor started nothing at all. The call
// was never charged to the ledger, so the run reported zero new combinations
// while still having asked a provider. Only the pre-first-slice close is
// asserted; nothing else is re-tested.
// ---------------------------------------------------------------------------

test("a run whose first slice never starts makes no research call and charges nothing", async () => {
  let calls = 0;
  const observedUnits: number[] = [];
  const errorCodes: string[] = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 1,
    // Round 1's retrieval guard is 4000ms, so 5000ms clears the outer gate.
    maxExecutionTimeMs: 5000,
    maxResearchRequests: 6,
    maxResearchRetrievalSlices: 10,
    onPhase: (event) => {
      if (event.errorCode) errorCodes.push(event.errorCode);
      if (typeof event.diagnostic?.researchProviderQueryUnits === "number") {
        observedUnits.push(event.diagnostic.researchProviderQueryUnits);
      }
      // The outer retrieval gate has already passed at this point. Let the
      // shared deadline cross the guard before the executor checks its first
      // slice, which is the real shape of a deadline closing mid-round.
      if (event.diagnostic?.stage === "retrieval") {
        busyWait(1500);
      }
    },
    research: async () => {
      calls += 1;
      return responseWith([
        outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
      ]);
    },
  });

  assert.equal(calls, 0, `no slice started, so no research call may happen: ${calls}`);
  assert.ok(
    observedUnits.every((units) => units === 0),
    `no combination may be charged when no slice started: ${JSON.stringify(observedUnits)}`,
  );
  assert.ok(
    errorCodes.includes("WORKER_DEADLINE"),
    `the stop reason must stay accurate: ${JSON.stringify(errorCodes)}`,
  );
});

// ---------------------------------------------------------------------------
// Counterexample 16 — a run-wide unit allowance must not be spendable in a
// single round. The discovery plan admits one provider x query cross-product
// (8 providers x 5 queries = 40 units), which is exactly the default cap. When
// round 1 spent all of it, the escalation round admission answered
// `request_budget_exhausted` and a community-only result "completed" without
// ever attempting verification. Reserving capacity for the rounds that may
// still run fixes that without granting any extra budget.
// ---------------------------------------------------------------------------

test("a wide first round leaves the escalation round an executable allowance", async () => {
  // `researchProviderQueryUnits` is cumulative for the whole research, so the
  // per-round figure has to be read from the round tag rather than the maximum.
  const observations: Array<{ round: number; units: number; max: number }> = [];
  await runAgent({
    input: discoveryInput,
    maxRounds: 2,
    maxExecutionTimeMs: 25000,
    // No explicit request/slice cap: the default allowance is exactly one
    // discovery cross-product, which is the case that starved escalation.
    onPhase: (event) => {
      const diagnostic = event.diagnostic;
      if (
        typeof diagnostic?.researchProviderQueryUnits === "number" &&
        typeof diagnostic?.maxResearchProviderQueries === "number" &&
        typeof diagnostic?.round === "number"
      ) {
        observations.push({
          round: diagnostic.round,
          units: diagnostic.researchProviderQueryUnits,
          max: diagnostic.maxResearchProviderQueries,
        });
      }
    },
    research: async () => responseWith([
      outcome({ source: "Official Update Pages", execution: "searched_no_results", searched: true, requestCount: 1 }),
    ]),
  });

  const firstRound = observations.filter((item) => item.round === 1);
  assert.ok(firstRound.length > 0, `the run must report round 1 accounting: ${JSON.stringify(observations)}`);
  const cap = observations[0].max;
  const spentInFirstRound = Math.max(...firstRound.map((item) => item.units));
  assert.ok(cap > 1, `the fixture needs a multi-unit allowance: ${cap}`);
  assert.ok(
    spentInFirstRound < cap,
    `round 1 must not consume the whole run-wide allowance while another round may run: ${spentInFirstRound}/${cap}`,
  );
});
