# Signal Map Project Report

Status date: 2026-09-22. This report records only behavior confirmed in code, tests, or prior calibration traces. It is not a product pitch that upgrades local fixtures into real-world closure.

Attribution:

- **Product / Architecture Decision — User**: product goal, evidence-over-volume principle, social-as-discovery, primary/official verification, freshness windows, and the calibration rule that a correct rejection must not be loosened to raise pass rate.
- **Implementation / Verification — AI-assisted**: code, tests, traces, and this report were produced with AI assistance under those decisions. This report does not claim the user hand-wrote every file.

## 1. Project Overview

Signal Map is a personal intelligence system, not a search box, a generic RAG demo, or a feed reader. The intended loop is:

```text
Research → Understand → Remember → Compare → Judge → Act → Learn
```

The product question is not “return the most documents.” It is “what changed, is it supported, and does it change what this user already knows enough to deserve attention?”

## 2. Product Problem

The user problem is overload plus weak provenance: repeated news, stale pages, mixed source authority, model hallucination risk, and no durable memory across research runs. Aggregating more links makes that worse. The target output is a small set of changes that are fresh, claim-supported, verified to the current contract, and new relative to stored knowledge.

## 3. Core Product Principles

User-set principles in force:

- The model is not a fact source. A claim must be supported by fetched content.
- Social and community posts are discovery leads. They are not standalone verification.
- Primary, official, or independent corroboration is required before reliability rises.
- Freshness, content validity, and source role are separate gates.
- A correct rejection is a successful outcome when the contract says the item should fail.
- Attention is later than evidence. Volume is not the success metric.

## 4. System Architecture

Current chain, with status as of this report:

```text
User Goal
→ Intent / Planning                         LOCAL / tests exist
→ Source Selection                          LOCAL / tests exist
→ Discovery                                 LOCAL; real coverage still environment-sensitive
→ Retrieval                                 LOCAL
→ Canonical Resolution                      LOCKED (formal)
→ Detail Fetch / Content Extraction         LOCKED (formal)
→ Claim Construction                        LOCKED (formal)
→ Evidence Evaluation / Entry               FORMAL REGRESSION LOCKED / REAL E2E PENDING
→ Reliability / Verification                FORMAL FIXTURE LOCKED / REAL E2E PENDING
→ Knowledge Comparison                      ENTRY + DUPLICATE formal fixture PASS
→ Attention                                 implemented, not this calibration target
→ Knowledge Update                          wired in runAgent; duplicate writes are blocked
→ Scheduler / Proactive                     present in tests; not closed here
```

`REAL E2E PENDING` means a live internet run has not yet produced a candidate that enters Evidence under the locked contracts. Fixture pass is not real-world closure.

## 5. Research Planning

`createResearchPlan` turns the user question and intent into the queries the pipeline actually runs. The calibration constraint is that identity, known information, and internal scaffolding must not become search entities or queries. Earlier failures came from substring intent rules (for example treating “工作” inside “工作流” as job search) and from leaking profile text into retrieval.

## 6. Discovery and Source Selection

When there is no explicit entity, the system uses broad discovery (community, directories, general web) and only later asks primary or official sources to verify. Hacker News is a discovery source (`sourceRole: discovery`, social tier). Its canonical target page is the page being fetched; it is not a second independent publisher.

## 7. Canonical Resolution and Detail Fetch

**Canonical Detail Fetch = LOCKED** at the formal-fixture level.

The resolver picks a canonical URL, detail enrichment fetches that page, and content extraction decides whether the body is usable. Budget reservation (`POST_PROCESSING_RESERVE_MS`) keeps extraction and claim work from being starved by slow upstreams.

A bounded parallel enrichment experiment failed: `Promise.allSettled` still waited on a hanging GitHub fetch and tripped the worker deadline. That change was reverted. GitHub timeouts observed in the live environment were classified as **ENVIRONMENTAL**, not a product bug, and were not “fixed” by raising the global deadline.

## 8. Claim Construction

Contract: a claim is a body-supported event fact. A discovery title alone is not claim evidence.

- Mosaic (real trace): canonical body had no launch or update fact → `NO_SUPPORTED_CLAIM` → **CORRECT_REJECTION**.
- Palmier Pro fixture: canonical body contains “launches …” → claim **VALID**.

`FIRST LOSS POINT` is the layer where the item stops. `FIRST FAILED OPERATION` is none when the stop matches the contract, and names one broken operation only when the implementation violates the contract.

## 9. Evidence Entry

Formal regression: `tests/evidence-entry.test.ts`.

```text
fresh + canonical content VALID + claim VALID
→ EvidenceRecord constructed
→ Evidence Evaluation reached
```

Status: **FORMAL REGRESSION LOCKED / REAL E2E PENDING**. The same fixture is then rejected later by Reliability, which is expected for a single unverified social discovery.

## 10. Reliability and Verification

Implementation lives in `research/research-pipeline.ts` (`verification`, cluster `verificationStatus`, `reliabilityScore`) and the rejection map in `research/filtering-summary.ts`.

Negative (`tests/evidence-entry.test.ts`):

```text
single HN social/discovery
→ no independent primary
→ verificationStatus = unverified
→ reliabilityScore = 30
→ LOW_RELIABILITY
→ CORRECT_REJECTION
```

Positive (`tests/reliability-positive.test.ts`, commit `ca105bb`):

```text
HN social + independent arXiv primary, related() true
→ verificationStatus = verified
→ independentEvidenceCount = 2
→ reliabilityScore = 94
→ lowReliability = 0
→ insufficientVerification = 0
```

The canonical first-party page of a social hit is the discovery target, not independent corroboration. Rejecting a single unverified source is the current product contract, not an implementation bug. Thresholds were not changed.

Status: **Reliability = FORMAL FIXTURE LOCKED / REAL E2E PENDING**. **Verification = FORMAL FIXTURE LOCKED / REAL E2E PENDING**. Neither is real-E2E closed.

## 11. Knowledge Comparison

State: **A — wired into the agent pipeline, with formal regression for entry and duplicate.**

Call chain in `agent/runner.ts`:

```text
listPersonalKnowledge (RETRIEVE)
→ research result
→ reconcileInformationGain
→ compareKnowledge (on STOP)
→ updateKnowledgeFromChanges
```

`compareKnowledge` / `reconcileInformationGain` live in `agent/evaluation.ts`. Duplicate detection uses claim fingerprints and token overlap (`equivalentClaim`, 0.8). `updateKnowledgeFromChanges` skips `DUPLICATE` and refuses to write when `informationGainStatus` is `NO_INFORMATION_GAIN`.

This round’s fixture (`tests/agent-runner.test.ts`):

```text
existing knowledge: "Palmier Pro launched an open-source AI video editor for macOS."
incoming evidence:  "Palmier Pro launches an open-source AI video editor for macOS."
```

Trace:

- Incoming evidence is an accepted primary fact signal (verified, reliability 90), not an object that bypasses the evidence shape.
- Repository: `InMemorySignalRepository.listPersonalKnowledge`, keyed by authenticated filter context. One prior `KNOWN_INFORMATION` record is returned and appears in the RETRIEVE step.
- Comparison direction is new signal versus persisted knowledge fingerprints. The synonym pair overlaps above the equivalent-claim threshold.
- Result: first run `NEW_INFORMATION` / classification `NEW`; second run `NO_INFORMATION_GAIN`, `knowledgeChanges.length = 0`, knowledge count stays 1.

`NO_INFORMATION_GAIN` is the runtime equivalent of duplicate for this path. `compareKnowledge`’s `DUPLICATE` label is used when the signal is already marked no-gain or the identity matches during classification; the write path does not persist a second record either way.

**Knowledge Comparison Entry = FORMAL REGRESSION PASS.** **Duplicate Classification = FORMAL FIXTURE PASS.**

There is no `SUPPLEMENT` enum. The runtime equivalent for “same source, old fact still true, new clause added” is `UPDATED_INFORMATION` / classification `UPDATES`.

Formal fixture in `tests/agent-runner.test.ts` (local, not real E2E):

```text
existing: Palmier Pro launched an open-source AI video editor for macOS.
incoming: Palmier Pro launched an open-source AI video editor for macOS and now supports automated rough cut and shot selection.
```

Second run retrieves the old record, sets `UPDATED_INFORMATION`, emits `UPDATES`, and keeps both statements. It does not collapse to `NO_INFORMATION_GAIN` and it is not `CONTRADICTS`. The write creates a second knowledge record rather than editing the first in place. That matches the current upsert contract; it is not treated as a bug in this round.

**Supplement = FORMAL FIXTURE PASS** (`UPDATES`, local only).

**Conflict = FORMAL FIXTURE PASS** as a non-overwrite, local only. The runtime does not infer contradiction from opposite wording. `compareKnowledge` can label `CONTRADICTS` only when the incoming signal already has `verificationStatus: "conflicting"`. `updateKnowledgeFromChanges` then drops that change because `canWriteKnowledge` rejects `CONTRADICTS`, so `runAgent.knowledgeChanges` does not contain it and the denial is not stored. The Palmier fixture checks retrieval, `conflictDetected`, and that the original launch fact remains the only record. Returning the `CONTRADICTS` label itself is not part of the current persisted-change contract.

**Major Change = PRODUCT CAPABILITY GAP.** There is no `MAJOR_CHANGE` classification. A later verified fact that reverses an earlier state (open-source edition discontinued, product moved to a hosted paid service) takes the same path as an ordinary supplement: same source URL, claims not equivalent, `UPDATED_INFORMATION` / `UPDATES`, old record kept, new record appended. Nothing marks the old fact as superseded. The fixture locks that current behavior. It is not a bug against the existing enum, and it is not a lock of a major-change product concept.

Knowledge Comparison is therefore **PARTIALLY CALIBRATED**, not formal-fixture locked.

Not locked, because Conflict and Major Change are still open. Do not read this as “Knowledge Comparison = LOCKED.”

## 12. Data and Repository Layer

- `information/rag-records.ts` builds event, claim, and evidence records from signals. Social evidence is stored with `sourceRole: discovery`; primary evidence uses `verification`.
- Repository interfaces cover events, claims, evidence, and personal knowledge.
- `InMemorySignalRepository` is what the agent-runner tests execute.
- PostgreSQL repositories and pgvector-oriented migrations exist and have their own tests, including a postgres agent-memory e2e when a database is configured.
- This report does not claim pgvector retrieval is the path that classified the duplicate fixture. That fixture used in-memory fingerprint and token comparison.

## 13. Runtime and Budget

The research run is bounded (worker deadline on the order of 25s, `BudgetManager`, post-processing reserve). Raising the timeout was rejected as a quality fix: a hung provider must fail soft, and reserved time must remain for extraction and claims. Parallel enrichment that still awaited a hanging GitHub call was reverted.

## 14. Testing Strategy

```text
FIRST LOSS → TRUE BUG or CORRECT_REJECTION
→ TRUE NEGATIVE fixture
→ TRUE POSITIVE fixture
→ regression in npm test
→ real E2E only when a live candidate reaches the layer
→ LOCK only that layer’s formal contract
```

`LOCAL PASS` and `FORMAL FIXTURE LOCKED` are not `REAL E2E CLOSED`.

Commands used for the gates in this cycle: `npm test`, `npm run typecheck`, `npm run lint`, `npm run api:build`, `git diff --check`. Full suite at the end of the knowledge-duplicate change: **413 passed, 0 failed, 3 skipped**.

## 15. Important Bugs and Failed Approaches

| Problem | Cause | What was done |
| --- | --- | --- |
| Job-search misroute on “工作流” | Substring intent match | Intent terms narrowed to explicit employment language |
| Evidence counted before it existed | Candidate count treated as evidence count | Accounting split discovery, produced evidence, and accepted evidence |
| Canonical fetch starved claim work | No post-processing reserve | Budget reservation; sequential enrichment kept |
| Parallel enrichment hit worker deadline | Settled promises still waited on hanging GitHub | Reverted; GitHub timeout left as environmental |
| Title-only claims | Discovery title used as the fact | Claim must come from body text with an event verb |
| Single HN item looked “verified” because a canonical page existed | Canonical URL confused with an independent source | Reliability stays unverified without a separate primary |

## 16. Current Status Matrix

| Module | Status | Validation | Real E2E | Notes |
| --- | --- | --- | --- | --- |
| Planning | Local | agent / intent tests | not this cycle | query pollution guarded |
| Source selection | Local | source-selector tests | not this cycle | social stays discovery |
| Discovery | Local | retrieval-coverage tests | partial / environment | empty providers are not evidence |
| Canonical fetch | Formal lock | detail-enrichment tests | environmental gaps remain | parallel enrichment reverted |
| Claim | Formal lock | content-processing + entry fixture | pending | Mosaic was a correct rejection |
| Evidence entry | Formal regression lock | `tests/evidence-entry.test.ts` | pending | reaches evaluation |
| Reliability | Formal fixture lock | negative + `tests/reliability-positive.test.ts` | pending | threshold unchanged |
| Verification | Formal fixture lock | same pair | pending | not auto-closed by reliability |
| Knowledge compare | Entry, duplicate, supplement, conflict fixture pass | `tests/agent-runner.test.ts` | pending | conflict requires incoming `conflicting` status; major change open |
| Information gain | Used by compare | agent-runner dedup tests | pending | `NO_INFORMATION_GAIN` blocks writes |
| Attention | Implemented | not calibrated here | pending | out of scope |
| Knowledge update | Wired | duplicate does not double-write | pending | in-memory fixture |
| Scheduler | Present | scheduler tests exist | not closed | out of scope |

## 17. Remaining Roadmap

```text
Knowledge Comparison
  Duplicate      formal fixture pass
  Supplement     formal fixture pass as UPDATES (local only)
  Conflict       formal fixture pass as CONTRADICTS (local only; status is an input)
  Major Change   capability gap: same UPDATES path, old fact not superseded
→ Attention Decision
→ Personal Alpha 10-query
→ Proactive / Scheduler
→ Feedback
→ Knowledge Update hardening
→ long-term learning proof
```

## 18. Personal Alpha Definition

Still to be run as real queries, not fixtures:

- broad discovery without an explicit entity
- explicit entity
- comparison question
- official release
- tool worth testing
- workflow research
- 7-day freshness
- 30-day freshness
- needs-more-evidence stop
- stateful query that must use historical knowledge

## 19. Deployment Architecture

Local development uses a Vinext frontend on port 3000. Database-backed API routes proxy to a Node server (`backend/node-server.ts`, built to `dist-api/server.mjs`) because `pg` cannot open TCP from the workerd bundle. Postgres is configured through environment variables consumed by that Node process (pooler host, database, user, password, SSL). Names only: database URL or host, user, password, and SSL mode live in local env files and are not copied here.

Auth uses Supabase SSR libraries. Public deployment scripts exist for an EdgeOne drop (`build:edgeone`, `package:edgeone`). This report does not claim a specific public domain is currently serving the calibrated build.

No passwords, tokens, API keys, cookies, or private keys belong in this document.

## 20. Interview and Portfolio Explanation

**30 seconds.** Signal Map watches topics for a specific person and keeps only changes that are fresh, sourced, and new relative to what they already know.

**2 minutes.** It is not RAG-over-a-folder. Social posts only discover leads. A claim has to be in the fetched body. One social post stays unverified until an independent primary source agrees. Matching an existing fact does not create a second memory.

**5 minutes.** Planning builds the real queries. Evidence entry, reliability, and verification are separate gates with negative and positive fixtures. Knowledge comparison is wired through `runAgent`: retrieve stored knowledge, compare the new claim, and persist only when the gain is real. Duplicate is the only comparison class closed so far.

Role to describe honestly: product direction, system rules, architecture choices, evaluation standards, and orchestration of AI-assisted implementation. Not “every line was typed by hand,” and not “the model chose the product.”

## Known pending sections

- Real E2E evidence entry, reliability, and verification.
- Major-change comparison. Conflict is only a local fixture that consumes an already conflicting verification status.
- Attention calibration.
- Proof that long-term learning changes later plans beyond the current duplicate block.
