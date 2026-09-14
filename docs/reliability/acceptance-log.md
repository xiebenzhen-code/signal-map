# Signal Map Reliability / Acceptance Log

Lightweight append-only record for Agent E2E, Quality Acceptance, and Stability Acceptance evidence.

Rules:

- Record only verified facts.
- Do not record secrets, passwords, full `DATABASE_URL`, API keys, cookies, tokens, or raw user-sensitive content.
- Append new acceptance or reliability records; do not rewrite historical outcomes unless correcting a documented mistake.

## 2026-09-14 — CI esbuild missing

- Date: 2026-09-14
- Test / Run ID: GitHub Actions Agent Loop E2E first CI build failure
- Commit SHA: `4f93b22`
- Layer: CI harness / dependency installation
- Symptom / Failure: `npm run api:build` failed with `sh: 1: esbuild: not found` and exit code `127`.
- Evidence: Workflow install step had skipped dev dependencies while `api:build` required the repo-local `esbuild` dev dependency.
- Root Cause: CI job-level production environment caused `npm ci` to omit dev dependencies needed by the build step.
- Minimal Fix: Install dependencies with `npm ci --include=dev` and restrict `NODE_ENV=production` to the Node API execution step.
- Re-test Result: Local `npm run api:build` passed after the harness fix.
- Status: PASS

## 2026-09-14 — Test Supabase project identity mismatch

- Date: 2026-09-14
- Test / Run ID: Agent Loop E2E Phase 0 safety gate
- Commit SHA: `7a90779`
- Layer: Test environment safety
- Symptom / Failure: E2E validation could not safely proceed when Supabase Auth project ref and PostgreSQL project ref did not both match the expected test project ref.
- Evidence: Phase 0 safety check compares `TEST_SUPABASE_PROJECT_REF` against the Supabase URL and the database URL structure before any product validation.
- Root Cause: Test environment identity was not confirmed as the independent `signal-map-test` project.
- Minimal Fix: Configure GitHub Secrets to point to the independent test Supabase project before running E2E.
- Re-test Result: Later Agent Loop E2E runs reached Runtime / DB, Auth / Tenant, and Persistence phases against the test environment.
- Status: PASS

## 2026-09-14 — PostgreSQL Transaction Pooler auth failure

- Date: 2026-09-14
- Test / Run ID: GitHub Actions PostgreSQL probe
- Commit SHA: unavailable
- Layer: PostgreSQL connection configuration
- Symptom / Failure: PostgreSQL probe failed before Signal Map product validation when Transaction Pooler credentials / URI configuration were not accepted.
- Evidence: GitHub Actions standard Node probe later confirmed the corrected Transaction Pooler URI could connect and execute `SELECT 1`.
- Root Cause: Connection configuration drift from the official Supabase Transaction Pooler URI.
- Minimal Fix: Use the Supabase Dashboard official Transaction Pooler URI as the single source of truth for the test `DATABASE_URL`; keep `POSTGRES_SSL=true`.
- Re-test Result: GitHub Actions standard Node runtime connected to the same Supabase Transaction Pooler and executed `SELECT 1`.
- Status: PASS

## 2026-09-14 — Agent Core Loop E2E PASS

- Date: 2026-09-14
- Test / Run ID: Signal Map Agent Loop E2E
- Commit SHA: `7a90779`
- Layer: Node runtime / Auth / PostgreSQL persistence / Agent loop harness
- Symptom / Failure: Baseline acceptance needed proof that Signal Map could run outside Sites Worker using standard Node and the independent test database.
- Evidence: Agent Loop E2E harness covers `/health`, login for test accounts A/B, tenant isolation checks, Knowledge / Goals / Follows persistence, Node restart readback, `/api/signals`, and logout.
- Root Cause: Not a failure record; this is the baseline acceptance record for the Node-based E2E harness.
- Minimal Fix: Added the manual `workflow_dispatch` acceptance workflow and HTTP-driven E2E script.
- Re-test Result: Operator confirmed the Agent Loop E2E baseline was passing before quality-mode extensions were added.
- Status: PASS

## 2026-09-14 — Quality report failure-path not generated

- Date: 2026-09-14
- Test / Run ID: Signal Map Agent Quality Acceptance
- Commit SHA: `547ba25`
- Layer: Quality harness / artifact generation
- Symptom / Failure: `quality_query` was enabled and executed, but artifacts only contained `signal-map-agent-loop-e2e-report.*`; expected `signal-map-agent-quality-report.*` files were missing.
- Evidence: Workflow artifact did not include the expected quality JSON / Markdown files even though `qualityMode.enabled=true`.
- Root Cause: Quality report generation was not guaranteed on failure or incomplete research paths.
- Minimal Fix: Ensure quality JSON and Markdown reports are always written when `quality_query` is non-empty, including HTTP 502 and zero-evidence results.
- Re-test Result: Harness now guarantees quality artifacts on failure paths and uploads both E2E and quality reports.
- Status: PASS

## 2026-09-14 — Quality query WORKER_DEADLINE / planning budget

- Date: 2026-09-14
- Test / Run ID: Signal Map Agent Quality Acceptance with real `quality_query`
- Commit SHA: `3ab844c`
- Layer: Quality harness observability / Agent deadline boundary
- Symptom / Failure: Real quality query returned HTTP `502`; last successful phase was `source_selection_finished`; `agent_finished` reported `WORKER_DEADLINE` after about `20978ms`; Search, Detail Fetch, Aggregation, and Evidence did not start.
- Evidence: Quality artifact trace showed `source_selection_finished itemCount=3`, followed by `agent_finished errorCode=WORKER_DEADLINE`.
- Root Cause: Confirmed deadline boundary; current evidence indicates the request exhausted the `/api/signals` deadline before retrieval started, but function-level planning timing inside AgentRunner is unavailable from the harness alone.
- Minimal Fix: In quality mode only, run the Node server with `MODEL_REQUEST_TIMEOUT_MS=6000` and add deadline/planning timing diagnostics to the quality report without changing AgentRunner behavior or production configuration.
- Re-test Result: Pending next manual quality workflow run.
- Status: PARTIAL

## 2026-09-14 — Production Sites to PostgreSQL runtime issue

- Date: 2026-09-14
- Test / Run ID: Production Sites PostgreSQL transport probe
- Commit SHA: `5841ff5`
- Layer: Production runtime / PostgreSQL transport
- Symptom / Failure: In OpenAI Sites / Cloudflare Worker runtime, direct PostgreSQL access failed with `Connection terminated unexpectedly`, including request-scoped client probes.
- Evidence: Production Sites probe returned `connectSucceeded=false`, `selectSucceeded=false`, and last phase `client_end_started`; standard Node in GitHub Actions connected to the same Supabase Transaction Pooler and executed `SELECT 1`.
- Root Cause: Current evidence bounds the issue to Sites runtime to Supabase PostgreSQL transport incompatibility / connectivity, not Signal Map Agent logic.
- Minimal Fix: Stop attempting to make Sites Worker directly use PostgreSQL; use a standard Node API runtime for PostgreSQL-backed endpoints.
- Re-test Result: No production runtime migration has been completed in this log.
- Status: FAIL

## 2026-09-14 — Agent Plan to Retrieval contract boundary

- Date: 2026-09-14
- Test / Run ID: Local contract regression for Agent Plan → Retrieval
- Commit SHA: same commit as this record
- Layer: Agent planning / Retrieval contract
- Symptom / Failure: `AgentRunner` produced `plan.queries`, but `runResearchPipeline` rebuilt its own query plan from `planQuery(input)`, allowing `agentGeneratedQueries` and `pipelineActualQueries` to diverge.
- Evidence: Code path showed `research-service` passing only source routing fields to `runResearchPipeline`, while `runResearchPipeline` called `planQuery(input)` internally.
- Root Cause: No explicit cross-layer `RetrievalPlan` contract separated Agent-owned semantic planning from Retrieval-owned deterministic provider mapping.
- Minimal Fix: Add `RetrievalPlan`, convert `ResearchPlan` with `toRetrievalPlan`, make Retrieval consume valid upstream queries first, and allow fallback planning only when upstream queries are missing or invalid.
- Re-test Result: `node --check scripts/signal-map-agent-loop-e2e.mjs`, `npm run typecheck`, `npm run api:build`, targeted contract / agent tests, and lint for changed source/test files passed locally.
- Status: PASS

## 2026-09-14 — Query / Entity parsing scaffolding pollution

- Date: 2026-09-14
- Test / Run ID: Local QueryPlanner entity pollution regression
- Commit SHA: same commit as this record
- Layer: Query planning / Entity parsing
- Symptom / Failure: Quality acceptance input could produce non-user entities such as `Signal`, `Map`, `What`, `Use`, and `Do`, and could leak harness scaffolding into generated search queries.
- Evidence: `planQuery` built `originalNeed` from `identity`, `knownInformation`, and generic `informationGaps`, then extracted capitalized English words from that combined text as entity candidates.
- Root Cause: QueryPlanner mixed product / harness labels and run instructions with user research semantics before entity extraction.
- Minimal Fix: Limit semantic query planning and entity extraction to user research fields, exclude identity and known-information scaffolding from `originalNeed`, and add generic entity-word validation for English function/question words.
- Re-test Result: Targeted tests passed for the quality query pollution case, normal company/product entities, and Agent Plan → Retrieval contract.
- Status: PASS

## 2026-09-14 — Broad discovery without entity selected official-only source

- Date: 2026-09-14
- Test / Run ID: Local SourceSelection broad discovery regression
- Commit SHA: same commit as this record
- Layer: SourceSelection / Discovery routing
- Symptom / Failure: Broad discovery quality query had `resolvedEntities=[]`, `intent=PRODUCT_UPDATE`, and `selectedSourceType=OFFICIAL`; search returned zero results with `emptyResultReason=official_source_selected_but_no_resolved_entities`.
- Evidence: Quality diagnostics showed Agent Plan → Retrieval contract passed and Query / Entity pollution was fixed, but `source_selection_finished` still selected the OFFICIAL provider group before any candidate entity existed.
- Root Cause: `PRODUCT_UPDATE` source profile prioritizes `OFFICIAL`, and SourceSelection did not distinguish no-entity candidate discovery from entity-specific official verification.
- Minimal Fix: For `INITIAL` research with no resolved entity and an OFFICIAL-first profile, select a discovery-capable first source while retaining OFFICIAL / PRIMARY as verification sources after candidates exist.
- Re-test Result: Local SourceSelector regression now verifies broad no-entity PRODUCT_UPDATE is not OFFICIAL-only, explicit Runway update can still prefer OFFICIAL, discovered entities can route to OFFICIAL / PRIMARY verification, and Agent Plan → Retrieval contract tests remain passing.
- Status: PASS
