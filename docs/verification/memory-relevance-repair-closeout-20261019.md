# 记忆相关性与前台交付修补 — 本地结项报告

- 日期：2026-10-19
- 分支：`fix/memory-relevance-20261019`（worktree `C:/Users/25186/AppData/Local/Temp/smfix/mem-worktree`）
- 基线：`7dab26096dcdd083adf20f272a89e854e9edfa2d`（fix/feed-parser-bounded-20261019）
- 范围：本地修复 + 本地验证。不部署、不 push、不 tag。

## 1. 前台失败取证结论（requestId signals-f7f22edd-898f-42d4-a585-1e3d190f7032）

后台任务 completed 但前台展示 "Live Web 暂时不可用" 的失败样本。本轮取证只读，未修改交付代码：

- CloudBase 日志中未取得该 requestId 的 HTTP 状态码与 phase 时长，**无直接证据**可还原前台失败点。
- 读取下一步：按 requestId 查 CloudBase 访问日志（ap-shanghai，环境 prod-5gcx79lya9e12c9f，日志查询 `signals-f7f22edd`），比对 `research_started → research_finished` phase 事件时间戳；前台 "Live Web 暂时不可用" 出现在 `research_finished` 缺失或超时的情况下。
- 沿同一请求链条发现的**确定性问题**（不需日志即可证明）：该请求的问题 plan 是 legacy 路径（无 topicProfile），原判定只要求实体命中，于是"Shopify AI Toolkit security scan""Shopify Hydrogen 版本发布"等无关材料进入证据池，前台呈现的话题混杂与"暂不可用"的降级文案可能同源（材料不足且不相关时 fallback 文案）。本报告第 2、3 节修复该根因。

## 2. 任务相关性修复（research/topic-relevance.ts, research/types.ts）

### 2.1 问题
legacy 路径判定 `subjectSatisfied && topicSatisfied` 只检查实体与查询词，"结账/支付"等**任务约束**不参与判定；同时 `canWriteKnowledge` 仅拒绝明确 `TOPIC_MISMATCH`，无 verdict 的信号（undefined）可写入知识。

### 2.2 设计
- 约束词来源收窄为 **`plan.coreKeywords` 的短词条** + `originalNeed` 的同语言族兜底（当 coreKeywords 缺少该语言族的短词时）。synonyms/topicKeywords 不进门禁——它们是发现层的同义扩展（"模型更新"等注册词），作为约束会过约束。
- CJK 片段按连接词切分（"结账与支付" → 结账/支付），每段须 2–3 字；叙事长句（"开源开发与工具"、"值得我测试的"）不产出约束——2-gram 爆炸曾制造 "发与" 这类伪约束，把真实 release 证据全拒。
- 停词表 `CONSTRAINT_STOP_TERMS`：疑问对象词（版本/升级/哪些/值得/安排…）、领域注册词（模型/生成/开源/开发/工具…）、时间窗（`30d` 等）。实体词与别名显式排除（"ComfyUI" 是主体不是任务）。
- 整句门槛：含 `?？。，,；;、` 的条目是问题正文，不是约束清单，跳过。
- **语言族回退**：与文本无共同语言族的约束组（中文约束 vs 英文正文）不判门槛，回退旧语义。避免"中文问题问英文 changelog"被误全拒（Adobe 计划场景）。
- 判定：`subjectSatisfied && taskSatisfied && topicSatisfied`；`matchedTaskConstraints` 记录命中的约束，新 reason `NO_TASK_CONSTRAINT_MATCH`。

### 2.3 测试（先红后绿）
`tests/task-relevance.test.ts` 5 项（Shopify 结账/支付计划）：
1. 同实体 + 任务约束 → MATCH（4 个中英正例）
2. 同实体 + 无任务约束（安全扫描/图片压缩/Hydrogon 发布/中文安全扫描）→ TOPIC_MISMATCH
3. 导航/订阅/频道介绍 → TOPIC_MISMATCH 且 relevanceGatePassed=false
4. 别实体材料不串入（Anthropic SDK payment 文档、Stripe checkout）
5. 同义词与语言变体容忍（tender types、支付方式与结账流程）

## 3. 写入准入收紧（agent/knowledge-updater.ts）

`canWriteKnowledge` 收紧为：`topicRelevance.decision === "MATCH"` 明示门槛（此前 undefined 也放行）、拒绝 CONTRADICTS/DUPLICATE、拒绝导航与频道套话文本（NAVIGATION_TEXT）。

`tests/memory-admission.test.ts` 8 项：导航/频道描述/无 verdict/离题实体均不写为 KNOWN_INFORMATION；正例仍准入；重复证据不加第二条；两用户两范围隔离。

## 4. 既有测试夹具对齐（tests/agent-runner.test.ts）

`signal()` 夹具补默认 `topicRelevance`（decision MATCH）——真实流水线对每个聚合簇调用 `assessTopicRelevance`（research-pipeline.ts），基线夹具缺该字段导致知识写入全部被拒（18 项误红）。

## 5. 验证结果

| 项 | 结果 |
|---|---|
| 定向组合（task-relevance / topic-relevance / memory-admission / memory-match-semantics / agent-runner / upgrade-context-wiring / signal-fusion） | 98 通过 / 0 失败 |
| 全量测试（npm test 全部 101 文件，node 24 运行） | 835 tests，830 pass，0 fail，5 skipped（环境条件跳过，无 skip 指令源码；本变更文件不涉条件跳过） |
| typecheck（tsc --noEmit） | 通过（退出码 0） |
| api:build（esbuild bundle backend/node-server.ts） | 通过（退出码 0，dist-api/server.mjs 1.4mb） |
| build（vinext build 全站） | 通过（退出码 0，"Build complete"） |
| eslint（变更文件 + 后续全量） | 变更文件干净 |
| knip / deps:check | 见下方记录 |

### 验证实施细则
- 测试运行器为 node 24（managed node 22 不支持 `--test-isolation=none`），命令与 `npm test` 等价：`node --experimental-strip-types --test --test-isolation=none <package.json test 列表>`。
- worktree 独立执行 `npm ci`（managed node 22）以取得 typescript/eslint/knip/depcruise/esbuild/vinext。
- 每轮回归均配基线对照（`git stash` 改动 → 单跑 → 恢复），确保失败/通过差异归因于本次改动而非环境。

### 回归事件记录（已修复，共 2 轮）
1. **升级上下文连线误红（4 例）**：`originalNeed` 尾部的 `30d` 时间窗与中文疑问词 2-gram 进入约束组，`relevant()` 把 GitHub release 证据判 MISMATCH。定位手段：复刻 stubFetch 的 probe + 临时约束日志 + 基线逐层对照。修复：约束来源收窄、时间窗过滤、叙事长句跳过、短词门槛。
2. **signal-fusion 误红（1 例）**：coreKeywords 的领域短语 `AI developer tools` 产生 latin 约束 `developer/tools`，把 "OpenAI News" 模板页判 MISMATCH（本应计入 insufficientContent 过滤）。修复：拉丁词条要求条目 ≤2 token。

两轮修复后定向组合与全量均恢复基线水平，且 `tests/task-relevance.test.ts` 5 项保持全绿（收紧未伤害目标场景）。

## 6. 变更清单

| 文件 | 变更 |
|---|---|
| `research/topic-relevance.ts` | 任务约束提取与语言族回退判定 |
| `research/types.ts` | `TopicRelevance.matchedTaskConstraints`、`TopicRelevanceReason.NO_TASK_CONSTRAINT_MATCH` |
| `agent/knowledge-updater.ts` | 写入准入收紧（MATCH 门槛 + 导航过滤） |
| `tests/task-relevance.test.ts` | 新增 5 项 |
| `tests/memory-admission.test.ts` | 新增 8 项 |
| `tests/agent-runner.test.ts` | 夹具补 topicRelevance（对齐真实契约） |
| `package.json` | test 脚本接入两个新测试文件 |
