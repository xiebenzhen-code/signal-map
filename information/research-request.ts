import type { ActiveKnowledgeContext } from "./types.ts";

function requestId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signals-${id}`;
}

export function createResearchRequest(knowledge: ActiveKnowledgeContext): RequestInit & { url: string } {
  return {
    url: "/api/signals",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signal-Map-Request-Id": requestId(),
    },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({
      identity: knowledge.identity,
      industry: knowledge.industry,
      focusAreas: knowledge.focusAreas,
      currentQuestions: knowledge.currentQuestions,
      knownInformation: knowledge.knownInformation,
      informationGaps: knowledge.informationGaps,
      trackedEntities: knowledge.trackedEntities,
      trackedEvents: knowledge.trackedEvents,
      userJudgements: knowledge.userJudgements,
      evidenceHistory: "",
      freshnessWindow: knowledge.freshnessWindow,
      sourceScope: knowledge.sourceScope,
      customSources: knowledge.customSources,
    }),
  };
}
