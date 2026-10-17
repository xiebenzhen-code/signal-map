import { normalizeStrings, RECOVERY_ONLY_KNOWLEDGE_ID } from "../information/knowledge-state.ts";
import type {
  ExperienceFeedback,
  FeedbackRecord,
  FilterKnowledgeState,
  FreshnessWindow,
  InformationFilter,
  InformationRun,
  KnowledgeByFilterId,
  LibraryEntry,
  PersonalProfile,
  SourceScope,
} from "../information/types.ts";

export const ORPHANED_LEGACY_KNOWLEDGE_ID = RECOVERY_ONLY_KNOWLEDGE_ID;
export const KNOWLEDGE_SCHEMA_VERSION = 2 as const;

export type LegacyKnowledgeState = {
  identity: string;
  industry: string;
  focusAreas: string[];
  currentQuestions: string[];
  knownInformation: string[];
  informationGaps: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  userJudgements: string[];
  evidenceHistory: string[];
  freshnessWindow: string;
};

export type LegacyInformationFilter = {
  id: string;
  filterName: string;
  identity: string;
  industry: string;
  focusAreas: string[];
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  freshnessWindow: string;
  sourceScope: string;
  customSources?: string[];
  createdAt: string;
  updatedAt: string;
};

export type AlphaSnapshotV2 = {
  filters: InformationFilter[];
  activeFilterId: string | null;
  profile: PersonalProfile;
  knowledgeByFilterId: KnowledgeByFilterId;
  knowledgeSchemaVersion: 2;
  library: LibraryEntry[];
  notes: Record<string, string>;
  feedback: FeedbackRecord[];
  experienceFeedback: ExperienceFeedback[];
  sessionId: string | null;
  lastRunByFilterId: Record<string, InformationRun>;
};

type LegacyAlphaSnapshot = {
  filters: LegacyInformationFilter[];
  activeFilterId: string | null;
  knowledge: LegacyKnowledgeState | null;
  library: LibraryEntry[];
  notes: Record<string, string>;
  feedback: FeedbackRecord[];
  experienceFeedback: ExperienceFeedback[];
  sessionId: string | null;
  lastRun: unknown;
};

type LegacyOrV2Snapshot = LegacyAlphaSnapshot | AlphaSnapshotV2;

function normalizeScope(value?: string): SourceScope {
  return value === "domestic" || value === "global" || value === "custom" ? value : "hybrid";
}

function normalizeFreshness(value?: string): FreshnessWindow {
  if (value === "1d" || value === "24h") return "24h";
  if (value === "3d" || value === "30d" || value === "90d") return value;
  return "7d";
}

export function isNormalizedInformationFilter(value: unknown): value is InformationFilter {
  if (!value || typeof value !== "object") return false;
  const filter = value as Record<string, unknown>;
  return (
    typeof filter.id === "string" &&
    typeof filter.filterName === "string" &&
    typeof filter.industry === "string" &&
    Array.isArray(filter.focusAreas) &&
    ["24h", "3d", "7d", "30d", "90d"].includes(String(filter.freshnessWindow)) &&
    ["domestic", "global", "hybrid", "custom"].includes(String(filter.sourceScope)) &&
    !("identity" in filter) &&
    !("knownInformation" in filter) &&
    !("informationGaps" in filter) &&
    !("currentQuestions" in filter)
  );
}

function emptyKnowledge(now: string): FilterKnowledgeState {
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

function fromLegacyKnowledge(legacy: LegacyKnowledgeState, now: string): FilterKnowledgeState {
  return {
    ...emptyKnowledge(now),
    currentQuestions: normalizeStrings(legacy.currentQuestions),
    knownInformation: normalizeStrings(legacy.knownInformation),
    informationGaps: normalizeStrings(legacy.informationGaps),
    trackedEntities: normalizeStrings(legacy.trackedEntities),
    trackedEvents: normalizeStrings(legacy.trackedEvents),
    userJudgements: normalizeStrings(legacy.userJudgements),
    evidenceHistory: normalizeStrings(legacy.evidenceHistory),
  };
}

function mergeActive(filter: LegacyInformationFilter, legacy: LegacyKnowledgeState, now: string) {
  return {
    ...fromLegacyKnowledge(legacy, now),
    currentQuestions: normalizeStrings([...filter.currentQuestions, ...legacy.currentQuestions]),
    knownInformation: normalizeStrings([...filter.knownInformation, ...legacy.knownInformation]),
    informationGaps: normalizeStrings([...filter.informationGaps, ...legacy.informationGaps]),
  };
}

export function migrateAlphaSnapshot(input: LegacyOrV2Snapshot, now: string): AlphaSnapshotV2 {
  if ("knowledgeSchemaVersion" in input && input.knowledgeSchemaVersion === 2) return input;
  const legacyInput = input as LegacyAlphaSnapshot;
  const legacy = legacyInput.knowledge;
  const activeLegacyFilter = legacyInput.filters.find((filter) => filter.id === legacyInput.activeFilterId);
  const defaultIdentity = (legacy?.identity || activeLegacyFilter?.identity || "").trim();
  const filters = legacyInput.filters.map<InformationFilter>((filter) => {
    const identity = filter.identity.trim();
    return {
      id: filter.id,
      filterName: filter.filterName,
      ...(identity && identity !== defaultIdentity ? { identityOverride: identity } : {}),
      industry: filter.industry.trim(),
      focusAreas: normalizeStrings(filter.focusAreas),
      freshnessWindow: normalizeFreshness(filter.freshnessWindow),
      sourceScope: normalizeScope(filter.sourceScope),
      customSources: normalizeStrings(filter.customSources ?? []),
      createdAt: filter.createdAt,
      updatedAt: filter.updatedAt,
    };
  });
  const knowledgeByFilterId = Object.fromEntries(
    legacyInput.filters.map((filter) => {
      const own = {
        ...emptyKnowledge(now),
        currentQuestions: normalizeStrings(filter.currentQuestions),
        knownInformation: normalizeStrings(filter.knownInformation),
        informationGaps: normalizeStrings(filter.informationGaps),
      };
      return [
        filter.id,
        filter.id === legacyInput.activeFilterId && legacy ? mergeActive(filter, legacy, now) : own,
      ];
    }),
  );
  if (!legacyInput.activeFilterId && legacy) {
    knowledgeByFilterId[ORPHANED_LEGACY_KNOWLEDGE_ID] = fromLegacyKnowledge(legacy, now);
  }
  return {
    filters,
    activeFilterId: legacyInput.activeFilterId,
    profile: { defaultIdentity },
    knowledgeByFilterId,
    knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    library: legacyInput.library,
    notes: legacyInput.notes,
    feedback: legacyInput.feedback,
    experienceFeedback: legacyInput.experienceFeedback,
    sessionId: legacyInput.sessionId,
    lastRunByFilterId: {},
  };
}

export function migrationWriteEntries(snapshot: AlphaSnapshotV2) {
  return [
    ["filters", snapshot.filters],
    ["profile", snapshot.profile],
    ["knowledgeByFilterId", snapshot.knowledgeByFilterId],
    ["lastRunByFilterId", snapshot.lastRunByFilterId],
    ["knowledgeSchemaVersion", snapshot.knowledgeSchemaVersion],
  ] as const;
}
