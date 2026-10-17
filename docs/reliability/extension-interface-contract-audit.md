# 扩展接口契约核对（2026-10-04，封口前审计）

只读审计；未新增代码/路由/配置（当前闭环不需要，不新增空壳 API）。
验证程度分级：**[实测]**=真实页面/真实运行轮次取证；**[离线测试]**=注入替身单测覆盖；**[未验证]**=仅有类型/骨架，不宣称可用。

## 一、来源接入

| 接口 | 真实位置 | 输入→输出 | 身份隔离 | 预算/超时 | 失败状态 | 已验证程度 |
|---|---|---|---|---|---|---|
| 来源检查 | `POST /api/sources/check`：边缘 `app/api/sources/check/route.ts` → api-proxy → `backend/custom-sources.ts createSourceCheckHandler` → `source-enrichment/custom-source.ts readCustomSource` | `{urls:string[]}`(≤8KB, ≤5条) → `{checks:CustomSourceCheck[]}`（无正文，含 status/reason/requestCount/publishedAtSource） | `withSession`+`resolveResearchIdentity`（匿名 cookie 身份，限流按身份） | 每来源 5s deadline；DoH 3s；512KB 上限；≤2 重定向；限流 8 次/分/身份+3 并发 | `blocked/login_required/too_thin/failed/not_searched` + HTTP 400/429；DoH 瞬时失败诚实 failed 不回退 | **[实测]** 页面 3 轮（blocked/readable/瞬时失败）+ [离线测试] doh 7 用例、并发竞争、SSRF 守卫 |
| 来源配置 | `lib/custom-sources.ts`（parseCustomSources≤5、publicSourceUrl、isPublicSourceAddress）→ IndexedDB `lib/alpha-storage.ts saveFilterSources`（事务读-并-写）→ `information/research-request.ts createResearchRequest`（customSources 字段） | 浏览器输入 → 过滤器持久化 → 研究请求字段 | 每浏览器过滤器作用域（filterId） | — | 语法/私网拒绝即时反馈 | **[实测]** 保存/刷新保留 + [离线测试] 并发/校验 |
| 来源注册表扩展 | `source-registry/config-loader.ts loadSourceExtensions` + `mergeGithubTargets`/`mergeCompanyRegistry`（`source-registry/sources.json`，导入时一次，改动需重启） | entities[] → github 仓库/公司域名/更新页/别名 | 服务端全局（无用户维度） | — | 静默跳过重复条目（文档明示） | **[离线测试]** 默认实体在用；**用户扩展条目未端到端验证**（entities=[] 现状） |
| 来源分类 | `research/source-classifier.ts classifySource` + 管线 provider 计划（allowedProviderIds） | publisher+url → SourceType | — | — | other 兜底 | **[离线测试]**；行业正则即适配点 |

## 二、研究调用

| 接口 | 真实位置 | 输入→输出 | 身份隔离 | 预算/超时 | 失败状态 | 已验证程度 |
|---|---|---|---|---|---|---|
| 页面研究提交 | `POST /api/signals`：边缘 `app/api/signals/route.ts` → api-proxy → `backend/handlers.ts handleSignals` → `research/research-pipeline.ts runResearchPipeline`（agent/runner BudgetManager） | ResearchRequest（identity/industry/focusAreas/currentQuestions/knownInformation/informationGaps/trackedEntities/trackedEvents/userJudgements/freshnessWindow/customSources/researchContextRevision）→ ResearchResponse（signals/queryPlan/progress/failures/counts/overview/coverage/filteringSummary/evidenceAccounting/evidenceRecords/sourceOutcomes/customSourceChecks/requestId） | withSession+resolveResearchIdentity；仓储按 userId+filterId 隔离 | **deadlineAt=now+25s**；规划超时→deterministic_plan 兜底（实测触发并恢复）；DoH 3s/源 5s/DB 连接 5s | HTTP 200 + failures[]/providerOutcomes 诚实降级；405/400 | **[实测]** 页面真实提交 2 轮（DeepSeek 轮、Adobe 轮 `signals-baa5d0df`）+ [离线测试] 管线/预算/相关性多件 |
| Agent 循环入口 | `POST /api/research/agent`：`handleResearchAgent` → `agent/task-runner.ts runTaskPlannedAgent`（`createEnvironmentModelAdapter`） | 同上输入（需 industry）→ 任务规划+逐步运行结果 | `resolveAuthContext` 登录必需 + `ensureFilter` 403 | 由 runner 内 BudgetManager（默认 30s，可 maxExecutionTimeMs） | 400/401/403 + 任务级失败 | **[离线测试]** agent-runner 48、task-planning 13；**未真实轮** |
| 计划预览 | `POST /api/research/plan`：`handleResearchPlan` → `research/query-planner.ts planQuery` | 输入 → `{queryPlan}` | 登录必需（401） | 同步纯函数 | 400/401 | **[离线测试]**；本轮离线复现同函数 |
| 流式进度 | `GET\|POST /api/research/stream`：`handleResearchStream`（withSession） | 输入 → 进度流 | 会话隔离 | 同研究预算 | 流中断 | **[未验证]** 页面未接（无 EventSource），备用入口 |
| 库级入口 | `runResearchPipeline(input, onProgress, debug{customSourceReader,deadlineAt}, sourceSelection覆盖)` | 同 POST /api/signals；reader/计划可注入 | 调用方负责 context | 可注入 deadline | 同上 | **[离线测试]** 注入替身标准接缝（多件） |
| 目标续跑链 | `agent/goal-resume.ts resumeGoalIfReady` ← `scheduler/watch-runner.ts runSchedulerTick`（findDueGoals→claimDueGoal 租约→resume→`runTaskPlannedAgent`）；MANUAL/EVENT 目标不轮询 | SchedulerTickInput（workerId/leaseMs/limit）→ SchedulerTickResult | repository context 按 user/filter | lease 默认 5min | claimed=false 跳过；expired/failed 逐目标 | **[离线测试]** goal-resume 10 + scheduler 6；**无生产触发** |

## 三、结果消费

| 接口 | 真实位置 | 输入→输出 | 身份隔离 | 失败状态 | 已验证程度 |
|---|---|---|---|---|---|
| 个人知识/证据 | `GET /api/control/knowledge[?summary=1]`：`backend/control-plane.ts getControlKnowledge`（summary=1 去支撑证据） | → knowledge[]（type/text/provenance/revisionHistory）+ evidence[]（按记录关联） | withSession；repository 按 userId+filterId | 错误 JSON | **[实测]** 页面 35 条渲染含新记录 + 反馈轮实测 |
| 反馈写入 | `POST /api/control/knowledge`：同文件反馈处理（JUDGEMENT/KNOWN_INFORMATION/TRACKED_EVENT 语义分流） | 反馈草稿 → 个人知识记录 | 同上 | 400/401 | **[实测]** 反馈跨会话轮（pk-8mfntc 等） |
| 运行元数据 | `GET /api/control/agent-runs`：`getControlAgentRuns`→`runSummary`（id/userQuery/status/evidenceIds/finalAttention/trace/knowledgeChanges） | → agentRuns[] | 同上 | — | **[实测]** Adobe 验收取证（逐条注意力+trace） |
| 关注 | `GET /api/control/follows`（页面在用） | → follows[] | 同上 | — | **[实测]** 页面加载 |
| 目标 | `GET\|POST /api/control/goals` + `[id]/resume\|pause\|abandon` | 目标 CRUD/生命周期动作 | 同上 + 403 | — | **[离线测试]** goal-planning 17；子路由动作未逐个实测 |
| 通知读取 | `GET /api/control/notifications` + `[id]/read`（标记已读） | → notifications[]（digest 窗口/租约字段） | 同上 | — | **[离线测试]** control-plane；通知**投递生产链未接线**（见缺口） |
| 研究响应直消费 | POST /api/signals 响应 → 页面 `information/today-selection.ts selectTodayPresentation`（必读/可用更新/已追赶） | 响应 → 呈现分桶 | 页面会话 | 空桶 caught_up | **[实测]** 2 轮 |

## 四、筛选核心复用确认（不预开发）

- **核心**：`runResearchPipeline` + `topic-relevance` + 候选准入/证据门 + 知识比较 + `today-selection`——纯函数层；provider 执行经 `allowedProviderIds` 注入；`customSourceReader`/计划可注入替身。
- **行业适配 = 数据/配置层，无需新管线**：① `sources.json` 实体扩展（github 仓库/公司注册表/更新页，需重启）；② `source-classifier.ts` 行业正则；③ `query-planner.ts` expansions 行业词。已由本轮证明：Adobe 问题经同一核心跑通（含相关性修复后）。
- **定时监测 = 库级已备、外围缺失**：`runSchedulerTick`（租约/认领）→ `resumeGoalIfReady` → `runTaskPlannedAgent`；通知去重/摘要 `deliverAttention` 已有库+测试。缺生产触发与运行后接线——属新增外围模块（本轮不开发）。

## 五、缺口清单（均非当前闭环所需；只报告，不实施）

1. **调度触发入口缺失**：无 cron/端点调用 `runSchedulerTick`。最小接线：一个运维触发端点或外部 cron 调库级函数（带 workerId/租约）。
2. **研究后通知投递未接线**：`deliverAttention` 无生产调用方。最小接线：运行 `persistence_finished` 后按 finalAttention 调 `deliverAttention`（去重/摘要由既有 notificationKey/digest 承担）。
3. **sources.json Adobe 条目**（上轮已报）：纯数据配置待授权。
4. `/api/research/stream` 页面未接：备用入口，非缺陷；验证程度标为未验证。
5. **后续任务（明确不在本轮）**：服务端来源配置管理、通知渠道扩展（inApp 之外）、通知租约运维、行业专属正则扩充。

当前闭环（页面→来源→研究→筛选→呈现→反馈→记忆）接口完整且经实测——**本轮无需补任何接口**。
