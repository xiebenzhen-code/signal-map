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
- Commit: 0ce661f6f79e89c5aef5880f2c2571d2cbac694a
- Layer: Intent classification / Source Selection / frontend natural-research-intent
- Symptom / Failure: AI 视频剪辑工具研究 Query 被错误分类为 JOB_SEARCH，industry 被判为 “AI 招聘与职业机会”，导致 Source Selection 偏向 job/company 来源而非研究型来源。
- Evidence: Query 含“工作流”；前端 inferredIndustry 正则 `/岗位|招聘|投递|求职|工作|职位|job|career/` 以子串匹配命中“工作”；该 industry 被 backend classifyIntent（读取 filterContext.industry）并入分类文本，“招聘”命中 JOB_SEARCH(0.92) 覆盖了裸 Query 本应命中的 PRODUCT_UPDATE(0.88)。修正前：classifyIntent(裸 query)=PRODUCT_UPDATE，带被污染 industry 后=JOB_SEARCH。
- Root Cause: information/natural-research-intent.ts 的 inferredIndustry 用子串“工作”判定就业意图，把“工作流(workflow)”误当 job；后端把 industry 标签并入 intent 分类文本，放大了这次误判。
- Minimal Fix: 前端 inferredIndustry 就业正则去掉“工作”，并对齐后端 classifyIntent 的显式就业词集合：`/岗位|职位|招聘|求职|投递|内推|job|jobs|career|hiring|opening/`。仅凭 workflow / tool / release / commercial / test 不再触发 JOB_SEARCH。
- Regression: intent-aware-research.test.ts 新增 A–E 用例（AI 工具研究→research，投递岗位/招聘→JOB_SEARCH，前端 draft industry 不含“AI 招聘与职业机会”，链路 industry→intent 非 JOB_SEARCH，Source Selection 选研究来源、QueryPlan 不含 job 查询）。intent-aware 13 PASS，source-selector 9 PASS；typecheck、lint、git diff --check 通过。
- Real E2E: POST /api/signals HTTP 200；body industry=“AI 视频与创作者工具”；intent=PRODUCT_UPDATE(0.88, secondary=TOOL_DISCOVERY)；sourceSelectionReason=“PRODUCT_UPDATE + INITIAL 无明确实体，先使用 GENERAL_WEB 发现候选，再用 OFFICIAL / PRIMARY 验证”；allowedProviders=[public-web,product-hunt,hacker-news,huggingface]；无 JS 异常。
- Status: LOCKED

## 2026-09-21 — Retrieval Coverage — Multi-source resilience

- Date: 2026-09-21
- Test / Run ID: real Query /api/signals signals-f29bfe82-c802-4eb0-a640-8e74878dfd1b
- Fix Commit: 28f5ec8ea5fa55e469a4099a190aa9be78d2fa01
- Layer: Retrieval / Source Coverage / product-hunt classification
- Symptom / Failure: 最近真实 AI 视频研究 Query 在通用 web 单一引擎（Google News RSS）不可达时 public-web 全部 upstream_error；Product Hunt direct fetch 返回 403；HN/HF 用冗长完整 Query 返回 0；OFFICIAL/GitHub/arXiv 被 allowedProviderIds gating，discovery=0 时完全未贡献。real run raw=0 → candidate=0 → evidence=0。
- Root Cause: ① GENERAL_WEB 仅 Google News 一个引擎（news.google.com 本环境不可达→0→upstream_error）；② Product Hunt 返回 HTTP 403 却归并成上游错误甚至 silent；③ HN/HF 使用冗长 query→0；④ OFFICIAL/GitHub/arXiv 仅在候选产生后才进入验证阶段，primary discovery 为空时被 gating 排除（github/official/company 尚为 entity-only）。
- Minimal Fix:
  1. 通用 web 二级引擎 DuckDuckGo HTML fallback（googleNews 失败/全 0 时尝试），新增 webSearchWithFallback；仅对 general-web/community 层开启；engine/fallbackAttempted 独立记账，两引擎都失败不再把 fallback 抹掉。
  2. HN/Hugging Face 改用短 topic query（shortQueryFor，≤2 个短 concept + 简短 modifier），不再传完整 prompt。
  3. 空 discovery 时执行级放开 gated 技术来源（arXiv/GitHub/Official/Company Registry，entity-only 仍保留实体条件），upsert 覆盖 not_searched 记账。
  4. Product Hunt 失败分类：HTTP 403 → failureCode "forbidden"，fail-soft 不阻塞其他 provider。
- Regression: tests/retrieval-coverage.test.ts 新增 A–F（主引擎失败→fallback 代码路径执行；HN/HF 短 query；空 discovery→technical fallback 执行；非空 discovery→不无脑放开；PH 403→forbidden 且 pipeline 继续；filter semantics 不变）。A–F 全 PASS；source-selector 9 PASS；intent-aware 13 PASS；typecheck、lint、api:build、git diff --check 通过。
- Real E2E:
  - intent = PRODUCT_UPDATE(0.88, secondary TOOL_DISCOVERY)（无 JOB_SEARCH 回归）
  - General Web: failed/upstream_error, requestCount 4, fallbackAttempted true（googleNews + DDG 均不可达）
  - Product Hunt: failed/forbidden（fail-soft）
  - Hacker News: searched, raw=2, normalized=2, TOPIC_MISMATCH=2
  - arXiv: searched（technical fallback 真实执行）, raw=8, normalized=8, TOPIC_MISMATCH=8
  - Hugging Face: searched, raw=0；Company Registry: searched, raw=0
  - total raw = 10（HN 2 + arXiv 8），candidate = 0，evidence = 0，displayed = 0
  - scanned = 0（scanned 只计准入候选，所有 raw 在 topic-relevance candidate-admission 被拒）
  - reason = deadline_exhausted_no_evidence
- DuckDuckGo fallback: CODE-PATH VERIFIED（回归 A）/ RUNTIME AVAILABILITY UNVERIFIED（本环境 html.duckduckgo.com 不可达）——两者已明确区分。
- Status: LOCKED（Retrieval Coverage 复核后升级：单 provider failure 不导致 retrieval 全空、HN short-query 实际产出 raw、empty discovery 时 arXiv technical fallback 真实执行、PH 403=forbidden 且 fail-soft、combined state 中 scanned/candidate>0）
- Real E2E Log（Retrieval Coverage）:
  1. technical fallback E2E — signals-f29bfe82-c802-4eb0-a640-8e74878dfd1b：HN raw=2 + arXiv raw=8（technical fallback 实际执行），candidate=0（当时为 Topic Relevance false negative）。
  2. calibration 后 E2E — signals-186ac5fb-69f9-455d-b0ae-08ecd7de15d8：HN raw=2 → normalized=2 → admitted candidate=2 → evidence=2。

## 2026-09-21 — Topic Relevance Calibration — AI Video Editing Variants

- Date: 2026-09-21
- Test / Run ID: real Query /api/signals signals-186ac5fb-69f9-455d-b0ae-08ecd7de15d8
- Fix Commit: eff9a03d0b7f20938d65d0232e6446419c786f6b
- Layer: Topic Relevance / candidate admission / filtering
- Symptom / Failure: Retrieval Coverage 修复后真实 E2E raw=10（HN 2 + arXiv 8），但 candidate=0，10 条全在 candidate admission 被 TOPIC_MISMATCH——含明显相关样本 "Palmier Pro – macOS video editor built for AI"、"Launch HN: Mosaic – Agentic Video Editing"。真实 over-filtering（P1 级误杀）。
- Root Cause: task-anchor 精确短语匹配（matches(text, anchor) 词边界子串)。任务锚点是固定短语（"AI video editing"/"automated rough cut"/…），真实语言变体（"Agentic Video Editing"、"video editor built for AI"）不含精确短语 → MISSING_TASK_ANCHOR。domain ("video") 命中也因 domain+task 双约束里 task 半失败而拒。FIRST FALSE NEGATIVE RULE = 无形态/语义变体容错的 task-anchor 精确匹配。
- Minimal Fix: 在 topic-relevance.ts 的显式分支加入受控变体匹配（taskConceptStem）：对齐 anchor 与文本的形态（edit/editor/editing→edit）与限定词（agentic/ai-powered/ai 前缀剥除），并加否定保护（no/not/without/没有/不含 前导 → 不计 task）。变体匹配严格限定于 profile.taskAnchors，禁止裸 "AI"/"video" 通过；保留 domain+task 双约束。
- Regression: tests/topic-relevance.test.ts 新增 "AI video editing 语言变体通过而无关变体仍拒"（POS=Palmier/Mosaic/显式剪辑；NEG=robotic manipulation/4D foundation/general multimodal/no-video-editing/medical video）。原有 P1 negatives（medical/robotics/general AI/unrelated arXiv）全部继续 reject。topic-relevance 13 PASS、retrieval-coverage 6、source-selector 9、intent-aware 13、retrieval-plan-contract 9、source-enrichment 14；typecheck、lint、api:build、git diff --check 通过。
- Accounting（PHASE 7）: `scanned` 实际按 admitted candidate 计数，不等同 raw。本轮原始 raw=2（HN），admittedCandidateCount=2，evidenceRecords=2，displayed=0。已记录二者不得混用。
- Real E2E:
  - intent = PRODUCT_UPDATE（无 JOB_SEARCH 回归）
  - Hacker News: raw=2, normalized=2, **admitted=2, TOPIC_MISMATCH=0**（修复前 TOPIC_MISMATCH=2）
  - arXiv: not_searched（discovery 非空 → technical fallback 未展开，符合 empty-discovery 门控）
  - General Web: failed/upstream_error（googleNews+DDG 本环境不可达）；Product Hunt: failed/forbidden
  - candidate=2, scanned=2, evidence=2, displayed=0（瓶颈已从 topic relevance 转移到 evidence→displayed 的 Reliability/Evidence 层，属下一阶段）
- 判定 PASS: raw>0 ✓；≥1 相关 HN/arXiv item 过 candidate admission ✓（HN 2）；candidate>0 ✓；无关内容继续 TOPIC_MISMATCH ✓（回归锁定）；未为 displayed>0 放宽其他 Evidence/Reliability ✓（displayed 仍 0）。
- Status: LOCKED（regression PASS + real E2E candidate>0 + negatives 继续 reject 三者齐备）

## 2026-09-21 — Runtime Transport Architecture

- Date: 2026-09-21
- Fix Commit: c868cccab066d8d173cd9c5bfd112ed6fe21e210
- Layer: Runtime / workerd<->Node proxy / PostgreSQL transport
- Symptom / Failure: DB-backed /api 在 workerd RSC runtime 直接执行 pg，因 workerd 无原始出站 TCP（nodejs_compat）→ Connection terminated unexpectedly，authenticated /api/signals agent_failed_before_source_selection、control APIs 503。
- Root Cause: workerd 内预打包 pg（deps_rsc/pg.js）需要 net/tls 原始 TCP，但 workerd 不支持；独立 Node（真实 net/tls）正常。
- Fix: DB-backed API 路由经 workerd HTTP proxy（proxyApiRequest）转发到真实 Node backend（dist-api/server.mjs）；workerd 不再执行 pg。proxy 保真 method/path/query/body/Cookie/Authorization/Content-Type/response status+body/Set-Cookie；upstream 不可达返回 API_UPSTREAM_UNAVAILABLE。
- Regression: tests/api-proxy.test.ts（5：DB route→Node upstream；query/body/header 保留；200 原样；4xx/5xx 不篡改；auth cookie/Authorization 不丢；edge-safe auth 不错误代理；upstream 不可达明确错误）+ tests/backend-server.test.ts（11）PASS。
- Real E2E: browser localhost:3000 → /api/signals → workerd proxy → Node :8080 → pg → Agent。HTTP 200，auth PASS，PostgreSQL PASS，无 Connection terminated，进入 source_selection/retrieval，Node 日志出现 DB-backed request（requestId signals-80fac072-07b3-4f5c-a1b2-b13b7fc0927a），workerd 日志无 postgres_pool_error。
- Status: LOCKED

## 2026-09-21 — Zero-Evidence Deadline Graceful Degradation

- Date: 2026-09-21
- Fix Commit: 16ad8f9fd0c4fbb7b832c88172411ae5a2b3230e
- Layer: Agent / deadline budget / evidence accounting
- Symptom / Failure: RESEARCH 在 deadline 耗尽且无 evidence 时以 WORKER_DEADLINE 硬失败，无法给出可恢复的 needs_more_evidence 状态。
- Root Cause: runAgent 对 WORKER_DEADLINE 统一走失败路径，缺少"零证据 deadline"的正常降级分支。
- Fix: 当 errorCode=WORKER_DEADLINE 且存在 preservedResponse 时，返回 status=needs_more_evidence、reason=deadline_exhausted_no_evidence（HTTP 200 经 research-service 映射）；unexpected exception 仍失败；Evidence>0 的 deadline 保持原 graceful completion。
- Regression: tests/agent-runner.test.ts（33）+ tests/public-alpha-research.test.ts（11）PASS。
- Real E2E: /api/signals 在零证据 deadline 下返回 HTTP 200、needs_more_evidence、reason=deadline_exhausted_no_evidence（而非硬失败）。
- Status: LOCKED

## 2026-09-21 — Content Enrichment Calibration (TDD)

- Date: 2026-09-21
- Commit: PENDING
- Layer: Detail enrichment / SourceEnrichment / content-quality
- Symptom / Failure: 真实 E2E 里相关 HN 候选（Palmier Pro、Mosaic，均 topicRelevance MATCH、有 canonicalUrl）因 canonicalUrl 从未进入 detail enrichment，detailAttempted=0，正文始终为 title-only → contentQuality=INSUFFICIENT_CONTENT → displayed=0。FIRST LOSS STAGE=INSUFFICIENT_CONTENT。
- Root Cause: shouldEnrichDetail 仅对 DISCOVERY provider（product-hunt/huggingface）开放，HN（EVIDENCE）等带真实 canonicalUrl 的相关候选永不抓正文；enrichDiscoveryCandidates 的 remainingBudgetMs 守卫在 deadline 近耗尽时把 enrichment 饿死（真实 run budget=0）。
- Fix: detail-enricher.ts 新增 isSafeDetailUrl（SSRF 最小约束：仅 http/https，拒 localhost/loopback/private/link-local/file/data）；shouldEnrichDetail 扩展为"DISCOVERY 保持 或 （相关 EVIDENCE 候选 + canonicalUrl 安全 + 内容不足）"；enrichDetail 新增通用 enrichGenericDetail（抓安全 canonicalUrl、提取正文，fail-soft，无正文/太簿则保持 INSUFFICIENT_CONTENT）；pipeline 传入 url + isRelevant。
- Regression: tests/detail-enrichment.test.ts 新增 A–F + URL safety + pipeline B/C（A 相关HN+url→eligible；D TOPIC_MISMATCH→不富集；F 无url→不富集；E DISCOVERY 保持；E2 同 URL 只 fetch 一次；URL safety 拒 localhost/127/169.254/file/data；B detail 成功→content 越过 INSUFFICIENT（含可验证主张）；C detail 失败 fail-soft 不伪造正文、保持 INSUFFICIENT、pipeline 不崩）。detail-enrichment 8 PASS；source-enrichment 14、topic-relevance 13、retrieval-coverage 6、intent-aware 13、retrieval-plan-contract 9 PASS；typecheck、lint、api:build、git diff --check、full suite（408 pass / 0 fail）全绿。
- Real E2E（signals-bac0eebf-ea62-4cbf-af1c-dd2a29e08c62）：raw=2（HN）、admitted=2、**enrichmentEligible=2 但 detailAttempted=0**（enrichDiscoveryCandidates 首迭代因 remainingBudgetMs=0 立即 break，此前搜索消耗 25s deadline）→ 真实 canonicalUrl 未被抓取 → content 仍 INSUFFICIENT_CONTENT(2)、evidence=2、finalEvidence=0、displayed=0。机制经 mock 验证生效；真实 run 被既有 enrichment budget 守卫饿死。
- New FIRST LOSS STAGE（真实 run）: INSUFFICIENT_CONTENT —— 但现在是"enrichment 未获 budget 而根本没抓正文"，非机制内判定。
- Status: PARTIAL（机制 CODE-PATH VERIFIED via mock；真实 canonicalUrl detailAttempted=0，未达 LOCKED 要求的"真实 detailAttempted>0 + detailSuccess>0"。下一步为调整 enrichment budget 守卫使真实 run 能执行 enrichment——触及 deadline/budget，需用户授权，不在本轮范围）

## 2026-09-21 — Budget Allocation Calibration — Detail Enrichment Reserve

- Date: 2026-09-21
- Commit: PENDING
- Layer: Worker-deadline budget allocation / detail enrichment reserve
- Symptom / Failure: Content Enrichment 修复后真实 E2E 仍 detailAttempted=0。时间线审计：search 阶段（general-web 4 查询在两引擎不可达时全量超时）消耗 ~30s，远超 25s deadline，enrichment 开始时 remainingMs<=0。
- Root Cause: FIRST BUDGET STARVATION POINT = search 阶段。enrichment 的 remainingBudgetMs = min(12000, max(0, remaining - 7000)) 在检索超时时已经=0；且 7000ms post 保留对真实后处理（实测 ~30ms）是 ~230 倍。
- Fix: 引入基于实测的 reserve——DETAIL_FETCH_RESERVE_MS=8000（2×现实 detail 抓取~4s）、POST_PROCESSING_RESERVE_MS=2500（post 实测 30ms 的安全下限）、PLANNING_MARGIN_MS=2500、RETRIEVAL_RESERVATION_MS=13000。general-web/community 属 luxury 发现层，当 remainingMS() <= RETRIEVAL_RESERVATION_MS 时不再启动新请求（don't-start-new-request guard）；enrichment post-reserve 降为实测 floor（2500 而非 7000）。total deadline 25s 不变。
- Regression: tests/budget-allocation.test.ts 新增 A–D（A 充足预算→enrichment 实际执行；B 预算紧张→luxury 发现让位且 enrichment 仍有执行窗口；C 无 eligible→充足预算下 retrieval 维持现状；D detail 抓取失败 fail-soft 不崩）。budget 4 PASS；agent-runner 33、public-alpha-research 11（E/F 零证据 deadline 与 Evidence>0 不回归）、detail-enrichment 8、source-enrichment 14、topic-relevance 13、retrieval-coverage 6、intent-aware 13、retrieval-plan-contract 9 PASS；typecheck、lint、api:build、git diff --check 通过。
- Real E2E（signals-ed67831b-8b02-4327-b9a6-ebe11b3b7b5d）：search 从 30029ms→1613ms（general-web 守卫生效），**detailAttempted=1**（修复前 0），detail_fetch durationMs=10014（用满 10s resolver timeout），detailSucceeded=0、detailFailed=1（github.com/palmier-io/palmier-pro 本机 curl ~4.9s 但 pipeline fetch 超 10s）。后处理完成、response 返回。
- NEW FIRST LOSS STAGE: INSUFFICIENT_CONTENT —— 但现在原因是 canonical detail fetch 真实失败（github 在本环境 >10s resolver timeout），不再是"从未获得执行窗口"。按 PHASE 8 在此停止，不追下一层。
- 判定: Budget Allocation = LOCKED（PASS1 总 deadline 不变；PASS2 detailAttempted>0；PASS4 后处理完成；PASS5 零证据 deadline 回归全绿；PASS6 单次 enrichment timeout fail-soft）。Content Enrichment = PARTIAL（PASS3 detailSuccess=0——github canonical 在本环境 10s 内抓不全）。
- Status: Budget Allocation LOCKED / Content Enrichment PARTIAL。

## 2026-09-21 — Canonical Detail Fetch Calibration

- Date: 2026-09-21
- Commit: PENDING
- Layer: Detail enrichment canonical fetch / budget allocation
- Symptom / Failure: 上轮真实 E2E detailAttempted=1 但 detailSucceeded=0（github canonical 10s 超时）；本轮并行 enrichment 曾导致 WORKER_DEADLINE 硬失败。
- Root Cause: FIRST FAILED OPERATION = github.com/palmier-io/palmier-pro TCP connect 超时（headers 从未到达，AbortError @10s；raw TCP family4 connect 12s 超时，family6 ENOTFOUND）——本沙箱对 github 间歇不可达（curl 偶发 ~5s 成功，undici 常超时），非 resolver body-read/decode bug、非 timeout 过小。mosaic.so/example.com undici 正常（headers 1.95s/0.7s）。并行 Promise.allSettled 会等待挂起 fetch 推过 deadline → WORKER_DEADLINE。
- Fix: 撤销并行 enrichment（回到 budget 尊重 sequential）；保留 budget floor（POST_PROCESSING_RESERVE_MS=2500）；对 PH/HF（不可靠 luxury 发现层）加 RETRIEVAL_RESERVATION_MS=13000 守卫（HN eligible 来源恒跑）。total deadline 25s 不变。
- Regression: tests/detail-enrichment.test.ts B2（两 eligible 一通一达→两者尝试、可达者成功）+ budget-allocation A-D；detail-enrichment 9、budget 4、retrieval-coverage 6、agent-runner 33、public-alpha 11 全 PASS；full suite 410 pass/0 fail；typecheck、lint、api:build、git diff --check 通过。
- Real E2E（signals-f1689eac-e408-4de3-b128-53e3854ea534）：**detailAttempted=2、detailSucceeded=2**（Palmier + Mosaic canonical 均真实抓取成功），无 WORKER_DEADLINE，后处理完成。
- New FIRST LOSS STAGE:
  - Palmier（github）：contentQuality 越过 INSUFFICIENT_CONTENT → 现为 **STALE**（发布于 2025-07-23，超出"过去 30 天"窗口）——合法 freshness 过滤。
  - Mosaic（mosaic.so）：**INSUFFICIENT_CONTENT**（claim 契约：落地页缺动作动词）——符合 Content Quality Contract。
- 判定: Canonical Detail Fetch = LOCKED（真实 canonical fetch SUCCESS、regression 全绿、fail-soft 保持）。Content Enrichment 升级：content-quality 不再错误杀死相关候选（Palmier 越过 content-insufficient），但 displayed 仍 0 因合法 freshness/claim。Budget Allocation 需 full suite + commit + ledger + push 后才正式工程 LOCKED。
- Status: Canonical Detail Fetch LOCKED；Content Enrichment content-layer LOCKED（displayed 受合法 freshness/claim 限制）。

## 2026-09-21 — Evidence Entry Calibration

- Date: 2026-09-21
- Commit: PENDING
- Layer: Evidence Entry / evidence record construction / pipeline entry
- Status: LOCAL PASS / FORMAL REGRESSION LOCKED（仅机制锁定，非 Evidence Quality 总闭环）
- Formal regression: tests/evidence-entry.test.ts（1 PASS，已注册进 npm test）
- Verified behavior: fresh（30 天窗口内）+ canonical content VALID + claim VALID → EvidenceRecord constructed（evidenceRecords>=1）→ Evidence Evaluation reached（evaluatedEvidenceCount>=1），且 insufficientContent=0、stale=0。
- Fixture downstream: 候选最终在 Reliability / Verification 被拒（单条未验证 HN social/tier C 源）→ 判定 contract-consistent，**不是 Evidence Entry 失败**。未修改 Reliability / Verification。
- 明确: REAL E2E EVIDENCE ENTRY NOT YET AVAILABLE；REAL E2E RE-TEST PENDING。不写 "Evidence Quality = LOCKED"，不写 "Reliability = bug"/"Verification = bug"（除非后续直接证据）。
- Prior chain: Canonical Detail Fetch = LOCKED；Claim Construction = LOCKED（TRUE POSITIVE = fresh claim-VALID fixture；TRUE NEGATIVE = Mosaic CORRECT_REJECTION）。

## 2026-09-21 — Reliability / Verification Calibration

- Date: 2026-09-21
- Commit: PENDING
- Layer: Evidence Quality / Reliability / Verification
- Status: FORMAL FIXTURE LOCKED / REAL E2E PENDING（不写 REAL E2E CLOSED）
- Formal regression: tests/reliability-positive.test.ts（1 PASS）
- TRUE NEGATIVE（evidence-entry.test.ts）: single HN social/discovery → verificationStatus=unverified → reliability=30 → LOW_RELIABILITY → CORRECT_REJECTION。
- TRUE POSITIVE（reliability-positive.test.ts）: HN social + independent arXiv primary（related()=true）→ verificationStatus=verified → independentEvidenceCount=2 → reliability=94 ≥ 55 → lowReliability=0 / insufficientVerification=0 → PASS。
- 边界: canonical 首方目标 ≠ independent corroboration；single unverified source → low reliability 是产品 contract，非 implementation bug。未改 Reliability/Verification threshold。
- 明确: REAL E2E Evidence Entry / Reliability / Verification 仍 PENDING（真实 E2E 尚未有候选进入 Evidence）。
