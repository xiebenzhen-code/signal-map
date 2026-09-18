import type { RetrievalPlan } from "../research/types.ts";
import type { ResearchPlan } from "./types.ts";

export function toRetrievalPlan(plan: ResearchPlan): RetrievalPlan {
  return {
    queries: [...plan.queries],
    topicKeywords: plan.topicKeywords ? [...plan.topicKeywords] : undefined,
    selectedSourceType: plan.selectedSourceType,
    fallbackSourceTypes: plan.fallbackSourceTypes ? [...plan.fallbackSourceTypes] : undefined,
    allowedProviderIds: plan.allowedProviderIds ? [...plan.allowedProviderIds] : undefined,
    reason: plan.reason ?? plan.sourceSelectionReason,
    resolvedEntities: plan.resolvedEntities?.map((entity) => ({
      canonicalEntity: entity.canonicalEntity,
      aliasesConsidered: [...entity.aliasesConsidered],
    })),
    intent: plan.intent,
    freshnessWindow: plan.freshnessWindow,
    retrievalWindows: plan.retrievalWindows ? [...plan.retrievalWindows] : undefined,
  };
}
