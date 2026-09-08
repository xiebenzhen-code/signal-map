import { planQuery } from "../research/query-planner.ts";
import type { ResearchInput } from "../research/types.ts";
import type { ResearchPlan, ResearchStrategy } from "./types.ts";
import type { SourceSelection } from "./source-selector.ts";
import type { IntentClassification, SourceProfile } from "../intent/types.ts";

function appendLines(existing: string, values: string[]) {
  return [existing, ...values].map((value) => value.trim()).filter(Boolean).join("\n");
}

export function createResearchPlan(
  input: ResearchInput,
  round: number,
  maxQueries: number,
  relatedKnowledge: string[] = [],
  strategy?: ResearchStrategy,
  sourceSelection?: SourceSelection,
  intent?: IntentClassification,
  sourceProfile?: SourceProfile,
): ResearchPlan {
  const planned = planQuery({
    ...input,
    knownInformation: appendLines(input.knownInformation, relatedKnowledge),
  });
  const base = planned.searchCombinations;
  const subject = [input.focusAreas, input.trackedEntities, input.currentQuestions].filter(Boolean).join(" ").trim();
  const strategyQueries: Record<Exclude<ResearchStrategy, "STOP">, string[]> = {
    INITIAL: [`${subject} recent changes`, `${subject} official documentation`, `${subject} release notes`],
    REFRESH: [`${subject} latest update`, `${subject} official announcement`, `${subject} recent release notes`],
    DEEPEN: [`${subject} technical details`, `${subject} primary document`, `${subject} implementation limitation`],
    BROADEN: [`${subject} independent coverage`, `${subject} alternate source`, `${subject} different perspective`],
    ESCALATE_SOURCE: [`${subject} official source`, `${subject} primary document`, `${subject} original announcement`],
    VERIFY_CONFLICT: [`${subject} conflicting claim`, `${subject} exact status official`, `${subject} authoritative source`],
  };
  const intentQueries: Partial<Record<IntentClassification["primaryIntent"], string[]>> = {
    JOB_SEARCH: [
      `${subject} open roles careers apply posted last ${input.freshnessWindow}`,
      `${subject} job board remote onsite skills`,
      `${subject} company careers application`,
    ],
    AIGC_OPPORTUNITY: [
      `${subject} product launch startup funding hiring open source creator adoption`,
      `${subject} commercial use case AIGC video new opportunity`,
      `${subject} independent signals funding GitHub jobs community`,
    ],
    PRODUCT_UPDATE: [
      `${subject} official changelog release notes latest`,
      `${subject} GitHub releases official announcement`,
      `${subject} product update documentation`,
    ],
    TECH_RESEARCH: [
      `${subject} primary documentation production limitations`,
      `${subject} technical specification benchmark GitHub issues`,
      `${subject} reproducibility implementation docs`,
    ],
    POLICY_REGULATION: [
      `${subject} government regulator primary document effective date scope jurisdiction`,
      `${subject} official policy regulation`,
      `${subject} legal text implementation date`,
    ],
  };
  const queries = (strategy && strategy !== "STOP"
    ? [...(intent ? intentQueries[intent.primaryIntent] ?? [] : []), ...strategyQueries[strategy], ...base]
    : base).filter((query, index, all) => query.trim() && all.indexOf(query) === index).slice(0, maxQueries);
  return {
    objective: round === 1 ? planned.originalNeed : `${planned.originalNeed} · 补充验证第 ${round} 轮`,
    queries,
    preferredSourceTypes: sourceProfile?.preferredSourceTypes ?? (round === 1
      ? ["primary", "trusted_media", "social"]
      : ["primary", "trusted_media"]),
    maxQueries,
    strategy,
    selectedSourceType: sourceSelection?.primarySourceType,
    fallbackSourceTypes: sourceSelection?.fallbackSourceTypes,
    allowedProviderIds: sourceSelection?.allowedProviderIds,
    sourceSelectionReason: sourceSelection?.reason,
  };
}
