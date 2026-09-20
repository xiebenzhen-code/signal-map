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

## 2026-09-14 — Multi-round Evidence preservation

- Date: 2026-09-14
- Test / Run ID: Local AgentRunner cumulative evidence regression
- Commit SHA: same commit as this record
- Layer: AgentRunner / multi-round evidence lifecycle
- Symptom / Failure: Quality E2E round 1 produced discovery evidence, but round 2 verification returned zero results / upstream failure; final HTTP response was `200` with `signalCount=0` and `evidenceCount=0`.
- Evidence: Trace showed round 1 search/detail/aggregation/evidence succeeded, then round 2 `PRIMARY` search returned zero results with provider failure; final acceptance stayed `PARTIAL`.
- Root Cause: `runAgent` replaced the run response with each latest round response. Later empty verification responses could therefore overwrite previously collected evidence before final evaluation and response generation.
- Minimal Fix: Keep a run-level cumulative response, merge each round's signals/claims/sources by stable source identity, update verification metadata for duplicate evidence, and evaluate / return / formally persist from cumulative evidence while intermediate provenance persistence uses only the current round.
- Re-test Result: Targeted tests now verify round 1 evidence survives round 2 zero results, later provider errors do not clear existing evidence, duplicate verification updates metadata without double counting, and final evaluation uses cumulative evidence.
- Status: PASS

## 2026-09-14 — ResearchRunState extraction

- Date: 2026-09-14
- Test / Run ID: Local ResearchRunState Phase 1 refactor regression
- Commit SHA: same commit as this record
- Layer: AgentRunner / run-level cumulative state
- Symptom / Failure: `runAgent` still owned low-level cumulative evidence identity, merge, count, and verification-upgrade details directly, making multi-round orchestration hard to audit.
- Evidence: `runAgent` contained evidence identity helpers, claim/source identity helpers, verification ranking, signal merge, response merge, and evidence count logic inline.
- Root Cause: Run-level cumulative state lacked a dedicated boundary separate from round-local response orchestration.
- Minimal Fix: Extract `ResearchRunState` with `mergeRoundResponse()`, `cumulativeResponse`, cumulative evidence counts, carried-forward counts, provider-failure snapshot, and duplicate evidence verification upgrade semantics.
- Re-test Result: Dedicated ResearchRunState tests and existing AgentRunner cumulative evidence regressions passed locally without changing SourceSelection, RetrievalPlan, QueryPlanner, provider, deadline, STOP, Knowledge, Attention, or persistence contracts.
- Status: PASS

## 2026-09-14 — Agent deadline graceful completion

- Date: 2026-09-14
- Test / Run ID: Local BudgetManager / AgentRunner Phase 2A regression
- Commit SHA: same commit as this record
- Layer: AgentRunner / deadline and budget boundary
- Symptom / Failure: Real quality E2E collected round 1 evidence, then started another planning round and hit `WORKER_DEADLINE`, which was surfaced as HTTP `502` instead of returning the cumulative evidence already collected.
- Evidence: Quality diagnostics showed round 1 search/detail/aggregation/evidence succeeded, followed by next-round planning and `WORKER_DEADLINE`.
- Root Cause: Deadline and guard checks were scattered in `runAgent`; there was no explicit budget boundary that could stop safely before next-round planning when cumulative evidence already existed.
- Minimal Fix: Add `BudgetManager` with existing `9000ms` model-planning and `4000ms` retrieval guards, check budget before next-round planning, and return `ResearchRunState.cumulativeResponse` when evidence exists but budget is unsafe.
- Re-test Result: Targeted tests verify next-round budget exhaustion does not start model planning, planning `WORKER_DEADLINE` after evidence returns cumulative evidence, no-evidence deadline does not fabricate a response, and budget-sufficient multi-round behavior continues.
- Status: PASS

## 2026-09-14 — Round attempt evidence merge timing

- Date: 2026-09-14
- Test / Run ID: Local AgentRunner same-round attempt merge regression
- Commit SHA: same commit as this record
- Layer: AgentRunner / ResearchRunState merge timing
- Symptom / Failure: Quality E2E showed round 1 search/detail/aggregation/evidence succeeded, but the following `fallback_planning` budget trace still reported `cumulativeEvidenceCount=0` and final evidence stayed zero.
- Evidence: `runAgent` merged into `ResearchRunState` only after fallback handling finished, so a primary attempt with evidence could be followed by an empty fallback before the run-level state observed the primary attempt.
- Root Cause: Same-round fallback was treated as a replacement response until the end of the round instead of as an additional attempt that should be merged immediately.
- Minimal Fix: Merge every `runResearchPipeline` attempt into `ResearchRunState` immediately after it returns; fallback attempts are merged as supplements and trace records `attemptType`, `roundEvidenceCount`, `carriedForwardEvidenceCount`, and `cumulativeEvidenceCount`.
- Re-test Result: Targeted tests verify primary attempt evidence survives empty fallback, provider-error fallback preserves cumulative evidence, fallback verified evidence does not duplicate count, and STOP/final evidence count reads cumulative state.
- Status: PASS

## 2026-09-14 — Evidence candidate and final count separation

- Date: 2026-09-14
- Test / Run ID: Local ResearchRunState / quality artifact evidence accounting regression
- Commit SHA: same commit as this record
- Layer: ResearchPipeline / ResearchRunState evidence accounting
- Symptom / Failure: Real quality E2E showed round 1 `evidence_finished=2`, then preservation diagnostics reported `cumulativeEvidenceCount=12` and `finalEvidenceCount=12`, while the final API response had `signalCount=0` and `evidenceCount=0`.
- Evidence: `sourceOutcomes.newEvidenceCount` was populated from provider/source `resultCount`; `evidence_finished` counts the pipeline's evaluated `allSignals` (each carries Claims and `evidenceSources`), which are persisted as `EvidenceRecord`s by `recordsFromSignal()`; `ResearchRunState.countEvidence()` treated the source outcome count as run evidence when no displayed signals existed.
- Root Cause: Source/provider discovery candidates were conflated with produced / accepted Evidence. The 12 count represented discovered candidate results, not accepted final Evidence.
- Minimal Fix: Add explicit `EvidenceAccounting` fields for discovered candidates, produced evidence, evaluated evidence, accepted evidence, rejected evidence, final evidence, and rejection reasons; make `ResearchRunState` count only produced Evidence, not source outcome candidate counts; make final trace values read final accounting rather than cumulative produced counts.
- Re-test Result: Targeted tests verify provider candidates do not inflate cumulative evidence, produced evidence survives empty fallback, produced-but-rejected evidence reports explicit rejection counts, and accepted evidence defines final evidence count.
- Status: PASS

## 2026-09-15 — Evidence accounting semantics correction

- Date: 2026-09-15
- Test / Run ID: Local evidence-record accounting regression
- Commit SHA: 82cbcc1
- Layer: ResearchPipeline / ResearchRunState / quality harness
- Symptom / Failure: Provider discovery returned 12 candidates while `evidence_finished` produced 2 evidence-bearing results; cumulative accounting could report candidate or signal counts instead of actual Evidence records, and final API output could show zero without a countable reason.
- Evidence: `sourceOutcomes.newEvidenceCount` is assigned from provider `resultCount`; actual Evidence objects are created by `recordsFromSignal(signal).evidence` from signal claims and evidence sources.
- Root Cause: Candidate, produced Evidence, evaluated Evidence, accepted Evidence, and final Evidence were not consistently derived from the same underlying objects.
- Minimal Fix: Add explicit `evidenceRecords` to research responses; derive produced, evaluated, accepted, cumulative, rejected, and final counts from stable EvidenceRecord identities; keep provider candidate counts diagnostic-only; expose the same fields in quality artifacts.
- Re-test Result: Targeted ResearchRunState, AgentRunner, RAG contract, RetrievalPlan, and SourceSelection tests passed; full test suite passed with only the two pre-existing DB-configuration skips; typecheck, API build, and related lint passed.
- Status: PASS

## 2026-09-20 — Intent / Source Selection — AI Tool Research vs Job Search

- Date: 2026-09-20
- Test / Run ID: real Query /api/signals signals-54bf2eb3-34e2-4921-b45c-9c3905c72e40
- Commit: PENDING
- Layer: Intent classification / Source Selection / frontend natural-research-intent
- Symptom / Failure: AI 视频剪辑工具研究 Query 被错误分类为 JOB_SEARCH，industry 被判为 “AI 招聘与职业机会”，导致 Source Selection 偏向 job/company 来源而非研究型来源。
- Evidence: Query 含“工作流”；前端 inferredIndustry 正则 `/岗位|招聘|投递|求职|工作|职位|job|career/` 以子串匹配命中“工作”；该 industry 被 backend classifyIntent（读取 filterContext.industry）并入分类文本，“招聘”命中 JOB_SEARCH(0.92) 覆盖了裸 Query 本应命中的 PRODUCT_UPDATE(0.88)。修正前：classifyIntent(裸 query)=PRODUCT_UPDATE，带被污染 industry 后=JOB_SEARCH。
- Root Cause: information/natural-research-intent.ts 的 inferredIndustry 用子串“工作”判定就业意图，把“工作流(workflow)”误当 job；后端把 industry 标签并入 intent 分类文本，放大了这次误判。
- Minimal Fix: 前端 inferredIndustry 就业正则去掉“工作”，并对齐后端 classifyIntent 的显式就业词集合：`/岗位|职位|招聘|求职|投递|内推|job|jobs|career|hiring|opening/`。仅凭 workflow / tool / release / commercial / test 不再触发 JOB_SEARCH。
- Regression: intent-aware-research.test.ts 新增 A–E 用例（AI 工具研究→research，投递岗位/招聘→JOB_SEARCH，前端 draft industry 不含“AI 招聘与职业机会”，链路 industry→intent 非 JOB_SEARCH，Source Selection 选研究来源、QueryPlan 不含 job 查询）。intent-aware 13 PASS，source-selector 9 PASS；typecheck、lint、git diff --check 通过。
- Real E2E: POST /api/signals HTTP 200；body industry=“AI 视频与创作者工具”；intent=PRODUCT_UPDATE(0.88, secondary=TOOL_DISCOVERY)；sourceSelectionReason=“PRODUCT_UPDATE + INITIAL 无明确实体，先使用 GENERAL_WEB 发现候选，再用 OFFICIAL / PRIMARY 验证”；allowedProviders=[public-web,product-hunt,hacker-news,huggingface]；无 JS 异常。
- Status: LOCKED
