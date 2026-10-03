# 原问题真实用户验收取证报告（2026-09-30）

## 0. 运行环境与身份（只读确认）

| 项 | 值 |
|---|---|
| HEAD | `cc65d6e`（ci: wire runtime verification scenario config），工作区 38 个改动/未跟踪文件（含此前修复与验收产物） |
| 前端 | `http://localhost:3000`，vinext dev（PID 22280），直接服务当前工作区源码 |
| 后端 | `http://127.0.0.1:8080`，`node dist-api/server.mjs`（PID 6248，nohup 启动于 09-30 01:34，非本轮启动；**其 stdout 未落盘，trace 日志缺失**，以下相位数据取自响应本体 `progress`/`sourceStatus`/`sourceDiagnostics`） |
| 运行代码核验 | 运行 bundle 含全部当前修复（releases 列表端点、30d 优先、平台名实体过滤、版本号聚类、窗口感知门槛）——`RUNNING BUNDLE = CURRENT FIX SET` 六项全 PASS |
| 身份 | 匿名（`researchMode: "anonymous"`；未发 guest cookie——本运行签名密钥下匿名身份为临时性） |
| 模型调用 | 预算确认：仓库无明示每次上限；本次仅允许该单次提交触发的 DeepSeek planning（deepseek-flash），未重试未换题 |

**浏览器入口限制（如实记录）**：浏览器工具对本机一切地址（`localhost`、`[::1]`）返回 private-target denied——本机 DNS 为 fake-IP/TUN 模式，所有域名解析进 198.18.0.0/15。**页面 DOM 与截图本轮无法取得**。提交通过页面同源入口语义复现：`inferNaturalResearchDraft`（首页 `submit()` 原样）+ `createResearchRequest`（首页 `fetch` 原样）→ POST `http://localhost:3000/api/signals` → workerd 代理 → Node 后端 → 真实上游（HN/Product Hunt/DuckDuckGo/arXiv 真实返回）。

## 1. 本次请求标识

| 项 | 值 |
|---|---|
| requestId | `signals-d5d3097d-ee28-42c4-9b85-908019eef354`（header 与 body 一致） |
| 开始 / 结束 | 2026-09-30T05:01:48.680Z → 05:02:11.531Z（22.85s） |
| HTTP | 200，`status: "needs_more_evidence"` |
| 意图 | PRODUCT_UPDATE (0.88) + TOOL_DISCOVERY；来源选择 "PRODUCT_UPDATE + INITIAL 无明确实体，先使用 PRIMARY 发现候选，再用 OFFICIAL / PRIMARY 验证" |
| 窗口 | `requestedFreshnessWindow: "30d"`（直通，未被截断） |
| 提交次数 | 1（无重试、无换题） |
| 原始响应 | `docs/reliability/video-workflow-acceptance-response.json`（完整保存） |

问题原文（与要求一致，未替换）：过去 30 天内，AI 辅助视频剪辑与自动化领域……（含"告诉我发生了什么、为什么值得关注，以及我现在能具体测试什么"）。

## 2. 五段漏斗（接口实际字段）

| 阶段 | 数值 | 字段来源 |
|---|---|---|
| 来源原始结果 | **30**（progress: "30 条扫描结果"；provider raw: PH 8 + HN 2 + GeneralWeb(DuckDuckGo) 6 + arXiv 8 + 其余 0 = 24 admitted 前原始，另有 6 条在 primary 尝试 0 结果后由 fallback 进入） | `progress`/`sourceDiagnostics` |
| 准入候选 | **16**（"12 条扫描结果收敛为 16 条来源"为两 attempt 合并口径；admitted：PH 8 + HN 2 + GW 6 = 16；arXiv 8 全部 TOPIC_MISMATCH=0 准入） | `sourceDiagnostics`/`evidenceAccounting` |
| 正文补全成功 | **5/5**（detailAttempted=5, detailSucceeded=5, detailFailed=0, stillInsufficient=1） | `filteringSummary.detailEnrichment` |
| 证据通过 | **0 / 16**（rejectedEvidenceCount=16） | `evidenceAccounting` |
| 最终页面展示 | **0**（signals=0，页面将显示 caught_up 空态） | `signals` |

## 3. 候选逐条与拒绝原因（可识别 8 条，其余列为证据缺口）

可识别候选（来自 `filteringDetails` + `evidenceRecords` 的 URL/标题/日期）：

| # | 标题 | URL | 来源 | 发布日期 | 关联 | 正文 | 拒绝阶段与理由 |
|---|------|-----|------|---------|------|------|---------------|
| 1 | Launch HN: Mosaic (YC W25) – Agentic Video Editing | mosaic.so | Hacker News | 2025-11-19（**超 30 天**） | 高度相关 | 详情抓取成功（GitHub—非 canonical） | 展示前：内容过少（INSUFFICIENT_CONTENT）+ STALE |
| 2 | Digital Nirvana Launches RoughCut AI Video Editing Platform | digital-nirvana.com/news/roughcut-ai-video-editing-platform | DuckDuckGo(General Web) | 未知（页面无日期元数据） | 高度相关 | 详情抓取成功但正文仍不足 | 展示前：INSUFFICIENT_CONTENT |
| 3 | Automated AI Video Editing Workflows: The 2026 Guide | resource.digen.ai/automated-ai-video-editing-workflows-2026 | DuckDuckGo | 未知 | 相关 | 同上 | 展示前：INSUFFICIENT_CONTENT |
| 4 | AI Video Editing Software That Actually Works in 2026 (Full Demo) | youtube.com/watch?v=grfIUCG3IHs | DuckDuckGo | 未知 | 相关（视频形态） | 视频页无可用正文 | 展示前：INSUFFICIENT_CONTENT |
| 5 | Selects by Cutback: AI Rough Cut for Video Editors | cutback.video/blog/… | DuckDuckGo | 未知 | 高度相关 | 同上 | 展示前：INSUFFICIENT_CONTENT |
| 6 | AutoKut - Revolutionary AI-Powered Video Editing | autokut.com | DuckDuckGo | 未知 | 相关 | 落地页无动作动词正文 | 展示前：INSUFFICIENT_CONTENT |
| 7 | GitHub - palmier-io/palmier-pro: macOS video editor built for AI | github.com/palmier-io/palmier-pro | Hacker News | 2026-07-23（**超 30 天**） | 高度相关 | GitHub 页面抓取成功（仓库 README 导航） | 展示前：STALE（合法 freshness 过滤）+ unverified |
| 8 | Product Hunt lists Lovable as a product discovery item | producthunt.com/products/lovable（及 n8n/attio/posthog/vapi/granola/raycast/supabase 共 8 条） | Product Hunt | 未知 | **不相关**（通用产品目录，非视频剪辑） | 目录占位文本 | 准入后：与当前问题主题不匹配（主题不匹配；另有 7 条 PH 在聚合/评分层被合并丢弃） |

**证据缺口（无法识别的候选）**：fallback attempt 中 General Web 的其余结果、"mer stories Events & webinars…"（chimneymedia.com，标题被导航污染）；`filteringDetails` 只保留 8 条样本，16 条证据记录与 8 个聚合事件的完整对应关系接口未提供 `candidateId` 级映射。arXiv 8 条的标题在 `sourceDiagnostics.candidateAdmissionRejectedSamples` 中仅存 3 条样本（Point2Part / Skill-Space Shooting / Imagine3D-LLM——**均为真实不相关的 3D/机器人论文，拒绝正确**）。

## 4. 失败归因（证据支持的分类）

| 分类 | 是否成立 | 证据 |
|---|---|---|
| 主题误杀 | **部分成立（历史问题已修复）** | arXiv 8 条全 TOPIC_MISMATCH，但样本均为 3D/机器人论文——**拒绝正确**，非误杀。09-21 的变体误杀已修复（本轮 topicAnchors 正常生成，PH/HN 16 条全部准入） |
| 来源覆盖不足 | **成立（主要阻塞点）** | ① `primary-web-search`（Google News+DDG 主引擎组合）在 primary attempt 返回 0——官方/一手来源通道空转；② GitHub Releases/Official Update Pages 在"无明确实体"下 not_searched（实体门控）；③ PH 返回 8 条目录噪声（无视频剪辑产品），实际贡献 0 |
| 正文获取失败 | **成立（第二阻塞点）** | detail 5/5 "成功"但 6 条仍 内容不足——抓回的是落地页/导航骨架，不含可提取的动作动词正文；YouTube/目录页天然无正文 |
| 合理过滤 | 成立 | Mosaic/Palmier STALE（2025-11/2026-07 超窗口）为正确拒绝；arXiv 不相关论文拒绝正确 |
| 展示丢失 | 不成立 | 无信号可展示，非展示层问题 |
| 证据不足 | 成立（结果性） | 16 条证据 0 通过：6 条内容不足 + 1 条过期 + 8 条 PH 目录噪声 + 1 条主题不匹配 |

## 5. 用户答案验收（按第 6 节标准，逐项）

| 标准 | 结果 |
|---|---|
| 直接回应视频剪辑与自动化需求 | **未通过**（0 条展示；无任何回答呈现） |
| 发布日期在最近 30 天 | **未通过**（唯一带日期候选 Mosaic 2025-11、Palmier 2026-07，均超窗；其余日期未知） |
| 可打开的一手来源 | **未通过**（官方/一手通道 0 结果：primary-web-search、company-registry 空转，GitHub Releases 未执行） |
| 说明变化、价值、可测试操作 | **未通过** |
| 商用条件有依据 | **未通过**（无任何商用条件信息返回） |

**结论：本次真实入口提交，用户答案验收不通过。** 系统正确给出了 `needs_more_evidence` 且页面会呈现空态与过滤说明（无虚假成功），但核心问题未获得任何可用答案。

## 6. 最小修补方案（只提方案，不实施）

**主要阻塞点 = 官方/一手来源通道在此类"无实体综合问题"上全空转**，候选只剩社区目录噪声与营销落地页，正文质量天然不足。两个最小修复点：

1. **`research/research-pipeline.ts`（primary 通道查询质量）**：`primary-web-search` 的 2 次请求 0 结果——查询组合把全部 6 个任务锚点串进一条长查询（"AI video editing automated rough cut multi-asset understanding shot selection official changelog…"），对任何搜索引擎都过长过窄。最小改动：primary 查询按锚点拆分为 ≤3 词短查询（复用既有 `shortQueryFor` 思路），不加新 Provider。
   回归测试：注入式断言 primary 查询长度/数量分布 + 至少一个 primary 结果在 mock 下准入。
2. **`source-enrichment/detail-enricher.ts`（正文提取对营销落地页失效）**：5/5 抓取"成功"但 6 条 内容不足——通用抓取器拿回导航骨架。最小改动：`enrichGenericDetail` 在正文提取后增加"是否含动作动词/变化描述"的自检，若不足则回退抓取 `<article>/<main>` 语义块（已在 URL 安全约束内），仍不足则保持现状（不放宽门槛）。
   回归测试：现有 detail-enrichment B/C 用例基础上，新增"落地页骨架→仍 内容不足（不伪造）"与"语义块含动作动词→ 内容充分"两用例。

不做：不加 Provider、不放宽相关性与证据门槛、不改展示逻辑、不假设"匿名不能访问 GitHub"（与本轮 PH/HN 匿名成功一致地无此问题——本轮 GitHub Releases 未执行是**实体门控**，与匿名无关）。

## 7. 限制遵守声明

未修改代码/环境/数据库；未放宽门槛；未添加 Provider/依赖/Agent/库表；未 commit/push/部署/触发 Actions/打包；仅提交一次，未重试未换题；未以 HTTP 200/检索数量替代答案验收；未输出"项目整体验收完成"。
