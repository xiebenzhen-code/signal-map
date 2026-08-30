import type { ResearchSignal } from "../research/types.ts";

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

function isUsableUpdateCandidate(event: ResearchSignal) {
  return (
    event.attentionDecision === "LIBRARY_ONLY" &&
    event.timestampStatus === "valid" &&
    event.knowledgeStatus !== "KNOWN" &&
    event.eventStatus !== "BACKGROUND" &&
    event.sourceTier !== "C" &&
    ["verified", "partially_verified"].includes(event.verificationStatus) &&
    event.reliabilityScore >= 70 &&
    event.relevanceScore >= 50 &&
    event.freshnessScore >= 65 &&
    event.noveltyScore >= 60
  );
}

function sourceRank(event: ResearchSignal) {
  return event.sourceTier === "S" ? 2 : event.sourceTier === "A" ? 1 : 0;
}

function byUsableUpdatePriority(left: ResearchSignal, right: ResearchSignal) {
  return (
    sourceRank(right) - sourceRank(left) ||
    right.freshnessScore - left.freshnessScore ||
    right.reliabilityScore - left.reliabilityScore ||
    right.noveltyScore - left.noveltyScore ||
    right.relevanceScore - left.relevanceScore
  );
}

export function selectTodayPresentation(events: ResearchSignal[]): TodayPresentation {
  const mustRead = uniqueEvents(
    events.filter((event) => event.attentionDecision === "MUST_READ"),
  ).slice(0, 5);
  const worthWatching = uniqueEvents(
    events.filter((event) => event.attentionDecision === "WORTH_WATCHING"),
  ).slice(0, 3);
  const usableUpdates = uniqueEvents(events)
    .filter(isUsableUpdateCandidate)
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
