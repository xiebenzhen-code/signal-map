---
name: social-signal-research
description: Discover and verify recent social signals for Signal Map when researching changes in a user's tracked entities, events, questions, or information gaps. Use social posts only as discovery leads, never as standalone facts.
---

# Social Signal Research

Use this workflow when Signal Map needs early evidence from public social or community sources. Do not use it to build a personal feed, infer preferences from engagement, or bypass a provider's supported access method.

## Start from the user's knowledge state

Read the active filter and use only the populated fields:

- `identity`
- `industry`
- `focusAreas`
- `trackedEntities`
- `trackedEvents`
- `currentQuestions`
- `knownInformation`
- `informationGaps`
- `freshnessWindow`
- `sourceScope`

Search for changes after what the user already knows. Prefer update-oriented terms such as `latest`, `today`, `update`, `release`, `announcement`, `changelog`, `new feature`, `new limitation`, `pricing`, `API`, `policy`, and `this week`. Search the configured freshness window first, then expand through 24h, 3d, 7d, and 30d only when needed.

## Evidence-first workflow

1. Plan focused queries from tracked entities, unresolved questions, and information gaps. Include aliases and English terms when they improve recall.
2. Search primary sources first: official blogs, documentation, release notes, official GitHub releases, research pages, filings, regulators, or company announcements.
3. Search trusted media when primary evidence is missing or independent confirmation is useful.
4. Use X, Xiaohongshu, Reddit, and other community sources only to discover early claims.
5. For every social lead, extract a concrete claim, then search for independent primary or trusted evidence.
6. Validate timestamps. Keep `publishedAt`, `eventOccurredAt`, `firstSeenAt`, `lastUpdatedAt`, and `retrievedAt` distinct. Never use retrieval time as publication time.
7. Deduplicate sources, cluster reports describing the same event, and preserve every original URL.
8. Compare the event with `knownInformation`. Repeated knowledge should lose novelty; evidence that answers an open question or fills a gap should gain relevance.
9. Classify the result as `MUST_READ`, `WORTH_WATCHING`, `LIBRARY_ONLY`, or `IGNORE`.

## Verification rules

- A social source without independent confirmation remains `SIGNAL` and `unverified` or `partially_verified`.
- Only evidence-backed claims may be labeled `FACT`.
- Conflicting credible sources must be marked `conflicting`; do not silently choose one.
- If reliable evidence cannot be found, return the lead with the specific verification failure. Do not invent missing facts or say a source was empty when it was not searched.
- Old background material may support understanding but must remain `BACKGROUND`; first discovery does not make it new.

Each claim must preserve:

- `claimText`
- `sourceUrl`
- `publisher`
- `publishedAt`
- `sourceType`
- `evidenceSnippet`
- `verificationStatus`

Each selected event must explain why it matters to this user's current knowledge state, not why it is broadly popular.

## Access and safety

Use existing provider abstractions. Credentials must come from the runtime environment. Never place tokens, cookies, sessions, browser profiles, or user credentials in source code, output, logs, fixtures, or this Skill. If a provider is unavailable or not configured, record that status and continue with available sources.

Do not publish, like, follow, comment, or otherwise mutate a social account unless the user separately and explicitly authorizes that action.
