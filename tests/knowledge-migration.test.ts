import assert from "node:assert/strict";
import test from "node:test";
import {
  isNormalizedInformationFilter,
  migrateAlphaSnapshot,
  migrationWriteEntries,
  ORPHANED_LEGACY_KNOWLEDGE_ID,
} from "../lib/alpha-migration.ts";

const now = "2026-08-28T08:00:00.000Z";
const later = "2026-08-29T08:00:00.000Z";

function legacySnapshot(activeFilterId: string | null = "ai") {
  return {
    filters: [
      {
        id: "ai",
        filterName: "AI 产品",
        identity: "AI 产品经理",
        industry: "AI",
        focusAreas: ["Agent", " Agent ", ""],
        knownInformation: ["Codex 已发布"],
        informationGaps: ["定价变化"],
        currentQuestions: ["API 是否开放？"],
        freshnessWindow: "1d",
        sourceScope: "all",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "fashion",
        filterName: "时尚",
        identity: "时尚研究者",
        industry: "时尚",
        focusAreas: ["运动户外"],
        knownInformation: ["旧趋势"],
        informationGaps: [],
        currentQuestions: [],
        freshnessWindow: "3d",
        sourceScope: "verified",
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeFilterId,
    knowledge: {
      identity: "AI 产品经理",
      industry: "AI",
      focusAreas: ["Agent"],
      knownInformation: ["Codex 已发布", "MCP 已普及"],
      informationGaps: ["企业采用率"],
      currentQuestions: ["哪些能力有变化？"],
      trackedEntities: ["OpenAI"],
      trackedEvents: ["Codex 更新"],
      userJudgements: ["Agent 将进入工作流"],
      evidenceHistory: ["OpenAI Release Notes"],
      freshnessWindow: "7d",
    },
    library: [],
    notes: {},
    feedback: [],
    experienceFeedback: [],
    sessionId: "session",
    lastRun: { dataMode: "LIVE" },
  };
}

test("active legacy knowledge is merged without contaminating inactive filters", () => {
  const result = migrateAlphaSnapshot(legacySnapshot(), now);
  assert.deepEqual(result.knowledgeByFilterId.ai.knownInformation, ["Codex 已发布", "MCP 已普及"]);
  assert.deepEqual(result.knowledgeByFilterId.ai.trackedEntities, ["OpenAI"]);
  assert.deepEqual(result.knowledgeByFilterId.fashion.trackedEntities, []);
  assert.deepEqual(result.knowledgeByFilterId.fashion.userJudgements, []);
  assert.equal(result.knowledgeByFilterId.ai.researchContextRevision, 1);
});

test("normalizes filters and refuses an unscoped legacy run", () => {
  const result = migrateAlphaSnapshot(legacySnapshot(), now);
  assert.equal(result.profile.defaultIdentity, "AI 产品经理");
  assert.equal(result.filters[0].identityOverride, undefined);
  assert.equal(result.filters[1].identityOverride, "时尚研究者");
  assert.deepEqual(result.filters[0].focusAreas, ["Agent"]);
  assert.equal(result.filters[0].freshnessWindow, "24h");
  assert.equal(result.filters[0].sourceScope, "hybrid");
  assert.deepEqual(result.lastRunByFilterId, {});
});

test("migration is idempotent", () => {
  const once = migrateAlphaSnapshot(legacySnapshot(), now);
  assert.deepEqual(migrateAlphaSnapshot(once, later), once);
});

test("orphaned legacy knowledge remains recovery-only", () => {
  const result = migrateAlphaSnapshot(legacySnapshot(null), now);
  assert.deepEqual(result.knowledgeByFilterId[ORPHANED_LEGACY_KNOWLEDGE_ID].trackedEntities, ["OpenAI"]);
  assert.equal(result.activeFilterId, null);
  assert.equal(result.filters.some((filter) => filter.id === ORPHANED_LEGACY_KNOWLEDGE_ID), false);
});

test("migration persists normalized filters before committing schema version", () => {
  const migrated = migrateAlphaSnapshot(legacySnapshot(), now);
  assert.deepEqual(
    migrationWriteEntries(migrated).map(([key]) => key),
    ["filters", "profile", "knowledgeByFilterId", "lastRunByFilterId", "knowledgeSchemaVersion"],
  );
});

test("legacy filter shape cannot be accepted as completed V2 data", () => {
  const legacy = legacySnapshot().filters[0];
  const normalized = migrateAlphaSnapshot(legacySnapshot(), now).filters[0];
  assert.equal(isNormalizedInformationFilter(legacy), false);
  assert.equal(isNormalizedInformationFilter(normalized), true);
});

test("90-day saved filters remain V2 data after reload rather than entering legacy migration", () => {
  const snapshot = migrateAlphaSnapshot(legacySnapshot(), now);
  snapshot.filters[0].freshnessWindow = "90d";
  assert.equal(isNormalizedInformationFilter(snapshot.filters[0]), true);
  assert.equal(migrateAlphaSnapshot(snapshot, later).filters[0].freshnessWindow, "90d");
});
