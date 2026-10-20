# 记忆选择稳定性收口 — 本地结项报告

- 日期：2026-10-19
- 分支：`fix/stability-closeout-20261019`（worktree `C:/Users/25186/AppData/Local/Temp/smfix/mem-worktree`）
- 父提交：`bb842cb`（fix/general-relevance-memory-20261019）
- 本提交：**`44157e4`**（fix/agent,research: close memory selection stability defects and verify admission，7 文件 +714/−72）
- 范围：仅收口已确认缺陷与回归；不部署、不 push、不 tag、不新增线上研究、不改来源。

---

## 1. 起点与纪律

- 主仓库 HEAD 含他人变更，全部修补在隔离 worktree（父 `bb842cb`）进行，未触碰主仓库他人工作。
- 四缺陷中 1/2/3 为上一轮已修复项，本轮继承其成果并标明证据位置；缺陷 4 在本轮补有效反例、先红后绿。
- 用户明确约束：不移除 `model` 停词、不让 `launch`/`payment` 等通用任务词单独代表主体、保留 "Model X" 完整主体及限定符、夹具与生产契约不一致时纠正夹具而非放宽生产规则、只补两个成对反例、观察旧实现失败后做最小修复。

## 2. 缺陷 1/2/3 继承结果（证据位置）

| 缺陷 | 结论 | 代码/测试证据 |
|---|---|---|
| ① 记忆跨实体误选 | 已修：subject→task 两级选择，`matches()` 词边界匹配（"in" 不再命中 "billing" 内部） | `agent/memory-selection.ts`；`tests/stability-regressions.test.ts` 用例 1–3 |
| ② 空约束默认 MATCH | 已修：空约束 `openBrowsing ? MATCH : UNCERTAIN`；裸实体计划不进 MATCH | `research/topic-relevance.ts` `taskConstraintTerms`；`tests/stability-regressions.test.ts` 用例 4–6 |
| ③ 曾验证但过时的记忆 | 已修：verificationStatus（已/未验证）与事实时效（价格/版本等 30 天窗口）分离 | `agent/memory-selection.ts` `stability()`；`tests/stability-regressions.test.ts` 用例 7–9 |

三个缺陷的反例/正例共 9 例（影视/电商/编程）分布在 `tests/stability-regressions.test.ts`，全部通过。

## 3. 缺陷 4：被排除记忆污染初始计划（先红后绿）

### 3.1 修复前（bb842cb）的行为
`runner.ts` 曾把仓库内全部记忆拼进 `knownInformation`（→ `knowledgeAwareQueries`/`searchCombinations`/初始 plan 与 query 都会携带被排除记忆），`bootstrapStrategy` 由「仓库记录数>0」决定而非最终筛选。

### 3.2 反例（`tests/stability-excluded-memory.test.ts`，5 例，先红后绿）
- **A**：无关记忆不进 context/query/模型输入，策略 INITIAL 非 REFRESH
- **B**：相关记忆进入所有消费方，策略 REFRESH
- **C**：回退路径（无记忆时正常 INITIAL）
- **C2**：第二轮 round1 INITIAL，最终策略由 policy 决定（非记忆泄漏）
- **D**：持久化 RETRIEVE trace 反映最终选择与排除原因

### 3.3 修复内容（`agent/runner.ts`，按证据调整）
- `selectionPlan = planQuery({...input, currentQuestions: memoryQuestion})` —— 选择基于**当前问题**而非遗留 input（用户最新问题覆盖旧 `currentQuestions`）。
- `subjectSelection` 传 `taskLevel: false`、`taskSelection` 在其 `selected` 上跑、共用同一 `selectionPlan` —— 两级不重复判断。
- `finalRelatedKnowledge = taskSelection.selected.map(r => r.text)`；`bootstrapStrategy = finalRelatedKnowledge.length > 0 ? "REFRESH" : "INITIAL"` —— 基于最终筛选，无关记忆不强制 REFRESH。
- 5 处 `relatedKnowledge` 引用改 `finalRelatedKnowledge`；`plan = createResearchPlan(..., finalRelatedKnowledge, ...)` 在 taskSelection 后重建 —— 被排除记忆不进 initial plan/queries/knowledgeAwareQueries。
- 移除废弃 `retrieveStep` 变量；subject+task 两级诊断直接进 `add()` 的 input/output（消除 mutation 后持久化旧摘要）。

### 3.4 旧版红验证（bb842cb-verify）
独立导出 `bb842cb` + 复制的两个新测试文件 + junction node_modules，用同一 node24 跑：**7 红 / 7 绿**——红全由目标断言触发（A/C2/D 三例 + 四缺陷红例各一），先观察到旧版失败，再在当前版通过。

## 4. Model X 成对反例（任务 D 核心，两例）

`tests/stability-regressions.test.ts` 追加两个成对反例：

- **例 1（RED→GREEN）**：`query="Did Model X launch?"`、遗留 `entities=["Codex"]`、plan.entities=["Model X"]、记录 "Model X is now released" → 期望 selected=1。
  - 旧实现：Model X 拆词后 `model` 被 generic 停词过滤、`x` 因长度不足被过滤；手工匹配与实际函数词集合不同 → 记录被 `no_shared_subject` 排除（红）。
  - 最小修复：`subjectPhrases()` 提取大写词 run 作完整主体短语，`SUBJECT_PHRASE_LEADERS` 只作**前导剥离**（"Did Model X" → 跳过 did → "Model X"），而非整段丢弃；全泛化短语（"API"/"AI"）仍丢，限定符短语（"Model X"）存活；**不移除 model 停词、不让 launch/payment 单独代表主体**。
- **例 2（保持 RED→GREEN 排除）**：同 query，记录 "Model Y is now released" + "Shopify launches a new billing portal" → 期望全 `no_shared_subject`、0 selected。防止例 1 修复重新引入跨实体污染。

两例同时绿：例 1 选入正确主体，例 2 排除其他产品发布。

## 5. 本轮发现并修复的回归（旧版绿 → 新版红 → 修复后绿）

| 回归 | 表现 | 根因 | 修复 |
|---|---|---|---|
| Adobe legacy 路径误拒 | `genuinely relevant Adobe material stays admissible` 红（真实视频工具 release 被拒） | 空约束分支 `entryNamesTask` 把实体粘连条目误判任务性 | `research/topic-relevance.ts`：`NON_TASK_FUNCTION_WORDS`（介词/冠词/助词/变化词变形 "changed"/"in" 不再算任务词），`entryNamesTask` 具体 token ≥2 才判定任务性 |
| CONFIRMS 误判 NEW | `CONFIRMS updates provenance...` 红（已知事实被当新知识） | 夹具记录 "Codex is available"（"available" 是时间敏感词）在 2026-09-05 距今 44.7 天，被时效规则**正确**排除出 knownInformation | **纠正夹具**：记录日期改为 3 天前（`new Date(Date.now()-3*24h)`），保持用例契约（已知事实被确认 → CONFIRMS 不重写、不推进 revision），不放宽生产规则 |
| 24h 背景窗口信号消失 | `background evidence outside a 24h window cannot become must read` 红（5 天前 release 不再产出 BACKGROUND 信号） | 同 Adobe 根因：计划条目 "What changed in Codex?" 被拆成 "changed"+"in" 两个"具体 token" → 误判任务性 → 非 open browsing → UNCERTAIN → 候选被拒 | 同一 `NON_TASK_FUNCTION_WORDS` 修复（3 项回归同源：空约束 open-browsing 判定过严） |

修复均以探针复现后落地，全部回归用例在当前版绿；且 `relevant()` 仍放行 UNCERTAIN 材料（发现层语义未变）。

## 6. 固定验收与门禁（全部通过）

- **8 文件核心矩阵**（stability-regressions / stability-excluded-memory / memory-selection-acceptance / agent-runner / general-relevance / task-relevance / topic-relevance / memory-admission）：**116 tests / 115 pass / 0 fail / 1 skipped**（数据库相关跳过，见第 8 节）。
- **全量测试更正（2026-10-20独立复核）**：完整执行package.json的105文件清单，实际为 **873 tests / 862 pass / 5 fail / 6 skipped**，首次命令退出1。5项失败为沙箱禁止连接本地端口（connect EACCES 127.0.0.1），均位于proxy-auth-http.test.mjs；解除该限制后，该文件独立复跑 **6/6通过，退出0**。逐项复核未剩未解释失败，但不能称首次全量命令退出0。原795/789/0/6缺少完整执行清单依据，不再作为全量验收结论。
- **typecheck**：`tsc --noEmit` 0 错误。
- **lint**：0 error / 28 既有 warning（存量，未新增）。
- **knip**：clean。
- **deps:check**：170 模块 0 依赖违规。
- **build**（vinext）：成功。**api:build**：成功（dist-api/server.mjs 1.4mb）。
- 两个新测试文件已接入 `package.json` test 脚本（105 文件列表）。

## 7. 提交与差分

`44157e4`（父 `bb842cb`）：7 文件 +714/−72。

```
agent/memory-selection.ts               | 107 ++++++---
agent/runner.ts                         |  90 +++++-----
package.json                            |   2 +-
research/topic-relevance.ts             | 131 +++++++---
tests/agent-runner.test.ts              |   5 +-
tests/stability-excluded-memory.test.ts | 227 +++++++++++++++++++++++++
tests/stability-regressions.test.ts     | 224 ++++++++++++++++++++++++++
```

- 提交前已确认工作区变更文件为 LF（无 CRLF），`-c core.autocrlf=false add` 提交，无虚胖 diff。
- 未 push、未 tag、未部署；主仓库与他人工作未动。

## 8. 跳过项与边界

- **数据库测试**：全量6项跳过保留为环境条件跳过；其中新增验收文件有1项数据库前置跳过，不能据此推断全量只有1项数据库相关。配置后必须真断言，不得空通过。真实数据库链路尚未因本地内存测试而获得验收。
- **前台失败根因**：维持 **UNKNOWN**（405 归因已撤回——405 对应另一次 `GET /api/research/plan` 探测，不能证明原 `POST /api/signals` 失败；504 不直接归因容器出网）。本次未改前端 HTTP method，未新增线上研究。
- **部署边界**：本轮未部署；DeployId 015为此前发布记录，本轮未实时复查平台。015容器已存在一次Shopify读取与解析成功的历史证据（1,874,367字节、100条处理/60条归一），不能标成完全未验证；持续稳定性及本轮新代码的云端效果仍未验证。研究请求504不能直接归因容器出网。

## 9. 受控发布条件评估

本轮为本地验证 + 本地提交，**不具备自动发布条件**。如需上线，应满足：

1. 单独授权（含回归修复 3 项对应的测试在目标基线复跑通过）。
2. 从 `44157e4`（或后续收口提交）构建并按既有流程部署（参考 DeployId 014/015 的导出—构建—回退链）。
3. 部署后以原题进行一次真实研究复验（feed 端到端 searched_with_results），此前容器出网问题未闭环。
4. 已登录账户的保存与整页刷新读回、下一次研究读取旧记忆已有历史证据；尚未验证本轮代码的云端记忆质量、登出重登读回和完整前台交付。前台交付失败仍是产品验收阻断，不能称“不影响主链路”。

## 10. 2026-10-20复核更正与溯源

- 独立复核实际运行新增两个稳定性测试文件：16/16通过。旧版红对照7红7绿属于执行方历史记录，本次未重复运行。
- 原始全量日志位于主仓库 `outputs/stability-audit-20261020-full.log`；复核报告为 `docs/verification/stability-44157e4-audit-20261020.md`。
- 历史云端证据参见 `docs/verification/authenticated-browser-memory-20261019.md`、`memory-cross-run-relevance-audit-20261019.md`、`shopify-phase-015-result-20261019.md`（主仓库）。
- typecheck、lint、knip、deps:check及构建保持执行方原报告证据，本次文档更正未重跑这些检查。未修改产品代码，未声称线上稳定。
