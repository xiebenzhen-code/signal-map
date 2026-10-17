# Filter-scoped Knowledge State Design

## Goal

Give every Signal Map filter an independent knowledge state while keeping a reusable default identity that each filter may override. Switching filters must never mix known information, gaps, questions, judgements, tracked entities, tracked events, evidence history, or prior research results between filters.

This change does not alter the UI, scoring, research pipeline, provider integrations, or product navigation.

## Current problem

The application currently persists one global `KnowledgeState`, while `InformationFilter` also stores several of the same fields. `app/page.tsx` merges them differently when creating and switching filters:

- `identity`, `industry`, `focusAreas`, `knownInformation`, `informationGaps`, `currentQuestions`, and `freshnessWindow` exist in both concepts.
- Switching filters overwrites some fields from the target filter but carries other fields from the previously active knowledge state.
- Settings updates the global knowledge state without updating the matching filter snapshot.
- The persisted state therefore has no unambiguous source of truth and can leak knowledge across filters.

## Ownership model

### Personal profile

`PersonalProfile` owns the reusable default identity. A filter may override it without changing other filters.

```ts
type PersonalProfile = {
  defaultIdentity: string;
};
```

`defaultIdentity` is reused when a filter has no override. `industry` is not global because one person may create filters for unrelated industries.

### Filter definition

`InformationFilter` owns query configuration, not accumulated knowledge.

```ts
type InformationFilter = {
  id: string;
  filterName: string;
  identityOverride?: string;
  industry: string;
  focusAreas: string[];
  freshnessWindow: "24h" | "3d" | "7d" | "30d";
  sourceScope: "domestic" | "global" | "hybrid" | "custom";
  customSources: string[];
  sourceScope: "domestic" | "global" | "hybrid" | "custom";
  customSources?: string[];
  createdAt: string;
  updatedAt: string;
};
```

`sourceScope` controls discovery coverage, not trust. `domestic` searches domestic sources, `global` searches global sources, `hybrid` searches both, and `custom` uses `customSources`. Social sources remain eligible for discovery in every applicable scope.

Source purpose and evidence status are independent source/event fields:

```ts
type SourceRole = "discovery" | "verification";

type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "conflicting";

type EvidenceSource = {
  sourceUrl: string;
  publisher: string;
  publishedAt?: string;
  sourceRole: SourceRole;
  verificationStatus: VerificationStatus;
};
```

`sourceRole: "discovery"` may surface a lead but cannot by itself promote a claim to Fact. Verification remains evidence-driven.

### Filter knowledge

`FilterKnowledgeState` owns everything the user knows, questions, judges, or tracks within one filter.

```ts
type FilterKnowledgeState = {
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

type KnowledgeByFilterId = Record<string, FilterKnowledgeState>;
```

### Derived research context

Research receives a derived `ActiveKnowledgeContext`. It is composed on demand and is never persisted as an independent mutable object.

```ts
type ActiveKnowledgeContext = {
  identity: string;
  industry: string;
  focusAreas: string[];
  freshnessWindow: "24h" | "3d" | "7d" | "30d";
  knownInformation: string[];
  informationGaps: string[];
  currentQuestions: string[];
  userJudgements: string[];
  trackedEntities: string[];
  trackedEvents: string[];
  researchContextRevision: number;
};
```

Composition resolves identity as:

```ts
const identity = filter.identityOverride ?? profile.defaultIdentity;
```

Existing provider and pipeline interfaces may continue to call this composed value `KnowledgeState` during the incremental migration, but storage and page state must not treat it as a separate source of truth.

`evidenceHistory` remains filter-scoped persisted history, but it is not part of `ActiveKnowledgeContext`. The current pipeline only concatenates it with `knownInformation` to suppress rediscovery; because the application also writes evidence history automatically after feedback and research activity, treating it as research context would create a research → evidence write → revision change → immediately stale loop. Evidence affects research only after the user explicitly promotes it into `knownInformation`, `userJudgements`, a question, a gap, or tracking state.

## Single sources of truth

| Concept | Source of truth |
| --- | --- |
| Default identity | `PersonalProfile.defaultIdentity` |
| Filter-specific identity | `InformationFilter.identityOverride` |
| Filter name, industry, focus, freshness, discovery scope | `InformationFilter` |
| Known information, gaps, questions, judgements, tracking, history, research-context revision | `knowledgeByFilterId[filterId]` |
| Active selection | `activeFilterId` |
| Research input | Derived `ActiveKnowledgeContext` |
| Last result for one filter | `lastRunByFilterId[filterId]` |

No field may be writable from two of these stores.

## Persistence model

The IndexedDB database and object store remain unchanged. New logical keys are added to the existing key-value store:

```ts
type AlphaSnapshotV2 = {
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
```

Every newly persisted run records the research-context revision that generated it:

```ts
type InformationRun = {
  // existing fields remain unchanged
  filterId: string;
  generatedFromResearchContextRevision: number;
  dataMode: "live" | "demo" | "mixed";
  fallbackReason?: string;
};
```

`dataMode` is mandatory and honest. A failed Live run may fall back to Demo only when the returned run is marked `demo` or `mixed` and records a concrete `fallbackReason`. The fallback must never be represented as a complete Live result. Any persisted filter-scoped run with an older uppercase mode is normalized during hydration; the unscoped legacy `lastRun` is still excluded from migration.

The legacy `knowledge` and `lastRun` keys remain readable for recovery and are not deleted. New code stops writing them after migration.

## Migration from the global KnowledgeState

Migration is pure, deterministic, and idempotent.

1. If `knowledgeSchemaVersion === 2` and `knowledgeByFilterId` exists, return the V2 data unchanged.
2. Create `profile.defaultIdentity` from legacy `knowledge.identity`; fall back to the active filter's legacy identity and then an empty string.
3. For the active filter, merge the legacy global knowledge with the filter's legacy fields:
   - Arrays are unioned with stable deduplication.
   - Global `trackedEntities`, `trackedEvents`, `userJudgements`, and `evidenceHistory` are retained here because they belonged to the last active context.
4. For each inactive filter, initialize its knowledge from only that filter's legacy `knownInformation`, `informationGaps`, and `currentQuestions`.
5. Do not copy the active filter's tracking, judgement, or evidence history into inactive filters.
6. Set every migrated `FilterKnowledgeState` to `researchContextRevision: 1` and use the migration time for `updatedAt`.
7. Normalize each filter into the new query-only representation. A legacy filter identity becomes `identityOverride` only when it differs from `profile.defaultIdentity`.
8. Map legacy source scopes `official`, `verified`, and `all` to `hybrid`, and map legacy freshness `1d` to `24h`. Those old source values mixed trust policy with discovery coverage; verification gates continue to control Fact promotion.
9. Do not import legacy `lastRun` into `lastRunByFilterId`, because it has no trustworthy filter/revision provenance. Retain the legacy key for recovery and trigger a fresh calculation for the active filter.
10. Persist `profile`, `knowledgeByFilterId`, empty `lastRunByFilterId`, and `knowledgeSchemaVersion: 2` before normal application writes resume.
11. Leave the legacy `knowledge` and `lastRun` records untouched as recovery fallbacks.

If there is no active filter, retain the global legacy knowledge in a reserved recovery-only entry. It never participates in `ActiveKnowledgeContext` and is never automatically adopted by a later filter. A future Recovery UI may let the user assign it explicitly.

## Create, edit, and switch behavior

### Create filter

The existing onboarding draft remains a UI concern. Submission splits it into:

- reusable `profile.defaultIdentity` and an optional filter identity override;
- an `InformationFilter` query definition;
- a new `FilterKnowledgeState` stored under the new filter ID.

### Edit active filter

- Default identity edits update `profile.defaultIdentity`; filter-specific identity edits update only `identityOverride`.
- Industry, focus areas, freshness, and discovery scope edits update the active `InformationFilter`.
- Known information, gaps, questions, judgements, tracked entities, tracked events, and evidence history update only `knowledgeByFilterId[activeFilterId]`.
- `researchContextRevision` increments only when a user-controlled input can change the next research or filtering result: `knownInformation`, `informationGaps`, `currentQuestions`, `userJudgements`, `trackedEntities`, `trackedEvents`, `industry`, `focusAreas`, `freshnessWindow`, `sourceScope`, `customSources`, `identityOverride`, or the effective `defaultIdentity`.
- Changing `profile.defaultIdentity` increments `researchContextRevision` only for filters without an `identityOverride`; filters with an override are unaffected.
- System-generated `evidenceHistory`, `lastSeenAt`, research metadata, and run metadata do not increment `researchContextRevision`.
- Promoting evidence through an explicit user action into known information, a judgement, a question, a gap, an entity, or an event does increment `researchContextRevision` because the promoted value becomes research context.
- Hydration, read-only composition, navigation, sorting, and automatic evidence recording do not increment `researchContextRevision`.

### Switch filter

1. All edits already live in their owning in-memory state and are persisted by the existing persistence effects; switching performs no last-second copying.
2. Set `activeFilterId` to the target ID.
3. Read the target filter and its `FilterKnowledgeState`.
4. Initialize a missing entry only from that target filter's migrated/default data.
5. Compose `ActiveKnowledgeContext` from profile, target filter, and target knowledge, resolving identity from override then default.
6. Read only `lastRunByFilterId[targetId]`; never retain the previous filter's visible result.
7. If the target run is missing or stale, clear the visible result and recalculate Today with the composed context.
8. If it is current, show that filter's own cached result while an explicitly requested refresh runs.

The previous filter's knowledge is never an input to this composition.

## Stale-result detection

A result is current only when all of the following are true:

```ts
run.filterId === activeFilter.id &&
run.generatedFromResearchContextRevision === activeKnowledge.researchContextRevision
```

The flow is:

1. A qualifying research-context mutation increments only the affected filter's `researchContextRevision`.
2. The existing result immediately becomes stale because its recorded revision no longer matches.
3. A stale result is not rendered as current Today information.
4. The application triggers a new filter/research run with the new `ActiveKnowledgeContext`.
5. On success, save the result to `lastRunByFilterId[filterId]` with the exact revision used to generate it.
6. If a newer knowledge mutation occurs while the request is in flight, the returned older revision remains stale and cannot replace the current result.
7. Demo fallback results follow the same filter ID and revision rules and carry honest `dataMode` and `fallbackReason` metadata.

Filter query and effective identity changes increment the affected filter's `researchContextRevision` before recalculation. This revision represents only the complete effective research context, including user-promoted knowledge, filter configuration, and resolved identity; it intentionally excludes system-produced evidence and run bookkeeping. `InformationFilter.updatedAt` still records the filter-definition edit time but is not a competing validity source.

## Targeted extraction from app/page.tsx

UI components and render functions remain in `app/page.tsx`. Only domain and data-coordination logic that is independently testable is extracted:

- `information/knowledge-state.ts`
  - create empty filter knowledge;
  - compose active research context;
  - apply insight feedback to one filter knowledge state;
  - increment research context only for qualifying user-controlled changes.
- `lib/alpha-migration.ts`
  - migrate legacy knowledge into V2 state without importing the browser storage adapter;
  - normalize legacy source scopes and uppercase run modes;
  - remain pure and idempotent.
- `information/run-information.ts`
  - run the live source;
  - fall back to DemoProvider when live research fails while recording honest mode and reason metadata;
  - preserve a failure when both sources fail.

`app/page.tsx` remains responsible for UI composition, navigation, modal state, sorting, and invoking these operations.

## Type ownership corrections

- `PersonalProfile`, `InformationFilter`, `FilterKnowledgeState`, `KnowledgeByFilterId`, and the derived knowledge context belong to `information/types.ts`.
- `ResearchSignal`, `Claim`, `EvidenceSource`, `SourceRole`, verification types, and research response types remain in `research/types.ts`. `sourceRole` belongs to each `EvidenceSource`, not to the aggregate `Claim`.
- Provider payload and connection contracts remain in `social/providers/types.ts`.
- `AlphaSnapshotV2` and migration-only legacy persistence shapes remain in `lib/alpha-storage.ts`.
- `LibraryEntry` is a product/domain concept and moves out of the storage adapter into `information/types.ts`.
- UI-local navigation and presentation types may remain in `app/page.tsx`; core domain entities may not be defined there.

The existing `ResearchInput` string fields are a transport representation, not another knowledge-state source of truth.

## Tests

Implementation follows red-green-refactor. Add only high-value tests:

### Knowledge isolation and migration

- Updating one filter's known information does not change another filter.
- Every qualifying user research-context mutation increments exactly one `researchContextRevision` and updates its timestamp.
- Automatic evidence/history/run metadata writes do not increment `researchContextRevision`.
- Changing a filter query input increments only that filter's `researchContextRevision`.
- Changing the default identity increments only filters without an identity override.
- Switching filters composes research context only from the target filter.
- Feedback updates only the active filter knowledge.
- Legacy active-filter data is merged without loss.
- Legacy inactive filters do not receive active judgements or tracking.
- Migration is idempotent.
- Settings changes produce the context used by the next Today recalculation.
- A run generated from an older research-context revision is stale and cannot replace a newer result.
- A run from another filter is never displayed after switching.

### Provider and fallback safety

- A failing connected provider does not discard successful provider results.
- A provider status exception becomes `error` instead of rejecting the entire status request.
- `not_configured` and `unavailable` remain distinguishable.
- Live research failure falls back to Demo mode.
- Live-to-Demo fallback records lowercase `dataMode` and a concrete `fallbackReason`; it never claims complete Live coverage.
- If both live and Demo fail, the original failure is surfaced without fabricated information.

Existing freshness, evidence validation, Demo-versus-Live, and social verification tests remain unchanged and must continue passing.

## Dependency boundaries

Keep the current dependency-cruiser rules. Add at most one rule if the current paths support it without exceptions:

- `app/` may depend on the social access contract/barrel, but not directly on concrete provider or connection-adapter implementations.

Do not add more layer rules until type ownership is clearer in actual code.

## Agent workflow policy

Create `AGENTS.md` without replacing product principles. It will route:

- regressions to `systematic-debugging`;
- medium features to `brainstorming`, `writing-plans`, and Qodo rules when configured;
- non-trivial implementation to `test-driven-development`;
- signal research to `social-signal-research`;
- completion claims to `verification-before-completion`, `npm run quality`, and `npm run build`.

It will also require a lightweight Repo Context Review before multi-file edits.

Qodo Skills are installed but cannot fetch organization rules until the runtime provides `QODO_API_KEY` or a local Qodo configuration. Missing Qodo credentials must not block local tests or cause fabricated rules.

## Non-goals

- No UI component split or visual change.
- No scoring, freshness, ranking, or research-pipeline rewrite.
- No X or Xiaohongshu integration work.
- No cloud sync, authentication, or new product module.
- No broad type-system rewrite.
- No migration that deletes legacy local data.

## Acceptance criteria

- Every filter has an isolated knowledge state with an explicit `researchContextRevision`.
- Default identity remains reusable and each filter can override it.
- Switching filters cannot carry knowledge from the previous filter.
- Switching filters cannot display another filter's cached run.
- Existing local Alpha data migrates without losing the active user's knowledge.
- Migration can run repeatedly without changing already migrated data.
- Today recalculation consumes the newly composed active context.
- Today results are accepted only when filter ID and research-context revision both match.
- Provider failures do not break the whole Today pipeline.
- Knip and dependency-cruiser remain clean.
- `npm run quality` and `npm run build` pass before completion is reported.
