# 原问题检索查询与正文补全修补报告（2026-09-30）

## 1. 只读确认（基准：signals-d5d3097d-ee28-42c4-9b85-908019eef354）

- HEAD `cc65d6e` + 工作区改动（修补均未提交，按要求保留）。
- 前端 vinext dev :3000（工作区源码）；后端 :8080 本轮已切换为含本轮修复的新 bundle。
- **primary 实际查询**（上轮实证）：`"AI video editing automated rough cut multi-asset understanding shot selection official changelog release notes latest"` 等 5 条，前 3 条均为 **10+ 词融合查询**（4 个任务锚点串联），primary-web-search requestCount=2 → resultCount=0。
- **五次详情补全对象**（上轮）：可确证 mosaic.so（导航骨架）、github.com/palmier-io/palmier-pro（GitHub 页骨架）与 3 条 Product Hunt 目录页——全部来自**有 providerId** 的候选；**6 条最相关的 DuckDuckGo 新闻页从未被补全**，因为 `shouldEnrichDetail` 硬性要求 `providerId`，而 web 搜索路径的候选只有 sourceType。
- 四类区分（上轮实证）：未获取正文=6 条 DDG 新闻页（选择缺口）；导航骨架=mosaic.so/palmier（提取缺口）；正文存在但提取失败=无法证实（无逐条 rawContent 存档）；超窗=Mosaic 2025-11、Palmier 2026-07（合理过滤）。

## 2. 实际修改（全部未提交）

### 2.1 检索查询（research/research-pipeline.ts）
- `providerQuery("primary-web-search")` 不再把前 4 个锚点融合成一条长查询：改为**单锚点 + 发布/官方意图词**的短查询（≤6 词）。
- 新增可导出的 `providerQueryFor(plan, providerId)` 及 `.all()` 变体集（每锚点 × release/official/launch 意图，上限 8 条变体）。
- primary 调用点改用变体集；**请求预算不变**（仍 ≤5 条）、**官方域名条件与 sourceHint 保留在每条变体上**；无产品名单硬编码。
- `shortQueryFor` 改为按**总词数**封顶（此前按条目数，两条 2 词锚点 + 2 词修饰词会超预算）。
- 恢复 `providerQuery` 的既有导出（本轮 codemod 曾误删，已还原）。

### 2.2 正文补全（source-enrichment/detail-enricher.ts）
- `shouldEnrichDetail` 不再硬性要求 providerId：**相关 + 安全 canonicalUrl 即资格**（unsafe URL/不相关/低分守卫全部保留）。
- `enrichGenericDetail` 提取顺序改为：`<article>/<main>/post-content/entry-content/article-body/release-notes/changelog` 语义块优先；无语义块时**剥离 nav/header/footer/aside/cookie-banner 结构 chrome** 再提取；骨架页在 thin 检查处诚实返回 TOO_THIN（不伪造内容）。
- `sourceCapability(undefined)` 显式返回 EVIDENCE（web 搜索候选）。

## 3. 测试结果

| 套件 | 结果 |
|---|---|
| 新增 tests/primary-query-split.test.ts（3） | PASS |
| 新增 tests/primary-query-provider.test.ts（3，含"融合查询必须消失"反例） | PASS |
| 新增 tests/detail-selection.test.ts（4：providerId 缺失资格、unsafe/不相关守卫、article 提取、骨架拒绝） | PASS |
| 回归 retrieval-coverage / intent-aware / topic-relevance / retrieval-plan-contract / source-selector / detail-enrichment / source-enrichment / budget-allocation / agent-runner / comfyui-pipeline-window | 56/56、87/87 全 PASS |
| `npm run quality` | **542 tests / 537 pass / 0 fail / 5 skipped**；typecheck/lint 0 errors（8 个 warnings 均为既有文件）；knip/deps PASS |
| `npm run api:build` / `npm run build` | PASS / PASS |

TDD 过程：6 个红测试先观察失败（providerQueryFor 未导出、资格 false、骨架 SUCCESS、article 提取失败），逐项转绿。

## 4. 真实提交验证（原问题全文、匿名、单次）

| 项 | 值 |
|---|---|
| requestId | `signals-7dd4694e-cef6-48ce-a139-c16d5e351095` |
| 时间 | 07:03:04.415Z → 07:03:27.540Z（23.1s） |
| HTTP | 200 / `needs_more_evidence` |
| 展示 | **0 signals**（7 事件全被拒：7×INSUFFICIENT_CONTENT） |
| 漏斗 | scanned 23 → candidates 9 → detail **0/0** → evidence 0/9 → displayed 0 |

**本轮真实结果没有改善，且暴露了新证据：**
1. **primary 通道本轮根本未执行**——round-1 走 discovery-first（`entities=[]` → selected=GENERAL_WEB，allowed=[public-web,product-hunt,hacker-news,huggingface]），primary-web-search 只属于 fallback 链；本轮 9 条候选非零，**fallback 未触发**，短查询修复未被真实路径验证（单测证明的只是实现契约，与任务预告一致）。
2. **本轮 detailAttempted=0**（上轮 5）——search 耗时 12.2s，剩余 ~10.8s < `RETRIEVAL_RESERVATION_MS`（13s），enrichment 被**预算守卫整体跳过**。资格修复被守卫掩盖。日志失败项："Detail Enrichment: 已接近请求时间上限，保留已有候选并跳过剩余详情抓取。"
3. 7 条候选仍全部 INSUFFICIENT_CONTENT：DDG 新闻页（发布日期均为**未知**——页面无可提取日期元数据）、Mosaic/Palmier（**超窗，合理过滤**）、HN Loopdesk（2025-10，超窗）。

## 5. 用户答案验收（同前标准）

**不通过。** 0 展示、无近期变化可核对（唯一带日期候选均超窗）、无一手链接进入结果、无价值/测试方法/商用依据说明（未知项均已标未知，未补造）。本轮未凑数量、未放宽门槛；"查询变体构造正确"仅为局部契约通过。

## 6. 剩余阻塞（本轮证据支持，停止追加修复）

1. **discovery-first 路径下 primary 通道不可达**（无实体 → allowed 不含 primary-web-search；候选非零 → fallback 不触发）。上轮的 primary 短查询修复只作用于 fallback 链。证据：本轮 trace `allowed=[public-web,product-hunt,hacker-news,huggingface]`、primary executed=false。
2. **enrichment 预算守卫在 search>12s 时整体饿死补全**（RETRIEVAL_RESERVATION_MS=13s 硬门）。证据：本轮 detail_fetch_finished dur=17ms、attempted=0。
3. **时间窗口覆盖**：该主题的 HN 高相关候选（Mosaic 2025-11、Palmier 2026-07、Loopdesk 2025-10）客观上超出 30 天窗，属合理过滤；DDG 结果无日期元数据（未知，非伪造）。
4. 依据受限材料，剩余问题已从"查询构造/正文提取实现"转移至**来源编排与预算分配层**，触及本轮范围外（管线架构），按要求停止。

## 7. 限制遵守

未改知识/偏好/认证/数据库/migration；未新增 Agent/Provider/依赖/库表/框架；未重写 UI 或研究管线；未 commit/push/部署/触发 Actions/打包；无关工作区改动保留；付费调用仅本轮一次提交；无重试、无换题、无 fixture 替代。
