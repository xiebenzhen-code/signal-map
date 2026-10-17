# 原问题有界集成修补报告（2026-09-30 第三轮）

## 1. 只读取证结论（子代理交叉验证 + 本地 trace 重建）

以 `signals-d5d3097d…` / `signals-7dd4694e…` 两轮真实响应与 backend-run5/6.log 为基准：

- **deadline 链**：`handleSignals` 固定 `Date.now()+25000` → `executeResearch` → `runAgent`（同一 `deadlineAt`，`maxExecutionTimeMs=deadline-now`）→ pipeline `debug.deadlineAt`。传递链完整无断点。
- **BudgetManager**：固定守卫 `canStartModelPlanning = remaining>9000`、`canStartRetrieval = remaining>4000`，单实例贯穿全部轮次。
- **primary 未执行的确切原因**（run5）：无实体 → `shouldStartWithDiscovery=false`（resolvedEntities 为空但 preferred[0]≠OFFICIAL → 常规 preferred=OFFICIAL 优先）；实际 selected=GENERAL_WEB（discovery-first 条件不满足时走默认 OFFICIAL+GENERAL_WEB 混合排序）。**allowed=[public-web,product-hunt,hacker-news,huggingface]** ——primary-web-search 不在 attempt-1 allowed 列表；候选非零（23 raw）→ fallback 触发条件 `signals.length===0` **成立过一次**（7 事件全被 evidence 门禁拒后 signals=0）→ fallback 进入 → plan_finished#2（PRIMARY，5 queries）→ `fallback_retrieval` 门 remaining=1984ms ≤ 4000ms → **WORKER_DEADLINE 抛出（runner.ts:317-318），fallback pipeline 从未执行** → catch 命中 `completeWithCumulativeResponse`（累计 9 evidence、0 展示）。
- **"13 秒直接阻止 enrichment"归因修正**（按任务要求不沿用）：enrichment 跳过发生在 detail_fetch（remaining≈2006ms），传入预算 `min(12000, max(0, 2006−2500))=0` → 循环首候选即触发 `elapsed(≥1ms) > 0` break（"已接近请求时间上限"，failures 已核验）。**这是"进入补全时实际剩余预算为 0"的直接证据，而非 13s 保留门本身**；真实运行中 RETRIEVAL_RESERVATION_MS 只影响 public-web/PH/HF 的启动门槛（run5 中 PH/HF not_searched 另有原因，属待证项，不在本轮处理）。
- **证据缺口（明确标注）**：run5 无逐候选 debug 日志，"enrich 输入的 23 条候选里 eligible 具体是哪几条"不可直接复原，只能由代码路径+响应字段间接推定（HN 2 条 providerId 存在、DDG 6 条 providerId=undefined——上一轮已修复其资格）。

## 2. 完整路径测试（真实编排，注入替身，先红后绿）

| 测试 | 观察到的红 | 修复后 |
|---|---|---|
| `tests/verification-budget.test.ts` RED A2：真实预算形态（模型规划 10.5s + 检索 12s 注入延迟、模型适配器替身、真实 runAgent 编排） | **红**：`attempts=[{round:1}]` —— 第二轮验证检索从未发生（与 run5 一致） | **绿**：round-2 实际执行，验证证据进入最终响应 |
| `tests/integration-patch.test.ts` RED B：前序检索慢（googleNews 1.5s）但剩余补全预算存在 → 相关候选进入详情补全 | 初始即绿（上轮资格修复生效）；本轮保留为回归 | 绿（detailAttempted≥1，门槛未放宽：0 展示保持） |
| `tests/integration-patch.test.ts` RED C：deadline 耗尽 → 不启动新抓取、诚实 needs_more_evidence | 初始即绿（既有守卫正确）；本轮保留为回归 | 绿 |
| 不相关/超窗/骨架继续拒绝 | topic-relevance/claim/quality 契约测试（既有 13+9 用例） | 全绿 |

修正说明：RED A 第一版（无预算形态）直接通过——证明**验证轮触发机制本身存在**（`evaluateEvidence` 的 socialOnly→CONTINUE 路径），真实缺陷是**预算分配使验证轮结构上不可能**，与子代理独立结论一致。测试因此修正为预算形态反例（A2）。

## 3. 实际修改（最小、未提交）

1. **agent/budget-manager.ts**：`BudgetManager` 增加 `attempt` 选项——验证轮（attempt≥2）守卫按 `1/2^(attempt-1)` 缩放（9000→4500→…、4000→2000→…，下限 1000ms）。**总 deadline、请求上限、门槛语义均未变**；只是后续轮次的门在剩余时间份额内可执行。
2. **agent/runner.ts**：两处门改用 attempt 缩放实例——轮首检索门（round≥2 用缩放实例，round-1 保持原守卫）与 fallback planning/retrieval 门。
3. **research/research-pipeline.ts**：enrichment 预算增加 **3000ms 下限，且被 `remainingMs()` 严格钳制**（deadline 耗尽时仍为 0，不启动任何新抓取——诚实降级保持）。

未做：不新增 Provider/Agent/依赖/库表；不重写 UI/管线；不放宽证据/相关性/时间门槛；不改总超时与请求上限。

## 4. 验证结果

- **quality**：547 tests / 542 pass / 0 fail / 5 skipped（typecheck 0 errors；lint 0 errors，8 warnings 全为既有文件）；knip/deps PASS。
- **api:build、build**：PASS。
- 回归：budget-allocation 4、agent-runner 33、integration-patch 3、verification-round 1、verification-budget 1、retrieval-coverage 6、detail-selection 4、comfyui-pipeline-window 1、public-alpha 11、research-policy/goal 等——全绿。

## 5. 真实用户结果（原问题全文、匿名、单次，预算已确认：仅本次触发的 DeepSeek planning）

| 项 | 值 |
|---|---|
| requestId | `signals-e5f91d07-69eb-4581-ba31-21a468cd0e9e` |
| 时间 / 耗时 | 07:45:57.794Z → 07:46:21.817Z（24.03s，deadline 25s 内） |
| HTTP / status | 200 / needs_more_evidence |
| 来源执行 | public-web 4 请求（0 raw，googleNews+DDG 均无结果）、hacker-news 1 请求（3 raw）；PH/HF/arxiv/primary 等 not_searched（本轮 HN 短查询命中 3 条相关 HN 帖） |
| 补全 | **detailAttempted=2（上轮 0）**：succeeded=1（Palmier GitHub 页，提取出真实发布内容 "releases through v0.7.6 … GPLv3"）、failed=1（超时 fail-soft） |
| 候选→拒绝 | ① Palmier（2026-07-23，**超 30 天窗**，正文已取得——合法 STALE）；② Mosaic（2025-11-19，超窗 + 正文不足）；③ Loopdesk HN 帖（2025-10-08，超窗 + 正文不足） |
| 展示 | **0 signals**（3/3 拒绝全部为合法时间过滤；无主题误杀、无证据伪造） |
| 修补生效证据 | detailAttempted 0→2、enrichment floor 在 remaining≈6.7s 时实际执行（上轮同位置为 0）；fallback 门 remaining=1150ms 时按缩放守卫（2000ms）判定不可行——**该判定正确**：1.1s 无法完成一次检索 |

**用户答案验收：不通过（0 展示）。** 当前失败阶段：**时间窗口**——本轮来源可达性与补全预算已修通（HN 命中相关帖、2 次补全实际执行、1 次成功提取正文），但该主题的社区高相关候选客观发布于 2025-10~2026-07，全部超出 30 天窗口；而 30 天窗口内的官方渠道（primary/官方页/GitHub Releases）在本轮仍因 discovery-first 编排未执行。未凑数量、未放宽门槛。

## 6. 剩余阻塞（证据支持，停止追加修复轮次）

1. **窗口内官方来源仍不可达**：discovery-first 编排下 attempt-1 的 allowed 不含 primary-web-search/GitHub Releases/官方页；这些来源只在 fallback（本轮 remaining=1150ms，任何检索都不可能完成）执行。要在此预算内真正打通，需要把 primary 类来源纳入 attempt-1 并行（管线编排层，超出本轮"不重写研究管线"边界）。
2. ** hn 候选的时间分布**：高相关 HN 内容集中在 2025Q4–2026Q3，30 天窗内 HN 无新帖（本轮 3 条全部超窗）——这是数据面事实，非管线缺陷。
3. 待证项（子代理同标注）：PH/HF 在 remaining>13s 时 not_searched 的内部原因；26 sourceStatus/13 sourceOutcomes 场景的实跑样本。

## 7. 限制遵守

未新增 Provider/Agent/框架/依赖/库表；未重写 UI 或研究管线；未放宽证据/相关性/时间门槛；未改知识/偏好/认证/数据库/migration；未 commit/push/部署/触发 Actions/打包；无关工作区改动保留；付费调用仅本轮一次（DeepSeek planning），未重试未换题；未以 CI/HTTP 200 替代答案验收；未宣称项目完成。
