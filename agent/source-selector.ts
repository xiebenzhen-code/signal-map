import type {
  ResearchStrategy,
  SourceCapability,
  SourceOutcome,
  SourceExecutionPlan,
  SourceSelectionType,
} from "./types.ts";
import type { ProfileSourceType, SourceProfile } from "../intent/types.ts";

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
  OFFICIAL: ["company-registry", "official-update-pages", "github-releases"],
  PRIMARY: ["primary-web-search", "reverse-primary", "arxiv"],
  GENERAL_WEB: ["public-web", "product-hunt", "hacker-news", "huggingface"],
  INDEPENDENT_MEDIA: ["trusted-media", "industry-media"],
  SOCIAL_SIGNAL: ["social-access", "reddit"],
};

const discoveryFirstSources: SourceSelectionType[] = ["GENERAL_WEB", "INDEPENDENT_MEDIA", "SOCIAL_SIGNAL", "PRIMARY"];
const verificationSources: SourceSelectionType[] = ["OFFICIAL", "PRIMARY"];

const profileSourceMap: Record<ProfileSourceType, SourceSelectionType[]> = {
  MEMORY: ["MEMORY"],
  OFFICIAL: ["OFFICIAL"],
  PRIMARY: ["PRIMARY"],
  GENERAL_WEB: ["GENERAL_WEB"],
  INDEPENDENT_MEDIA: ["INDEPENDENT_MEDIA"],
  SOCIAL_SIGNAL: ["SOCIAL_SIGNAL"],
  GITHUB: ["OFFICIAL"],
  COMPANY: ["OFFICIAL", "GENERAL_WEB"],
  COMPANY_CAREERS: ["GENERAL_WEB", "OFFICIAL"],
  JOB_BOARD: ["GENERAL_WEB", "INDEPENDENT_MEDIA"],
  COMMUNITY: ["SOCIAL_SIGNAL", "GENERAL_WEB"],
  STARTUP: ["INDEPENDENT_MEDIA", "GENERAL_WEB"],
  FUNDING: ["INDEPENDENT_MEDIA", "GENERAL_WEB"],
  JOB: ["GENERAL_WEB", "OFFICIAL"],
  CAREERS: ["GENERAL_WEB", "OFFICIAL"],
  MEDIA: ["INDEPENDENT_MEDIA"],
  INDUSTRY_MEDIA: ["INDEPENDENT_MEDIA"],
  CHANGELOG: ["OFFICIAL"],
  PRICING: ["OFFICIAL", "PRIMARY"],
  GOVERNMENT: ["PRIMARY", "OFFICIAL"],
  REGULATOR: ["PRIMARY", "OFFICIAL"],
  PRIMARY_DOCUMENT: ["PRIMARY"],
  OFFICIAL_DOCS: ["OFFICIAL", "PRIMARY"],
  PAPER: ["PRIMARY", "GENERAL_WEB"],
  CONFERENCE: ["PRIMARY", "GENERAL_WEB"],
  ARXIV: ["PRIMARY", "GENERAL_WEB"],
  PRODUCT_DIRECTORY: ["GENERAL_WEB", "INDEPENDENT_MEDIA"],
  COURSE: ["GENERAL_WEB", "OFFICIAL"],
  JOB_REQUIREMENTS: ["GENERAL_WEB"],
  PRACTICAL_CASES: ["INDEPENDENT_MEDIA", "GENERAL_WEB"],
  OFFICIAL_SPEC: ["OFFICIAL", "PRIMARY"],
  INDEPENDENT_REVIEW: ["INDEPENDENT_MEDIA", "GENERAL_WEB"],
  USER_FEEDBACK: ["SOCIAL_SIGNAL", "GENERAL_WEB"],
  SEARCH_TREND: ["GENERAL_WEB"],
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

function uniqueSourceTypes(types: SourceSelectionType[]) {
  return Array.from(new Set(types));
}

function uniqueProviderIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function hasResolvedEntities(input: { resolvedEntities?: Array<{ canonicalEntity?: string }> }) {
  return Boolean(input.resolvedEntities?.some((entity) => entity.canonicalEntity?.trim()));
}

function shouldStartWithDiscovery(input: {
  strategy: ResearchStrategy;
  sourceProfile?: SourceProfile;
  resolvedEntities?: Array<{ canonicalEntity?: string }>;
}) {
  if (input.strategy !== "INITIAL") return false;
  if (hasResolvedEntities(input)) return false;
  const preferred = input.sourceProfile?.preferredSourceTypes.flatMap((type) => profileSourceMap[type]) ?? [];
  return preferred[0] === "OFFICIAL";
}

function routeDiscoveryBeforeVerification(preferred: SourceSelectionType[]) {
  return uniqueSourceTypes([
    ...discoveryFirstSources.filter((type) => preferred.includes(type)),
    ...preferred.filter((type) => !discoveryFirstSources.includes(type) && !verificationSources.includes(type)),
    ...verificationSources.filter((type) => preferred.includes(type)),
  ]);
}

export function selectSource(input: {
  strategy: ResearchStrategy;
  availableSourceCapabilities?: SourceCapability[];
  previousSourceOutcomes?: SourceOutcome[];
  sourceProfile?: SourceProfile;
  resolvedEntities?: Array<{ canonicalEntity?: string; aliasesConsidered?: string[] }>;
}): SourceSelection {
  if (input.strategy === "STOP") {
    return { fallbackSourceTypes: [], allowedProviderIds: [], reason: "策略要求停止研究", sourceGap: false };
  }
  const capabilities = input.availableSourceCapabilities?.length
    ? input.availableSourceCapabilities
    : defaultCapabilities();
  const available = new Set(capabilities.filter((capability) => capability.available).map((capability) => capability.type));
  const profilePreferred = input.sourceProfile?.preferredSourceTypes.flatMap((type) => profileSourceMap[type]) ?? [];
  const basePreferred = uniqueSourceTypes([
    ...profilePreferred,
    ...strategySources[input.strategy],
    "GENERAL_WEB" as const,
  ]).filter((type) => input.strategy !== "VERIFY_CONFLICT" || (type !== "SOCIAL_SIGNAL" && type !== "MEMORY"));
  const discoveryMode = shouldStartWithDiscovery(input);
  const preferred = discoveryMode ? routeDiscoveryBeforeVerification(basePreferred) : basePreferred;
  const usable = preferred.filter((type) => available.has(type) && !hasLowValueOutcome(type, input.previousSourceOutcomes ?? []));
  const primarySourceType = usable[0];
  const availableVerificationSourceTypes = verificationSources.filter((type) => usable.includes(type));
  // Discovery-first must not DEFER first-hand verification providers to a later
  // fallback attempt: entity-less questions whose round-1 discovery consumes the
  // budget never reach that fallback (observed twice in production runs), so the
  // OFFICIAL/PRIMARY providers lose their executable chance entirely. Keep the
  // discovery provider set first, but include the verification providers in the
  // same attempt's allowed list — the pipeline's provider-level guards (entity
  // gates, canExecute, budget) still govern what actually runs, and no provider
  // starts unconditionally.
  const allowedProviderIds = primarySourceType
    ? discoveryMode && availableVerificationSourceTypes.length
      ? uniqueProviderIds([
          ...providerIds[primarySourceType],
          ...availableVerificationSourceTypes.flatMap((type) => providerIds[type]),
        ])
      : providerIds[primarySourceType]
    : [];
  return {
    primarySourceType,
    fallbackSourceTypes: primarySourceType ? usable.slice(1) : [],
    allowedProviderIds,

    reason: primarySourceType
      ? discoveryMode
        ? `${input.sourceProfile?.intent ?? "GENERAL_RESEARCH"} + ${input.strategy} 无明确实体，先使用 ${primarySourceType} 发现候选，再用 ${availableVerificationSourceTypes.join(" / ") || "OFFICIAL / PRIMARY"} 验证`
        : `${input.sourceProfile?.intent ?? "GENERAL_RESEARCH"} + ${input.strategy} 优先使用 ${primarySourceType}`
      : `${input.sourceProfile?.intent ?? input.strategy} 没有可用来源能力`,
    sourceGap: !primarySourceType,
    discoveryMode,
    verificationSourceTypes: availableVerificationSourceTypes,
  };
}

export { profileSourceMap, strategySources };
