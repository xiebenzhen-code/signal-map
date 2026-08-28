# Filter-scoped Knowledge State Design

## Goal

Give every Signal Map filter an independent knowledge state while keeping long-lived personal identity reusable. Switching filters must never mix known information, gaps, questions, judgements, tracked entities, tracked events, or evidence history between filters.

This change does not alter the UI, scoring, research pipeline, provider integrations, or product navigation.

## Current problem

The application currently persists one global `KnowledgeState`, while `InformationFilter` also stores several of the same fields. `app/page.tsx` merges them differently when creating and switching filters:

- `identity`, `industry`, `focusAreas`, `knownInformation`, `informationGaps`, `currentQuestions`, and `freshnessWindow` exist in both concepts.
- Switching filters overwrites some fields from the target filter but carries other fields from the previously active knowledge state.
- Settings updates the global knowledge state without updating the matching filter snapshot.
- The persisted state therefore has no unambiguous source of truth and can leak knowledge across filters.

## Ownership model

### Personal profile

`PersonalProfile` owns long-lived user information that is reusable across filters.

```ts
type PersonalProfile = {
  identity: string;
};
```

`identity` is global. `industry` is not global because one person may create filters for unrelated industries.

### Filter definition

`InformationFilter` owns query configuration, not accumulated knowledge.

```ts
type InformationFilter = {
  id: string;
  filterName: string;
  industry: string;
  focusAreas: string[];
  freshnessWindow: "1d" | "3d" | "7d" | "30d";
  sourceScope: "official" | "verified" | "all";
  createdAt: string;
  updatedAt: string;
};
```

### Filter knowledge

`FilterKnowledgeState` owns everything the user knows, questions, judges, or tracks within one filter.

```ts
type FilterKnowledgeState = {
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
type ActiveKnowledgeContext = PersonalProfile &
  Pick<InformationFilter, "industry" | "focusAreas" | "freshnessWindow"> &
  FilterKnowledgeState;
```

Existing provider and pipeline interfaces may continue to call this composed value `KnowledgeState` during the incremental migration, but storage and page state must not treat it as a separate source of truth.

## Single sources of truth

| Concept | Source of truth |
| --- | --- |
| Long-lived identity | `PersonalProfile` |
| Filter name, industry, focus, freshness, source scope | `InformationFilter` |
| Known information, gaps, questions, judgements, tracking, history | `knowledgeByFilterId[filterId]` |
| Active selection | `activeFilterId` |
| Research input | Derived `ActiveKnowledgeContext` |

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
  lastRun: InformationRun | null;
};
```

The legacy `knowledge` key remains readable for migration and is not deleted. New code stops writing it after migration.

## Migration from the global KnowledgeState

Migration is pure, deterministic, and idempotent.

1. If `knowledgeSchemaVersion === 2` and `knowledgeByFilterId` exists, return the V2 data unchanged.
2. Create `profile.identity` from legacy `knowledge.identity`; fall back to the active filter's legacy identity and then an empty string.
3. For the active filter, merge the legacy global knowledge with the filter's legacy fields:
   - Arrays are unioned with stable deduplication.
   - Global `trackedEntities`, `trackedEvents`, `userJudgements`, and `evidenceHistory` are retained here because they belonged to the last active context.
4. For each inactive filter, initialize its knowledge from only that filter's legacy `knownInformation`, `informationGaps`, and `currentQuestions`.
5. Do not copy the active filter's tracking, judgement, or evidence history into inactive filters.
6. Filters are normalized into the new query-only representation.
7. Persist `profile`, `knowledgeByFilterId`, and `knowledgeSchemaVersion: 2` before normal application writes resume.
8. Leave the legacy `knowledge` record untouched as a recovery fallback.

If there is no active filter, retain the global legacy knowledge in a reserved migration entry until a filter becomes active, rather than discarding it.

## Create, edit, and switch behavior

### Create filter

The existing onboarding draft remains a UI concern. Submission splits it into:

- reusable `profile.identity`;
- an `InformationFilter` query definition;
- a new `FilterKnowledgeState` stored under the new filter ID.

### Edit active filter

- Identity edits update `profile`.
- Industry, focus areas, freshness, and source scope edits update the active `InformationFilter`.
- Known information, gaps, questions, judgements, tracked entities, tracked events, and evidence history update only `knowledgeByFilterId[activeFilterId]`.

### Switch filter

1. All edits already live in their owning in-memory state and are persisted by the existing persistence effects; switching performs no last-second copying.
2. Set `activeFilterId` to the target ID.
3. Read the target filter and its `FilterKnowledgeState`.
4. Initialize a missing entry only from that target filter's migrated/default data.
5. Compose `ActiveKnowledgeContext` from profile, target filter, and target knowledge.
6. Clear the previous result and recalculate Today with the composed context.

The previous filter's knowledge is never an input to this composition.

## Targeted extraction from app/page.tsx

UI components and render functions remain in `app/page.tsx`. Only domain and data-coordination logic that is independently testable is extracted:

- `information/knowledge-state.ts`
  - create empty filter knowledge;
  - compose active research context;
  - apply insight feedback to one filter knowledge state;
  - migrate legacy knowledge into V2 state.
- `information/run-information.ts`
  - run the live source;
  - fall back to DemoProvider when live research fails;
  - preserve a failure when both sources fail.

`app/page.tsx` remains responsible for UI composition, navigation, modal state, sorting, and invoking these operations.

## Type ownership corrections

- `PersonalProfile`, `InformationFilter`, `FilterKnowledgeState`, `KnowledgeByFilterId`, and the derived knowledge context belong to `information/types.ts`.
- `ResearchSignal`, `Claim`, verification types, and research response types remain in `research/types.ts`.
- Provider payload and connection contracts remain in `social/providers/types.ts`.
- `AlphaSnapshotV2` and migration-only legacy persistence shapes remain in `lib/alpha-storage.ts`.
- `LibraryEntry` is a product/domain concept and moves out of the storage adapter into `information/types.ts`.
- UI-local navigation and presentation types may remain in `app/page.tsx`; core domain entities may not be defined there.

The existing `ResearchInput` string fields are a transport representation, not another knowledge-state source of truth.

## Tests

Implementation follows red-green-refactor. Add only high-value tests:

### Knowledge isolation and migration

- Updating one filter's known information does not change another filter.
- Switching filters composes research context only from the target filter.
- Feedback updates only the active filter knowledge.
- Legacy active-filter data is merged without loss.
- Legacy inactive filters do not receive active judgements or tracking.
- Migration is idempotent.
- Settings changes produce the context used by the next Today recalculation.

### Provider and fallback safety

- A failing connected provider does not discard successful provider results.
- A provider status exception becomes `error` instead of rejecting the entire status request.
- `not_configured` and `unavailable` remain distinguishable.
- Live research failure falls back to Demo mode.
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

- Every filter has an isolated knowledge state.
- Identity remains reusable across filters.
- Switching filters cannot carry knowledge from the previous filter.
- Existing local Alpha data migrates without losing the active user's knowledge.
- Migration can run repeatedly without changing already migrated data.
- Today recalculation consumes the newly composed active context.
- Provider failures do not break the whole Today pipeline.
- Knip and dependency-cruiser remain clean.
- `npm run quality` and `npm run build` pass before completion is reported.
