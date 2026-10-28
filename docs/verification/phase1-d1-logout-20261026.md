# 阶段 1-D1：登录用户退出修复（2026-10-26）

基线 `4e132de`。本文件只覆盖 D1，不顺带重构会话系统。

## 1. 缺陷复述

`app/control/page.tsx` 的 `setUser` 三处赋值均为 `null`（`:94` 初始、`:109`、`:161`、`:196`），
已登录面板与其中的 `Logout` 按钮（`:263`）是不可达死代码；首页顶栏在已登录时只有“长期记忆”，
全仓库无其他退出入口。结论：**用户无法从界面退出登录**，而 `/api/auth/logout` 服务端实现是存在的。

## 2. 修复方式（最小）

| 文件 | 改动 |
|---|---|
| `lib/session-controls.ts`（新增，53 行） | `describeSessionControl(state)` 决定顶栏显示哪种控件；`performLogout({request})` 只调用 `/api/auth/logout`（POST、`same-origin`、`no-store`），OK 才算 `signed_out`，4xx/5xx 与网络异常一律 `failed` 并带可展示文案 |
| `app/page.tsx`（+39/−9） | 顶栏已登录分支增加“退出登录”按钮：`pending` 时禁用并显示“退出中…”，失败时保留登录态并就地显示错误；成功后作废 `currentResearchContextRef`、结束观察记录，再 `location.replace("/")` 回到未登录首页 |
| `tests/login-navigation.test.ts`（+3/−6） | 删除恒真的 `dashboardLoads` 断言与不再使用的 `load` 注入（D3） |

设计取舍：

- **不在前端隐藏按钮假装退出**：只有服务端返回 OK 才离开已登录视图。
- **不在前端读写 Cookie**：凭据完全由服务端 `Set-Cookie` 管理。
- **不删除本地研究资料**：退出只是切换分区；账号库原样保留，`createAlphaStorage(ownerId)` 已按账号分库。
- **在途请求隔离**：成功后执行 `window.location.replace("/")`。整页替换会销毁当前文档，
  账号分区的组件状态、在途研究请求与已渲染卡片随之一起丢弃；新文档以未登录身份重新解析会话，
  因此不需要在回调里手工作废 ref（该写法也会触发 `react-hooks/immutability` 规则）。

## 3. 测试（`tests/session-logout.test.ts`，7 条）

| # | 断言 | 红灯 | 绿灯 |
|---|---|---|---|
| 1 | 已登录 → `authenticated`；未登录 → `anonymous` | 失败 | 通过 |
| 2 | `checking`/`error` 永不算已登录（含残留 userId 的情况） | 失败 | 通过 |
| 3 | 退出走 `/api/auth/logout`，POST + `same-origin`，仅 1 次调用 | 失败 | 通过 |
| 4 | 退出过程不发 `/api/signals`、`/api/research`（不产生付费研究） | 失败 | 通过 |
| 5 | 服务端 503 → `failed` 且文案含状态码，绝不报成功 | 失败 | 通过 |
| 6 | 网络异常 → `failed`，不吞错 | 失败 | 通过 |
| 7 | 退出后视图为 `anonymous`；恢复失败时为 `error` 而非已登录 | 失败 | 通过 |

红灯证据：模块不存在时 7/7 失败，`failing tests` 首条为
`describeSessionControl must be exported`。

## 4. 关联测试与门禁

| 项目 | 结果 |
|---|---|
| `tests/session-logout.test.ts` | 7/7 通过 |
| `tests/login-navigation.test.ts` | 5/5 通过（D3 断言已替换） |
| `tests/local-account-storage.test.ts` | 5/5 通过（A→B→A 隔离、匿名库不被继承） |
| `tests/local-account-boundary.test.ts` | 4/4 通过 |
| `tests/home-research-trigger.test.ts` | 2/2 通过（登录/刷新不自动发起研究） |
| `npm run quality` | 见提交后的完整门禁记录 |
| `npm run build` / `npm run api:build` | 见提交后的完整门禁记录 |
| `git diff --check` | 见提交后的完整门禁记录 |

数据库条件跳过的 6 项不计作通过。

## 5. 仍未验证

- 真实浏览器：登录 → 顶栏出现“退出登录” → 点击 → 回到未登录首页 → 刷新仍为未登录。
- Supabase 登出是否对所有 `sb-*` Cookie 分片下发 `Max-Age=0`（受部署代理影响）。
- 退出后匿名分区是否确实看不到原账号的历史研究卡片（依赖 `key` 重挂载与分库，代码层已隔离，运行时未复验）。
- 持续在途的研究请求在退出瞬间的行为（代码层已作废上下文，浏览器未实测）。

## 6. 未处理

- **D2 保留**：`auth/session.ts:48-50` 把异常吞成 `null`，`backend/handlers.ts:627-630` 仍回 200 `{user:null}`，
  客户端判为匿名。方向安全（不会把未登录当已登录），但 Supabase 抖动会短暂显示空匿名库。本次不重构。
- `/control` 已登录面板与 `Logout` 仍是死代码；本阶段按指令“不重做 /control”，未清理。
