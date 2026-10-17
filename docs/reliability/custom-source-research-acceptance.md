# 自选来源完整研究验收记录（2026-10-04）

## 运行标识
- requestId: `signals-baa5d0df-4300-4861-8eb0-2942b70ce640`
- 运行元数据 id: `agent-run-54c44d51-4cbe-4da9-8ce5-49830596f662`（status=completed，49.7s）
- 材料（固定）: `https://blog.adobe.com/en/publish/2026/09/08/generate-create-directly-in-your-timeline-with-new-ai-powered-innovations-in-premiere-after-effects`
- 问题（固定）: 过去30天，Adobe Premiere和After Effects有哪些值得我测试的AI剪辑更新？优先官方依据，说明具体变化、适用条件和可测试操作；未知事项明确标注。
- 提交方式: 页面表单一次点击（`正在研究…`→完成），无人工重试、无换题、无第二次提交。

## Adobe URL 全链路（数据库与日志实证）
| 阶段 | 结果 | 证据 |
|---|---|---|
| 抓取 | ✅ 可读取 | 后端日志 `custom-sources: searched_with_results, resultCount:1, requestCount:2`；页面"已进入本次结果" |
| 候选准入 | ✅ 入池 | `claim-trryh1`（event-2ky5pc），21 条候选之一 |
| 证据 | ✅ 保留 | `evidence-1x1gxx5`，`partially_verified`，单来源 |
| 时间判断 | ❌ 未获得日期 | **`published_at = NULL`**（DB 实证）；管线未能从原文提取发布日期 |
| 注意力 | 入库不推送 | run `finalAttention` 21/21 = `LIBRARY_ONLY`；知识记录 `pk-98wux9`（KNOWN_INFORMATION）已写入 |
| 最终呈现 | 未进今日队列 | 今日 3 条为最近的 codex releases（5h/15h/24h 前，均 primary/S、有日期）；筛选详情面板显示该条为"保留/INTERPRETATION（证据尚未完全闭环）" |

## 发布日期核对（步骤5）
- 检查端点: "未识别到发布日期"（meta 提取未命中）。
- 研究管线: 同样未获得日期（`published_at=NULL`，DB 实证）——两条路径共用同一 `extractPage`（仅解析 `article:published_time|datePublished|date` meta），blog.adobe.com 无此类 meta。
- 人工核对（上轮存档+本轮检索代理）: 页面日期 2026-09-08（在30天窗口内）。**该人工日期未注入任何响应/数据库，不作为管线判断依据。**

## 筛选详情面板逐条对照（页面实测）
- GitHub releases（20 条，openai/codex×10 + gemini-cli×10）: "与当前关注领域匹配；1 条独立证据链；融合判断：**FACT**（包含 Primary/官方证据且无冲突）"→ 保留。
- Adobe 原文: "为未解决问题补充证据：adobe；1 条独立证据链；融合判断：**INTERPRETATION**（有外部证据但尚未形成 Primary 事实闭环）；证据尚未完全闭环"→ 保留。

## 缺陷分类（步骤6；只报告，未修补）
1. **日期提取缺陷（实现）**: `extractPage` 仅解析 meta 标签，目标页无此类 meta → `published_at=NULL` → 无时间戳，无法进入按"X小时前"时间线排序的今日队列，也无法做30天窗口确认。
2. **来源分类保守（实现）**: 自选来源默认归类 `industry_media/B`（authority 60）——官方 Adobe 博客无法形成 Primary 事实闭环，与 GitHub(primary/S) 在融合判断中层级不利。
3. **证据缺口（真实）**: 单来源、无交叉验证 → `partially_verified`/INTERPRETATION。
4. **相关性门槛失准（筛选合理性）**: 20 条与"Adobe 视频剪辑"无关的 GitHub releases（AI 编码工具）全部"与当前关注领域匹配"通过并保留，其中 3 条按新近度占据今日队列，直接拉低答案价值。
5. **UI 呈现观察**: 资料库"认知"页签渲染 15 条均为修订 2 旧记录，本轮写入的修订 1 记录（含 Adobe `pk-98wux9`）未在列表中出现（DB 已确认写入）。

## 计数
| 类别 | 次数 |
|---|---|
| 研究提交 | **1**（无重试/换题/二次提交） |
| 内部模型调用 | 规划尝试 1 次（`MODEL_PLANNING_TIMEOUT`→确定性规划兜底）；知识比对阶段 1 轮 33.9s（逐次调用数日志未打印，精确总数不可得）；检索/证据阶段无模型调用 |
| 检查端点请求（本轮） | 3（1×瞬时 failed reqCount=0 + 2×readable；瞬时失败为诚实降级，未静默回退） |
| 持久化写入 | 21 知识 + 21 claims + 21 events + 21 evidence + 运行元数据 + 上下文修订（DB 实证） |
| 数据库访问 | 只读 SELECT 3 轮（无任何写操作） |
| 门禁 | 本轮未运行（与门禁历史结果分开标注：`doh-source-resolution-report.md` 记录 707 tests/702 pass/0 fail/5 skipped、专项 52/52、build 0——均为往轮结果） |

## 边界
- Adobe 原文被抓取、入池、保留、入库（KNOWN_INFORMATION），但**未进入今日阅读队列**；页面最终答案由 3 条薄且与问题无关的 GitHub release 卡片构成——**答案价值不达标**。
- 本记录为验收证据存档；未修补、未放宽门槛、未用其他来源替代该 URL 验收；未改代码/网络/数据库/证据门槛；未 commit/push/deploy/打包。
- 截图: `custom-source-research-final-page.png`（表单+来源读取情况）、`custom-source-research-cards.png`（结果卡片区）。
- 临时检查脚本: `scripts/tmp-inspect-run.mjs`、`scripts/tmp-run-evidence-ids.json`（只读检查用，未打印任何凭据）。