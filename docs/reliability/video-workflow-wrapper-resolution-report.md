# Google News RSS 包装链接解析修补报告（2026-09-30 第五轮）

## 1. 只读定位（以 `signals-425a07d4…` 真实响应为基准）

- **失败链接**（本次真实响应原文）：`https://news.google.com/rss/articles/CBMiaEFVX3lxTFBCMXNyVEQ2Z2JsN2UxNV9mc0dYTTZmMTVmSXlDcm9FeVlGWnBZN2tvbDVxeHg5Zm5kSHRYWkpTYU5sZXo5U2I2UnpLUDRWZ1I0WDRMQXdiTWxYWGpuWlE4UE9FOWwyemI4?oc=5`
- **实测行为**（三重探测）：HTTP 200（**无重定向**）、无 Location 头；返回 580KB Angular JS 壳页；ID base64 解码为 protobuf 片段含 `AU_yqL…` 新格式 opaque ID，**原始 URL 不在 ID 内**；包装页含 `data-n-a-id`+`data-n-a-ts` 但**无 signature**——静态解码与公开端点均无法解析，仅 Google 内部 batchexecute API 可解（不采用：未文档化内部接口）。
- **分类结论**：不是 HTTP 重定向、不是页面内链接、不是编码包装可静态还原——是**解析失败类**（JS 壳页）。旧式 ID 的 302 行为已不存在。
- **既有代码资产**：`googleNews()` 已把 RSS `<source url>`（发布方主域，如 runway.com）存为 `publisherUrl`；`enrichDetail` 已有 `isSafeDetailUrl` 安全校验、10s timeout、fail-soft。

## 2. 实际修改（TDD 先红后绿，未提交）

**source-enrichment/detail-enricher.ts**（唯一修改点，复用现有抓取基建）：
1. **包装识别**：`isGoogleNewsWrapper()`（news.google.com/rss/articles/ 模式）——包装 URL 先走解析，不再直接当正文抓取。
2. **站点受限解析**：`resolveWrapperViaPublisherOrigin()`——用 feed 里已有的发布方主域构造 `site:<origin> <title>` 查询，走**既有 DuckDuckGo HTML 端点**定位真实文章 URL；候选必须 `hostname === origin.hostname` 且过 `isSafeDetailUrl`（**复用现有 URL 安全约束，解析后再次校验**）。
3. **诚实失败**：解析失败 → 返回 TOO_THIN（不把 580KB Google 壳页存为 rawContent/判 SUCCESS）——壳页不再被误判为正文。
4. **关联保留**：解析成功时 `canonicalUrl` = 原始发布文章，`evidenceFrom = "Publisher article (resolved from Google News wrapper)"`；解析失败保留原 wrapper URL 供溯源。
5. **预算/限制**：每候选**最多 1 次额外解析请求**，10s timeout，遵守调用方传入的 enrichmentBudget（总 deadline/请求上限未变，未新增引擎——DDG 端点是管线既有依赖）。

**research/research-pipeline.ts**：enrichment `metadata` 透传 `candidate.publisherUrl`（RSS `<source url>` 既有字段，此前被丢弃）。

## 3. 测试（tests/wrapper-resolution.test.ts，先红后绿）

| 用例 | 修补前 | 修补后 |
|---|---|---|
| 包装→发布方文章解析 + 有效正文提取 | 红：`TOO_THIN`（Google 壳被判无内容，真实文章丢失） | 绿：SUCCESS + canonicalUrl=真实文章 + 提取到正文（rough-cut/shot selection 等）+ 不含 Google 壳 + 发生了 site:runway.com 查询 |
| 不可解析包装保持诚实失败 | 红：**Google 壳被存为 rawContent**（isThin 580KB 误判为有内容） | 绿：非 SUCCESS、壳不入 rawContent |

回归：detail-selection 4、detail-enrichment 9、source-enrichment 14、firsthand-attempt 1、video-primary-domains 1、comfyui-pipeline-window 1、integration-patch 3、verification-budget/round 2、retrieval-coverage 6、public-alpha 11 → **53/53 全绿**。

## 4. 验证

- **quality：551 tests / 546 pass / 0 fail / 5 skipped**（typecheck 0 errors；lint 0 errors，8 warnings 全为既有文件）；knip/deps PASS；api:build、build PASS。
- bundle 核验：`resolveWrapperViaPublisherOrigin` 在运行产物中。

## 5. 真实用户结果（原问题全文、匿名、单次，预算已确认：仅本次 DeepSeek planning）

`signals-a86bda8d-72fe-4384-9156-1dfd8252999e`（09:42:51→08:24+23.8s，200/needs_more_evidence）：

| 项 | 值 |
|---|---|
| 来源执行 | primary-web-search 10 请求 → 1 结果；company-registry 2；hacker-news 1 请求 → 3；arxiv 2 → 0 |
| 补全 | detailAttempted=4、succeeded=3、failed=0、stillInsufficient=2 |
| 候选 | Runway（**窗口内 2026-09-18**，包装 URL **未被解析**→诚实 TOO_THIN）、Loopdesk/Mosaic/Palmier（均超窗或壳页不足，合法过滤） |
| 展示 | **0 signals**（4/4 合法过滤：2 stale + 2 insufficientContent；topicMismatch=0） |
| 证据留痕 | Runway 条目证据 URL 仍为 wrapper（解析未成功，如实保留），拒绝理由"内容太少，无法验证" |

**用户答案验收：不通过（0 展示）。** 当前失败阶段：**包装解析的站点查询在本环境不可靠**——实测 DDG 返回 202（反爬挑战，0 结果），Bing RSS 可用但对 "Runway Resources" 文章只返回域名根，未索引该文；因此解析器在真实运行中对 Runway 条目未能定位原文，条目按诚实降级被过滤。

## 6. 剩余阻塞（证据支持，不自动追加修补）

1. **静态解析的本质限制**：Google News 新格式 ID（AU_yqL…）是 opaque 的——ID 不含 URL、壳页无 signature、公开搜索引擎对该长尾文章索引不全（DDG 202 挑战 + Bing RSS 未收录）。三条出路均超出本轮边界：a) Google 内部 batchexecute API（未文档化，不采用）；b) 无头浏览器渲染壳页（禁用动态抓取）；c) 30 天窗口的官方站点索引完整性（取决于搜索引擎）。
2. 佐证（未注入、仅对照）：子代理手工核验的窗口内一手更新里，**官方域名白名单内的厂商（Runway changelog、adobe、blackmagicdesign、apple、descript 等）在 primary 通道已可达**——但 Google News 包装的**具体文章页**仍需上述三种路径之一才能稳定解析。
3. Runway 条目的日期与来源属实（09-18，verified），若未来 DDG/Bing 收录该文，现有解析器将自动工作（无代码改动需求）。

## 7. 限制遵守

未新增 Provider/Agent/依赖/框架/库表（DDG HTML 端点为管线既有依赖）；未重写 UI/研究管线；未调整来源选择/评分/证据门槛；未改知识/偏好/认证/数据库/migration；未 commit/push/部署/触发 Actions/打包；无关工作区改动保留；真实提交仅一次（无重试/换题/fixture）；零结果未包装为成功。
