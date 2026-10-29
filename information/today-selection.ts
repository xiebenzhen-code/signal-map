import { compareAttentionPriority } from "../research/actionability.ts";
import type { ResearchSignal } from "../research/types.ts";
import { freshnessWindowHours } from "./freshness.ts";

type TodayPresentationKind =
  | "must_read"
  | "worth_watching"
  | "usable_updates"
  | "caught_up";

export type TodayPresentation = {
  kind: TodayPresentationKind;
  items: ResearchSignal[];
  mustRead: ResearchSignal[];
  worthWatching: ResearchSignal[];
  usableUpdates: ResearchSignal[];
};

function uniqueEvents(events: ResearchSignal[]) {
  const ids = new Set<string>();
  return events.filter((event) => {
    if (ids.has(event.id)) return false;
    ids.add(event.id);
    return true;
  });
}

// "usable updates" are in-window official/trusted changes the user explicitly
// asked about. The freshness gate is relative to the requested research window
// (the caller passes it), not a fixed 72h cutoff: a verified 8-day-old release
// must surface for a "last month" question. Every non-freshness gate —
// verification, reliability, relevance, novelty, source tier, event status —
// is unchanged.
function isUsableUpdateCandidate(event: ResearchSignal, windowDays: number) {
  const ageHours = freshnessAgeHours(event);
  return (
    event.attentionDecision === "LIBRARY_ONLY" &&
    event.timestampStatus === "valid" &&
    event.knowledgeStatus !== "KNOWN" &&
    event.eventStatus !== "BACKGROUND" &&
    event.sourceTier !== "C" &&
    ["verified", "partially_verified"].includes(event.verificationStatus) &&
    event.reliabilityScore >= 70 &&
    event.relevanceScore >= 50 &&
    ageHours !== undefined &&
    ageHours <= windowDays * 24 &&
    event.noveltyScore >= 60
  );
}

function freshnessAgeHours(event: ResearchSignal) {
  const reference = event.lastUpdatedAt || event.eventOccurredAt || event.publishedAt;
  if (!reference || event.timestampStatus !== "valid") return undefined;
  const time = new Date(reference).getTime();
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

function sourceRank(event: ResearchSignal) {
  return event.sourceTier === "S" ? 2 : event.sourceTier === "A" ? 1 : 0;
}

function byUsableUpdatePriority(left: ResearchSignal, right: ResearchSignal) {
  return (
    Number(right.actionabilityStatus === "TEST_NOW") - Number(left.actionabilityStatus === "TEST_NOW") ||
    sourceRank(right) - sourceRank(left) ||
    right.freshnessScore - left.freshnessScore ||
    right.reliabilityScore - left.reliabilityScore ||
    right.noveltyScore - left.noveltyScore ||
    right.relevanceScore - left.relevanceScore
  );
}

export function selectTodayPresentation(
  events: ResearchSignal[],
  freshnessWindow: string = "7d",
): TodayPresentation {
  const windowDays = Math.max(1, freshnessWindowHours(freshnessWindow) / 24);
  const mustRead = uniqueEvents(
    events.filter((event) =>
      event.attentionDecision === "MUST_READ" && event.eventStatus !== "BACKGROUND"),
  ).sort(compareAttentionPriority).slice(0, 5);
  const worthWatching = uniqueEvents(
    events.filter((event) => event.attentionDecision === "WORTH_WATCHING"),
  ).sort(compareAttentionPriority).slice(0, 3);
  const usableUpdates = uniqueEvents(events)
    .filter((event) => isUsableUpdateCandidate(event, windowDays))
    .sort(byUsableUpdatePriority)
    .slice(0, 3);

  if (mustRead.length) {
    return {
      kind: "must_read",
      items: mustRead,
      mustRead,
      worthWatching,
      usableUpdates,
    };
  }

  if (worthWatching.length) {
    return {
      kind: "worth_watching",
      items: worthWatching,
      mustRead: [],
      worthWatching,
      usableUpdates,
    };
  }

  if (usableUpdates.length) {
    return {
      kind: "usable_updates",
      items: usableUpdates,
      mustRead: [],
      worthWatching: [],
      usableUpdates,
    };
  }

  return {
    kind: "caught_up",
    items: [],
    mustRead: [],
    worthWatching: [],
    usableUpdates: [],
  };
}
