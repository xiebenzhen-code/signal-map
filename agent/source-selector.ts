import type {
  ResearchStrategy,
  SourceCapability,
  SourceOutcome,
  SourceExecutionPlan,
  SourceSelectionType,
} from "./types.ts";

export type SourceSelection = SourceExecutionPlan;

const strategySources: Record<Exclude<ResearchStrategy, "STOP">, SourceSelectionType[]> = {
  INITIAL: ["GENERAL_WEB", "OFFICIAL", "PRIMARY"],
  REFRESH: ["OFFICIAL", "PRIMARY", "GENERAL_WEB"],
  DEEPEN: ["PRIMARY", "OFFICIAL", "GENERAL_WEB"],
  BROADEN: ["INDEPENDENT_MEDIA", "GENERAL_WEB", "PRIMARY"],
  ESCALATE_SOURCE: ["OFFICIAL", "PRIMARY"],
  VERIFY_CONFLICT: ["PRIMARY", "OFFICIAL", "INDEPENDENT_MEDIA"],
};

const providerIds: Record<SourceSelectionType, string[]> = {
  MEMORY: [],
  OFFICIAL: ["official-update-pages", "github-releases"],
  PRIMARY: ["primary-web-search", "reverse-primary"],
  GENERAL_WEB: ["public-web"],
  INDEPENDENT_MEDIA: ["trusted-media", "industry-media"],
  SOCIAL_SIGNAL: ["social-access", "reddit"],
};

function defaultCapabilities(): SourceCapability[] {
  return (["MEMORY", "OFFICIAL", "PRIMARY", "GENERAL_WEB", "INDEPENDENT_MEDIA", "SOCIAL_SIGNAL"] as SourceSelectionType[])
    .map((type) => ({
      type,
      available: true,
      supportsFreshness: type !== "MEMORY",
      supportsPrimaryDocuments: type === "OFFICIAL" || type === "PRIMARY",
      supportsDomainFilter: type !== "MEMORY",
      supportsTimeFilter: type !== "MEMORY",
    }));
}

function hasLowValueOutcome(type: SourceSelectionType, outcomes: SourceOutcome[]) {
  const matching = outcomes.filter((outcome) => outcome.sourceType === type);
  return matching.length > 0 && matching.every((outcome) =>
    outcome.resultCount === 0 || (outcome.newEvidenceCount === 0 && outcome.newClaimCount === 0),
  );
}

export function selectSource(input: {
  strategy: ResearchStrategy;
  availableSourceCapabilities?: SourceCapability[];
  previousSourceOutcomes?: SourceOutcome[];
}): SourceSelection {
  if (input.strategy === "STOP") {
    return { fallbackSourceTypes: [], allowedProviderIds: [], reason: "策略要求停止研究", sourceGap: false };
  }
  const capabilities = input.availableSourceCapabilities?.length
    ? input.availableSourceCapabilities
    : defaultCapabilities();
  const available = new Set(capabilities.filter((capability) => capability.available).map((capability) => capability.type));
  const preferred = Array.from(new Set([...strategySources[input.strategy], "GENERAL_WEB" as const]));
  const usable = preferred.filter((type) => available.has(type) && !hasLowValueOutcome(type, input.previousSourceOutcomes ?? []));
  const primarySourceType = usable[0];
  return {
    primarySourceType,
    fallbackSourceTypes: primarySourceType ? usable.slice(1) : [],
    allowedProviderIds: primarySourceType
      ? providerIds[primarySourceType]
      : [],
    reason: primarySourceType
      ? `${input.strategy} 优先使用 ${primarySourceType}`
      : `${input.strategy} 没有可用来源能力`,
    sourceGap: !primarySourceType,
  };
}

export { strategySources };
