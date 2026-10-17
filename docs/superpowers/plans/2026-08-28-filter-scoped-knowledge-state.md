# Filter-scoped Knowledge State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every filter an isolated, revisioned knowledge state and filter-scoped research result without changing the product UI or Research Pipeline behavior.

**Architecture:** Persist reusable identity in `PersonalProfile`, query configuration in `InformationFilter`, and user knowledge in `knowledgeByFilterId`. Derive a minimal `ActiveKnowledgeContext` at run time, accept results only when filter ID and research-context revision still match, and wrap Live-to-Demo fallback with explicit provenance metadata.

**Tech Stack:** TypeScript 5.9, React 19, Vinext/Next 16, IndexedDB, Node.js test runner, ESLint, Knip, dependency-cruiser.

**Spec:** `docs/superpowers/specs/2026-08-28-filter-scoped-knowledge-state-design.md`

## Global Constraints

- Do not rewrite UI structure, scoring, freshness, ranking, the Research Pipeline, or provider integrations.
- `researchContextRevision` increments only for user-controlled inputs that can change the next research/filtering result.
- System-generated evidence history and run metadata must not increment `researchContextRevision`.
- `ActiveKnowledgeContext` exposes one resolved `identity`, `sourceScope`, and normalized `customSources`; it never exposes `defaultIdentity` or `evidenceHistory`.
- `sourceScope` is exactly `domestic | global | hybrid | custom`; trust remains represented by `sourceRole` and `verificationStatus`.
- Live-to-Demo fallback must never claim Live coverage and must record `dataMode` plus `fallbackReason`.
- Legacy IndexedDB records remain readable and are not deleted.
- Do not add packages, UI components, API integrations, or unrelated refactors.
- Every implementation task follows red-green-refactor and runs its focused tests before commit.
- Completion requires fresh `npm run quality` and `npm run build` output.

---

## File Structure

### New files

- `tests/knowledge-migration.test.ts` — legacy-to-V2 migration and idempotency regressions.
- `tests/knowledge-state.test.ts` — filter isolation, context composition, and revision semantics.
- `tests/information-run.test.ts` — stale-result and honest fallback regressions.
- `tests/social-access-layer.test.ts` — provider failure isolation regressions.
- `information/knowledge-state.ts` — pure filter knowledge/context mutation helpers.
- `information/run-information.ts` — Live, Demo fallback, and result-currency orchestration.
- `lib/alpha-migration.ts` — pure deterministic legacy persistence migration.
- `AGENTS.md` — repository-local engineering workflow policy.

### Modified files

- `information/types.ts`, `research/types.ts` — final ownership and run provenance types.
- `information/filter-engine.ts`, `research/research-pipeline.ts` — lowercase Demo/Live producer values only.
- `lib/alpha-storage.ts` — V2 reads, ordered migration writes, normalized filters, and filter-scoped persistence.
- `social/access/social-access-layer.ts`, `social/providers/index.ts` — injectable access class.
- `app/page.tsx` — replace global knowledge/run state with V2 owners and derived context.
- `package.json`, `.dependency-cruiser.cjs` — complete test list and one narrow import boundary.

---

### Task 1: Lock all regressions before implementation

**Files:**
- Create: `tests/knowledge-migration.test.ts`
- Create: `tests/knowledge-state.test.ts`
- Create: `tests/information-run.test.ts`
- Create: `tests/social-access-layer.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: current public types.
- Produces: executable specifications for every new pure helper and provider failure behavior.

- [ ] **Step 1: Expand the test command**

First run `rg --files tests | sort` and copy every existing test file into the script before adding new ones. The current repository has `tests/filter-engine.test.ts`; it already contains freshness, evidence validation, Demo-versus-Live, and social verification regressions. Use this explicit Windows-safe list so none of those tests leave `npm test`:

```json
"test": "node --experimental-strip-types --test --test-isolation=none tests/filter-engine.test.ts tests/knowledge-migration.test.ts tests/knowledge-state.test.ts tests/information-run.test.ts tests/social-access-layer.test.ts"
```

- [ ] **Step 2: Write migration regressions**

Create fixed legacy fixtures and these exact assertions in `tests/knowledge-migration.test.ts`:

```ts
test("active legacy knowledge is merged without contaminating inactive filters", () => {
  const result = migrateAlphaSnapshot(legacySnapshot, now);
  assert.deepEqual(result.knowledgeByFilterId.ai.knownInformation, ["Codex 已发布", "MCP 已普及"]);
  assert.deepEqual(result.knowledgeByFilterId.ai.trackedEntities, ["OpenAI"]);
  assert.deepEqual(result.knowledgeByFilterId.fashion.trackedEntities, []);
  assert.deepEqual(result.knowledgeByFilterId.fashion.userJudgements, []);
  assert.equal(result.knowledgeByFilterId.ai.researchContextRevision, 1);
});

test("identity and discovery scope migrate without trusting an unscoped old run", () => {
  const result = migrateAlphaSnapshot(legacySnapshot, now);
  assert.equal(result.profile.defaultIdentity, "AI 产品经理");
  assert.equal(result.filters[0].identityOverride, undefined);
  assert.equal(result.filters[1].identityOverride, "时尚研究者");
  assert.equal(result.filters[0].sourceScope, "hybrid");
  assert.deepEqual(result.lastRunByFilterId, {});
});

test("migration is idempotent", () => {
  const once = migrateAlphaSnapshot(legacySnapshot, now);
  assert.deepEqual(migrateAlphaSnapshot(once, later), once);
});
```

The fixture must include two filters, global tracking/judgement/evidence data, legacy scopes `all` and `verified`, and an uppercase `LIVE` legacy run.

- [ ] **Step 3: Write revision and ownership regressions**

Create `tests/knowledge-state.test.ts`:

```ts
test("research changes only the selected filter", () => {
  const ai = createEmptyFilterKnowledge(now);
  const fashion = createEmptyFilterKnowledge(now);
  const updated = updateResearchContext(ai, { knownInformation: ["Codex 已更新"] }, later);
  assert.equal(updated.researchContextRevision, 2);
  assert.equal(fashion.researchContextRevision, 1);
  assert.deepEqual(fashion.knownInformation, []);
});

test("automatic evidence does not invalidate research context", () => {
  const updated = recordEvidence(createEmptyFilterKnowledge(now), "OpenAI Release Notes", later);
  assert.equal(updated.researchContextRevision, 1);
  assert.deepEqual(updated.evidenceHistory, ["OpenAI Release Notes"]);
});

test("explicitly promoting evidence into known information increments once", () => {
  const recorded = recordEvidence(createEmptyFilterKnowledge(now), "OpenAI Release Notes", later);
  const promoted = updateResearchContext(recorded, { knownInformation: ["Codex 已更新"] }, later);
  assert.equal(recorded.researchContextRevision, 1);
  assert.equal(promoted.researchContextRevision, 2);
});

test("context exposes resolved identity but not profile or evidence fields", () => {
  const context = composeActiveKnowledgeContext(
    { defaultIdentity: "默认身份" },
    { ...filter, identityOverride: "研究身份" },
    createEmptyFilterKnowledge(now),
  );
  assert.equal(context.identity, "研究身份");
  assert.equal("defaultIdentity" in context, false);
  assert.equal("evidenceHistory" in context, false);
});

test("default identity invalidates only inheriting filters", () => {
  const result = applyDefaultIdentity(
    { defaultIdentity: "旧身份" },
    [filter, { ...filter, id: "design", identityOverride: "设计师" }],
    { ai: createEmptyFilterKnowledge(now), design: createEmptyFilterKnowledge(now) },
    "新身份",
    later,
  );
  assert.equal(result.knowledgeByFilterId.ai.researchContextRevision, 2);
  assert.equal(result.knowledgeByFilterId.design.researchContextRevision, 1);
});

test("each query input invalidates only the edited filter", () => {
  const patches = [
    { industry: "开发工具" },
    { focusAreas: ["Coding Agent"] },
    { freshnessWindow: "24h" as const },
    { sourceScope: "global" as const },
    { customSources: ["https://openai.com"] },
    { identityOverride: "开发者工具研究者" },
  ];
  for (const patch of patches) {
    const result = updateFilterResearchConfig(filter, createEmptyFilterKnowledge(now), patch, later);
    assert.equal(result.knowledge.researchContextRevision, 2);
  }
});

test("no-op query edit preserves references and revision", () => {
  const knowledge = createEmptyFilterKnowledge(now);
  const result = updateFilterResearchConfig(filter, knowledge, { industry: filter.industry }, later);
  assert.equal(result.filter, filter);
  assert.equal(result.knowledge, knowledge);
});
```

- [ ] **Step 4: Write stale-result and fallback regressions**

Create `tests/information-run.test.ts`:

```ts
test("run is current only for matching filter and revision", () => {
  assert.equal(isInformationRunCurrent(run(), "ai", 3), true);
  assert.equal(isInformationRunCurrent(run(), "fashion", 3), false);
  assert.equal(isInformationRunCurrent(run(), "ai", 4), false);
});

test("run selection never leaks another filter cache", () => {
  const runs = { ai: run(), fashion: run({ filterId: "fashion" }) };
  assert.equal(selectCurrentInformationRun(runs, "fashion", 3)?.filterId, "fashion");
  assert.equal(selectCurrentInformationRun(runs, "ai", 4), null);
});

test("Live failure falls back honestly", async () => {
  const result = await runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    runLive: async () => { throw new Error("Web provider unavailable"); },
    runDemo: async () => run({ dataMode: "demo" }),
  });
  assert.equal(result.dataMode, "demo");
  assert.equal(result.fallbackReason, "Web provider unavailable");
  assert.equal(result.filterId, "ai");
  assert.equal(result.generatedFromResearchContextRevision, 3);
});

test("an in-flight old revision fails completion validation", async () => {
  let currentRevision = 3;
  const pending = Promise.resolve(run());
  currentRevision = 4;
  assert.equal(isInformationRunCurrent(await pending, "ai", currentRevision), false);
});

test("both failures surface without fabricated information", async () => {
  await assert.rejects(runInformation({
    filterId: "ai",
    researchContextRevision: 3,
    runLive: async () => { throw new Error("Live failed"); },
    runDemo: async () => { throw new Error("Demo failed"); },
  }), /Live failed; Demo fallback failed: Demo failed/);
});
```

Use a complete `InformationRun` factory with empty signals/overview/coverage and lowercase `dataMode`.

- [ ] **Step 5: Write provider failure regressions**

Create `tests/social-access-layer.test.ts` with two local `SocialProvider` fakes:

```ts
test("one search failure preserves another provider result", async () => {
  const layer = new SocialAccessLayer([failingX, successfulXiaohongshu]);
  const result = await layer.search({ query: "Codex", industry: "AI" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source, "xiaohongshu");
});

test("status exception becomes error without rejecting other statuses", async () => {
  const layer = new SocialAccessLayer([statusFailingX, successfulXiaohongshu]);
  const statuses = await layer.getConnectionStatuses();
  assert.equal(statuses.find((item) => item.id === "x")?.state, "error");
  assert.equal(statuses.find((item) => item.id === "xiaohongshu")?.state, "connected");
});

test("not configured and unavailable remain distinct and are not searched", async () => {
  const layer = new SocialAccessLayer([notConfiguredX, unavailableXiaohongshu]);
  const result = await layer.search({ query: "Codex", industry: "AI" });
  assert.deepEqual(result.items, []);
  assert.equal(result.statuses.find((item) => item.id === "x")?.state, "not_configured");
  assert.equal(result.statuses.find((item) => item.id === "xiaohongshu")?.state, "unavailable");
  assert.equal(xSearchCalls, 0);
  assert.equal(xiaohongshuSearchCalls, 0);
});
```

Each fake is a complete `SocialProvider`; its status is fixed by the fixture and its `search` method increments the matching call counter before returning or throwing.

- [ ] **Step 6: Run every new file and observe red**

```bash
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/knowledge-migration.test.ts
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/knowledge-state.test.ts
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/information-run.test.ts
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/social-access-layer.test.ts
```

Expected: missing module/export failures. Do not write production code until these expected failures are recorded.

- [ ] **Step 7: Commit the red regression suite**

```bash
git add package.json tests/knowledge-migration.test.ts tests/knowledge-state.test.ts tests/information-run.test.ts tests/social-access-layer.test.ts
git commit -m "test: lock filter-scoped knowledge regressions"
```

---

### Task 2: Implement idempotent migration

**Files:**
- Modify: `information/types.ts`
- Create: `lib/alpha-migration.ts`
- Modify: `lib/alpha-storage.ts`
- Test: `tests/knowledge-migration.test.ts`

**Interfaces:**
- Consumes: legacy `knowledge`, filter-owned knowledge fields, and unscoped `lastRun`.
- Produces: `PersonalProfile`, `FilterKnowledgeState`, `KnowledgeByFilterId`, `AlphaSnapshotV2`, `migrateAlphaSnapshot(input, now)`.

- [ ] **Step 1: Define the final domain types**

Add to `information/types.ts`:

```ts
export type FreshnessWindow = "24h" | "3d" | "7d" | "30d";
export type SourceScope = "domestic" | "global" | "hybrid" | "custom";
export type DataMode = "live" | "demo" | "mixed";
export type PersonalProfile = { defaultIdentity: string };

export type FilterKnowledgeState = {
  researchContextRevision: number;
  updatedAt: string;
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  userJudgements: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  evidenceHistory: string[];
};

export type KnowledgeByFilterId = Record<string, FilterKnowledgeState>;
```

Make `InformationFilter` query-only with `identityOverride?`, `industry`, `focusAreas`, `freshnessWindow`, `sourceScope`, and `customSources?`. Split run typing so producers can return an unscoped payload and only the coordinator can create a cacheable run:

```ts
export type InformationRunPayload = {
  signals: ResearchSignal[];
  overview: ResearchOverview;
  coverage: ProviderCoverage;
  failures: string[];
  fetchedAt: string;
  dataMode: DataMode;
  lastCheckedAt?: string;
  fallbackReason?: string;
};

export type InformationRun = InformationRunPayload & {
  filterId: string;
  generatedFromResearchContextRevision: number;
};
```

Change `InformationProvider.run` to return `Promise<InformationRunPayload>`. This prevents Demo and Live producers from inventing cache identity; `runInformation` is the only place that stamps filter ID and revision.

- [ ] **Step 2: Implement the pure migration**

Create `lib/alpha-migration.ts` with:

```ts
export const KNOWLEDGE_SCHEMA_VERSION = 2 as const;
export const ORPHANED_LEGACY_KNOWLEDGE_ID = "__legacy_unassigned__";

const unique = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const normalizeScope = (value?: string): SourceScope =>
  value === "domestic" || value === "global" || value === "custom"
    ? value
    : "hybrid";

const normalizeFreshness = (value?: string): FreshnessWindow =>
  value === "1d" || value === "24h" ? "24h"
    : value === "3d" || value === "30d" ? value
    : "7d";

function fromLegacyKnowledge(legacy: LegacyKnowledgeState, now: string): FilterKnowledgeState {
  return {
    researchContextRevision: 1,
    updatedAt: now,
    knownInformation: unique(legacy.knownInformation ?? []),
    informationGaps: unique(legacy.informationGaps ?? []),
    currentQuestions: unique(legacy.currentQuestions ?? []),
    userJudgements: unique(legacy.userJudgements ?? []),
    trackedEntities: unique(legacy.trackedEntities ?? []),
    trackedEvents: unique(legacy.trackedEvents ?? []),
    evidenceHistory: unique(legacy.evidenceHistory ?? []),
  };
}

export function migrateAlphaSnapshot(input: LegacyOrV2Snapshot, now: string): AlphaSnapshotV2 {
  if (input.knowledgeSchemaVersion === 2 && input.knowledgeByFilterId) return input as AlphaSnapshotV2;
  const legacy = input.knowledge;
  const activeId = input.activeFilterId;
  const activeLegacyFilter = input.filters.find((filter) => filter.id === activeId);
  const defaultIdentity = legacy?.identity || activeLegacyFilter?.identity || "";
  const filters = input.filters.map((filter) => ({
    id: filter.id,
    filterName: filter.filterName,
    ...(filter.identity && filter.identity !== defaultIdentity
      ? { identityOverride: filter.identity }
      : {}),
    industry: filter.industry,
    focusAreas: unique(filter.focusAreas),
    freshnessWindow: normalizeFreshness(filter.freshnessWindow),
    sourceScope: normalizeScope(filter.sourceScope),
    customSources: filter.customSources,
    createdAt: filter.createdAt,
    updatedAt: filter.updatedAt,
  }));
  const knowledgeByFilterId = Object.fromEntries(input.filters.map((filter) => {
    const active = filter.id === activeId;
    return [filter.id, {
      researchContextRevision: 1,
      updatedAt: now,
      knownInformation: unique([...(filter.knownInformation ?? []), ...(active ? legacy?.knownInformation ?? [] : [])]),
      informationGaps: unique([...(filter.informationGaps ?? []), ...(active ? legacy?.informationGaps ?? [] : [])]),
      currentQuestions: unique([...(filter.currentQuestions ?? []), ...(active ? legacy?.currentQuestions ?? [] : [])]),
      userJudgements: active ? unique(legacy?.userJudgements ?? []) : [],
      trackedEntities: active ? unique(legacy?.trackedEntities ?? []) : [],
      trackedEvents: active ? unique(legacy?.trackedEvents ?? []) : [],
      evidenceHistory: active ? unique(legacy?.evidenceHistory ?? []) : [],
    }];
  }));
  if (!activeId && legacy) knowledgeByFilterId[ORPHANED_LEGACY_KNOWLEDGE_ID] = fromLegacyKnowledge(legacy, now);
  return {
    filters,
    activeFilterId: activeId,
    profile: { defaultIdentity },
    knowledgeByFilterId,
    knowledgeSchemaVersion: 2,
    library: input.library ?? [],
    notes: input.notes ?? {},
    feedback: input.feedback ?? [],
    experienceFeedback: input.experienceFeedback ?? [],
    sessionId: input.sessionId ?? null,
    lastRunByFilterId: {},
  };
}
```

Define `LegacyKnowledgeState`, `LegacyInformationFilter`, and `LegacyAlphaSnapshot` as exact structural copies of the current pre-V2 types at the top of `lib/alpha-migration.ts`; define `LegacyOrV2Snapshot = LegacyAlphaSnapshot | AlphaSnapshotV2`. `ORPHANED_LEGACY_KNOWLEDGE_ID` is recovery-only: context composition rejects that ID and no filter creation/switch path adopts it. Do not mutate `input`. Never import legacy `lastRun` because it has no trustworthy filter/revision provenance.

- [ ] **Step 3: Update storage without deleting recovery records**

Add V2 keys to `lib/alpha-storage.ts`:

```ts
profile: PersonalProfile;
knowledgeByFilterId: KnowledgeByFilterId;
knowledgeSchemaVersion: 2;
lastRunByFilterId: Record<string, InformationRun>;
```

Hydration reads V2 and legacy keys together. When V2 is absent, call `migrateAlphaSnapshot` and write one IndexedDB transaction in this order: normalized `filters`, `profile`, `knowledgeByFilterId`, `lastRunByFilterId`, then `knowledgeSchemaVersion`. Transaction completion is the migration commit point; `knowledgeSchemaVersion` must never be written by an earlier transaction. Leave `knowledge` and `lastRun` untouched.

- [ ] **Step 4: Run focused migration tests**

```bash
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/knowledge-migration.test.ts
```

Expected: PASS for merge, isolation, identity, scope normalization, run rejection, orphan recovery, and idempotency.

- [ ] **Step 5: Commit the migration slice**

```bash
git add information/types.ts lib/alpha-migration.ts lib/alpha-storage.ts tests/knowledge-migration.test.ts
git commit -m "feat: migrate knowledge state per filter"
```

---

### Task 3: Establish state ownership and revision semantics

**Files:**
- Create: `information/knowledge-state.ts`
- Test: `tests/knowledge-state.test.ts`

**Interfaces:**
- Consumes: Task 2 domain types.
- Produces: `createEmptyFilterKnowledge`, `composeActiveKnowledgeContext`, `updateResearchContext`, `recordEvidence`, `updateFilterResearchConfig`, and `applyDefaultIdentity`.

- [ ] **Step 1: Implement explicit minimal context composition**

```ts
export function composeActiveKnowledgeContext(
  profile: PersonalProfile,
  filter: InformationFilter,
  knowledge: FilterKnowledgeState,
): ActiveKnowledgeContext {
  return {
    identity: filter.identityOverride ?? profile.defaultIdentity,
    industry: filter.industry,
    focusAreas: filter.focusAreas,
    freshnessWindow: filter.freshnessWindow,
    sourceScope: filter.sourceScope,
    customSources: normalizeStrings(filter.customSources ?? []),
    knownInformation: knowledge.knownInformation,
    informationGaps: knowledge.informationGaps,
    currentQuestions: knowledge.currentQuestions,
    userJudgements: knowledge.userJudgements,
    trackedEntities: knowledge.trackedEntities,
    trackedEvents: knowledge.trackedEvents,
    researchContextRevision: knowledge.researchContextRevision,
  };
}
```

Construct each property explicitly; do not spread profile/filter/knowledge.

- [ ] **Step 2: Implement qualifying knowledge mutations**

```ts
export function updateResearchContext(
  current: FilterKnowledgeState,
  patch: ResearchKnowledgePatch,
  now: string,
): FilterKnowledgeState {
  if (!researchPatchChanged(current, patch)) return current;
  return {
    ...current,
    ...patch,
    researchContextRevision: current.researchContextRevision + 1,
    updatedAt: now,
  };
}

export function recordEvidence(current: FilterKnowledgeState, evidence: string, now: string) {
  const evidenceHistory = unique([...current.evidenceHistory, evidence]);
  if (arraysEqual(evidenceHistory, current.evidenceHistory)) return current;
  return { ...current, evidenceHistory, updatedAt: now };
}
```

`ResearchKnowledgePatch` contains only known information, gaps, questions, judgements, tracked entities, and tracked events. Normalize every array by trimming, removing empty values, and stable-deduplicating before equality comparison. Evidence history is deliberately absent.

- [ ] **Step 3: Implement filter/default-identity invalidation**

Implement `updateFilterResearchConfig` with a `FilterResearchPatch` limited to `industry`, `focusAreas`, `freshnessWindow`, `sourceScope`, `customSources`, and `identityOverride`. Normalize arrays before comparison and normalize an empty/whitespace `identityOverride` to `undefined`; one or more changed fields calls `bumpResearchContext` exactly once. Implement `applyDefaultIdentity` by mapping `knowledgeByFilterId` and calling `bumpResearchContext` only when the matching filter has no `identityOverride`. No-op edits return the original objects.

- [ ] **Step 4: Run focused state tests**

```bash
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/knowledge-state.test.ts
```

Expected: PASS, including evidence-only no-bump and effective-identity behavior.

- [ ] **Step 5: Commit the ownership slice**

```bash
git add information/knowledge-state.ts tests/knowledge-state.test.ts
git commit -m "feat: isolate filter research context"
```

---

### Task 4: Protect stale results and fallback honesty

**Files:**
- Create: `information/run-information.ts`
- Modify: `research/types.ts`
- Modify: `research/research-pipeline.ts`
- Modify: `information/filter-engine.ts`
- Modify: `social/access/social-access-layer.ts`
- Modify: `social/providers/index.ts`
- Modify: `tests/filter-engine.test.ts`
- Test: `tests/information-run.test.ts`
- Test: `tests/social-access-layer.test.ts`

**Interfaces:**
- Consumes: Task 2 `InformationRun`.
- Produces: `isInformationRunCurrent`, `selectCurrentInformationRun`, `runInformation`, injectable `SocialAccessLayer`, lowercase provenance, and explicit source roles.

- [ ] **Step 1: Implement run currency and fallback**

```ts
export function isInformationRunCurrent(
  run: InformationRun | null,
  filterId: string,
  researchContextRevision: number,
) {
  return Boolean(run && run.filterId === filterId &&
    run.generatedFromResearchContextRevision === researchContextRevision);
}

export function selectCurrentInformationRun(
  runs: Record<string, InformationRun>,
  filterId: string,
  researchContextRevision: number,
) {
  const run = runs[filterId] ?? null;
  return isInformationRunCurrent(run, filterId, researchContextRevision) ? run : null;
}

export async function runInformation(options: RunInformationOptions): Promise<InformationRun> {
  try {
    return stamp(await options.runLive(), options);
  } catch (liveError) {
    try {
      return {
        ...stamp(await options.runDemo(), options),
        dataMode: "demo",
        fallbackReason: errorMessage(liveError),
      };
    } catch (demoError) {
      throw new Error(`${errorMessage(liveError)}; Demo fallback failed: ${errorMessage(demoError)}`);
    }
  }
}
```

`stamp` must overwrite `filterId` and `generatedFromResearchContextRevision` with the exact request inputs.

Define `RunInformationOptions.runLive` and `.runDemo` as `() => Promise<InformationRunPayload>`. Define `stamp(payload, options)` as `{ ...payload, filterId: options.filterId, generatedFromResearchContextRevision: options.researchContextRevision }`.

- [ ] **Step 2: Normalize producer modes only**

Change Demo output to `dataMode: "demo"`, Live Research output to `dataMode: "live"`, and all related unions/tests to lowercase. Do not modify scoring, freshness, extraction, or verification logic.

Keep `Claim` free of a single `sourceRole`. Add `EvidenceSource` with `sourceRole: "discovery" | "verification"`, and make `Claim.evidenceSources: EvidenceSource[]`. One Claim may carry both discovery and verification evidence. Populate the array from existing source records without changing current verification scoring or promotion gates.

Replace the old trust-based Demo source gate. For this migration, `domestic`, `global`, and `hybrid` retain eligible Demo sources; `custom` retains only URLs under `customSources`. Geographic provider behavior is explicitly outside this plan.

- [ ] **Step 3: Export the access class**

Change `class SocialAccessLayer` to `export class SocialAccessLayer`. Keep the existing singleton and existing `Promise.allSettled` behavior.

Search `app/page.tsx`, `information/`, `research/`, and providers for fallback before integration. Remove the page-owned nested `catch → demoProvider.run` path. `information/run-information.ts` is the only owner of Live failure → Demo fallback; `filter-engine`, `research-pipeline`, and providers return their own mode and never invoke another provider.

- [ ] **Step 4: Run focused tests**

```bash
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/information-run.test.ts
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/social-access-layer.test.ts
npm exec -- node --experimental-strip-types --test --test-isolation=none tests/filter-engine.test.ts
```

Expected: PASS. Successful provider results survive peer failure; fallback carries a reason and never claims Live.

- [ ] **Step 5: Commit stale/fallback protection**

```bash
git add information/run-information.ts information/filter-engine.ts research/types.ts research/research-pipeline.ts social/access/social-access-layer.ts social/providers/index.ts tests/information-run.test.ts tests/social-access-layer.test.ts tests/filter-engine.test.ts
git commit -m "feat: protect run provenance and provider failures"
```

---

### Task 5: Connect V2 ownership back to `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`
- Modify: `lib/alpha-storage.ts`
- Test: all files from Tasks 1–4

**Interfaces:**
- Consumes: migration, context, mutation, run, and currency helpers.
- Produces: filter-scoped hydration, switching, persistence, feedback, Settings edits, and request-completion validation.

- [ ] **Step 1: Replace global writable owners**

Use:

```ts
const [profile, setProfile] = useState<PersonalProfile>({ defaultIdentity: "" });
const [knowledgeByFilterId, setKnowledgeByFilterId] = useState<KnowledgeByFilterId>({});
const [lastRunByFilterId, setLastRunByFilterId] = useState<Record<string, InformationRun>>({});
```

Derive `activeFilter`, `activeKnowledge`, and `activeContext`. Derive `response` from `lastRunByFilterId[activeFilterId]`; do not retain writable global `knowledge` or `response` state.

- [ ] **Step 2: Hydrate and persist only V2 owners**

Hydration sets normalized `filters`, `profile`, `knowledgeByFilterId`, and `lastRunByFilterId`. Normal persistence writes only:

```ts
setAlphaValue("profile", profile);
setAlphaValue("knowledgeByFilterId", knowledgeByFilterId);
setAlphaValue("lastRunByFilterId", lastRunByFilterId);
```

Stop current writes to legacy `knowledge`/`lastRun`, but do not delete those records.

- [ ] **Step 3: Make filter creation and switching isolated**

Creation inserts one query-only filter and one new `FilterKnowledgeState` under its ID. Switching performs `setActiveFilterId(targetId)` only; it never copies arrays from the prior filter. Initialize a missing target entry from that target alone before activation.

- [ ] **Step 4: Route mutations through the domain helpers**

Settings edits and explicit feedback use `updateResearchContext`. Automatic history uses `recordEvidence`. Filter configuration uses `updateFilterResearchConfig`. Default identity uses `applyDefaultIdentity`. Every array is normalized before revision comparison; empty identity overrides become `undefined`. Only explicit promotion of Evidence into Known Information/Judgement/Question/Gap/Tracking increments revision.

- [ ] **Step 5: Keep evidence history outside Research Context**

Build request parameters from `activeContext`. If the existing route still requires `evidenceHistory`, send an empty string for backward compatibility; do not add it to the context. `knownInformation` is the approved novelty input.

- [ ] **Step 6: Validate both request start and completion**

Capture `{ filterId, researchContextRevision }` before awaiting. Keep a ref with the current pair. After `await runInformation`, validate again. No AbortController is added in this phase; the isolated coordinator leaves cancellation as a future optimization:

```ts
if (!isInformationRunCurrent(
  result,
  currentResearchContextRef.current.filterId,
  currentResearchContextRef.current.researchContextRevision,
)) return;

setLastRunByFilterId((current) => ({ ...current, [result.filterId]: result }));
```

Do not write stale completion results to React state or IndexedDB.

- [ ] **Step 7: Hide stale cached results without adding UI**

```ts
const response = activeContext && activeFilterId && isInformationRunCurrent(
  lastRunByFilterId[activeFilterId] ?? null,
  activeFilterId,
  activeContext.researchContextRevision,
) ? lastRunByFilterId[activeFilterId] : null;
```

Keep the existing loading/empty presentation. Do not add a stale panel or badge.

- [ ] **Step 8: Update source-scope values without redesigning the form**

Use `hybrid`, `domestic`, `global`, and `custom` option values and Chinese labels in the existing select. Preserve markup structure and CSS.

- [ ] **Step 9: Run the integrated checks**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all PASS. Verify there are no disabled hook rules or new `any` casts.

- [ ] **Step 10: Commit page integration**

```bash
git add app/page.tsx lib/alpha-storage.ts
git commit -m "feat: connect filter-scoped knowledge state"
```

---

### Task 6: Add workflow guardrails and finish verification

**Files:**
- Create: `AGENTS.md`
- Modify: `.dependency-cruiser.cjs`

**Interfaces:**
- Consumes: existing project skills and quality scripts.
- Produces: repository-local workflow policy and one enforceable import boundary.

- [ ] **Step 1: Create the minimal project policy**

```md
# Signal Map Engineering Workflow

Before multi-file changes, review `package.json`, affected types, existing tests, and `git status`.

- Regressions: use `systematic-debugging` before proposing a fix.
- Medium or larger changes: confirm design, then use `writing-plans`.
- Non-trivial implementation: use `test-driven-development`; observe red before production code.
- Social signal research: follow `social-signal-research` and preserve provenance.
- Qodo rules: use only when configured; never fabricate unavailable organization rules.
- Completion: use `verification-before-completion`, then run `npm run quality` and `npm run build`.
- Preserve unrelated working-tree changes and avoid UI/pipeline rewrites unless explicitly requested.
```

- [ ] **Step 2: Add one dependency boundary**

```js
{
  name: "no-app-to-social-implementations",
  severity: "error",
  comment: "UI imports the social access contract, not concrete providers or adapters.",
  from: { path: "^app/" },
  to: { path: "^social/(providers/(x|xiaohongshu)|connections)/" },
},
```

Do not add exceptions. Redirect any current violation through the access layer/barrel without changing behavior.

- [ ] **Step 3: Run the complete quality gate**

```bash
npm run quality
```

Expected: typecheck, lint, tests, Knip, and dependency-cruiser all exit 0.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: exit 0 with normal Vinext production output.

- [ ] **Step 5: Inspect the final change set**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors and no unrelated rewrites.

- [ ] **Step 6: Scan for credentials**

```bash
rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!package-lock.json' '(Bearer\s+[A-Za-z0-9._-]{20,}|X_BEARER_TOKEN\s*=\s*\S+|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+)' .
```

Expected: no real credential values. A match is acceptable only when the file is `.env.example` and the value is empty or exactly `replace_me`.

- [ ] **Step 7: Commit guardrails**

```bash
git add AGENTS.md .dependency-cruiser.cjs
git commit -m "chore: enforce Signal Map implementation workflow"
```

---

## Execution Checkpoints

1. Task 1: intended regressions are red for the expected missing behavior.
2. Task 2: migration tests are green; active data is preserved and inactive filters stay clean.
3. Task 3: state tests are green; evidence-only writes do not bump revision.
4. Task 4: stale/fallback/provider tests are green; run provenance is honest.
5. Task 5: all tests, typecheck, and lint are green with V2 state wired to the existing page.
6. Task 6: `npm run quality` and `npm run build` pass from fresh invocations.

## Completion Report

Report verified migration behavior, single sources of truth, revision triggers/non-triggers, filter switching, stale completion protection, fallback provenance, provider isolation, final quality/build status, and any remaining browser-only IndexedDB migration risk.
