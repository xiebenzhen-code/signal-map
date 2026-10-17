# Deployment Ready Check — Signal Map P6.1.5（2026-10-04）

审计范围：backend/node-server.ts 部署到公网（CloudBase 云托管）前的只读检查。未修改业务代码、未部署、未 commit/push。

## 结论：条件性 Ready

后端可以构建、可以独立运行；但有 3 项部署前必须处理的事项（见 Required Secrets / Deployment Steps 的 ⚠ 标记）。

---

## Docker:

**结构**：`node:22-bookworm-slim` → `npm ci`（装全部 deps+devDeps，含 linux 版 esbuild）→ `COPY . .` → `npm run api:build`（容器内构建）→ `NODE_ENV=production, PORT=8080` → `CMD ["node","dist-api/server.mjs"]`。

**判定：✅ 可以直接运行生产 API**，依据：

1. `.dockerignore` 已排除 `.env*`（密钥不进镜像）、`node_modules`（宿主 Windows 二进制不污染）、`dist`/`dist-api`/`.next`（构建产物重新生成）。
2. `pg` 是 dependency（`^8.23.0`），esbuild `--external:pg` 后运行时从镜像内 `node_modules` 加载 —— `npm ci` 已保证。
3. `certs/supabase-ca.pem` 不在 ignore 列表 → `COPY . .` 会带入（若 `POSTGRES_SSL=true` 且用相对路径 `POSTGRES_CA_PATH=certs/supabase-ca.pem`，容器内可解析；`readFileSync(caPath)` 相对 CWD=/app）。

**注意（非阻塞）**：
- 无 `HEALTHCHECK` 指令；CloudBase 用平台健康检查代替即可（见 Runtime）。
- 镜像内 devDeps 全量安装（esbuild 仅构建期需要）——可后续优化多阶段构建，本轮不要求。
- `EXPOSE 8080` 为文档性声明；CloudBase 以实际监听端口为准。

## Build:

**`npm run api:build` 判定：✅ 生成正确的 `dist-api/server.mjs`**

- 脚本：`esbuild backend/node-server.ts --bundle --platform=node --format=esm --target=node22 --external:pg --outfile=dist-api/server.mjs`
- 实测：exit 0，产物 1.4MB 单文件。
- **独立冒烟通过**：`PORT=8091 node dist-api/server.mjs` 启动成功，`/api/auth/me` 返回 200 `{"user":null}`，`/health` 返回 200 `{"status":"ok"}`（不依赖任何 TS 源码）。
- 全部 9 个生产 env 引用均以字符串形式存在于产物（运行时注入，不烘焙）：`DATABASE_URL`、`POSTGRES_SSL`、`POSTGRES_CA_PATH`、`SIGNAL_MAP_ALLOWED_ORIGIN`、`SIGNAL_MAP_GUEST_SECRET`、`SOURCE_DOH_URL`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`MODEL_PROVIDER`。

## Runtime:

- 监听：`PORT`（默认 8080，`parseInt(process.env.PORT)`）——CloudBase 服务端口填 8080 或映射后端口。
- 健康检查路径：**`/health`**（200 JSON）。注意不是 `/api/health`（该路径 404，已实测）。
- `/api/research/stream` 为 SSE 流式（`text/event-stream`）→ CloudBase 需关闭响应缓冲、放宽超时（研究运行分钟级）。
- CORS：`SIGNAL_MAP_ALLOWED_ORIGIN` 未设置时输出 `*`；设置后仅同源放行——**前端域名上线时必须设置**。
- 会话：`SIGNAL_MAP_GUEST_SECRET` 未设置时 fallback 到 `DATABASE_URL`（auth/session.ts:11）——生产必须显式设置独立密钥。

## Required Secrets:

| 变量 | 必需性 | 说明 |
|---|---|---|
| `DATABASE_URL` | ⚠ 必需 | PostgreSQL 连接串（Supabase pooler）。无它后端启动但所有 DB 路由失败 |
| `SIGNAL_MAP_GUEST_SECRET` | ⚠ 必需（显式） | 匿名会话签名密钥；不设则 fallback DATABASE_URL（耦合、轮换风险） |
| `DEEPSEEK_API_KEY` | ⚠ 研究功能必需 | 模型调用；不设则研究管线无模型可用（页面加载、检查端点不受影响） |
| `SIGNAL_MAP_ALLOWED_ORIGIN` | ⚠ 必需（前端上线后） | 前端公网域名（如 `https://<你的EdgeOne域名>`）；缺省 `*` 有 CSRF 面 |

## Required Environment Variables:

| 变量 | 必需性 | 默认/示例 |
|---|---|---|
| `PORT` | 可选 | 8080（CloudBase 会注入，Dockerfile 已 ENV） |
| `NODE_ENV` | 可选 | Dockerfile 已 ENV=production |
| `POSTGRES_SSL` | 推荐 | `true`（公网到 Supabase 必须 TLS） |
| `POSTGRES_CA_PATH` | 推荐 | `certs/supabase-ca.pem`（相对 /app；镜像已含 certs/） |
| `PGSSLMODE` | 可选 | `require`（与 POSTGRES_SSL 二选一即可） |
| `SOURCE_DOH_URL` | 可选 | 如 `https://dns.google/resolve`；云托管出网正常时不需要（TUN fake-IP 仅本机问题） |
| `MODEL_PROVIDER` | 可选 | 未设时走 deepseek 适配器（agent/models/factory.ts） |
| `DEEPSEEK_MODEL` | 可选 | 未设用默认 planning/synthesis 模型 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（或 `_ANON_KEY`） | 视路由 | auth 会话校验用（auth/session.ts）；后端全量路由含 auth，建议提供 |
| `POSTGRES_POOL_MAX` / `POSTGRES_IDLE_TIMEOUT_MS` / `POSTGRES_CONNECTION_TIMEOUT_MS` / `SIGNAL_MAP_SERVER_INSTANCE_ID` | 可选 | 均有默认 |

## Deployment Steps:

1. **准备镜像**：Dockerfile 现状可用；在 CloudBase 云托管新建服务 → 上传代码或镜像 → **服务端口 8080** → 健康检查路径 `/health`。
2. **注入 Secrets**（CloudBase「环境变量/配置管理」，非镜像层）：`DATABASE_URL`、`SIGNAL_MAP_GUEST_SECRET`、`DEEPSEEK_API_KEY`、`SIGNAL_MAP_ALLOWED_ORIGIN=https://<前端域名>`、`POSTGRES_SSL=true`、`POSTGRES_CA_PATH=certs/supabase-ca.pem`。
3. **SSE 设置**：确认 CloudBase 网关对 `/api/research/stream` 不缓冲、超时 ≥ 数分钟。
4. **验证后端公网可达**：`curl https://<云托管域名>/health` → 200。
5. **配置前端**：EdgeOne/Netlify 环境变量 **`API_UPSTREAM_URL=https://<云托管域名>`**（backend/api-proxy.ts 消费；未设时默认 `http://127.0.0.1:8080`，公网前端会得到 502 `API_UPSTREAM_UNAVAILABLE`）→ 重新部署前端。
6. **端到端验证**：前端登录 → 来源检查（`/api/sources/check` 为 PROXY 路由，经 API_UPSTREAM_URL 转发）→ signals 列表。

**前端 `API_UPSTREAM_URL` 最终答案**：`https://<CloudBase 云托管服务公网域名>`（HTTP 协议头必须带上；PROXY 路由清单：`/api/signals`、`/api/sources/check`、`/api/research/agent`、`/api/control/*`、`/api/diagnostics/postgres-transport`）。

## 架构事实（审计中确认，供部署决策）

- **双运行时架构**：前端（vinext/workerd）的 `app/api/*/route.ts` 分两类——PROXY（`proxyApiRequest` → HTTP 转发到 `API_UPSTREAM_URL`）与 DIRECT（workerd 内直接执行 handler，如 auth/login、research/plan、social）。
- `node-server.ts` 实现全部 /api 路由 + `/health`（比前端 PROXY 清单更全）→ 后端独立可服务完整 API 面。
- docs/tencent-cloud-backend.md 的 `X_BEARER_TOKEN`/`XHS_SERVICE_URL` 在当前代码中**无引用**（历史文档残留），不在必需清单。

## 本轮计数

- 模型调用：0；研究提交：0（上轮验收中断，预算授权仍未使用）
- 代码修改：0（纯审计；上轮遗留的 DoH 接线恢复已由用户授权并完成，属于前轮工作）

## 遗留

- 上轮"自选来源完整研究验收"在第 1 步（预检+接线恢复+后端重启）后被本任务打断：研究提交 0、requestId 无。预算授权未消耗，待用户重新发起。
