import assert from "node:assert/strict";
import test from "node:test";
import { selectBoundedCandidates } from "../research/candidate-selection.ts";

type Event = {
  id: string;
  overallScore: number;
  preliminaryEligible?: boolean;
  freshnessEligible?: boolean;
  timestampValid?: boolean;
  background?: boolean;
  known?: boolean;
  protectedReasons?: Array<
    "tracked_entity" | "tracked_event" | "current_question" | "information_gap" | "focus_area"
  >;
  attentionDecision?: "MUST_READ" | "WORTH_WATCHING" | "LIBRARY_ONLY" | "IGNORE";
};

function event(id: string, overallScore: number, overrides: Partial<Event> = {}): Event {
  return {
    id,
    overallScore,
    preliminaryEligible: true,
    freshnessEligible: true,
    timestampValid: true,
    background: false,
    known: false,
    protectedReasons: [],
    attentionDecision: "LIBRARY_ONLY",
    ...overrides,
  };
}

function candidates(events: Event[]) {
  return events.map((value) => ({
    id: value.id,
    overallScore: value.overallScore,
    preliminaryEligible: value.preliminaryEligible ?? false,
    freshnessEligible: value.freshnessEligible ?? false,
    timestampValid: value.timestampValid ?? false,
    isBackground: value.background ?? false,
    isKnown: value.known ?? false,
    protectedReasons: value.protectedReasons ?? [],
    value,
  }));
}

test("a tracked entity outside the global top 50 remains in the candidate pool", () => {
  const general = Array.from({ length: 55 }, (_, index) => event(`general-${index}`, 100 - index));
  const tracked = event("tracked", 1, { protectedReasons: ["tracked_entity"] });

  const result = selectBoundedCandidates(candidates([...general, tracked]));

  assert.equal(result.selected.length, 50);
  assert.ok(result.selected.some((item) => item.value.id === "tracked"));
  const trace = result.audit.find((item) => item.id === "tracked");
  assert.equal(trace?.preTruncationRank, 56);
  assert.equal(trace?.selected, true);
  assert.equal(trace?.selectionReason, "context_protected");
  assert.deepEqual(trace?.protectedReason, ["tracked_entity"]);
});

test("current question and information gap matches are protected without a new score", () => {
  const general = Array.from({ length: 51 }, (_, index) => event(`general-${index}`, 100 - index));
  const question = event("question", 3, { protectedReasons: ["current_question"] });
  const gap = event("gap", 2, { protectedReasons: ["information_gap"] });

  const result = selectBoundedCandidates(candidates([...general, question, gap]));

  assert.ok(result.selected.some((item) => item.value.id === "question"));
  assert.ok(result.selected.some((item) => item.value.id === "gap"));
});

test("unrelated high-score events cannot crowd out every eligible protected event", () => {
  const general = Array.from({ length: 60 }, (_, index) => event(`general-${index}`, 100 - index));
  const protectedEvents = [
    event("entity", 1, { protectedReasons: ["tracked_entity"] }),
    event("focus", 2, { protectedReasons: ["focus_area"] }),
  ];

  const result = selectBoundedCandidates(candidates([...general, ...protectedEvents]));

  assert.deepEqual(
    result.selected.filter((item) => item.protectedReasons.length).map((item) => item.value.id),
    ["focus", "entity"],
  );
});

test("known, background, stale, and preliminary IGNORE events are never context-protected", () => {
  const items = [
    event("known", 4, { known: true, protectedReasons: ["tracked_entity"] }),
    event("background", 3, { background: true, protectedReasons: ["tracked_entity"] }),
    event("stale", 2, { freshnessEligible: false, protectedReasons: ["tracked_entity"] }),
    event("ignored", 1, { preliminaryEligible: false, attentionDecision: "IGNORE", protectedReasons: ["tracked_entity"] }),
  ];

  const result = selectBoundedCandidates(candidates(items));

  assert.equal(result.audit.find((item) => item.id === "ignored")?.selectionReason, "overall_score");
  for (const id of ["known", "background", "stale", "ignored"]) {
    assert.deepEqual(result.audit.find((item) => item.id === id)?.protectedReason, []);
  }
});

test("a preliminary SIGNAL below library novelty may remain a general candidate for the final Worth Watching gate", () => {
  const general = Array.from({ length: 49 }, (_, index) => event(`general-${index}`, 100 - index));
  const signal = event("worth-watching-signal", 20, {
    preliminaryEligible: false,
    attentionDecision: "IGNORE",
    protectedReasons: ["tracked_entity"],
  });

  const result = selectBoundedCandidates(candidates([...general, signal]));
  const trace = result.audit.find((item) => item.id === "worth-watching-signal");

  assert.ok(result.selected.some((item) => item.value.id === "worth-watching-signal"));
  assert.equal(trace?.selectionReason, "overall_score");
  assert.deepEqual(trace?.protectedReason, []);
});

test("selection audit preserves pipeline-provided eligibility branches and context matches", () => {
  const result = selectBoundedCandidates([
    {
      id: "audited-event",
      overallScore: 80,
      preliminaryEligible: false,
      freshnessEligible: true,
      timestampValid: true,
      isBackground: false,
      isKnown: false,
      protectedReasons: ["tracked_entity"],
      eligibilityAudit: {
        scores: { relevance: 72, reliability: 62, novelty: 61, freshness: 90, eventStatus: "SIGNAL" },
        canEnterLibrary: {
          value: false,
          libraryBranch: {
            reliability: { actual: 62, threshold: 55, pass: true },
            relevance: { actual: 72, threshold: 58, pass: true },
            novelty: { actual: 61, threshold: 38, pass: true },
          },
          signalBranch: {
            eventStatus: { actual: "SIGNAL", expected: "SIGNAL", pass: true },
            relevance: { actual: 72, threshold: 70, pass: true },
            freshness: { actual: 90, threshold: 80, pass: true },
            novelty: { actual: 61, threshold: 65, pass: false },
          },
          failedConditions: ["signal_novelty_below_65"],
        },
        contextMatches: {
          entityMatches: ["claude code"],
          trackedEventMatches: [],
          questionMatches: ["workflow"],
          gapMatches: ["limitations"],
          focusAreaMatches: ["ai coding agents"],
        },
      },
      value: event("audited-event", 80),
    },
  ]);

  assert.deepEqual(result.audit[0].eligibilityAudit?.canEnterLibrary.failedConditions, ["signal_novelty_below_65"]);
  assert.deepEqual(result.audit[0].eligibilityAudit?.contextMatches.entityMatches, ["claude code"]);
});

test("duplicates are selected once, the pool is bounded, and more than 50 protected events use existing overall score", () => {
  const protectedEvents = Array.from({ length: 55 }, (_, index) =>
    event(`protected-${index}`, 100 - index, { protectedReasons: ["tracked_event"] }),
  );
  const duplicate = event("protected-0", 99, { protectedReasons: ["tracked_event"] });

  const result = selectBoundedCandidates(candidates([...protectedEvents, duplicate]));

  assert.equal(result.selected.length, 50);
  assert.deepEqual(result.selected.map((item) => item.value.id), protectedEvents.slice(0, 50).map((item) => item.id));
  assert.equal(result.selected.filter((item) => item.value.id === "protected-0").length, 1);
  assert.equal(result.audit.find((item) => item.id === "protected-54")?.selectionReason, "not_selected");
});

test("existing Codex-like candidates remain selected and final decisions are not changed", () => {
  const codex = event("codex-release", 92, { attentionDecision: "MUST_READ" });
  const result = selectBoundedCandidates(candidates([codex, event("other", 70)]));

  assert.equal(result.selected[0].value.id, "codex-release");
  assert.equal(result.selected[0].value.attentionDecision, "MUST_READ");
});
