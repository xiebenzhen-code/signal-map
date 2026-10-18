import assert from "node:assert/strict";
import test from "node:test";

test("browser observations distinguish visible feedback from HTTP completion and preserve unknowns", async () => {
  const { createResearchObservation } = await import("../information/browser-observation.ts");
  let now = 100;
  const records: unknown[] = [];
  const observed = createResearchObservation(() => now, (event) => records.push(event));
  now = 180;
  observed.feedback();
  observed.request("signals-test");
  now = 2100;
  observed.complete("completed");
  observed.complete("completed");
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { stage: "browser_research", requestId: "signals-test", firstFeedbackMs: 80,
    visibleCompletionMs: 2000, outcome: "completed", longTaskCount: null, maxLongTaskMs: null });
  const unknown: unknown[] = [];
  createResearchObservation(() => 10, (event) => unknown.push(event)).complete("failed");
  assert.equal((unknown[0] as Record<string, unknown>).firstFeedbackMs, null);
  const incomplete: unknown[] = [];
  createResearchObservation(() => 60000, (event) => incomplete.push(event)).complete("incomplete");
  assert.equal((incomplete[0] as Record<string, unknown>).visibleCompletionMs, null);
});
import {
  isInformationRunCurrent,
  runInformation,
  selectCurrentInformationRun,
} from "../information/run-information.ts";
import type { InformationRun, InformationRunPayload } from "../information/types.ts";

function payload(overrides: Partial<InformationRunPayload> = {}): InformationRunPayload {
  return {
    signals: [],
    overview: { scanned: 0, deduplicated: 0, events: 0, verified: 0, relevant: 0, mustKnow: 0, worthWatching: 0, libraryOnly: 0, ignored: 0, noiseReductionRate: 100, novelInformationRate: 0 },
    coverage: { level: "Limited", usedProviders: [], zeroResultProviders: [], notSearchedProviders: [], unavailableProviders: [], notConfiguredProviders: [], failedProviders: [], outcomes: [] },
    failures: [],
    fetchedAt: "2026-08-28T08:00:00.000Z",
    dataMode: "live",
    ...overrides,
  };
}

function run(overrides: Partial<InformationRun> = {}): InformationRun {
  return { ...payload(), filterId: "ai", generatedFromResearchContextRevision: 3, ...overrides };
}

test("HTTP-success payload with failed agent status is rejected, without demo substitution", async () => {
  let demoCalls = 0;
  await assert.rejects(runInformation({
    filterId: "ai", researchContextRevision: 3,
    runLive: async () => payload({ ...({ status: "failed", requestId: "signals-failed" } as object) }),
    runDemo: async () => { demoCalls++; return payload({ dataMode: "demo" }); },
  }), /本次研究未完成/);
  assert.equal(demoCalls, 0);
});

test("failed historical run is never selected as current successful results", () => {
  const failed = run({ ...({ status: "failed" } as object) });
  assert.equal(selectCurrentInformationRun({ ai: failed }, "ai", 3), null);
});

test("run is current only for matching filter and revision", () => {
  assert.equal(isInformationRunCurrent(run(), "ai", 3), true);
  assert.equal(isInformationRunCurrent(run(), "fashion", 3), false);
  assert.equal(isInformationRunCurrent(run(), "ai", 4), false);
});

test("run selection never leaks another filter cache", () => {
  const runs = { ai: run(), fashion: run({ filterId: "fashion" }) };
  assert.equal(selectCurrentInformationRun(runs, "fashion", 3)?.filterId, "fashion");
  assert.equal(selectCurrentInformationRun(runs, "ai", 4), null);
});

test("Live failure falls back honestly", async () => {
  const result = await runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    runLive: async () => { throw new Error("Web provider unavailable"); },
    runDemo: async () => payload({ dataMode: "demo" }),
  });
  assert.equal(result.dataMode, "demo");
  assert.equal(result.fallbackReason, "Web provider unavailable");
  assert.equal(result.filterId, "ai");
  assert.equal(result.generatedFromResearchContextRevision, 3);
});

test("production research errors do not silently substitute fixed demo results", async () => {
  let calls = 0;
  await assert.rejects(runInformation({
    filterId: "ai", researchContextRevision: 3, allowDemoFallback: false,
    runLive: async () => { throw new Error("Search unavailable"); },
    runDemo: async () => { calls += 1; return payload({ dataMode: "demo" }); },
  }), /Search unavailable/);
  assert.equal(calls, 0);
});

test("auth failure never turns into a Guest Demo research result", async () => {
  let demoCalls = 0;
  await assert.rejects(runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    runLive: async () => { throw Object.assign(new Error("Login required"), { status: 401 }); },
    runDemo: async () => { demoCalls += 1; return payload({ dataMode: "demo" }); },
  }), /Login required/);
  assert.equal(demoCalls, 0);
});

test("public local mode never calls the authenticated Research API", async () => {
  let liveCalls = 0;
  const result = await runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    localOnly: true,
    runLive: async () => { liveCalls += 1; return payload(); },
    runDemo: async () => payload({ dataMode: "demo" }),
  });
  assert.equal(liveCalls, 0);
  assert.equal(result.dataMode, "demo");
});

test("an in-flight old revision fails completion validation", async () => {
  let currentRevision = 3;
  const pending = Promise.resolve(run());
  currentRevision = 4;
  assert.equal(isInformationRunCurrent(await pending, "ai", currentRevision), false);
});

test("both failures surface without fabricated information", async () => {
  await assert.rejects(runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    runLive: async () => { throw new Error("Live failed"); },
    runDemo: async () => { throw new Error("Demo failed"); },
  }), /Live failed; Demo fallback failed: Demo failed/);
});
