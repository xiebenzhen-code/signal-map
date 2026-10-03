# 原问题一手来源获取闭环报告（2026-09-30 第四轮）

## 1. 真实供给核对（子代理，未调用付费模型）

30 天窗口（2026-09-01~09-30）内经**官方一手页面直接抓取验证**的更新（摘要，完整清单见子代理记录）：

| 产品 | 日期 | 官方一手 URL | 要点 | 商用依据 |
|---|---|---|---|---|
| Adobe Premiere Pro 26.5 | 09-08 | blog.adobe.com/…/generate-create-directly-in-your-timeline… | Generative Media Tool（时间轴内生成视频/音效）、Separate Crosstalk、Auto Ducking | 页面明示 commercially safe（音频模型/生成音乐同步权） |
| DaVinci Resolve 21.1 | 09-08 | blackmagicdesign.com/media/partial/release/20260908-03 | AI 助手集成（Claude/ChatGPT Codex）、高光剪辑自动化、批量渲染 | 免费下载（页面原文） |
| Final Cut Pro 12.4 | 09-29 | support.apple.com/en-us/102825 | Cinematic mode 素材可编辑 | 未知 |
| Descript 9-17 汇总 | 09-17 | descript.canny.io/changelog/… | 字幕系统重做、AI 生成配乐落时间轴、AI Speech | 未知 |
| Runway 多条 | 09-04~09-23 | runway.com/changelog | Adobe/Resolve 插件、Enhance Frame Rate、Kling 系列上 MCP | 逐条标注计划层级 |
| Topaz September "Speed Update" | 09-28 | topazlabs.com/updates/sep2026 | Starlight Fast 3、SDR-to-HDR 面板 | Web 订阅标注 <$1M 营收组织可商用 |
| Pika 新平台 | 09-17 | pika.art/blog/welcome-to-the-new-pika | 25+ 应用、Video Studio 50 资产挂载、3 分钟多镜头 | 未知 |
| OpusClip 多条 | 09-10~09-30 | opusclip.canny.io/changelog | Lower Thirds、Motion Studio B-roll、音频库导入 | 逐条标注计划层级 |
| FireCut v1.2.34 | 09-09 | firecut.ai/changelog | Magic cut 目标时长、多说话人字幕 | 未知 |
| TimeBolt v7.4.x | 9 月 | timebolt.io/timebolt-update-log | Claude/ChatGPT Local MCP 驱动跳剪 | 未知 |

窗口外已核实（防混淆）：Runway Gen-4.5（2025-12）、Luma Ray3.2（2026-06）、Kling 3.0（2026-02，未直接核验）。明确未找到：Gling、Autopod。**供给结论：30 天内确有 10 条可核验一手更新——原问题零结果不是"供给不存在"。** 本清单仅作对照证据，未注入产品、未硬编码名单。

## 2. 首轮遗漏一手检索的具体条件（systematic-debugging 定位）

- **条件 A（来源选择）**：无实体 PRODUCT_UPDATE → discovery-first → attempt-1 allowed=[public-web,product-hunt,hacker-news,huggingface]，OFFICIAL/PRIMARY 全部延后到 fallback；两次真实运行中 fallback 剩余 1.1~2.0s，结构性饿死。
- **条件 B（域名过滤，本轮新发现）**：`primaryDomains()` 对含"AI"的 need 强制附加**固定 AI 厂商白名单**（site:openai.com OR site:anthropic.com …）——视频剪辑生态（adobe/blackmagic/apple/descript/runway/topaz/pika/opusclip）**全部不在白名单**，短查询 + 无关域名白名单 = 恒 0 结果（run f2b0d713：primary 5 请求 0 结果实证）。
- 证据缺口如实标注：run7 的 pipelineActualQueries 显示的是 agent plan 而非 provider 实际串，provider 实际串由 primaryQueries（变体+sourceHint+domains）构成，0 结果与域名过滤的因果由 run8（修复后同位置返回 1 条窗口内结果）交叉证实。

## 3. 实际修改（TDD，先红后绿，未提交）

| 文件 | 修改 | 红测试 |
|---|---|---|
| agent/source-selector.ts | discovery-first 时把验证类 provider（OFFICIAL/PRIMARY）并入**同一 attempt** 的 allowedProviderIds（`uniqueProviderIds` 合并；pipeline 内既有 entity 门/canExecute/预算守卫继续约束实际执行，无无条件启动） | tests/firsthand-attempt.test.ts：真实 runner + 真实预算形态（规划 8.5s+检索补全 15.4s）下，修复前 executed 仅 GENERAL_WEB 四家 → 修复后 OFFICIAL/PRIMARY 获得可执行机会 |
| research/research-pipeline.ts | `primaryDomains()` 视频剪辑类问题（视频/剪辑/粗剪/镜头/video edit/rough cut）改用**视频行业官方域名集**（adobe/helpx/blackmagicdesign/apple/descript/runway/topazlabs/pika.art/opusclip/firecut/timebolt）；其余类别不变；候选仍须通过主题相关性与新鲜度门禁 | tests/video-primary-domains.test.ts：视频问题 primary 查询不得携带 AI 厂商白名单、应指向行业官方域名 |

不新增 Provider/Agent/依赖/库表；不重写管线；不放宽日期/相关性/证据门槛；总 deadline 与请求上限不变（primary 仍 ≤5 请求）。

## 4. 验证

- quality：**549 tests / 544 pass / 0 fail / 5 skipped**（typecheck 0 errors；lint 0 errors，8 warnings 全为既有文件）；knip/deps PASS；api:build、build PASS。
- 回归：source-selector、intent-aware、retrieval-coverage、verification-budget/round、integration-patch、comfyui-pipeline-window、public-alpha、research-policy 等 59/59 全绿。

## 5. 同一问题真实用户结果（匿名、单次、预算已确认：仅本次 DeepSeek planning）

`signals-425a07d4-0e58-491f-8944-8857fbe1d98a`（08:38:34.980Z→08:38:58.323Z，23.34s，200/needs_more_evidence）：

| 阶段 | 数值 |
|---|---|
| 来源执行 | **primary-web-search 5 请求 → 1 条结果（首次非零！）**；hacker-news 3；arxiv 0；company-registry 0 |
| 候选 | 4（63 scanned → 4 admitted） |
| 补全 | **detailAttempted=4 / succeeded=4**（0 失败） |
| 证据 | 4/4 拒绝：2 stale（Mosaic 2025-11、Palmier 2026-07——合法超窗）+ 2 insufficientContent |
| 展示 | **0 signals** |

**修补生效的实证**：① primary 通道首次返回**窗口内**条目（Runway 2026-09-18，verified）；② 4 条候选全部完成正文补全（此前最多 5、上轮 0）。

**窗口内条目的死因（诚实归因）**：Google News RSS 包装条目（Runway）的 URL 是 news.google.com 重定向链接，无 canonicalUrl、描述段不可提取 → INSUFFICIENT_CONTENT。**不是**主题误杀（topicMismatch=0）、不是时间不符（该条 09-18 在窗内）、不是补全预算（4/4 执行）。

**用户答案验收：不通过（0 展示）。** 当前失败阶段：**RSS 重定向 URL 的正文解析**——一手渠道已通、窗口内条目已获取，但 Google News 的包装链接使正文提取失败。未凑数量、未放宽门槛、零结果未包装为成功（needs_more_evidence 如实返回）。

## 6. 剩余阻塞（证据支持，停止）

1. **news.google.com RSS 条目 URL 为重定向包装**，enrichGenericDetail 抓取该 URL 得到的是 Google 空壳页而非原始文章 → 窗口内一手条目死在正文提取。最小修补方向（本轮不实施）：googleNews() 解析 RSS 时提取 `<source url>`/描述中的原始发布方链接，或在 detail 抓取前跟随重定向头。对应回归：注入式"RSS 包装 URL → 解析出 canonical 后提取成功"用例。
2. github-releases/official-update-pages 本轮 not_searched（entity 门控：无实体不搜，符合既有契约）；company-registry 0 结果（无视频厂商映射——如需覆盖须扩 registry，超出"不硬编码产品名单"边界，需另行决策）。
3. HN 高相关帖客观超窗（2025-10~2026-07），属数据面事实。

## 7. 限制遵守

未新增 Provider/Agent/框架/依赖/库表；未重写 UI/研究管线/知识架构；未放宽日期/相关性/证据门槛；未增加总 deadline 或请求上限；未改知识/偏好/认证/数据库/migration；未 commit/push/部署/触发 Actions/打包；无关工作区改动保留；第一阶段未调用付费模型；真实提交仅一次，无重试、无换题、无 fixture 替代。
