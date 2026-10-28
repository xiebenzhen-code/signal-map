# N5b｜新旧相关性门离线前后对照（只读）

日期：2026-10-26。范围：8 个离线冻结案例 + H03 冻结快照。旧门 `5142a6705b7cdb5f3b133d6a9567da9256019182`，新门 `p2n/stability-and-diagnosis`（运行时 HEAD `302a3993`，工作树含 N4 未提交改动）。

本轮只读复算：网络尝试 0（fetch/http/https/net/dns 全部安装拒绝守卫并触发 0 次）、模型调用 0、研究提交 0、产品源码修改 0（除 N5c 新增测试外）。机器可读证据：`outputs/n5b-gate-compare-20261026/gate-compare.json`、`rows.json`、`compare.mjs`（均在 gitignore 的 `/outputs/` 下）。

## 1. 口径必须先说清

| 项 | 本文含义 | 不含义 |
|---|---|---|
| 正式展示条数 | 在**判定层**通过相关性门、可进入正式结果的条目数上限 | 生产实际展示数（可靠性、新颖度、日期、注意力门未在离线层复算） |
| possibleRelated 条数 | `topicRelevance.decision === "UNCERTAIN"` 的条目数 | 已确认结论、必读、已核验事实 |
| 移动 | 同一批条目在新门里从「正式可展示」改为「possibleRelated」 | 线上流量变化、准确率提升 |

旧门语义（5142a67）：`research/research-pipeline.ts` 的正式结果只排除 `TOPIC_MISMATCH`、`IGNORE` 与 `INSUFFICIENT_CONTENT`，**不排除 UNCERTAIN**；当时没有 `possibleRelated` 字段。

新门语义（N4）：正式结果额外排除 `UNCERTAIN`，并由 `partitionByVerdictCertainty` 把 UNCERTAIN 分入 possibleRelated（`research/filtering-summary.ts:39-49`、`research/research-pipeline.ts:2581-2582`）。

**判定函数未变**：`git diff --stat 5142a67 HEAD -- research/topic-relevance.ts research/query-planner.ts` 为空，`parseRegisteredFeed` 也未改。脚本对 137 行逐行断言新旧 `decision` 与 `reason` 完全一致，断言全部通过。因此下表差异**只来自分区逻辑**，不含判定漂移。

## 2. 汇总

| 口径 | 旧门 | 新门 | 变化 |
|---|---:|---:|---:|
| 判定行 | 137 | 137 | 0 |
| 正式可展示（判定层） | 75 | 50 | −25 |
| possibleRelated | 0（字段不存在） | 25 | +25 |

## 3. 逐案例

| 案例 | 来源 | 行数 | 正式 旧→新 | possibleRelated 旧→新 | 移动数 |
|---|---|---:|---:|---:|---:|
| D01 | kdenlive | 20 | 9→9 | 0→0 | 0 |
| D02 | kdenlive | 20 | 9→9 | 0→0 | 0 |
| D03 | obs | 10 | 10→10 | 0→0 | 0 |
| D04 | krita | 20 | 20→20 | 0→0 | 0 |
| D05 | woocommerce | 12 | 2→2 | 0→0 | 0 |
| D06 | chrome | 25 | 25→0 | 0→25 | **25** |
| D07 | infoq | 20 | 0→0 | 0→0 | 0 |
| D08 | 36kr-flashes + geekpark-ai | 10 | 0→0 | 0→0 | 0 |
| H03 | 36氪快闪 + 极客公园（保存响应） | 34 | 24→24 | 0→0 | 0 |

## 4. 被移动条目（仅 D06，共 25 条）

全部 reason = `UNCERTAIN_TASK_CONSTRAINT`。题面为中文「过去7天 Chrome 浏览器的安全更新有哪些变化？」，材料为英文 Chrome 发布说明，判定为“任务约束无法确认”，而非“主题不符”。

| # | rowId | 标题 | publishedAt |
|---:|---|---|---|
| 1 | D06-chrome-1 | Chrome Dev for Desktop Update | 2026-10-16T15:43:33.041Z |
| 2 | D06-chrome-2 | Chrome Dev for Android Update | 2026-10-16T13:13:32.498Z |
| 3 | D06-chrome-3 | Chrome Beta for Desktop Update | 2026-10-16T09:13:33.426Z |
| 4 | D06-chrome-4 | Chrome for Android Update | 2026-10-15T23:00:00.000Z |
| 5 | D06-chrome-5 | Chrome Beta for Android Update | 2026-10-15T22:58:31.889Z |
| 6 | D06-chrome-6 | Extended Stable Update for Desktop | 2026-10-15T21:20:05.224Z |
| 7 | D06-chrome-7 | Stable Channel Update for Desktop | 2026-10-15T20:50:35.703Z |
| 8 | D06-chrome-8 | Early Stable Update for Desktop | 2026-10-14T20:46:06.194Z |
| 9 | D06-chrome-9 | Chrome for Android Update | 2026-10-14T20:25:53.845Z |
| 10 | D06-chrome-10 | Chrome Beta for iOS Update | 2026-10-14T17:13:33.604Z |
| 11 | D06-chrome-11 | Chrome Beta for Android Update | 2026-10-14T13:28:32.349Z |
| 12 | D06-chrome-12 | Chrome for Android Update | 2026-10-13T22:00:00.000Z |
| 13 | D06-chrome-13 | Beta Channel Update for ChromeOS / ChromeOS Flex | 2026-10-13T21:16:57.530Z |
| 14 | D06-chrome-14 | Stable Channel Update for Desktop | 2026-10-13T20:53:43.905Z |
| 15 | D06-chrome-15 | Extended Stable Update for Desktop | 2026-10-13T20:40:37.365Z |
| 16 | D06-chrome-16 | Chrome Stable for iOS Update | 2026-10-13T16:13:33.466Z |
| 17 | D06-chrome-17 | Stable Channel Update for ChromeOS / ChromeOS Flex | 2026-10-09T23:46:54.569Z |
| 18 | D06-chrome-18 | Chrome Dev for Android Update | 2026-10-09T14:43:32.230Z |
| 19 | D06-chrome-19 | Chrome Dev for Desktop Update | 2026-10-09T14:28:32.819Z |
| 20 | D06-chrome-20 | Chrome for Android Update | 2026-10-07T22:30:00.000Z |
| 21 | D06-chrome-21 | Long Term Support Channel Update for ChromeOS | 2026-10-07T18:30:32.914Z |
| 22 | D06-chrome-22 | Chrome Beta for Android Update | 2026-10-07T17:28:32.223Z |
| 23 | D06-chrome-23 | Early Stable Update for Desktop | 2026-10-07T17:18:55.747Z |
| 24 | D06-chrome-24 | Chrome Beta for Desktop Update | 2026-10-07T15:13:34.219Z |
| 25 | D06-chrome-25 | Chrome Beta for iOS Update | 2026-10-07T14:58:33.042Z |

其余 7 个离线案例与 H03 无任何条目移动，因此无需列条目标题。

## 5. H03 的特殊说明

- 保存的 34 条判定为 24 `MATCH` + 10 `TOPIC_MISMATCH`，**UNCERTAIN 为 0**，所以新门在 H03 上移动 0 条，`possibleRelated` 为 0。
- H03 生产展示为 2 条，两条在保存判定中均为 `MATCH`（`LEGACY_QUERY_TERM_MATCH`，命中查询词「产品」）。新门不会撤销这两条。
- 结论：N4 不能解释、也没有改变 H03 的展示结果。H03 的疑点（英伟达条目的相关性、最终 plan 与早轮切片不一致）仍属未解决缺口，需要同 attempt 的 plan 与 `clusterText` 才能定案。
- H03 没有 `clusterText`、原始正文与逐 attempt plan，本表只能使用**保存下来的判定**，不能重算。

## 6. 这次对照能证明与不能证明

能证明（可直接复现）：

1. 判定函数在两提交间未变，137 行新旧 decision/reason 逐行一致。
2. 新门把 UNCERTAIN 从正式结果移入 possibleRelated，影响面精确为 25 条，全部在 D06。
3. D06 判定层正式可展示数由 25 降为 0，possibleRelated 由 0 升为 25。
4. H03 与其余 7 个案例在判定层零变化。

不能证明：

1. 不能证明线上展示条数会减少 25；D06 未过可靠性、新颖度、日期、注意力门，故 25 只是上限。
2. 不能证明 D06 的 25 条被正确降级或错误降级——缺独立人工标注。
3. 不能证明新门提升了展示精度或降低了误零率；两个指标的分母（人工金标）仍为空。
4. 不能证明 H03 的 2 条展示合理；本次没有重算 H03 判定。
