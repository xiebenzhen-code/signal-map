import assert from "node:assert/strict";
import test from "node:test";

import { applyAttentionPreferences } from "../agent/evaluation.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import {
  classifyQueryOutcome,
  computeCaptureDigest,
  confirmServerIdentity,
  evaluateDuplicateCase,
  evaluatePreferenceAttribution,
  evaluatePreferenceIsolation,
  executeAndBindQuery,
  factFingerprint,
  factStateUnchanged,
  hasHighAttention,
  hasLowAttention,
  isProcessAlive,
  replayEvidenceMaterialValid,
  selectRunForRequest,
  stopProcessLike,
} from "../scripts/signal-map-agent-loop-e2e.mjs";

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function signalWith(overrides = {}, claims = undefined) {
  const defaultClaims = [{
    claimText: "Palmier Pro adds pricing tiers",
    verificationStatus: "verified",
    evidenceSources: [{ sourceUrl: "https://example.com/pricing", canonicalUrl: "https://example.com/pricing" }],
  }];
  return {
    id: overrides.id ?? "signal-1",
    reliabilityScore: 92,
    verificationStatus: "verified",
    attentionDecision: "MUST_READ",
    entityMatches: ["Palmier Pro"],
    sources: [{ sourceUrl: "https://example.com/pricing" }],
    ...overrides,
    claims: claims ?? overrides.claims ?? defaultClaims,
  };
}

const PREFERENCE = { scopeType: "entity", scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" };

// Builds a replay material whose declared outputs are always recomputed with
// the real production modifier, so the validator's re-derivation can be tested
// against honestly produced material and against tampered material alike.
function buildReplayMaterial({ mode = "CAPTURED_REPLAY", withCapture = true, mutate } = {}) {
  const knowledgeState = { knownFacts: ["palmier-pro-launched-macos-editor"] };
  const withoutSignals = [structuredClone(signalWith({}))];
  const withSignals = [structuredClone(signalWith({}))];
  const material = {
    mode,
    ...(mode === "CAPTURED_REPLAY" && withCapture
      ? { capture: { commitSha: "abc123", requestId: "req-1", runId: "run-1", sourceMaterial: "captures/q1.json" } }
      : {}),
    arms: {
      withoutPreference: { signals: withoutSignals, knowledgeState },
      withPreference: { signals: withSignals, knowledgeState },
    },
    preference: PREFERENCE,
  };
  const withoutResponse = { signals: withoutSignals };
  const withResponse = { signals: withSignals };
  applyAttentionPreferences(withoutResponse, []);
  applyAttentionPreferences(withResponse, [PREFERENCE]);
  material.outputs = {
    withoutPreferenceAttention: withoutSignals.map((signal) => signal.attentionDecision).join(","),
    withPreferenceAttention: withSignals.map((signal) => signal.attentionDecision).join(","),
  };
  if (mutate) mutate(material);
  return material;
}

// ---------------------------------------------------------------------------
// 1. Replay evidence must be independently re-derivable
// ---------------------------------------------------------------------------

test("an honestly produced CAPTURED_REPLAY material validates", () => {
  const result = replayEvidenceMaterialValid(buildReplayMaterial());
  assert.equal(result.valid, true, result.reason);
  assert.equal(hasHighAttention(result.withoutPreferenceAttention), true);
  assert.equal(hasLowAttention(result.withPreferenceAttention), true);
});

test("material with only mode and declared outputs but no arm inputs is rejected", () => {
  const result = replayEvidenceMaterialValid({
    mode: "CAPTURED_REPLAY",
    capture: { commitSha: "abc", requestId: "req-1", runId: "run-1", sourceMaterial: "x" },
    outputs: { withoutPreferenceAttention: "MUST_READ", withPreferenceAttention: "LIBRARY_ONLY" },
  });
  assert.equal(result.valid, false);
});

test("declared fact invariance is not trusted: arms with different claims or sources are rejected", () => {
  const changedClaim = buildReplayMaterial({ mutate: (material) => {
    material.arms.withPreference.signals[0].claims[0].claimText = "Palmier Pro adds enterprise SSO";
  } });
  assert.equal(replayEvidenceMaterialValid(changedClaim).valid, false);

  const changedSource = buildReplayMaterial({ mutate: (material) => {
    material.arms.withPreference.signals[0].claims[0].evidenceSources[0] = {
      sourceUrl: "https://example.com/sso",
      canonicalUrl: "https://example.com/sso",
    };
  } });
  assert.equal(replayEvidenceMaterialValid(changedSource).valid, false);
});

test("different knowledge initial states between arms are rejected", () => {
  const material = buildReplayMaterial({ mutate: (material) => {
    material.arms.withPreference.knowledgeState = { knownFacts: ["something-else"] };
  } });
  assert.equal(replayEvidenceMaterialValid(material).valid, false);
});

test("caller-filled outputs that contradict the real execution are rejected", () => {
  const material = buildReplayMaterial({ mutate: (material) => {
    material.outputs.withPreferenceAttention = "MUST_READ";
  } });
  const result = replayEvidenceMaterialValid(material);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "declared-outputs-mismatch-recomputed");
});

test("CAPTURED_REPLAY without capture provenance is rejected; FIXTURE_REPLAY validates as material but cannot close real acceptance", () => {
  const noCapture = buildReplayMaterial({ withCapture: false });
  assert.equal(replayEvidenceMaterialValid(noCapture).valid, false);

  const fixture = buildReplayMaterial({ mode: "FIXTURE_REPLAY" });
  assert.equal(replayEvidenceMaterialValid(fixture).valid, true);

  const closed = evaluatePreferenceAttribution({
    baseline: { bound: true, classification: "NEW", attention: "MUST_READ", evidenceCount: 2, accepted: 1, fact: factFingerprint([signalWith({})]) },
    preference: { bound: true, classification: "NEW", attention: "LIBRARY_ONLY", evidenceCount: 2, accepted: 1, fact: factFingerprint([signalWith({})]) },
    control: { bound: true, classification: "NEW", attention: "MUST_READ", evidenceCount: 3, accepted: 1 },
    preferencePersisted: true,
    replayEvidence: fixture,
    preferenceIsolationObserved: true,
  });
  assert.equal(closed.causalityProven, false);
  assert.equal(closed.closed, false);
});

test("live attribution closes with a valid CAPTURED_REPLAY material and observed preference isolation", () => {
  const closed = evaluatePreferenceAttribution({
    baseline: { bound: true, classification: "NEW", attention: "MUST_READ", evidenceCount: 2, accepted: 1, fact: factFingerprint([signalWith({})]) },
    preference: {
      bound: true, classification: "NEW", attention: "LIBRARY_ONLY", evidenceCount: 2, accepted: 1,
      fact: factFingerprint([signalWith({}, [{
        claimText: "Palmier Pro adds enterprise SSO",
        verificationStatus: "verified",
        evidenceSources: [{ sourceUrl: "https://example.com/sso" }],
      }])]),
    },
    control: { bound: true, classification: "NEW", attention: "MUST_READ", evidenceCount: 3, accepted: 1 },
    preferencePersisted: true,
    replayEvidence: buildReplayMaterial(),
    preferenceIsolationObserved: true,
  });
  assert.equal(closed.causalityProven, true);
  assert.equal(closed.closed, true);
});

// ---------------------------------------------------------------------------
// 2. Request binding: actual call order, not just the pure function
// ---------------------------------------------------------------------------

function fakeSession({ signalsResponse, runBatches, onCall } = {}) {
  const calls = [];
  let runIndex = 0;
  return {
    calls,
    async request(path, opts = {}) {
      calls.push({ path, method: opts.method || "GET", body: opts.body ?? null });
      if (onCall) return onCall(path, opts);
      if (path.startsWith("/api/control/agent-runs")) {
        const batch = runBatches[runIndex] ?? { status: 200, agentRuns: [] };
        runIndex += 1;
        return { status: batch.status ?? 200, data: { agentRuns: batch.agentRuns ?? [] } };
      }
      if (path.startsWith("/api/signals")) return signalsResponse;
      return { status: 404, data: {} };
    },
  };
}

test("wiring snapshots pre-existing runs before the request and excludes them", async () => {
  const requestStartedAt = Date.now();
  const preExisting = { id: "run-old", startedAt: new Date(requestStartedAt - 60_000).toISOString() };
  const session = fakeSession({
    signalsResponse: { status: 200, data: { signals: [], evidenceAccounting: { discoveredCandidateCount: 0, producedEvidenceCount: 0, acceptedEvidenceCount: 0 } } },
    runBatches: [
      { agentRuns: [preExisting] },           // pre-request snapshot
      { agentRuns: [preExisting] },           // post-request runs (same old run)
    ],
  });
  const result = await executeAndBindQuery(session, "filter-a", "req-1", { industry: "q" }, []);
  assert.equal(result.ok, true);
  assert.equal(result.binding.status, "NOT_FOUND");
  // Actual call order: snapshot (GET agent-runs) BEFORE the signals POST.
  assert.equal(session.calls[0].path.startsWith("/api/control/agent-runs"), true);
  assert.equal(session.calls[1].path.startsWith("/api/signals"), true);
});

test("snapshot read failure aborts binding without issuing the research request", async () => {
  const session = fakeSession({
    signalsResponse: { status: 200, data: { signals: [] } },
    runBatches: [{ status: 500 }],
  });
  const result = await executeAndBindQuery(session, "filter-a", "req-1", { industry: "q" }, []);
  assert.equal(result.ok, false);
  assert.equal(result.bindingStatus, "SNAPSHOT_UNAVAILABLE");
  assert.equal(session.calls.some((call) => call.path.startsWith("/api/signals")), false);
});

test("multiple new runs inside the window are ambiguous through the wiring", async () => {
  const now = Date.now();
  const session = fakeSession({
    signalsResponse: { status: 200, data: { signals: [] } },
    runBatches: [
      { agentRuns: [] },
      { agentRuns: [
        { id: "run-a", startedAt: new Date(now - 1000).toISOString() },
        { id: "run-b", startedAt: new Date(now - 500).toISOString() },
      ] },
    ],
  });
  const result = await executeAndBindQuery(session, "filter-a", "req-1", { industry: "q" }, []);
  assert.equal(result.ok, true);
  assert.equal(result.binding.status, "AMBIGUOUS");
});

test("a failed request never inherits a historical run through the wiring", async () => {
  const now = Date.now();
  const historical = { id: "run-hist", startedAt: new Date(now - 60_000).toISOString() };
  const session = fakeSession({
    signalsResponse: { status: 500, data: { error: "boom" } },
    runBatches: [
      { agentRuns: [historical] },
      { agentRuns: [historical] },
    ],
  });
  const result = await executeAndBindQuery(session, "filter-a", "req-1", { industry: "q" }, []);
  assert.equal(result.ok, true);
  assert.equal(result.binding.status, "NOT_FOUND");
  assert.equal(result.response.status, 500);
});

test("a run left unbound by an earlier query is excluded once it appears", async () => {
  const now = Date.now();
  const lateRun = { id: "run-late", startedAt: new Date(now - 30_000).toISOString() };
  const first = await executeAndBindQuery(
    fakeSession({
      signalsResponse: { status: 200, data: { signals: [] } },
      runBatches: [{ agentRuns: [] }, { agentRuns: [] }],
    }),
    "filter-a", "req-1", { industry: "q" }, [],
  );
  assert.equal(first.binding.status, "NOT_FOUND");

  const second = await executeAndBindQuery(
    fakeSession({
      signalsResponse: { status: 200, data: { signals: [] } },
      runBatches: [{ agentRuns: [lateRun] }, { agentRuns: [lateRun] }],
    }),
    "filter-a", "req-2", { industry: "q" }, ["run-late"],
  );
  assert.equal(second.binding.status, "NOT_FOUND");
});

// ---------------------------------------------------------------------------
// 3. Process identity confirmed by the served process
// ---------------------------------------------------------------------------

test("a process killed by signal is not alive even when exitCode is null", () => {
  assert.equal(isProcessAlive({ exitCode: null, signalCode: "SIGTERM", pid: 123 }), false);
});

test("a child that never spawned (no pid) is not alive", () => {
  assert.equal(isProcessAlive({ exitCode: null, pid: undefined }), false);
  assert.equal(isProcessAlive(null), false);
});

test("a running child with pid and no exit or signal is alive", () => {
  assert.equal(isProcessAlive({ exitCode: null, signalCode: null, pid: 123 }), true);
});

test("health identity must come from the expected instance, not just HTTP 200", async () => {
  const ok = (instanceId) => async () => ({
    ok: true,
    json: async () => ({ status: "ok", instanceId }),
  });
  const match = await confirmServerIdentity({ baseUrl: "http://x", expectedInstanceId: "inst-1", fetchImpl: ok("inst-1") });
  assert.equal(match.confirmed, true);

  const foreign = await confirmServerIdentity({ baseUrl: "http://x", expectedInstanceId: "inst-1", fetchImpl: ok("other-instance") });
  assert.equal(foreign.confirmed, false);
  assert.equal(foreign.reason, "health-response-instance-mismatch");

  const missing = await confirmServerIdentity({ baseUrl: "http://x", expectedInstanceId: "inst-1", fetchImpl: ok(undefined) });
  assert.equal(missing.confirmed, false);
  assert.equal(missing.reason, "health-response-missing-instance-id");
});

// ---------------------------------------------------------------------------
// 4. Preference isolation verified directly over a scoped store
// ---------------------------------------------------------------------------

test("preference isolation: saved scope visible, sibling filter and other user unaffected, consumption scoped", () => {
  const store = new InMemorySignalRepository();
  const result = evaluatePreferenceIsolation({ store });
  assert.equal(result.savedVisibleToOwner, true);
  assert.equal(result.siblingFilterUnaffected, true);
  assert.equal(result.otherUserUnaffected, true);
  assert.equal(result.matchedEntityLowered, true);
  assert.equal(result.unmatchedEntityUnaffected, true);
  assert.equal(result.siblingFilterConsumptionUnaffected, true);
  assert.equal(result.otherUserConsumptionUnaffected, true);
  assert.equal(result.passed, true);
});

test("an empty control (no signals) can never count as isolation success", () => {
  const store = new InMemorySignalRepository();
  const contextA = { authenticatedUserId: "user-a", filterId: "filter-a" };
  store.savePreference(contextA, PREFERENCE, "2026-09-27T00:00:00.000Z");
  const result = evaluatePreferenceIsolation({ store, signals: [] });
  assert.equal(result.passed, false);
});

test("a broken store without tenant scoping fails the isolation scenario", () => {
  const shared = new Map();
  const brokenStore = {
    savePreference(context, input, now) {
      shared.set(input.scopeValue, { ...input, createdAt: now, updatedAt: now });
      return { id: input.scopeValue, ...input, createdAt: now, updatedAt: now };
    },
    listPreferences() {
      return [...shared.values()];
    },
  };
  const result = evaluatePreferenceIsolation({ store: brokenStore });
  assert.equal(result.passed, false);
});

// ---------------------------------------------------------------------------
// Regression guards kept from P0/P0.1
// ---------------------------------------------------------------------------

test("classifyQueryOutcome still separates auth, rate, business and evidence outcomes", () => {
  assert.equal(classifyQueryOutcome(401, { error: "Unauthorized" }), "AUTH_FAILURE");
  assert.equal(classifyQueryOutcome(429, { error: "rate" }), "RATE_LIMITED");
  assert.equal(classifyQueryOutcome(500, { error: "boom" }), "BUSINESS_FAILURE");
  assert.equal(classifyQueryOutcome(400, { signals: [] }), "INVALID_RESPONSE");
  assert.equal(classifyQueryOutcome(200, { signals: [] }), "INVALID_RESPONSE");
  assert.equal(classifyQueryOutcome(200, { signals: [], evidenceAccounting: { discoveredCandidateCount: 0, producedEvidenceCount: 0, acceptedEvidenceCount: 0 } }), "CORRECT_EMPTY");
});

test("selectRunForRequest still rejects ambiguous windows", () => {
  const now = Date.now();
  const result = selectRunForRequest(
    [{ id: "a", startedAt: new Date(now - 1000).toISOString() }, { id: "b", startedAt: new Date(now - 500).toISOString() }],
    { requestStartedAt: now - 2000, requestCompletedAt: now },
  );
  assert.equal(result.status, "AMBIGUOUS");
});

test("stopProcessLike still requires a confirmed exit event", async () => {
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};
  const result = await stopProcessLike(child, { termTimeoutMs: 40, killTimeoutMs: 40 });
  assert.equal(result.stopped, false);
  assert.equal(result.reason, "exit-unconfirmed");
});

test("fact fingerprints still distinguish claim and source changes", () => {
  const original = factFingerprint([signalWith({})]);
  const changed = factFingerprint([signalWith({}, [{
    claimText: "Palmier Pro adds enterprise SSO",
    verificationStatus: "verified",
    evidenceSources: [{ sourceUrl: "https://example.com/sso" }],
  }])]);
  assert.equal(factStateUnchanged(original, changed), false);
});

test("attention helpers keep their meaning", () => {
  assert.equal(hasHighAttention("MUST_READ"), true);
  assert.equal(hasLowAttention("LIBRARY_ONLY"), true);
  assert.equal(hasLowAttention("none"), false);
});

// ---------------------------------------------------------------------------
// P1-A unit 1: capture file contract, loader and re-derivable replay evidence
// ---------------------------------------------------------------------------

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReplayEvidenceFromCapture,
  loadCaptureMaterial,
  loadScenarioConfig,
  runOfflineReplay,
  runPreferenceIsolationScenarios,
} from "../scripts/signal-map-agent-loop-e2e.mjs";

function capturePayload(overrides = {}) {
  const response = overrides.response ?? {
    signals: [signalWith({})],
    evidenceAccounting: { discoveredCandidateCount: 1, producedEvidenceCount: 1, acceptedEvidenceCount: 1 },
  };
  const knowledgeState = overrides.knowledgeState ?? { knownFacts: ["existing-fact"], available: true };
  const core = {
    captureVersion: 1,
    kind: "SIGNAL_RUN_CAPTURE",
    commitSha: "abc123",
    requestId: "req-1",
    runId: "run-1",
    entity: "Palmier Pro",
    capturedAt: "2026-09-27T00:00:00.000Z",
    response,
    knowledgeState,
  };
  return { ...core, inputDigest: computeCaptureDigest(core) };
}

test("explicit empty knowledge state is valid and distinct from a missing knowledge state", () => {
  const signals = [signalWith({})];
  const arms = {
    withoutPreference: { signals, knowledgeState: { knownFacts: [] } },
    withPreference: { signals: structuredClone(signals), knowledgeState: { knownFacts: [] } },
  };
  const withoutArm = { signals: structuredClone(arms.withoutPreference.signals) };
  const withArm = { signals: structuredClone(arms.withPreference.signals) };
  applyAttentionPreferences(withoutArm, []);
  applyAttentionPreferences(withArm, [PREFERENCE]);
  const material = {
    mode: "CAPTURED_REPLAY",
    capture: { commitSha: "abc", requestId: "req-1", runId: "run-1", sourceMaterial: "capture.json" },
    arms,
    preference: PREFERENCE,
    outputs: {
      withoutPreferenceAttention: withoutArm.signals.map((s) => s.attentionDecision).join(","),
      withPreferenceAttention: withArm.signals.map((s) => s.attentionDecision).join(","),
    },
  };
  assert.equal(replayEvidenceMaterialValid(material).valid, true);

  const missingState = {
    ...material,
    arms: {
      withoutPreference: { signals: structuredClone(signals) },
      withPreference: { signals: structuredClone(signals) },
    },
  };
  const result = replayEvidenceMaterialValid(missingState);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "knowledge-state-missing");
});

test("capture loader validates file presence, shape, explicit knowledge state and input digest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sm-captures-"));
  try {
    const missing = await loadCaptureMaterial(join(dir, "nope.json"));
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "capture-file-missing");

    const badJson = join(dir, "bad.json");
    await writeFile(badJson, "{not json", "utf8");
    assert.equal((await loadCaptureMaterial(badJson)).reason, "capture-parse-failed");

    const noState = join(dir, "no-state.json");
    const payload = capturePayload();
    delete payload.knowledgeState;
    await writeFile(noState, JSON.stringify(payload), "utf8");
    assert.equal((await loadCaptureMaterial(noState)).reason, "knowledge-state-missing");

    const emptyState = join(dir, "empty-state.json");
    await writeFile(emptyState, JSON.stringify(capturePayload({ knowledgeState: { knownFacts: [], available: true } })), "utf8");
    const emptyResult = await loadCaptureMaterial(emptyState);
    assert.equal(emptyResult.ok, true);

    // Post-write tampering: the digest was computed over the original inputs,
    // so editing the recorded evidence after the fact must be detected.
    const tamperedSource = capturePayload();
    tamperedSource.response.signals[0].claims[0].claimText = "Palmier Pro adds enterprise SSO";
    const tampered = join(dir, "tampered.json");
    await writeFile(tampered, JSON.stringify(tamperedSource), "utf8");
    assert.equal((await loadCaptureMaterial(tampered)).reason, "capture-input-tampered");

    const good = join(dir, "good.json");
    await writeFile(good, JSON.stringify(capturePayload()), "utf8");
    const goodResult = await loadCaptureMaterial(good);
    assert.equal(goodResult.ok, true);
    assert.equal(goodResult.material.entity, "Palmier Pro");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay evidence is built from the captured input and rejected for unrelated captures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sm-captures-"));
  try {
    const path = join(dir, "q1.capture.json");
    await writeFile(path, JSON.stringify(capturePayload()), "utf8");
    const capture = await loadCaptureMaterial(path);

    const built = buildReplayEvidenceFromCapture(capture, { sourceMaterial: path, entity: "Palmier Pro" });
    assert.equal(built.ok, true, built.reason);
    assert.equal(built.replayEvidence.mode, "CAPTURED_REPLAY");
    assert.equal(built.replayEvidence.capture.requestId, "req-1");
    const validation = built.validation;
    assert.equal(validation.valid, true);
    assert.equal(hasHighAttention(validation.withoutPreferenceAttention), true);
    assert.equal(hasLowAttention(validation.withPreferenceAttention), true);

    const unrelated = buildReplayEvidenceFromCapture(capture, { sourceMaterial: path, entity: "Acme" });
    assert.equal(unrelated.ok, false);
    assert.equal(unrelated.reason, "unrelated-capture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline replay stays open when the capture cannot be associated or was tampered with", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sm-captures-"));
  try {
    const good = join(dir, "good.capture.json");
    await writeFile(good, JSON.stringify(capturePayload()), "utf8");
    const closed = await runOfflineReplay({ capturePath: good, entity: "Palmier Pro" });
    assert.equal(closed.materialValid, true);
    assert.equal(closed.mode, "CAPTURED_REPLAY");

    const open = await runOfflineReplay({ capturePath: good, entity: "Acme" });
    assert.equal(open.closed, false);
    assert.equal(open.reason, "unrelated-capture");

    // Post-write tampering of the recorded evidence must keep the replay open.
    const tamperedSource = capturePayload();
    tamperedSource.response.signals[0].claims[0].claimText = "Palmier Pro adds enterprise SSO";
    const tampered = join(dir, "tampered.capture.json");
    await writeFile(tampered, JSON.stringify(tamperedSource), "utf8");
    const tamperedResult = await runOfflineReplay({ capturePath: tampered, entity: "Palmier Pro" });
    assert.equal(tamperedResult.closed, false);
    assert.equal(tamperedResult.reason, "capture-input-tampered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scenario config is validated and defaults stay available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sm-config-"));
  try {
    const defaults = await loadScenarioConfig(undefined);
    assert.equal(defaults.ok, true);
    assert.equal(defaults.config, null);

    const missing = await loadScenarioConfig(join(dir, "nope.json"));
    assert.equal(missing.ok, false);

    const invalid = join(dir, "invalid.json");
    await writeFile(invalid, JSON.stringify({ newFact: { entity: "A" } }), "utf8");
    assert.equal((await loadScenarioConfig(invalid)).ok, false);

    const valid = join(dir, "valid.json");
    await writeFile(valid, JSON.stringify({
      newFact: { entity: "A", queries: { NEW_BASELINE: "q1", UPDATE_PROBE: "q3", RELIABILITY_DIFF: "q4" } },
      duplicate: { entity: "A", queries: { DUPLICATE_SAME_FACT: "q2" } },
      preferenceRestart: { entity: "A", queries: { SAVE_PREFERENCE_RESTART: "q7", PREFERENCE_ATTRIBUTION: "q8", PREFERENCE_STABILITY: "q10" }, candidateSources: ["hacker-news"] },
      isolation: { entity: "B", queries: { ISOLATION_CONTROL: "q9", NEW_ENTITY_B: "q5", DUPLICATE_ENTITY_B: "q6" } },
    }), "utf8");
    const loaded = await loadScenarioConfig(valid);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.config.preferenceRestart.candidateSources.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P1-A unit 2: real preference isolation execution entry (HTTP wiring)
// ---------------------------------------------------------------------------

function preferenceFakeSession({ ownerList = [], siblingList = [], otherList = [], crossStatus = 403, saveStatus = 200, isOwnerSession = false } = {}) {
  const calls = [];
  return {
    calls,
    isOwnerSession,
    async request(path, opts = {}) {
      calls.push({ path, method: opts.method || "GET", body: opts.body ?? null });
      const filterId = new URL(path, "http://x").searchParams.get("filterId");
      if (filterId === "filter-a") {
        if (opts.method === "POST") return { status: saveStatus, data: { preference: {} } };
        return { status: 200, data: { preferences: ownerList } };
      }
      if (filterId === "filter-a2") return { status: 200, data: { preferences: siblingList } };
      if (filterId === "filter-b-user-b") {
        if (isOwnerSession) return { status: crossStatus, data: { error: "Forbidden" } };
        return { status: 200, data: { preferences: otherList } };
      }
      return { status: 404, data: {} };
    },
  };
}

test("preference isolation scenario: storage, consumption and auth rejection recorded separately", async () => {
  const owner = preferenceFakeSession({ ownerList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }], isOwnerSession: true });
  const sibling = preferenceFakeSession({ siblingList: [] });
  const other = preferenceFakeSession({ otherList: [] });

  const result = await runPreferenceIsolationScenarios({
    ownerSession: owner,
    ownerFilterId: "filter-a",
    siblingFilterId: "filter-a2",
    otherUserSession: other,
    otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(result.storageIsolation.ownerReadBack, true);
  assert.equal(result.storageIsolation.siblingFilterEmpty, true);
  assert.equal(result.storageIsolation.otherUserEmpty, true);
  assert.equal(result.authRejection.rejected, true);
  assert.equal(result.observed, true);
  assert.equal(owner.calls[0].method, "POST");
  assert.equal(owner.calls[1].path.startsWith("/api/preferences"), true);
  assert.equal(owner.calls.some((call) => call.path.includes("filter-b-user-b")), true);
});

test("a sibling filter that already holds the preference fails storage isolation", async () => {
  // The sibling read is issued by the OWNER session (same user A), so the
  // sibling list must be configured on the owner's fake session.
  const owner = preferenceFakeSession({
    ownerList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }],
    siblingList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }],
    isOwnerSession: true,
  });
  const other = preferenceFakeSession({ otherList: [] });
  const result = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: other, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(result.storageIsolation.siblingFilterEmpty, false);
  assert.equal(result.observed, false);
});

test("auth rejection that silently succeeds (200) fails the isolation scenario", async () => {
  const owner = preferenceFakeSession({ ownerList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }], crossStatus: 200, isOwnerSession: true });
  const sibling = preferenceFakeSession({ siblingList: [] });
  const other = preferenceFakeSession({ otherList: [] });
  const result = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: other, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(result.authRejection.rejected, false);
  assert.equal(result.observed, false);
});

test("an owner read that returns nothing cannot claim the preference was saved", async () => {
  const owner = preferenceFakeSession({ ownerList: [], isOwnerSession: true });
  const sibling = preferenceFakeSession({ siblingList: [] });
  const other = preferenceFakeSession({ otherList: [] });
  const result = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: other, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(result.storageIsolation.ownerReadBack, false);
  assert.equal(result.observed, false);
});

test("consumption isolation comes from the caller-computed rows, never hardcoded", async () => {
  const owner = preferenceFakeSession({ ownerList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }], isOwnerSession: true });
  const sibling = preferenceFakeSession({ siblingList: [] });
  const other = preferenceFakeSession({ otherList: [] });
  const result = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: other, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: false },
  });
  assert.equal(result.observed, false);
  assert.equal(result.consumptionIsolation.unmatchedHigh, false);
});

// ---------------------------------------------------------------------------
// Restored P0.1 regression scenarios
// ---------------------------------------------------------------------------

test("a per-fact reliability change is detected even when the maximum is unchanged", () => {
  const original = factFingerprint([
    signalWith({ id: "high", reliabilityScore: 92 }),
    signalWith({ id: "low", reliabilityScore: 40, verificationStatus: "unverified" }),
  ]);
  const changed = factFingerprint([
    signalWith({ id: "high", reliabilityScore: 92 }),
    signalWith({ id: "low", reliabilityScore: 41, verificationStatus: "unverified" }),
  ]);
  assert.equal(factStateUnchanged(original, changed), false);
});

test("verification status swapped between facts is detected", () => {
  const original = factFingerprint([
    signalWith({ id: "a" }, [{ claimText: "fact one", verificationStatus: "verified", evidenceSources: [{ sourceUrl: "https://example.com/1", canonicalUrl: "https://example.com/1" }] }]),
    signalWith({ id: "b", reliabilityScore: 40 }, [{ claimText: "fact two", verificationStatus: "unverified", evidenceSources: [{ sourceUrl: "https://example.com/2", canonicalUrl: "https://example.com/2" }] }]),
  ]);
  const swapped = factFingerprint([
    signalWith({ id: "a" }, [{ claimText: "fact one", verificationStatus: "unverified", evidenceSources: [{ sourceUrl: "https://example.com/1", canonicalUrl: "https://example.com/1" }] }]),
    signalWith({ id: "b", reliabilityScore: 40 }, [{ claimText: "fact two", verificationStatus: "verified", evidenceSources: [{ sourceUrl: "https://example.com/2", canonicalUrl: "https://example.com/2" }] }]),
  ]);
  assert.equal(factStateUnchanged(original, swapped), false);
});

test("a duplicate surfaced as high attention or an unbound record never closes", () => {
  const baseline = { bound: true, classification: "NEW", attention: "MUST_READ", knowledgeUnchanged: false, fact: factFingerprint([signalWith({})]) };
  const loud = evaluateDuplicateCase({
    baseline,
    duplicate: { bound: true, classification: "DUPLICATE", knowledgeUnchanged: true, attention: "MUST_READ", fact: factFingerprint([signalWith({})]) },
  });
  assert.equal(loud.closed, false);
  const unbound = evaluateDuplicateCase({
    baseline,
    duplicate: { bound: false, classification: "DUPLICATE", knowledgeUnchanged: true, attention: "LIBRARY_ONLY", fact: factFingerprint([signalWith({})]) },
  });
  assert.equal(unbound.closed, false);
});

test("an already-exited process reports confirmed exit without signalling", async () => {
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.exitCode = 0;
  let killed = false;
  child.kill = () => { killed = true; };
  const result = await stopProcessLike(child, { termTimeoutMs: 50, killTimeoutMs: 50 });
  assert.equal(killed, false);
  assert.equal(result.stopped, true);
  assert.equal(result.alreadyExited, true);
});

// ---------------------------------------------------------------------------
// P1-B closeout 1: dual-account session lifecycle orchestration
// ---------------------------------------------------------------------------

test("prepareAcceptanceSessions logs in both accounts before any scenario runs", async () => {
  const { prepareAcceptanceSessions, logoutAllSessions } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const events = [];
  const createSession = (label) => ({ label });
  const login = async (session, email) => { events.push(`login:${email}`); session.loggedIn = true; };
  const logout = async (session) => { events.push(`logout:${session.label}`); session.loggedIn = false; };

  const sessions = await prepareAcceptanceSessions({
    createSession, login,
    accountAEmail: "a@test", accountAPassword: "p-a",
    accountBEmail: "b@test", accountBPassword: "p-b",
  });
  assert.equal(sessions.harnessSession.loggedIn, true);
  assert.equal(sessions.otherUserSession.loggedIn, true);
  assert.deepEqual(events, ["login:a@test", "login:b@test"]);

  await logoutAllSessions([sessions.harnessSession, sessions.otherUserSession], { logout });
  assert.deepEqual(events.slice(2), ["logout:Account A (ten-query)", "logout:Account B (ten-query)"]);
  assert.equal(sessions.harnessSession.loggedIn, false);
});

test("runAuthenticatedAcceptance requires both accounts before running the dependent phase", async () => {
  const { runAuthenticatedAcceptance } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const owner = { label: "A", user: { id: "u-a" } };
  const other = { label: "B", user: { id: "u-b" } };
  let ran = false;
  await runAuthenticatedAcceptance({
    ownerSession: owner, otherUserSession: other,
    runDependent: ({ ownerSession, otherUserSession }) => {
      assert.equal(ownerSession.user.id, "u-a");
      assert.equal(otherUserSession.user.id, "u-b");
      ran = true;
    },
  });
  assert.equal(ran, true);

  await assert.rejects(() => runAuthenticatedAcceptance({
    ownerSession: {}, otherUserSession: other,
    runDependent: () => {},
  }));

  // This reproduces the historical main bug: B logged out before the
  // preference-isolation scenario but still passed as otherUserSession.
  await assert.rejects(() => runAuthenticatedAcceptance({
    ownerSession: owner, otherUserSession: {},
    runDependent: () => {},
  }));
});

test("logoutAllSessions tolerates an individual logout failure without stopping the others", async () => {
  const { logoutAllSessions } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const events = [];
  const a = { label: "A" };
  const b = { label: "B" };
  const logout = async (session) => {
    events.push(`logout:${session.label}`);
    if (session.label === "A") throw new Error("A logout backend error");
  };
  const result = await logoutAllSessions([a, b], { logout });
  assert.deepEqual(events, ["logout:A", "logout:B"]);
  assert.deepEqual(result.failures, ["A"]);
  assert.equal(result.loggedOut.some((item) => item.label === "B"), true);
});

test("main orchestrates logout only after the ten-query phase in the actual source path", async () => {
  const { readFile: readFs } = await import("node:fs/promises");
  const src = await readFs("scripts/signal-map-agent-loop-e2e.mjs", "utf8");
  const mainStart = src.indexOf("async function main(");
  assert.notEqual(mainStart, -1, "main must exist");
  const mainBody = src.slice(mainStart);
  // The acceptance accounts must not be logged out before the ten-query phase
  // starts; a premature logout would leave account B dead for the
  // preference-isolation scenario.
  const logoutCalls = [];
  let searchFrom = 0;
  while (true) {
    const idx = mainBody.indexOf('"/api/auth/logout"', searchFrom);
    if (idx === -1) break;
    logoutCalls.push(idx);
    searchFrom = idx + 1;
  }
  const tenQueryIdx = mainBody.indexOf("runTenQuerySequence(");
  assert.notEqual(tenQueryIdx, -1, "main must call runTenQuerySequence");
  const premature = logoutCalls.filter((idx) => idx < tenQueryIdx);
  assert.equal(premature.length, 0, `premature logout(s) before ten-query: ${premature.length}`);
});

test("the acceptance orchestration keeps account B authenticated through the dependent phase", async () => {
  const { prepareAcceptanceSessions, runAuthenticatedAcceptance, logoutAllSessions } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const events = [];
  const createSession = (label) => ({ label });
  const login = async (session, email) => { session.user = { id: email }; session.loggedIn = true; events.push(`login:${email}`); };
  const logout = async (session) => { session.loggedIn = false; events.push(`logout:${session.label}`); };

  const sessions = await prepareAcceptanceSessions({
    createSession, login,
    accountAEmail: "a@test", accountAPassword: "p-a",
    accountBEmail: "b@test", accountBPassword: "p-b",
  });

  let dependentRan = false;
  await runAuthenticatedAcceptance({
    ownerSession: sessions.harnessSession,
    otherUserSession: sessions.otherUserSession,
    runDependent: ({ ownerSession, otherUserSession }) => {
      assert.equal(ownerSession.loggedIn, true);
      assert.equal(otherUserSession.loggedIn, true, "account B must stay logged in during isolation");
      dependentRan = true;
    },
  });
  assert.equal(dependentRan, true);
  assert.equal(events.filter((e) => e.startsWith("logout")).length, 0, "no logout before dependent phase");

  await logoutAllSessions([sessions.harnessSession, sessions.otherUserSession], { logout });
  assert.equal(sessions.harnessSession.loggedIn, false);
  assert.equal(sessions.otherUserSession.loggedIn, false);
});

test("an invalid other-user session is distinguished from a logged-in user with no preference", async () => {
  const { runPreferenceIsolationScenarios } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const owner = preferenceFakeSession({ ownerList: [{ scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" }], isOwnerSession: true });
  const loggedOutOther = preferenceFakeSession({ crossStatus: 401, otherList: [] });
  const loggedOutOtherApi = {
    // The other-user session is dead: every request it issues is rejected.
    async request(path, opts = {}) {
      const filterId = new URL(path, "http://x").searchParams.get("filterId");
      if (filterId === "filter-b-user-b") return { status: 401, data: { error: "Unauthorized" } };
      return { status: 404, data: {} };
    },
  };
  const invalidSession = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: loggedOutOtherApi, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(invalidSession.storageIsolation.otherUserSessionValid, false);
  assert.equal(invalidSession.isolationStatus, "OTHER_USER_SESSION_INVALID");
  assert.equal(invalidSession.observed, false);

  // Logged in, own scope, simply no preference: a distinct, valid empty state.
  const validEmpty = preferenceFakeSession({ otherList: [] });
  const emptyResult = await runPreferenceIsolationScenarios({
    ownerSession: owner, ownerFilterId: "filter-a", siblingFilterId: "filter-a2",
    otherUserSession: validEmpty, otherUserFilterId: "filter-b-user-b",
    consumptionIsolation: { matchedLowered: true, unmatchedHigh: true },
  });
  assert.equal(emptyResult.storageIsolation.otherUserSessionValid, true);
  assert.equal(emptyResult.storageIsolation.otherUserEmpty, true);
});

// ---------------------------------------------------------------------------
// P1-B closeout 2: capture artifacts are sanitized, digest-covered and deliverable
// ---------------------------------------------------------------------------

test("capture write sanitizes credential-looking strings inside research content", async () => {
  const { writeRunCapture, loadCaptureMaterial } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const dir = await mkdtemp(join(tmpdir(), "sm-sanitize-"));
  try {
    const dirtySignal = signalWith({}, [{
      claimText: "Palmier Pro leaked Bearer sk-secret123 and postgres://user:pass@db.host/db",
      verificationStatus: "verified",
      evidenceSources: [{ sourceUrl: "https://example.com/leak", canonicalUrl: "https://example.com/leak" }],
    }]);
    const written = await writeRunCapture({
      captureDir: dir, requestId: "req-s", runId: "run-s", commitSha: "abc", entity: "Palmier Pro",
      response: { signals: [dirtySignal], evidenceAccounting: {} },
      knowledgeState: { knownFacts: [], available: true },
    });
    const raw = await readFile(written.path, "utf8");
    assert.equal(raw.includes("sk-secret123"), false);
    assert.equal(raw.includes("postgres://user:pass@db.host/db"), false);
    const loaded = await loadCaptureMaterial(written.path);
    assert.equal(loaded.ok, true, loaded.reason);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge read failures are preserved as unavailable, never as an empty state", async () => {
  const { scopedKnowledgeState, knowledgeCountFromState } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const failing = fakeSession(); // fakeSession without knowledge handling returns 404
  const failedState = await scopedKnowledgeState(failing, "filter-x");
  assert.equal(failedState.available, false);
  assert.equal(knowledgeCountFromState(failedState), null);

  const emptyState = { knownFacts: [], available: true };
  assert.equal(knowledgeCountFromState(emptyState), 0);
});

test("a capture whose knowledge state was unavailable cannot build replay evidence", async () => {
  const { writeRunCapture, loadCaptureMaterial, buildReplayEvidenceFromCapture } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const dir = await mkdtemp(join(tmpdir(), "sm-kstate-"));
  try {
    const written = await writeRunCapture({
      captureDir: dir, requestId: "req-k", runId: "run-k", commitSha: "abc", entity: "Palmier Pro",
      response: { signals: [signalWith({})], evidenceAccounting: {} },
      knowledgeState: { knownFacts: [], available: false },
    });
    const loaded = await loadCaptureMaterial(written.path);
    assert.equal(loaded.ok, true, loaded.reason);
    assert.equal(loaded.material.knowledgeState.available, false);
    const built = buildReplayEvidenceFromCapture(loaded, { entity: "Palmier Pro" });
    assert.equal(built.ok, false);
    assert.equal(built.reason, "knowledge-state-unavailable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the capture digest covers the acceptance-relevant state, not only signals", async () => {
  const { computeCaptureDigest, writeRunCapture, loadCaptureMaterial } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const core = {
    requestId: "req-d", runId: "run-d", entity: "Palmier Pro", commitSha: "abc",
    response: { signals: [signalWith({})], evidenceAccounting: {} },
    knowledgeState: { knownFacts: ["k1"], available: true },
  };
  const digestA = computeCaptureDigest(core);
  const digestB = computeCaptureDigest({ ...core, knowledgeState: { knownFacts: ["k2"], available: true } });
  assert.notEqual(digestA, digestB);
  const digestC = computeCaptureDigest({ ...core, requestId: "req-other" });
  assert.notEqual(digestA, digestC);

  const dir = await mkdtemp(join(tmpdir(), "sm-digest-"));
  try {
    const written = await writeRunCapture({ captureDir: dir, ...core });
    const tampered = JSON.parse(await readFile(written.path, "utf8"));
    tampered.knowledgeState.knownFacts = ["tampered"];
    const tamperedPath = join(dir, "tampered.capture.json");
    await writeFile(tamperedPath, JSON.stringify(tampered), "utf8");
    const loaded = await loadCaptureMaterial(tamperedPath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.reason, "capture-input-tampered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P1-B closeout 3: LIVE and offline share one loader-based validation path
// ---------------------------------------------------------------------------

test("acceptance replay is built by re-loading the capture file, never from hand-made state", async () => {
  const { writeRunCapture, buildReplayEvidenceForAcceptance } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  const dir = await mkdtemp(join(tmpdir(), "sm-accept-"));
  try {
    const written = await writeRunCapture({
      captureDir: dir, requestId: "req-1", runId: "run-1", commitSha: "abc", entity: "Palmier Pro",
      response: { signals: [signalWith({})], evidenceAccounting: {} },
      knowledgeState: { knownFacts: ["existing-fact"], available: true },
    });
    const built = await buildReplayEvidenceForAcceptance({
      capturePath: written.path,
      expected: { requestId: "req-1", runId: "run-1", entity: "Palmier Pro" },
    });
    assert.equal(built.ok, true, built.reason);
    assert.equal(built.replayEvidence.mode, "CAPTURED_REPLAY");
    assert.equal(built.validation.valid, true);

    const mismatched = await buildReplayEvidenceForAcceptance({
      capturePath: written.path,
      expected: { requestId: "req-1", runId: "run-1", entity: "Acme" },
    });
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.reason, "unrelated-capture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P1-B closeout 4: budget constants and workflow artifact wiring
// ---------------------------------------------------------------------------

test("research request accounting covers the whole main flow", async () => {
  const { ACCEPTANCE_RESEARCH_REQUEST_COUNT, ACCEPTANCE_SEQUENCE_LENGTH, ACCEPTANCE_QUALITY_REQUEST_COUNT } = await import("../scripts/signal-map-agent-loop-e2e.mjs");
  assert.equal(ACCEPTANCE_SEQUENCE_LENGTH, 10);
  assert.equal(ACCEPTANCE_RESEARCH_REQUEST_COUNT, 12); // 2 stateful runs + 10 sequence
  assert.equal(ACCEPTANCE_QUALITY_REQUEST_COUNT, 1);   // optional quality query
});

test("the CI artifact carries captures and replay reports without environment material", async () => {
  const { readFile: readFs } = await import("node:fs/promises");
  const { default: yaml } = await import("yaml");
  const workflow = yaml.parse(await readFs(".github/workflows/signal-map-agent-loop-e2e.yml", "utf8"));
  const upload = workflow.jobs["agent-loop-e2e"].steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
  const paths = upload.with.path.split("\n").map((line) => line.trim()).filter(Boolean);
  assert.equal(paths.includes("signal-map-agent-loop-e2e-report.json"), true);
  assert.equal(paths.includes("signal-map-replay-report.json"), true);
  assert.equal(paths.some((path) => path.startsWith("captures/")), true);
  assert.equal(paths.some((path) => path.includes(".env")), false);
  assert.equal(paths.some((path) => path.includes("cookie")), false);
});

