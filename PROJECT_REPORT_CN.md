# Signal Map 项目技术报告

> 状态日期：2026-09-22 ｜ 基线：`423 项测试，420 通过，0 失败，3 跳过`
> 所有"已实现/未实现"仅依据仓库中真实存在的代码、测试与提交历史，不夸大、不臆测。
> 专业名词给出英文原名 + 中文解释，避免只堆术语。

---

# 第一部分：能力总览

## 1.1 这是什么

Signal Map 是一个**个人信息认知系统**（Personal Intelligence Agent）。它要解决的不是"帮你搜到更多东西"，而是：

> 在信息过载里，找出**值得你相信**且**值得你注意**的**新变化**。

它不是普通搜索（Search）、不是 RAG（检索增强生成，Retrieval-Augmented Generation，即"先查资料再喂给模型生成答案"）、不是 feed 阅读器。它的核心循环是：

```
研究(Research) → 理解(Understand) → 记忆(Remember) → 比较(Compare) → 判断(Judge) → 行动(Act) → 学习(Learn)
```

一句话判断一个系统是不是"真认知"而不是"假 RAG"：**它有没有跨时间的连续记忆，并在新信息到来时和旧记忆做比较、只保留真正的增量。**

---

## 1.2 已实现能力（按模块，附中文说明）

### ① 意图识别与规划（Intent & Planning）—— 已 LOCK

- **Intent classification（意图分类）**：把用户问题归类为 `PRODUCT_UPDATE`、`JOB_SEARCH`、`TECH_RESEARCH`、`TOOL_DISCOVERY` 等 17 类研究意图。
- **ResearchPlan → RetrievalPlan（研究计划→检索计划）**：从问题生成实际 pipeline 要执行的查询，且严格防止把用户的身份、已知信息、内部脚手架污染进查询和实体（entity）。
- 历史问题：AI 视频工具的查询曾被误判为求职（因为子串把"工作流"里的"工作"当成了就业关键词）。已修复并用回归锁定。

### ② 来源选择与发现（Source Selection & Discovery）—— 部分实现

- **Source profile（来源画像）**：每个意图有偏好来源，如 `OFFICIAL`（官方）、`PRIMARY`（一手）、`GITHUB`、`GENERAL_WEB`（通用网页）。
- **社会信号只作发现线索**：Hacker News / 社区帖是 `discovery`（发现层），**不是**独立的事实来源。产品原则：社会帖只负责"发现"，`primary/official` 负责"验证"（verification）。

### ③ Canonical 解析与详情抓取（Canonical Detail Fetch）—— 已 LOCK

- **Resolver（解析器）**：把一条社会/发现链接解析为最终的官方页面 URL（canonical URL）。
- **Detail enrichment（详情增强）**：抓取 canonical 页面正文；并预留预算（`POST_PROCESSING_RESERVE_MS`），避免被慢的上游把提取和 claim 处理饿死。
- 失败方案记录：曾用"有限并行富集 + `Promise.allSettled`"，结果仍被挂起的 GitHub 请求卡住导致 worker 超时，已回滚。GitHub 超时被判为**环境问题**，不是产品 bug。

### ④ Claim 构造（Claim Construction）—— 已 LOCK

- 原则：**claim（事实断言）必须来自"正文支撑的事件事实"**，不能只用发现层的标题。
- 真实负例 Mosaic：canonical 正文没有发布/更新事件 → `NO_SUPPORTED_CLAIM`（无支撑断言）→ 正确拒绝。
- 正式正例 Palmier：canonical 正文含 "launches"（发布）→ claim VALID。

### ⑤ 证据入口（Evidence Entry）—— 正式回归 LOCK / 真实 E2E 待定

- 前提：新鲜(fresh) + canonical 正文有效 + claim 有效 → 构造 `EvidenceRecord` → 进入 `Evidence Evaluation`（证据评估）。
- 注意：**fixture 通过 ≠ 真实 E2E 通过**。真实线上 E2E 尚未有候选进入这一层。

### ⑥ 可靠性与验证（Reliability / Verification）—— 正式 fixture LOCK / 真实 E2E 待定

- **Reliability（可靠性评分）** + **Verification（验证状态）** 是两套独立门槛。
- 负例：单一 HN 社会来源，无独立一手佐证 → `unverified` → reliability=30 → `LOW_RELIABILITY`（低可靠）→ 正确拒绝。
- 正例：HN 社会 + 独立 arXiv 一手佐证 → `verified` → reliability=94 → 通过。
- 关键概念：canonical 目标页 ≠ 独立佐证。单条未验证社会源判低可靠，是**产品契约**，不是实现 bug。

### ⑦ 知识比较（Knowledge Comparison）—— 部分校准

这条是"真正的记忆"所在：新证据进来后，和已有知识比较，决定它是**重复、补充、冲突、还是全新**。

| 分类（classification） | 中文含义 | 运行时状态 | 持久化 | 状态 |
|---|---|---|---|---|
| `DUPLICATE` | 重复（用户已知） | `NO_INFORMATION_GAIN` 无信息增益 | 不写 | 已 LOCK |
| `UPDATES` | 补充（旧事实保留 + 新增细节） | `UPDATED_INFORMATION` | 追加一条 | 已 LOCK |
| `CONTRADICTS` | 冲突 | `conflicting` | 拒绝写入 | 已 LOCK |
| `MAJOR_CHANGE` | 重大状态变化 | （无独立枚举，走 `UPDATES`） | 追加 | **能力缺口** |

- 当前实现没有 `MAJOR_CHANGE` 枚举。一个"产品从开源改为付费托管"的重大变化，会走和普通补充一样的 `UPDATES` 路径，旧事实不被标记为 superseded（被取代）。**这是产品能力缺口，不是回归 bug**——现有分类枚举从未要求区分。
- 结论：**Knowledge Comparison = PARTIALLY CALIBRATED（部分校准）**。

### ⑧ 注意力（Attention）—— 正式 fixture LOCK / 真实 E2E 待定（本轮修复）

- 分类：`MUST_READ`（必读）、`WORTH_WATCHING`（值得关注）、`LIBRARY_ONLY`（仅入资料库）、`IGNORE`（忽略）。
- 本轮**修复**了一个真实架构 gap：研究阶段先用启发式算一个"预注意力"（provisional attention），之后知识比较（reconcile）才能确认信息增益。修复前，一个用户已知的同义重复（launched/launches）会以 `MUST_READ` 被推送。
- **最小修复**：新增 `reconcileAttentionDecision`，在 reconcile 之后把 `NO_INFORMATION_GAIN` 的信号从 `MUST_READ`/`WORTH_WATCHING` 降为 `LIBRARY_ONLY`。已用正/反/语义重复三个 fixture 锁定，不误伤真正的新信息。

### ⑨ 用户反馈学习闭环（Feedback / Learning Loop）—— 已实现（本地 fixture）

这条是"个人认知"真正区别于普通 RAG 的关键：**用户的反馈被持久化，并在下一次运行时实际改变系统判断**。

- **数据模型**：`UserPreferenceRecord`（用户偏好记录），字段为 `scopeType`（作用域：实体/主题/类别）、`scopeValue`（作用域值，如 "Palmier Pro"）、`feedbackType`（反馈类型，本轮为 `LOWER_ATTENTION` 即"降低注意力"）、`createdAt`/`updatedAt`。
- **持久化**：新增 `PreferenceRepository` 接口（`savePreference` / `listPreferences`），`InMemorySignalRepository` 已实现；按用户 + filter 作用域隔离。postgres 本轮不强做迁移，未强制实现该接口。
- **消费点**：`runAgent` 每次运行加载已保存的 preferences，在知识协调之后、最终注意力组装之前应用 `applyAttentionPreferences`。
- **行为闭环**：运行 1 无偏好时，一条新鲜 verified 高价值信号 → `MUST_READ`；用户反馈"这类信息以后不用提醒我"（`LOWER_ATTENTION` for entity "Palmier Pro"）；运行 2 用同一实体的**新事实**（并非重复）→ 加载偏好 → 从 `MUST_READ` 降为 `LIBRARY_ONLY`。
- **关键产品原则**：用户反馈改变的是**"是否值得打扰我"（personalized Attention）**，**不是**"事实是否成立"（epistemic state）。知识记录、证据、reliability、verification 均不被反馈改写。
- **归因干净**：第二个用例特意用"非重复的新事实"，从而证明降级唯一来自持久化的偏好，而不是由于 reconcile 判重（reconcile 只降 `NO_INFORMATION_GAIN`，此处是 `UPDATED_INFORMATION`）。

（关于反馈与整体系统位置，见第一部分 1.2 与第二部分 2.3。）

### ⑨-bis 补充说明

以上 ⑨ 之前已有模块编号；此处 Feedback 学习闭环为新增能力，实现在本报告较晚阶段完成，放在这里以便与"已实现能力"整体对照。

### ⑨-bis 数据层、运行时与部署（Data / Runtime / Deployment）

- **数据层（Data / Repository）**：`InMemorySignalRepository`（内存仓库，供测试）、PostgreSQL 仓库与 pgvector 迁移（有独立测试）。注意：pgvector 检索**不是**当前 fixture 比较所走的路径——那是内存指纹 + 词重叠。
- **运行时与预算（Runtime / Budget）**：`BudgetManager`、约 25s 的 worker deadline、post-processing 预算预留。**不靠无限加超时来掩盖质量问题**。
- **部署（Deployment）**：前端 Vinext（workerd，3000 端口）；数据库后端 API 通过 Node 服务（8080）代理，因为 `pg` 无法在 workerd 里开 TCP 连接；Postgres 通过环境变量配置（Supabase pooler）。认证用 Supabase SSR。EdgeOne 部署脚本存在，但**未声称**当前线上域名正在服务校准后的构建。

---

## 1.3 未实现能力 / 待办

| 能力 | 中文说明 | 当前状态 |
|---|---|---|
| **真实线上 E2E 证据入口** | 真实互联网检索出的候选能真正进入 Evidence 层 | REAL E2E PENDING（线上检索受限） |
| **Knowledge SUPPLEMENT / CONFLICT 线上验证** | 补充/冲突的本地 fixture 已过，但真实 E2E 未过 | REAL E2E PENDING |
| **MAJOR_CHANGE（重大变化）** | "产品重大转向"应被识别为 supersede，而非普通补充 | 产品能力缺口 |
| **Attention 真实 E2E** | 线上注意力决策验证 | REAL E2E PENDING |
| **Attention 中 `UPDATES` 是否应提升注意力** | 知识补充是否该升为 `MUST_READ` | 未定（本轮刻意不做） |
| **Conflict 语义推断** | 系统**不**从"did not launch"这类自然语言推断冲突；冲突状态来自上游 verification | 契约边界，非 bug |
| **Feedback → Knowledge Update 校准** | 用户反馈闭环 | 未开始 |
| **Scheduler / Proactive Discovery** | 定时主动发现 | 未做校准 |
| **通知/推送真正投递** | 实际发邮件/推送/UI 通知 | 未实现 |
| **长期学习证明** | 跨 run 的记忆是否真的改变后续规划 | 仅 DUPLICATE 阻断有证据 |
| **pgvector 作为实际检索路径** | 向量检索是否真正接入 | 仅 schema/测试，非当前 fixture 路径 |
| **线上部署闭环** | 公共域名服务校准后的构建 | 未验证 |

---

# 第二部分：全部修改过程（工程演进复盘）

> 这部分的重点是：**哪些是用户做出的产品/架构决策，哪些是 AI 辅助的实现与验证**。不把 AI 写出的代码包装成用户手写，也不把产品设计归给 AI。

- **Product / Architecture Decision — User（用户决策）**：产品目标、证据优先于信息量、社会源只作发现、一手/官方用于验证、新鲜度/有效性/权威性、基于证据的判断、注意力而非信息量、长期知识。
- **Implementation / Verification — AI-assisted（AI 辅助实现与验证）**：绝大多数代码、测试、追踪、文档由 AI 协助完成，并在用户确认的产品契约下进行校准。

## 2.1 校准方法论（贯穿全程的工程方法）

```text
FIRST LOSS（第一个失败点）
→ TRUE BUG（真 bug） 还是 CORRECT_REJECTION（正确拒绝）
→ TRUE NEGATIVE（负例：该拒就拒）
→ TRUE POSITIVE（正例：该过就过）
→ TDD regression（回归锁定）
→ Real E2E（真实线上）
→ LOCK（锁定）
```

两个贯穿原则：

1. **区分 FIRST LOSS POINT（在哪个环节丢失）≠ FIRST FAILED OPERATION（哪个操作出错）**。正确拒绝时 FIRST FAILED OPERATION = NONE。
2. **LOCAL PASS（本地通过）≠ REAL E2E CLOSED（线上闭环）**。绝不把 fixture 通过夸大成线上可用。

## 2.2 按提交历史回顾修改过程

### 阶段一：意图/主题相关性可靠性（较早提交）

| 提交 | 说明 |
|---|---|
| `473edc2` `4b84484` `3f0df7c` `b2ca8a6` `4dcc421` | 强制 domain+task 主题锚点、把规范化与候选准入分离、主题相关性门控语义 |
| `0ce661f` | **修复**：AI 工具研究查询被误判为求职（子串把"工作流"的"工作"当就业词） |
| `156bbc3` | 记录意图可靠性锁定 |

### 阶段二：检索覆盖（Retrieval）

| 提交 | 说明 |
|---|---|
| `28f5ec8` | **修复**：多源检索覆盖与提供方韧性（DuckDuckGo 兜底、HN/arxiv 空发现技术兜底） |
| `eff9a03` | **修复**：接受受控的 AI 视频剪辑变体相关性 |
| `c29bc3b` | 记录检索与相关性可靠性锁定 |

### 阶段三：运行时架构（Runtime Architecture）

| 提交 | 说明 |
|---|---|
| `c868ccc` | **修复**：把 Postgres API 路由到 Node 后端（因为 `pg` 在 workerd 里无法开 TCP 连接） |
| `16ad8f9` | **修复**：零证据时优雅处理 deadline |
| `3d97176` | 记录运行时传输与 deadline 降级锁定 |
| `45fd724` | **修复**：预算预留下完成 canonical 详情内容 |
| `32e1f90` | 记录 canonical 详情抓取校准 |
| `8842f5e` | **测试**：锁定新鲜 + 有效 claim 进入评估（Evidence Entry 正式回归） |
| `ca105bb` | **测试**：锁定 Reliability/Verification 正例路径 |

### 阶段四：知识比较（Knowledge Comparison）

| 提交 | 说明 |
|---|---|
| `dec5da3` | **测试**：锁定重复比较路径 + 加入项目报告 |
| `6550665` | **测试**：锁定补充(UPDATES)与冲突(CONTRADICTS)路径 |
| `6c90260` | **测试**：记录重大状态变化的能力缺口 |

### 阶段五：注意力（Attention）

| 提交 | 说明 |
|---|---|
| `b479858` | **测试**：锁定已接受更新进入注意力的入口路径 |
| `ff77947` | **测试**：锁定正例/负例 + 记录 reconcile 与注意力脱节 |
| `78d3a15` | **修复**：让最终注意力服从知识比较的信息增益（核心修复） |

### 阶段六：文档

| 提交 | 说明 |
|---|---|
| `32e1f90` `3d97176` `c29bc3b` `156bbc3` | 各阶段可靠性/校准记录 |
| `dec5da3`（含）之后 | `SIGNAL_MAP_PROJECT_REPORT.md` 项目报告持续更新 |

## 2.3 当前系统状态矩阵

| 模块 | 状态 | 验证 | 真实 E2E |
|---|---|---|---|
| 规划 Planning | 本地 | 测试 | 非本轮 |
| 来源选择 Source Selection | 本地 | 测试 | 非本轮 |
| 发现 Discovery | 本地 | 测试 | 部分/环境受限 |
| Canonical 抓取 | 正式锁 | 测试 | 环境受限 |
| Claim | 正式锁 | 测试 | 待定 |
| 证据入口 Evidence Entry | 正式回归锁 | 测试 | 待定 |
| 可靠 Reliability | 正式 fixture 锁 | 正+负 | 待定 |
| 验证 Verification | 正式 fixture 锁 | 正+负 | 待定 |
| 知识比较 Knowledge Compare | 部分校准 | 重复/补充/冲突 | 待定 |
| 信息增益 Information Gain | 被比较使用 | 去重测试 | 待定 |
| 注意力 Attention | 正式 fixture 锁 | 正+负+语义重复 | 待定 |
| 知识更新 Knowledge Update | 已接 | 重复不双写 | 内存 fixture |
| 反馈学习反馈 Feedback Loop | 正式 fixture pass（本地） | agent-runner 测试 | 未闭环 | 偏好降低注意力；postgres 偏好未迁移 |
| 调度 Scheduler | 存在 | 测试存在 | 未关闭 |
| 主动发现 Proactive | 未校准 | — | — |

## 2.4 值得记录的工程教训

1. **正确拒绝是成功**：一个按契约该被拒的信号被拒，是正确行为，不是要"修复"的失败。
2. **契约 ≠ 实现**：`compareKnowledge` 是运行时分类器；当产品概念（如 Major Change）与枚举不一致时，是能力缺口而非 bug。
3. **最小修复**：Attention 的架构 gap 用一条 `reconcileAttentionDecision` 修复，不重写评估器、不改阈值、不误伤正例。
4. **不靠加超时**：预算与优雅降级是质量手段，不是掩盖慢上游的借口。
5. **fixture ≠ 线上**：所有锁定都明确区分"本地 fixture 通过"与"真实 E2E 闭环"。

## 2.5 关键文件位置

- 意图/规划：`intent/`、`planning/`
- 检索/发现：`research/`（`research-pipeline.ts`）
- Canonical/详情：`source-enrichment/`
- Claim：`content-processing/`
- 评估/知识/注意力：`agent/`（`runner.ts`、`evaluation.ts`、`knowledge-updater.ts`）
- 数据层：`information/`（`rag-records.ts`、`repositories/`）
- 运行时：`backend/`
- 测试：`tests/`

---

*本报告反映仓库当前状态；任何被标记为 PENDING / 能力缺口 / 待定的能力，不应在后续沟通中被描述为"已上线"。*
