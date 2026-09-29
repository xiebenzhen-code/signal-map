# Signal Map 验证包使用说明（V1.1 P1-A）

状态：**离线准备完成**。本包只提供"真实验证入口"，不构成真实 Provider E2E、长期个人闭环或生产能力已验证的声明。

## 1. 组成

| 入口 | 命令/位置 | 说明 |
|---|---|---|
| 预检 + LIVE 捕获 + 报告 | `node scripts/signal-map-agent-loop-e2e.mjs`（CI workflow 同款；需 secrets） | phase0 安全门 → 幂等 migration → 10-query 序列（逐 query 写捕获文件）→ 偏好隔离 HTTP 场景 → 报告 |
| 离线回放 | `node scripts/signal-map-agent-loop-e2e.mjs --offline-replay <capture.json> [--entity E]` | 纯文件操作：加载捕获产物 → 校验关联与 digest → 用真实 `applyAttentionPreferences` 重推导两臂 → 写 `signal-map-replay-report.json`（closed=false 时 exit 1） |
| 场景配置 | `SIGNAL_MAP_SCENARIO_CONFIG=<path>` 或 `--scenarios <path>`（CLI 待接）；示例见 `docs/verification-scenarios.example.json` | 四场景：newFact / duplicate / preferenceRestart / isolation；entity、queries、candidateSources 可配置；示例实体不必然有新事实，无合格候选时报告 PARTIAL |
| 捕获目录 | `SIGNAL_MAP_CAPTURE_DIR`（默认 `captures/<runId>/`） | 每个query 一份脱敏捕获（响应 + 显式 knowledgeState + inputDigest）；运行自有数据，清理仅限本次运行范围 |

## 2. 捕获文件契约（v1）

```text
captureVersion: 1
kind: SIGNAL_RUN_CAPTURE
commitSha / requestId / runId / entity / capturedAt   ← 溯源与关联
response: { signals[], evidenceAccounting }            ← 脱敏后的研究响应
knowledgeState: { knownFacts[] }                       ← 显式必填；空状态 = { knownFacts: [] }，与缺失不同
inputDigest: sha256(stable(signals))                   ← 加载器重算校验，防捕获后篡改
```

CAPTURED_REPLAY 有效性 = 加载成功 + 与被评估实体/运行关联 + 双臂同输入同知识初始状态（仅偏好条件不同）+ 真实 `applyAttentionPreferences` 重推导输出与声明一致。`FIXTURE_REPLAY` 只证明函数契约，永不关闭真实验收。

## 3. 报告分层

`phases.tenQuery`（PASS/PARTIAL/FAIL）内分别呈现：

```text
fixture:          tests/e2e-acceptance-logic.test.mjs（仅函数契约）
capturedReplay:   CLOSED / OPEN(原因)   —— 依赖真实捕获材料
live:             OBSERVED（rows 逐 query：runBinding/failureClass/classification/attention/知识计数）
realDatabase:     NOT EXECUTED in this run（真实 DB 集成测试在 npm test 中按 skip 标注）
```

被测版本：`underTest.commitSha`（git rev-parse HEAD）+ `workingTreeDirty`。CI 侧另有 `GITHUB_SHA`，两者不混用。

## 4. P1-B 执行清单（真实诊断）

前置条件（全部满足才执行）：
1. GitHub Secrets 10 必需项：`TEST_DATABASE_URL`（**独立测试库**）、`POSTGRES_SSL="true"`、`TEST_SUPABASE_URL`、`TEST_SUPABASE_PUBLISHABLE_KEY`、`TEST_SUPABASE_PROJECT_REF`、`TEST_DATABASE_SAFETY_ACK="independent-test-database"`、`TEST_ACCOUNT_A/B_EMAIL/PASSWORD`（两个不同账号）。
2. 被测版本：push 后的 master commit（本地未提交代码不参与）；如需捕获与 commit 绑定，先提交本轮改动。
3. 成本/请求上限：10 个真实 research 请求（每个 ≤25s deadline）+ 每 query 2 次 agent-runs 读 + 1 次知识读 + 隔离场景约 5 次 preferences 调用；建议一轮运行 ≤ 45 次 HTTP 调用、≤ 10 次 provider 检索。
4. 数据清理范围：仅 `filter-<runId>-*` 与两个测试账号名下的 notifications/goals/user_preferences/personal_knowledge/revisions/run_metadata/filters 及派生 evidence/claims/events；不触碰其他数据。

执行步骤：
1. Actions → "Signal Map Agent Loop E2E" → Run workflow（可选 `quality_query` 留空）。
2. 下载 artifact `signal-map-agent-loop-e2e-report`，核对 `underTest.commitSha` == 触发 commit。
3. 逐 query 审计：`runBinding=BOUND`（无 SNAPSHOT_UNAVAILABLE/AMBIGUOUS）、`failureClass` 分类、`classification`。
4. Q7 审计：`oldExit.stopped=true`、`identityConfirmation.confirmed=true`、`preferenceDurable=true`。
5. 从 Q1 捕获文件运行 `--offline-replay`（entity=Q1 实体）→ `signal-map-replay-report.json` 的 `closed=true` 才算 CAPTURED_REPLAY 闭合。
6. 核对 `preferenceIsolation.observed=true`（storage/auth/consumption 三段分别确认）。
7. 汇总判定：tenQuery=PASS 需绑定全通过 + duplicate 闭合 + 偏好归因闭合 + 隔离 observed；否则按缺失项如实 PARTIAL，不得谎报。

会发生真实调用/写入的步骤：上述 1（真实 provider 检索 + 测试库读写 + migration 幂等应用）。其余（离线回放、fixture 测试）为零外部调用。
