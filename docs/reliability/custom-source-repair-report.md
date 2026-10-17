# 自选来源验收失败的有界修补记录（2026-10-04）

固定依据：requestId `signals-baa5d0df-4300-4861-8eb0-2942b70ce640`。本轮 0 模型调用、0 研究提交；
离线复现 + 注入替身测试；未改网络配置/证据门槛/数据库；未 commit/push/deploy/打包。

## 一、相关性误放行（已关闭）
- 根因证据（离线全链复现，真实函数+真实运行数据）：
  1. `research/github-discovery.ts` broad fallback：实体不命中注册表 → 拉全部默认仓库（openai/codex、google-gemini/gemini-cli 等），设计注释明言"交给下游相关性门筛选"。
  2. 下游门 `assessTopicRelevance` legacy 路径（topicProfile 缺失）：`planQuery` 的 AI 扩展把 "release notes" 放入 `industryKeywords` → `topicTerms` 分词出裸词 "release" → 复现结果：`"Release 0.162.0-alpha.11" → MATCH, matchedTerms=["release"]`——40 条 Release 全部靠文档类型词放行（同族证据：早前轮次的 "Releases · Comfy-Org/ComfyUI" 知识记录、09-29 arXiv 轮的 tags 含 "release"）。
- 修复（通用，无产品名硬编码，未关 GitHub 源，broad fallback 保留）：`research/topic-relevance.ts` GENERIC_TERMS 增加 `release / releases / changelog / notes / announcement`（文档类型词非主题词）。
- 红→绿：新增 3 用例（无关 Release 必拒 ×3 形态 → 红；Adobe 材料仍准入 → 守护绿；宽泛问题按内容匹配仍能发现未指名项目 → 守护绿）；16/16。真实路径复验：codex/gemini-cli → TOPIC_MISMATCH，Adobe → MATCH。

## 二、日期提取（已关闭提取缺口；呈现影响已实证）
- 真实淘汰条件（`information/today-selection.ts` `isUsableUpdateCandidate`）：`timestampStatus==="valid"` 且 `ageHours` 可算——**日期缺失即出局**；另有 `reliabilityScore>=70` 等门（Adobe 为 62，partially_verified 单来源 industry_media/B——门槛未放宽）。
- 真实页面材料：blog.adobe.com 无 article:published_time/JSON-LD/<time>，日期仅在 **CardDate 标签块**（`<div>CardDate</div><div>2026-09-08</div>`）。
- 修复：`source-enrichment/custom-source.ts` `extractPage` 扩展四级来源（meta > JSON-LD datePublished > `<time datetime>` > 通用"标注日期单元"），记录出处 `publishedAtSource` 与冲突 `publishedAtConflict`（最高优先级胜出）；**URL 日期绝不使用**；无日期保持未知。
- 测试覆盖：有效（JSON-LD/CardDate/time）、缺失（含 URL 带日期陷阱）、冲突（meta vs JSON-LD → meta 胜 + 冲突旗标）、超窗（仍提取，窗口判定留在下游）。
- 红→绿：6 新用例（5 红→绿 + 1 守护）；管线传播断言：候选 publishedAt → 最终 evidence 字段（isoDate 归一化）。
- 呈现影响（实证）：`tests/today-selection.test.ts` 新用例——同参数条目有日期进 usableUpdates、`timestampStatus:"missing"` 不进。**日期是必要非充分条件**：Adobe 当前 62<70 的可靠性门仍会拦住它（如实保留，不放宽）。

## 三、来源与知识语义（调查后停止该分支）
- 来源归属：公司注册表 9 家（OpenAI/Anthropic/Google DeepMind/Meta/Microsoft/NVIDIA/Hugging Face/DeepSeek/ComfyUI），**无 Adobe**；`source-registry/sources.json` 支持扩展但为空。→ 按约束继续保守分类（industry_media/B）。
- **最小方案（未实施）**：在 `source-registry/sources.json` 增加 Adobe 实体（aliases: adobe/premiere；domains: blog.adobe.com/helpx.adobe.com），重启后 company-registry 与 official-update-pages 即可核验归属并修正来源类型——纯数据配置，无代码改动。
- KNOWN_INFORMATION 语义：`agent/evaluation.ts` `matchPersistedKnowledge` 的 DUPLICATE 判定只比 claim 指纹，**不消费 provenance.verificationStatus**——partially_verified 的"用户已接触"记录会把未来同 claim 的更强验证证据判为 DUPLICATE（NO_INFORMATION_GAIN）；同 URL 后续内容走 UPDATE 不受影响。
- **最小方案（未实施，超出本轮）**：仅 `verified` 的 KNOWN_INFORMATION 允许触发 DUPLICATE；partial/unverified 记录遇同 claim 新证据改判 UPDATE（升级而非压制）。

## 四、页面可见性
- **更正上轮误报**：DOM 实测认知列表渲染 **35 篇、含 Adobe 记录**（修订 1×2、修订 2×12、修订 14×21）——上轮"认知列表不显示新记录"是 domSnapshot 截断所致，非过滤器/分页/修订/读取失败。
- 文案语义（已修复）：原 included 文案"已进入本次结果"以入库冒充展示（今日队列只选 3 条）。提取 `customSourceReadReason(included)`：included → "正文可读取，**已保留**到本次结果与资料库；是否出现在**今日**阅读列表取决于相关性、时间与证据，请以今日卡片为准。"；未保留 → 原"未通过本次筛选"文案。红→绿（helper 断言先红后绿）。

## 五、门禁（本轮实测）
| 检查 | 退出码 | 结果 |
|---|---|---|
| 专项测试（topic-relevance/custom-sources/today-selection/source-config/detail-selection/doh/source-enrichment/comfyui-discovery/novelty-attribution/today-window） | 0 | 110/110 |
| `npm run quality`（typecheck+lint+全测+knip+deps:check） | 0 | 718 tests / 713 pass / 0 fail / 5 skipped；knip PASS；deps:check 163 模块/352 依赖无违规 |
| `npm run api:build` | 0 | — |
| `npm run build` | 0 | — |
| `git diff --check` | 0 | 仅 CRLF 提示 |

历史门禁（往轮存档，与本轮分开）：`doh-source-resolution-report.md` 707/702/0/5、DoH 专项 52/52。

## 六、修改文件
| 文件 | 修改 |
|---|---|
| `research/topic-relevance.ts` | GENERIC_TERMS +5 文档类型词 |
| `source-enrichment/custom-source.ts` | extractPage 四级日期提取 + 出处/冲突字段 |
| `lib/custom-sources.ts` | CustomSourceCheck +publishedAtSource/publishedAtConflict |
| `research/research-pipeline.ts` | 导出 customSourceReadReason 并接线（文案分层） |
| `tests/topic-relevance.test.ts` | +3 用例 |
| `tests/custom-sources.test.ts` | +7 用例/断言（日期 6、传播 1、文案 1） |
| `tests/today-selection.test.ts` | +1 用例（时间戳条件实证） |

过程工件（只读复现/取证，保留）：`scripts/tmp-repro-relevance.ts`、`scripts/tmp-dump-plan.mjs`、`scripts/tmp-inspect-run.mjs`、`scripts/tmp-run-evidence-ids.json`、`scripts/tmp-adobe-page.html`（真实页面材料）。

## 七、计数
模型调用 0；研究提交 0；检查端点请求 0；真实页面抓取 1（获取日期标记材料）；数据库只读 SELECT 4。

## 八、未完成项与最小下一步
1. Adobe 来源归属核验：sources.json 数据扩展（纯配置）——待授权。
2. KNOWN_INFORMATION 验证状态语义修正（evaluation.ts DUPLICATE 判定消费 provenance）——独立小轮次。
3. Adobe 条目可靠性 62<70：待归属核验升级为 primary/S 后自然解决，不改门槛。
4. 上轮"认知列表不显示"误报已在报告更正，无代码问题。