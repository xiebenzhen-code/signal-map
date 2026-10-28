# 阶段 1 证据：版本身份、入口契约、来源隔离、登录边界（2026-10-26）

本文件只记录只读核对与离线测试结果。**未部署、未发起研究、未调用付费模型、未改业务逻辑。**

## 0. 基线与差异说明

| 项目 | 值 |
|---|---|
| 分支 | `p2n/stability-and-diagnosis` |
| 本阶段起始 HEAD | `c3262d3cd87ad3ea06821d4ecd235e673b96e939` |
| API 027 产品源码 | `cf164081e5398be93f30841ba811dca17dc4a2ff` |
| `docs/portfolio/formal-release-identity.json` | Sites53 + API019，source `f7b5c78`，production code `dac6056`（2026-10-21） |
| `docs/verification/CURRENT-BASELINE-20261026.md` | API 027，HEAD 记录 `0ed7a6a`（2026-10-26） |
| 文档提交 `e5e7439` | **不可解析**，沿用 `CURRENT-BASELINE` 的作废声明 |
| 远端实时 HEAD | `UNKNOWN`（本机到 github.com 连接失败，GitHub 连接器为 auth-required） |

**两份基线的关系**：`docs/portfolio` 是 2026-10-21 的 Web 发布身份（Sites53/API019），`docs/verification` 是 2026-10-26 的更晚记录（API 027）。
两者不矛盾：前者记录 Web 侧发布，后者记录 API 侧发布；但**都不能证明此刻线上 Web 的构建身份**，见第 1 节。

## 1. 版本身份表

| 对象 | 结论 | 证据 | 状态 |
|---|---|---|---|
| 线上 API 承流版本 | DeployId **027**，FlowRatio 100，状态 `normal`，镜像 tag `signal-map-api-preview-027-20261026123332`，更新时间 `2026-10-26 12:33:23` | `tcb cloudrun detail --json`（只读） | **已确认** |
| 线上 API 源码身份 | 对应 `cf16408` | 发布手册 `docs/verification/api027-release-manual-20261026.md` + 上述 tag 时间戳一致 | **已确认**（记录一致，非镜像 digest 校验） |
| 线上 Web 构建身份 | `UNKNOWN` | 首页 200，响应头仅 `server: cloudflare` 与 vinext `Vary`；无 build/version/`x-deployment-id` 响应头；`deployment-id` chunk 只定义头名不含值 | **仅观测，未确认** |
| 线上 Web 与 API 的连通 | 同源 `/api/auth/me` → 200 `{"user":null}`；`/api/diagnostics/postgres-transport` GET → 405 | curl 只读 | **已确认连通**，未确认指向哪个 API 版本 |
| 仓库内 Web 发布记录 | Sites53，source `f7b5c78`，API019 | `docs/portfolio/formal-release-identity.json` | **仅发布记录**（2026-10-21） |
| 历史研究结果 vs 当前 Run | 响应含 `requestId`；`InformationRun` 持久化 `filterId`、`generatedFromResearchContextRevision`、`fetchedAt`；**无版本字段**；UI 仅在失败时显示 requestId | `information/types.ts:62,81-82`；`app/page.tsx:1181` | **可凭 requestId+时间区分请求，不能凭版本区分构建** |
| 浏览器缓存结果 | 按 `ownerId` 分库（匿名库与账号库分离），`lastRunByFilterId` 按 filter 存储 | `lib/alpha-storage.ts:54-55,207-209` | **已确认分区** |

结论：**API 侧可确认到 027；Web 侧只能确认“可访问且能代理到某个 API”，无法确认构建号**。不得用 `/health` 200 或首页 200 代替 Web 版本证明。

## 2. 两条研究接口的真实差异（只读核对）

| 维度 | `POST /api/signals`（页面在用） | `POST /api/research/stream`（备用） |
|---|---|---|
| 传输 | `app/api/signals/route.ts` → `proxyApiRequest` → Node 后端 `handleSignals` | workerd 内直接 `handleResearchStream` |
| 输入解析 | `bodyRecord` → `inputFromRecord`；缺 industry → 400，**带 requestId** | `researchInput` → `bodyInput` → 同一 `inputFromRecord`；缺 industry → 400，**无 requestId** |
| 身份 | `resolveResearchIdentity`：可匿名/访客（签发 guest cookie） | 仅 `resolveAuthContext`，匿名一律 401 |
| 研究执行 | `executeResearch`：25s deadline、预算与限流（匿名 4/分钟、登录 12/分钟）、`onPhase` 埋点、feedCache | 直接 `runResearchPipeline`，**无 deadline、无预算、无 feedCache、无 onPhase** |
| 持久化 | 写 filter、knowledge、agent run 元数据（生产强制 Postgres） | **无 repository**，只做内存计算 |
| 响应 | JSON + `requestId` + `researchMode` + `X-Signal-Map-Request-Id` | SSE：`progress` / `result` / `pipeline_error`，无 requestId、无 errorCode |
| 页面使用 | **是**（`information/research-request.ts:10`） | 否（全仓库无 EventSource 调用） |

因此：**不能用 SSE 单接口成功替代页面验收**；也不能把 stream 的空 `requestedQuestion` 当作页面缺陷。

## 3. 入口契约（STEP 2）：零生产改动，6 项断言通过

固定原题：`过去 7 天，36氪快讯和极客公园 AI 报道了哪些国内 AI 产业新进展？`

新增 3 条测试于 `tests/research-request.test.ts`（累计 6 条）：

| 断言 | 结果 |
|---|---|
| 请求目标是 `/api/signals`，POST，无 query 参数 | 通过 |
| 原题逐字进入 `currentQuestions` | 通过 |
| 原题未混入 `industry` | 通过 |
| `freshnessWindow` 为 `7d`，未被默认值吞掉 | 通过 |
| 后端归一化后 `requestedQuestion` 等于完整原题 | 通过 |
| 仅传 industry 时 `requestedQuestion` 为空（反向证明必须传 currentQuestions） | 通过 |
| 配置中继后，36氪与极客公园都进入来源选择 | 通过 |

**未发现入口传参缺陷，因此没有生产代码修改。**

## 4. 来源失败隔离（STEP 3）：零生产改动，30/30 通过

新增 3 条测试于 `tests/registered-feeds.test.ts`：

| 场景 | 结果 |
|---|---|
| 36氪中继超时、极客公园可读 | 极客公园 `searched_with_results`（2 条，items 保留 2 条）；36氪 `failed` + `upstream_error` + `FEED_TIMEOUT`；`failures` 仅 1 条 |
| 中继未配置 | 36氪 `not_configured`、`searched: false`；不得伪装成成功 |
| 极客公园可读但为空 | `searched_no_results`，与 `failed` 区分；items 为 0，不补卡片 |

既有测试 `one broken feed never aborts the research or contaminates its peers` 同时通过，说明隔离不是本次新加的。

**未降低任何相关性、日期或可靠性门槛；36氪实时可用性仍为 `UNKNOWN`，本阶段未恢复 RSSHub。**

## 5. 登录与会话边界（STEP 4）

### 5.1 已验证（代码 + 测试）

- 登录成功只跳 `"/"`（或 `/?observe=1`），不转发任意 URL；失败/无会话/需验证均不跳转（`app/control/page.tsx:128-140`）。
- `tests/login-navigation.test.ts` 5/5 通过。
- 首页会话判断为三态（checking/ready/error），错误态不渲染子内容、不回落到匿名库作为“已登录”（`app/components/local-account-boundary.tsx:16-19,34-40`）。
- 首页/刷新**不会自动发起研究**：`refreshToday` 的 6 个调用点全部是用户点击或表单提交；没有 `useEffect` 依赖 `currentUser` 触发研究（`app/page.tsx:1496,1545,1656,1677,1686,2037`）。
- 账号隔离：IndexedDB 按 `ownerId` 分库，匿名库不被账号继承（`lib/alpha-storage.ts:54-55,207-209`）。

### 5.2 已确认缺陷（本阶段未修复，需你决定）

**D1｜没有可用的退出入口（确认）**

`app/control/page.tsx` 中 `setUser` 的三处赋值均为 `null`（`:94` 初始、`:109`、`:161`、`:196`），
因此已登录面板（`:234-356`）与其中的 `Logout` 按钮（`:263`，`{user ? ... : null}`）是**不可达死代码**；
全仓库 `.tsx` 中 `Logout|退出登录|signOut` 仅此一处，首页只有“登录/注册”链接。
后果：用户**无法从界面退出登录**；`/api/auth/logout` 服务端实现存在（`backend/handlers.ts:632-639`），但没有 UI 可达路径。

未修复原因：修复需要新增或恢复可见的退出控件，属 UI 决策（AGENTS.md 要求避免未经请求的 UI 改写），不与“零代码修改”冲突但超出最小修补证明范围。

**D2｜鉴权异常被当作匿名（风险，运行时表现 UNKNOWN）**

`auth/session.ts:48-50` 捕获任何异常返回 `null`，`backend/handlers.ts:627-630` 仍返回 200 `{user: null}`；
客户端据此判定匿名并切到匿名分区（`lib/local-account.ts:8`、`app/page.tsx:960`）。
方向是“已登录被判成匿名”，不是“未登录被当成已登录”，但会短暂显示空工作区，且该窗口内的写入落在匿名库。

**D3｜登录导航测试存在恒真断言（覆盖被高估）**

`tests/login-navigation.test.ts:29,61` 断言 `dashboardLoads === 0`，但注入的 `loadDashboardState` 在 `authenticate` 中从未被调用，该断言恒真；`logout()` 与首屏 effect 未被覆盖。

### 5.3 手动验收清单（`MANUAL_LOGIN_PENDING`）

请依次操作并记录：

1. 打开 `https://signal.benzhenlab.com/control`，用测试账号登录 → 应回到首页且顶栏不再显示“登录/注册”。
2. 刷新首页 → 仍是登录态，`/api/auth/me` 返回带 user 的对象（可在 DevTools Network 查看状态，不要粘贴 Cookie 值）。
3. 打开 `?observe=1` 页面 → 观察模式仍可用。
4. 寻找退出入口 → **若找不到，即确认 D1**（预期当前版本找不到）。
5. 若通过其它方式退出（如清 Cookie），刷新后应回到未登录态，且不得出现他人历史研究。
6. 全程确认：登录与刷新过程**没有自动出现新的研究结果卡片**（不应产生付费运行）。

## 6. 门禁（本阶段提交后）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run quality` | **0** | 992 项测试：986 通过、6 条件跳过、0 失败；lint 0 error |
| `npm run build` | **0** | vinext build 完成 |
| `npm run api:build` | **0** | `dist-api/server.mjs` 产出 |
| `git -c core.whitespace=cr-at-eol diff --check` | **0** | 无空白错误 |

6 项条件跳过不计作通过（数据库测试环境缺失）。

## 7. UNKNOWN 汇总

| 项目 | 状态 |
|---|---|
| 线上 Web 构建号 / 是否含 N4 与 0b 代码 | `UNKNOWN` |
| 远端实时 HEAD 与远端分支枚举 | `UNKNOWN` |
| 真实浏览器登录→刷新→退出→重登 | `MANUAL_LOGIN_PENDING` |
| Supabase 故障导致被误判匿名的实际频率 | `UNKNOWN` |
| 36氪中继当前实时可用性 | `UNKNOWN` |
| 生产代理是否完整保留多个 `Set-Cookie` 分片 | `UNKNOWN`（有测试断言，未在本阶段运行） |
| 数据库条件跳过的 6 项是否通过 | 未验证（不计 PASS） |
