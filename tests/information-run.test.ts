import assert from "node:assert/strict";
import test from "node:test";
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
