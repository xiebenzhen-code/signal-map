import type {
  ActiveKnowledgeContext,
  FilterKnowledgeState,
  FreshnessWindow,
  InformationFilter,
  KnowledgeByFilterId,
  PersonalProfile,
  SourceScope,
} from "./types.ts";

export const RECOVERY_ONLY_KNOWLEDGE_ID = "__legacy_unassigned__";

export function normalizeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createEmptyFilterKnowledge(now: string): FilterKnowledgeState {
  return {
    researchContextRevision: 1,
    updatedAt: now,
    currentQuestions: [],
    knownInformation: [],
    informationGaps: [],
    trackedEntities: [],
    trackedEvents: [],
    userJudgements: [],
    evidenceHistory: [],
  };
}

export function composeActiveKnowledgeContext(
  profile: PersonalProfile,
  filter: InformationFilter,
  knowledge: FilterKnowledgeState,
): ActiveKnowledgeContext {
  if (filter.id === RECOVERY_ONLY_KNOWLEDGE_ID) {
    throw new Error("Recovery-only legacy knowledge cannot become active research context");
  }
  return {
    identity: filter.identityOverride ?? profile.defaultIdentity,
    industry: filter.industry,
    focusAreas: normalizeStrings(filter.focusAreas),
    freshnessWindow: filter.freshnessWindow,
    sourceScope: filter.sourceScope,
    customSources: normalizeStrings(filter.customSources ?? []),
    currentQuestions: normalizeStrings(knowledge.currentQuestions),
    knownInformation: normalizeStrings(knowledge.knownInformation),
    informationGaps: normalizeStrings(knowledge.informationGaps),
    trackedEntities: normalizeStrings(knowledge.trackedEntities),
    trackedEvents: normalizeStrings(knowledge.trackedEvents),
    userJudgements: normalizeStrings(knowledge.userJudgements),
    researchContextRevision: knowledge.researchContextRevision,
  };
}

type ResearchKnowledgeKey =
  | "currentQuestions"
  | "knownInformation"
  | "informationGaps"
  | "trackedEntities"
  | "trackedEvents"
  | "userJudgements";

export type ResearchKnowledgePatch = Partial<Pick<FilterKnowledgeState, ResearchKnowledgeKey>>;

export function updateResearchContext(
  current: FilterKnowledgeState,
  patch: ResearchKnowledgePatch,
  now: string,
): FilterKnowledgeState {
  const normalized = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, normalizeStrings(value ?? [])]),
  ) as ResearchKnowledgePatch;
  const changed = (Object.keys(normalized) as ResearchKnowledgeKey[]).some(
    (key) => !arraysEqual(current[key], normalized[key] ?? []),
  );
  if (!changed) return current;
  return {
    ...current,
    ...normalized,
    researchContextRevision: current.researchContextRevision + 1,
    updatedAt: now,
  };
}

export function recordEvidence(current: FilterKnowledgeState, evidence: string, now: string) {
  const evidenceHistory = normalizeStrings([...current.evidenceHistory, evidence]);
  if (arraysEqual(evidenceHistory, current.evidenceHistory)) return current;
  return { ...current, evidenceHistory, updatedAt: now };
}

type FilterResearchPatch = Partial<{
  identityOverride: string | undefined;
  industry: string;
  focusAreas: string[];
  freshnessWindow: FreshnessWindow;
  sourceScope: SourceScope;
  customSources: string[];
}>;

function normalizedFilterPatch(patch: FilterResearchPatch): FilterResearchPatch {
  const result = { ...patch };
  if ("identityOverride" in result) result.identityOverride = result.identityOverride?.trim() || undefined;
  if (result.industry !== undefined) result.industry = result.industry.trim();
  if (result.focusAreas !== undefined) result.focusAreas = normalizeStrings(result.focusAreas);
  if (result.customSources !== undefined) result.customSources = normalizeStrings(result.customSources);
  return result;
}

function filterValueEqual(left: unknown, right: unknown) {
  return Array.isArray(left) && Array.isArray(right)
    ? arraysEqual(left as string[], right as string[])
    : left === right;
}

export function updateFilterResearchConfig(
  filter: InformationFilter,
  knowledge: FilterKnowledgeState,
  patch: FilterResearchPatch,
  now: string,
) {
  const normalized = normalizedFilterPatch(patch);
  const changed = (Object.keys(normalized) as Array<keyof FilterResearchPatch>).some(
    (key) => !filterValueEqual(filter[key], normalized[key]),
  );
  if (!changed) return { filter, knowledge };
  return {
    filter: { ...filter, ...normalized, updatedAt: now },
    knowledge: {
      ...knowledge,
      researchContextRevision: knowledge.researchContextRevision + 1,
      updatedAt: now,
    },
  };
}

export function applyDefaultIdentity(
  profile: PersonalProfile,
  filters: InformationFilter[],
  knowledgeByFilterId: KnowledgeByFilterId,
  defaultIdentity: string,
  now: string,
) {
  const normalized = defaultIdentity.trim();
  if (profile.defaultIdentity === normalized) return { profile, knowledgeByFilterId };
  return {
    profile: { defaultIdentity: normalized },
    knowledgeByFilterId: Object.fromEntries(
      Object.entries(knowledgeByFilterId).map(([id, knowledge]) => {
        const filter = filters.find((candidate) => candidate.id === id);
        if (!filter || filter.identityOverride || id === RECOVERY_ONLY_KNOWLEDGE_ID) return [id, knowledge];
        return [id, {
          ...knowledge,
          researchContextRevision: knowledge.researchContextRevision + 1,
          updatedAt: now,
        }];
      }),
    ),
  };
}
