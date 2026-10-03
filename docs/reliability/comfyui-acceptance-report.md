# ComfyUI 查询用户入口验收报告（2026-09-29）

## 结论

**链路级用户验收：通过。浏览器渲染级验收：受限（见「验收边界」）。**

未登录用户以原问题提交后，系统返回最近一个月 ComfyUI 的全部 3 个正式版本
（v0.37.0 / v0.36.0 / v0.35.0），每个版本带发布日期、官方 GitHub Release 链接与
发布内容要点；同一会话换题为 arXiv 论文问题后，请求实体与结果解释中
ComfyUI 残留为 0。

修复前的行为：同样的问题只返回最新一版、且因 72 小时新鲜度硬门槛被整体挡在
首页之外（EmptyToday，"今天没有需要你关注的新变化"）。

## 一、原因与最小修改清单

逐次调用观察均为**首次 primary 尝试**取证（round-1-primary），未被 fallback 覆盖。

| # | 差异证据 | 根因 | 最小修复 |
|---|---------|------|---------|
| 1 | 首页请求体 `trackedEntities=[]`，`industry="个人关注方向"` | `information/natural-research-intent.ts` 实体目录缺 ComfyUI；industry 无 github/开源规则 | 实体目录加 `ComfyUI`；`inferredIndustry` 增加 `github/发布/版本/release/changelog/开源 → 开源开发与 AI 工具` |
| 2 | 匿名响应 `queryPlan.requestedFreshnessWindow="3d"`（请求 30d） | `normalizeRetrievalFreshness` 的 `includes("3")` 先于 `includes("30")` 命中 | 调整判断顺序，30d/月 分支提前 |
| 3 | `planQuery.entities=["ComfyUI","GitHub"]`，产生 "GitHub Investor Relations" 等无效查询 | 来源平台名被当作研究实体抽取 | `validEntityCandidate` 排除 github/arxiv/huggingface 等固定平台名集合 |
| 4 | `topicKeywords` 含 `”寻找有证据支持的新变化` 残段并进入搜索组合 | 首页缺口句模板的指令性词未过滤 | `isTopicPhrase`/`topicKeywords` 过滤 围绕/寻找/证据支持 等指令词 |
| 5 | GitHub 只返回 1 个版本；真实最近一个月有 3 个 | `github-discovery.ts` 只调 `releases/latest` | 改用列表接口 `releases?per_page=10`，保留每版本 tag/日期/链接/正文；outcome 语义不变（失败=failed，空=searched_no_results） |
| 6 | 10 个版本被聚成 1 个事件，9 个记为 DUPLICATE 噪声（`strongestHiddenSignal.reason=DUPLICATE, evidenceCount=10`） | `titleTokens` 丢弃 `v0.37.0`（拆分后 <3 字符），同 repo 标题 Jaccard=1.0 | `sameEvent` 对同 repo 的 `/releases/tag/` 不同 tag 判为不同事件；`titleTokens` 保留版本号 token |
| 7 | v0.37.0 `freshnessScore=25` → `actionabilityStatus=REVIEW_FIRST` → `IGNORE`，不进 signals | pipeline 注意力门禁 `freshnessScore>=65`（≈72h）绝对化，与请求窗口错位 | `assessSignalActionability` 增加可选窗口上下文（`eventAgeHours`/`requestedFreshnessHours`），窗口内事件满足门槛；**其余质量门禁（验证/可靠性/相关性/新颖度）全部保留** |
| 8 | 首页渲染 EmptyToday | `selectTodayPresentation` 的 `usableUpdates` 硬性要求 `freshnessScore>=65` | 新鲜度门槛改为窗口感知（调用方传入 `requestedFreshnessWindow`），其余门槛与必读/值得关注路径不变 |
| 9 | 换题后旧题缺口回声进入新请求（代码级复现：`startResearch` 无条件并集） | `app/page.tsx#startResearch` 对 `informationGaps`/`trackedEntities` 无条件 union | 问题变化（topic switch）时替换为新 draft；同题细化仍合并。**不清空用户长期知识与偏好；账号级 Knowledge/偏好完全不动** |

未修改：Blender、论文检索质量、HN 独立问题；未新增 Agent/Provider/依赖/库表；未动凭证；未 commit/push；未触发 Actions；未打包。

## 二、普通用户入口修复前后对照

| 项 | 修复前（实测） | 修复后（实测） |
|----|--------------|--------------|
| 请求实体 | `[]`（ComfyUI 丢失） | `["ComfyUI"]` |
| 行业 | 个人关注方向（兜底） | 开源开发与 AI 工具 |
| 检索窗口 | 30d 请求 → 实际 3d | 30d 直通 |
| GitHub 获取 | `releases/latest` 1 个 | `releases?per_page=10` → 10 个版本 |
| 事件数 | 3（10 版本并 1 簇） | 12（每版本独立事件） |
| 首页可见 | EmptyToday（0 条） | 1 条必读 + 2 条今日可用更新 + 完整列表在响应中 |
| 一个月覆盖 | 仅 v0.37.0 | v0.37.0(09-21) / v0.36.0(09-15) / v0.35.0(09-09) 全覆盖 |
| 换题后 | 旧题缺口/实体残留 | 实体 `[]`、关键词无 ComfyUI、结果解释泄漏 0 |

## 三、实际链路结果与来源链接（两次真实提交）

**提交 1**（原问题，匿名会话，requestId `signals-b649f86f-89d8-437c-a892-8a89b64c7c86`，
HTTP 200 / status completed / 23.8s，round-1-primary 单次尝试后策略 STOP，无 fallback）：

- v0.37.0（MUST_READ，09-21）：<https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0>
- v0.36.0（LIBRARY_ONLY/今日可用，09-15）：<https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.36.0>
- v0.35.0（LIBRARY_ONLY/今日可用，09-09）：<https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.35.0>
- 窗口外旧版本（v0.34.0 及更早）按 BACKGROUND 保留，不冒充新版本。
- 列表页 `…/releases` 与文档页 `docs.comfy.org` 仍为 BACKGROUND，**未计为版本**。
- 覆盖差异如实标注：列表接口本次取 per_page=10（当月仅 3 个发布 → 本月完整覆盖；
  若未来一个月内发布超过 10 个，将只覆盖最新 10 个，需在呈现层声明）。

**提交 2**（同会话换题 "最近一个月 arXiv 有哪些视频生成论文？"，requestId
`signals-15a272fc-e454-497f-a4ca-f612831cdfe1`，HTTP 200 / completed）：

- plan entities：`[]`（无 ComfyUI 残留）；topicKeywords：`["AI 视频与创作者工具","AI 视频工具","arXiv"]`。
- 全部结果标题/解释/标签 ComfyUI 泄漏计数 = 0。
- 返回 1 条 arXiv 论文信号（论文检索质量不在本轮范围，只验证换题边界）。

原始响应证据：`docs/reliability/acceptance-final-submission-1.json`、
`docs/reliability/acceptance-final-submission-2.json`。

**已排除的假设**：非匿名限流（预算 4/min，每次仅用 1 次）；非预算/模型故障
（DeepSeek planning 每次正常完成，约 10.7s）；非认证/DB 问题（匿名会话稳定）。

## 四、验收边界（必须如实说明）

- **浏览器工具限制**：本机 DNS 处于 fake-IP/TUN 模式，所有域名（含 localhost）
  解析到 198.18.0.0/15，浏览器工具将一切目标判为 private target 而拒绝；
  临时公网隧道也无法绕过该解析层。两次提交通过**真实链路驱动**完成：
  页面同源 fetch 语义（`createResearchRequest` 原样构造）→ vinext dev 代理
  （workerd）→ Node 后端（`--experimental-strip-types` 源码模式）→ 真实
  GitHub API 上游；会话 cookie 与浏览器一致复用。
- **因此本报告结论为链路级通过**：请求构造、匿名 handler、Provider 执行、
  结果状态、换题边界均在真实服务进程上验证；**页面 DOM 渲染未经浏览器确认**，
  不宣称"浏览器验收完成"。本地入口供人工核验：**<http://localhost:3000>**
  （前端 dev 与后端 8080 均为本轮代码，见第五节）。
- 付费额度说明：既有 DeepSeek 配置额度未确认，本轮未新增付费调用；
  两次提交的模型规划沿用现有配置正常完成。

## 五、本地入口

- 前端：`http://localhost:3000`（vinext dev，PID 见 `frontend-run.log`，服务本轮源码）
- 后端：`http://127.0.0.1:8080/health`（源码模式 `node --env-file=.env.local --experimental-strip-types backend/node-server.ts`）
- 未登录即可在首页输入问题测试；换题在同一页面直接输入新问题提交。

## 六、验证结果

| 门禁 | 结果 |
|------|------|
| `npm run quality`（typecheck + lint + test + knip + deps:check） | PASS（525 tests：520 pass / 0 fail / 5 skipped；lint 0 errors，8 个 warnings 全部来自既有文件 `signal-map-agent-loop-e2e.mjs`/`e2e-acceptance-logic.test.mjs`/`postgres-preference.test.ts`，与本轮改动无关） |
| `npm run api:build` | PASS（dist-api/server.mjs 1.3mb） |
| `npm run build` | PASS（Build complete） |

本轮新增/修改测试（TDD：先红后绿，红状态均已留档于过程记录）：

- 重写 `tests/comfyui-discovery.test.ts`：fetcher 注入 3 版本发布样本；断言版本号、
  日期、官方链接、发布内容逐条保留；空结果与访问失败不得记为检索成功；
  无 `resultCount>=0` 式伪通过；30d 不截断；GitHub 非实体；指令残段不入关键词；
  前端草稿识别 ComfyUI。
- 新增 `tests/comfyui-pipeline-window.test.ts`：端到端（网络注入，模型不调用）
  30d 问题必须存活 ≥2 个版本事件，各带独立 tag/日期/官方链接。
- 新增 `tests/actionability-window.test.ts`：窗口内 8 天前的已验证官方 release
  达 TEST_NOW；无窗口上下文时绝对门槛不变；窗口外仍拒绝。
- 新增 `tests/today-window.test.ts`：30d 窗口内 8 天前官方 release 进入"今日可用更新"；
  验证/相关性/来源层级/已知性门禁保持；窗口外过期内容不出现。
- 新增 `tests/topic-switch.test.ts`：页面源码级断言换题替换缺口/实体、
  今日展示接收请求窗口。
- 既有 fixture 适配：`community-discovery.test.ts`、`public-alpha-research.test.ts`
  （releases 列表形状）、`today-selection.test.ts`（相对时间夹具，消除日历漂移）。

## 七、诚实边界

- 页面渲染证据缺失如上；若浏览器可用，打开本地入口即可复核第 3/4/5 步。
- `selectTodayPresentation` 的 `usableUpdates` 上限 3 条：本月 3 版本全量可见；
  未来超过 3 条时，列表完整性需依赖响应全文或后续呈现层扩展（本轮不改 UI 结构）。
