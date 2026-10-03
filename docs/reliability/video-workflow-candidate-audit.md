# 视频工作流原问题候选与拒绝原因核对（2026-09-30，只读）

范围声明：本轮仅核对现有证据，未修改代码、未调用模型、未重跑研究、未提交/推送/部署/迁移/打包。
三组证据严格分开：① ComfyUI/arXiv 换题响应（2026-09-29，不用于本结论）；② Origin 修复与浏览器 403 记录（2026-09-29/30）；③ 视频工作流原问题（2026-09-21）。

## 一、目标请求的身份确认

| 项 | 值 | 证据位置 |
|---|---|---|
| 问题原文 | "过去 30 天内，AI 辅助视频剪辑与自动化领域有哪些真正值得我测试的新发布、模型、工具或工作流更新？重点关注多素材理解、自动粗剪、镜头选择、批量处理和可商用工作流。优先官方或一手来源，排除纯营销、重复转载和只有概念没有可验证功能的内容。" | tests/intent-aware-research.test.ts `REAL_AI_VIDEO_RESEARCH_QUERY`（与 acceptance-log 2026-09-21 记录对应） |
| "10 条候选、0 条通过" requestId | `signals-f29bfe82-c802-4eb0-a640-8e74878dfd1b` | docs/reliability/acceptance-log.md（Retrieval Coverage 条目） |
| 运行时间 / 环境 | 2026-09-21，commit 28f5ec8 之后；真实联网 E2E | 同上 |
| 原始响应 | **不存在于当前工作区**（已查 docs/reliability、根目录、git dangling objects、.zwork、TEMP、全部后端日志；后端日志最早覆盖 2026-09-29） | 本轮核对 |
| 后续链路 requestId（同问题谱系，非同一轮） | `186ac5fb`（candidate=2）、`bac0eebf`、`ed67831b`、`f1689eac`（detailAttempted=2/detailSucceeded=2） | acceptance-log.md 2026-09-21 各条目 |

## 二、十条候选逐条核对表

**来源构成：Hacker News raw=2 + arXiv raw=8（technical fallback 实际执行）。**
可确证字段的来源仅有 acceptance-log.md 的文字记录；原始响应缺失的字段一律写"未知"，未根据摘要补造。

| # | 标题 | URL | 来源 | 发布日期 | 与需求关联 | 正文/证据 | 实际拒绝原因 |
|---|------|-----|------|---------|-----------|----------|-------------|
| 1 | Palmier Pro – macOS video editor built for AI | 未知（后续轮次为 github.com/palmier-io/palmier-pro） | Hacker News | 未知（后续轮次为 2025-07-23，超 30 天） | 相关（AI 视频编辑工具） | 当轮未知 | TOPIC_MISMATCH（candidate admission，topic-relevance false negative） |
| 2 | Launch HN: Mosaic – Agentic Video Editing | 未知（后续轮次为 mosaic.so） | Hacker News | 未知 | 相关（AI 视频编辑） | 当轮未知 | TOPIC_MISMATCH（同上） |
| 3–10 | 未知（arXiv 8 条，逐条标题/URL/日期均无存档） | 未知 | arXiv | 未知 | 未知（当轮记录仅称"全部 TOPIC_MISMATCH"，未逐条判相关/不相关） | 未知 | TOPIC_MISMATCH（同上机制；第 3–10 条中是否混有确实不相关的论文，无原始数据，不可判） |

**拒绝环节分类归属**：10/10 属于"筛选或展示存在错误"中的 **topic-relevance 误杀（P1 级 over-filtering）**——
不是查询偏离、不是来源调用失败（HN/arXiv 均真实返回 raw）、不是时间不符、不是正文获取不足（当轮尚未到 enrichment）、不是证据不足（未到 evidence 层）。

## 三、根因判断（一段话）

10 条候选 0 条通过的主要阻塞点已确证为 **candidate admission 层的 topic-relevance 误杀**：任务锚点采用固定短语精确匹配，"Agentic Video Editing""video editor built for AI" 这类真实语言变体不含精确短语 → MISSING_TASK_ANCHOR → 10/10 TOPIC_MISMATCH。该根因在 2026-09-21 已被识别并修复（eff9a03，taskConceptStem 变体匹配 + 否定保护；回归锁定 POS=Palmier/Mosaic，NEG 集不变），且后续轮次（`186ac5fb` 起）HN 候选已能 admitted=2。**因此"10 条候选 0 条通过"是已修复的历史缺陷的历史快照，不是当前代码的现存状态。**

当前材料无法回答的问题是：**修复后的管线在综合视频工作流问题上是否真正产出了可测试的方案（displayed>0 且答非所问消除）**。历史链路止步于两处有记录的真实失败：① `f1689eac` 轮 Palmier 判 STALE（发布于 2025-07-23，超出 30 天窗口——合法过滤，但意味着该历史候选集本身已过时）；② Mosaic 判 INSUFFICIENT_CONTENT（落地页缺动作动词——符合 claim 契约）。原始响应缺失导致：当轮 8 条 arXiv 的逐条相关性、全部 10 条的 URL/日期、各 provider 逐次 outcome 明细均无法复原。

## 四、缺失的材料（明确列出，然后停止）

1. `signals-f29bfe82…` 的原始响应 JSON（10 条候选的标题/URL/日期/片段/逐条 outcome）——2026-09-21 运行未落盘。
2. 2026-09-21 当天的 backend trace 日志（`signals_phase_trace` 逐相位 diagnostic，含 providerOutcomes 与 TOPIC_MISMATCH 样本）。
3. 修复后（eff9a03 及之后）针对**同一问题原文**的真实重跑响应——当前不存在；ComfyUI/arXiv 两份响应属不同问题，不能替代。
4. 当前工作区既有的 27×403 浏览器记录（Origin）与 3×200 成功记录分属不同问题/时刻，不与 09-21 数据混用。

## 五、最小下一步（只提方案，不实施）

用**当前代码**、同一问题原文、同一匿名入口做一次真实重跑并落盘原始响应（含 queryPlan、sourceOutcomes、sourceDiagnostics、filteringDetails），即可验证：变体匹配修复后该问题 candidates>0 是否成立、以及历史第二阻塞点（STALE/INSUFFICIENT_CONTENT 合法过滤）是否仍导致 0 展示。若 displayed 仍为 0 且全部拒绝原因为合法 freshness/claim 过滤，则问题性质从"管线缺陷"转为"该历史候选集过时"，需换用当前时间窗口内的真实候选集再评估。本轮不执行。

## 六、禁止事项确认

未假设"匿名不能访问 GitHub"（与 2026-09-29 匿名 GitHub 成功响应矛盾，已弃用该假设）；未把 CI PASS、请求成功或 ComfyUI 结果当作本问题验收；未新增架构/Agent；未降低门槛；未强制展示；未宣称项目整体验收完成。
