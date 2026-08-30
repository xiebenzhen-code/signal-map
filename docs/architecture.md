# Signal Map Architecture

## Knowledge and runs

- `PersonalProfile` owns reusable `defaultIdentity`.
- `InformationFilter` owns research configuration and optional identity override.
- `knowledgeByFilterId` is the single source of truth for filter-scoped knowledge.
- `ActiveKnowledgeContext` contains only resolved research inputs.
- `researchContextRevision` changes only when user context affecting research changes.
- `lastRunByFilterId` stores a run with the filter ID and revision that produced it. A mismatch is stale and cannot render.

## Information flow

```text
ActiveKnowledgeContext → Query Planning → Discovery → Dedup → Event Clustering
→ Claim Extraction → Verification → Knowledge Comparison → Attention Decision
```

`information/run-information.ts` is the only owner of Live-to-Demo fallback. Every run records data mode and fallback reason.

`information/today-selection.ts` is a presentation-only selector. It never modifies ranking or `AttentionDecision`: it shows Must Read, otherwise Worth Watching, otherwise up to two eligible `LIBRARY_ONLY` fresh peripheral events, otherwise caught-up.

## Social access

```text
Product / Research → SocialAccessLayer → Provider → External API or connection adapter
```

Providers are isolated. Their connection state is separate from their per-run search outcome. `research/source-coverage.ts` is the single source of truth for public source coverage.

Zero-cost discovery currently combines Public Web search, official GitHub Releases, Reddit search, and optional local Xiaohongshu research. GitHub Releases are primary evidence; GitHub Issues/Discussions and other developer communities are discovery-only social sources. X remains optional when its server credential is not configured.

Business logic, data models, tests, and architecture rules remain in this repository. Skills may improve workflow but are not runtime dependencies.
