# N5d｜`/api/diagnostics/postgres-transport` 加固方案（只出方案，不实现）

日期：2026-10-26。基线：`p2n/stability-and-diagnosis`。本文只描述方案、改动文件与测试，**未修改任何代码**。

## 1. 现状（已只读核对）

| 位置 | 事实 |
|---|---|
| `backend/node-server.ts:88-89` | 路由已注册：`/api/diagnostics/postgres-transport` → `handlePostgresTransportProbe` |
| `backend/postgres-transport-probe.ts:87-90` | `withSession` 包装，要求 `POST`；仅校验 `resolveAuthContext(request)`，未校验 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` |
| `backend/supabase-auth-transport-probe.ts:227-240` | 同类探针**已有**令牌门：环境变量缺失 → `404 Not found`（默认关闭）；令牌不匹配 → `401`；比较使用 `timingSafeEqual` |
| `backend/api-proxy.ts:18-26` | 两条诊断路径均属 `isDbBackedApiPath`，会转发到 API 上游 |
| `backend/api-proxy.ts:89-101` | 代理整体复制请求头，仅删除 `host`、`content-length`、`origin`，故 `x-signal-map-diagnostic-token` 会被原样转发，代理侧无需改动 |

## 2. 风险（为什么必须二选一）

1. **权限过宽**：任何持有有效登录会话的用户都能触发两次数据库连接（`Client` + `Pool` 各一次），可被用作连接放大器，也能高频探测数据库可用性。
2. **信息暴露**：返回体含 `phases[].error.name/code/message`。`sanitizePostgresTransportError` 只清洗 `postgres://` URL 与 `password/token/apikey/authorization/cookie` 键值（`backend/postgres-transport-probe.ts:23-28`），**不清洗主机名、端口、数据库名、角色名**；pg 错误的 message 常包含这些字段。
3. **默认暴露**：与 supabase 探针的“未配置即 404”不一致，形成不对称的安全姿态。

## 3. 方案 A（推荐）：要求 `SIGNAL_MAP_DIAGNOSTIC_TOKEN`

复用 supabase 探针已有的门禁语义，保持两端一致。

### 3.1 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `backend/diagnostic-token.ts`（**新增**） | 导出 `diagnosticGate(request: Request): Response \| null` 与 `tokenMatches` | 把 `supabase-auth-transport-probe.ts:220-240` 现有逻辑原样抽出；安全代码不复制两份 |
| `backend/postgres-transport-probe.ts` | 在 `withSession` 内、方法校验之后插入 `const gate = diagnosticGate(request); if (gate) return gate;` | 保持“会话 + 令牌”双重条件，不降低现有门槛 |
| `backend/supabase-auth-transport-probe.ts` | 改为调用共享 `diagnosticGate`，删除本地重复实现 | 行为必须逐字不变（404/401/`timingSafeEqual`） |
| `backend/node-server.ts` | 不改 | 路由路径与顺序不变 |

不改：`backend/api-proxy.ts`（令牌头已透传）、数据库层、Dockerfile、运行时配置、判定规则。

### 3.2 门禁顺序（明确写死，避免歧义）

1. 方法不是 `POST` → `405`
2. `SIGNAL_MAP_DIAGNOSTIC_TOKEN` 未配置或为空 → `404 Not found`（默认关闭，不暴露端点存在）
3. `x-signal-map-diagnostic-token` 缺失或不匹配（定时安全比较）→ `401`
4. 无有效会话 → `401`（保留现有 `resolveAuthContext`）
5. 通过后执行探针，响应带 `Cache-Control: no-store`

运维需要临时启用时，配置环境变量并重启实例；用完即移除变量，端点自动回到 404。

### 3.3 测试（新增/修改）

| 测试文件 | 用例 | 断言 |
|---|---|---|
| `tests/backend-server.test.ts` | 令牌未配置 | 返回 `404`，响应体不含探针字段 |
| 同上 | 令牌错误 | 返回 `401`，且**不执行**数据库连接（用可注入依赖或计数桩验证 0 次连接） |
| 同上 | 令牌正确但无会话 | 返回 `401` |
| 同上 | 令牌正确 + 有效会话 | 返回 `200`，字段仍为 `requestId/client/pool`，且不含 `DATABASE_URL` 原文 |
| 同上 | 环境令牌与请求令牌长度不同 | 返回 `401`，不抛异常（覆盖 `timingSafeEqual` 长度保护） |
| 同上 | `supabase-auth-transport` 回归 | 抽出共享 helper 后 404/401/200 行为与原实现一致 |
| `tests/api-proxy.test.ts` | 代理转发 | 断言 `x-signal-map-diagnostic-token` 出现在上游请求头，未被删除 |

### 3.4 验收

- 先红后绿：先写失败用例（当前实现下“未配置令牌仍可访问”，用例应失败），再实现门禁使其通过。
- 五条门禁（typecheck/lint/test/knip/deps）与 `build`、`api:build` 全过。
- 不新增日志输出令牌；错误体不得回显请求头。

## 4. 方案 B：移除端点

适用条件：登录 503 的 pg transport 取证已经结束，后续不再需要现场对比 `Client` 与 `Pool`。

| 文件 | 改动 |
|---|---|
| `backend/postgres-transport-probe.ts` | 删除文件 |
| `backend/node-server.ts:88-89` | 删除分支 |
| `backend/api-proxy.ts:23` | 从 `isDbBackedApiPath` 删除该路径 |
| `tests/backend-server.test.ts`、`tests/api-proxy.test.ts` | 删除相关用例，并新增“该路径不再被代理为 DB 路径”的断言 |

移除比加固更彻底：不留潜在信息面，也不留运维开关。代价是失去一次可复现的传输层取证手段。

## 5. 建议

**选 A**，理由：传输层问题尚未全部结案（历史 023/024 媒体读取超时、登录 503 的 pg transport 分支），需要保留可复现探针；而 A 的默认关闭语义使其在生产不暴露，风险可控。

若决定不再需要现场取证，**选 B**，并在同一提交删除测试，避免留下指向不存在路由的用例。

## 6. 本方案未做的事

- 未修改任何源码、未新增 `backend/diagnostic-token.ts`、未改测试。
- 未读取、未设置 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` 的值。
- 未部署、未重启、未调用该端点。
