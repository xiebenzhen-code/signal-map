# 发布候选整理与独立验证（2026-10-04）

## 结论

发布候选已整理，独立安装、完整质量门禁、API/前端构建及编译 API 本机冒烟通过，
并已形成 Git 发布提交 `d2d5118ff357644248ccafdc8b39ea80a4016d4f` 推送至
`release/v1.1-public-validation-20261004`，Linux Docker 镜像已构建并通过生产启动与
`/health` 探活。此结论仅证明候选内容可验证；公网部署、云端数据库 TLS 与前端代理尚未验收。

## 候选范围

- 基线 HEAD：`110d9044e31ab2f21413655e4e67c4fc592d8c00`。
- 当前工作区有 13 个已跟踪修改文件。快照读取修改后的实际文件，没有回退到 HEAD 内容。
- 候选含 367 个文件，包括 DoH 实现、DoH/记忆语义测试、当前业务修补、公开 CA、必要配置与验收/学习材料。
- 全部 90 个 `.test.ts`/`.test.mjs` 文件已注册到 `npm test`，注册路径均存在。
- `certs/supabase-ca.pem` 与 `certs/prod-ca-2021.crt` 已显式收集；公开 PEM 被 Git 忽略，后续提交须显式纳入。
- 排除本地环境配置、Cookie 文件、日志、临时脚本、备份、旧 ZIP、远程附件、依赖与构建产物；未删除原工作区任何文件。
- `.openai/hosting.json` 被现有 Vite 配置直接导入，属于构建依赖，因此保留；不是运行密钥。
- 凭证格式扫描命中 7 个测试文件中的 18 处数据库 URL，经核对均是合成配置/脱敏测试夹具。未检出扫描规则覆盖的私钥块、JWT 或长 `sk-` token；此扫描不是所有密钥格式的完整证明。

干净构建上下文：
`C:\Users\25186\AppData\Local\Temp\signal-map-release-candidate-20261004-211408\source`

独立验证目录：
`C:\Users\25186\AppData\Local\Temp\signal-map-release-candidate-20261004-211408\verify`

不要上传 `verify`，其中含安装依赖和生成产物。`source` 未写入任何真实运行凭证，也没有验证日志或依赖目录。

## 本轮实际验证

| 项目 | 退出码 | 结果 |
|---|---:|---|
| `npm ci --offline` 初次沙箱尝试 | 1 | 安装子进程被 `spawn EPERM` 阻止，不计为产品缺陷或安装通过 |
| 同命令在允许子进程的执行环境重跑 | 0 | 安装 764 个包，离线使用本机缓存 |
| `KNIP_DISABLE_RAW_TRANSFER=1 npm run quality` | 0 | 183.4s；typecheck、lint、tests、knip、deps:check 全链通过 |
| tests | 0 | 725 总数 / 720 pass / 0 fail / 5 skipped；90 个测试文件 |
| lint | 0 | 0 errors / 27 warnings，未为候选改写规则 |
| deps:check | 0 | 163 modules / 352 dependencies，无违规 |
| `npm run api:build` | 0 | 0.5s，生成 `dist-api/server.mjs` |
| `npm run build` | 0 | 22.9s |
| 编译 API 独立冒烟 | 0 | `NODE_ENV=production`，随机端口；`/health`=ok，实例标记匹配；`/api/auth/me` 返回 user=null |

验证使用 Node v24.21.0，不等同于 Dockerfile 中 Linux Node 22 的实测。API 冒烟进程已停止，没有占用原服务端口。
验证未加载 `.env.local`；数据库、模型及 Supabase 登录配置在门禁子进程中显式移除。未执行产品真实研究，也未配置付费模型调用。

## 已明确的前端连接契约

浏览器同源请求 `/api/signals` → 前端实际运行的 API 路由 → `proxyApiRequest` → `API_UPSTREAM_URL` → Node API。

- `API_UPSTREAM_URL` 应为实际 CloudBase 后端的 HTTPS origin，不带 `/api`；最终域名尚未取得，不能预填虚构地址。
- 此变量由前端 API 运行时读取，静态 HTML 无法读取它并自动产生代理。
- 现有 `edgeone.json` 将 `/*` 重写到 `index.html`，静态 Drop 脚本只生成 HTML/资源，未提供公网 `/api/*` 代理。
- 后续须落实平台真实的 `/api/*` 转发，或采用能运行现有前端路由的部署形态；本轮未改线上配置。
- 若仍使用该 EdgeOne 构建配置，其 Node 22.11.0 低于项目要求的 >=22.13.0，需后续修正部署配置。

## 云端配置校正

- 后端 `auth/session.ts` 也读取 `NEXT_PUBLIC_SUPABASE_URL` 与 publishable/anon key，不能只配置前端。
- `MODEL_PROVIDER` 未配置时当前工厂默认 OpenAI；选择 DeepSeek 须明确配置 `MODEL_PROVIDER=deepseek` 及对应 key。
- `SIGNAL_MAP_ALLOWED_ORIGIN` 填实际前端 origin，它参与 POST 来源校验；不能用 `*` 代替业务来源。
- `SIGNAL_MAP_GUEST_SECRET` 建议使用独立稳定密钥，代码实际允许回退到 `DATABASE_URL`。
- 公网数据库连接保持 TLS 与 CA 校验。当前直连端点的 IPv6 可达性和 direct 协商必须在云端实测，不能由本地成功推导。
- 容器中公开 CA 可用路径为 `/app/certs/supabase-ca.pem`。连接串避免 SSL query 参数覆盖应用 SSL 配置。
- `/health` 只证明 HTTP 存活，不证明数据库可用。

## Docker 验证记录（Linux/amd64，本地）

- 镜像：`signal-map-api:rc-20261004-d2d5118`
- 构建上下文：上述干净候选 `source` 目录 + 同步的 `.dockerignore`（含云构建 hygiene 排除规则）。
- 构建：首次 `npm ci` 遇瞬时 `ECONNRESET`（非缺陷，容器内到 registry 的 DNS+HTTPS 实测 200），重试 exit 0。
- 镜像 Image ID：`sha256:d108d66152e01073c72539ac0adbed6b47445ded40b908dd19fd793bcefdb7f4`。
- **RepoDigest 状态：未推送镜像仓库，故不存在经仓库签发的 RepoDigest。**
  本地 `docker image inspect` 的 `RepoDigests[0]` 显示的是镜像 ID 本身，不代表远端仓库摘要，不得当作 CloudBase 镜像摘要。
- 镜像内含 `dist-api/server.mjs`、`pg@8.23.0`、`source-registry/sources.json`、`certs/supabase-ca.pem`
  （CA sha256 与候选源一致）。
- 容器探活（未注入真实密钥，TLS/安全未关）：启动日志仅一条监听消息，`/health`=200，
  注入 `SIGNAL_MAP_SERVER_INSTANCE_ID=signal-map-d2d5118` 后返回该实例标记；`/api/auth/me` 无凭证返回 `{"user":null}`。
- 一致性核对（不含 `.dockerignore`）：
  - 候选 `source` 目录与 `d2d5118` 全文件 SHA256 比较，去行尾差异后**业务树内容一致（0 差异）**；
  - 候选与 `d2d5118` 之间观察到的是文本换行差异（CRLF vs LF），经规范化（去除 CR）后哈希一致，
    **二进制文件按原始字节比较**（如 `certs/*.pem` 以原始字节比对，见上 CA sha256 一致）；
  - 候选快照时间早于 `d2d5118` 提交，因此 `d2d5118` 新增文档 `docs/reliability/deployment-ready-check.md` 不在候选内，属纯文档，非构建输入。

> 说明：不用 Docker 构建时的上下文传输量作为排除规则是否生效的唯一证据。
> 排除规则通过性以（a）`.dockerignore` 规则与候选目录物理扫描（无 `.env.local`/`*.log`/`*.zip`/`tmp-*`/secrets）、
> （b）镜像内 `find` 无 `.env.local`/`*.log`/`*.zip`、（c）必需文件（CA、sources.json、entry、lockfile）确实进入镜像 三方面共同确认。

## 尚待完成

1. 获取真实 CloudBase 服务入口，落实前端 API 代理，注入云端运行配置。
2. 云端验证数据库 TLS、登录态读取，再按单独预算完成跨网络研究及反馈验收。
3. 公网部署（CloudBase 构建必须确认实际 checkout 的新 SHA）与前端代理仍未验证。

原始清单、每文件 SHA256、配置说明、门禁日志与结果保存在 `outputs/release-candidate-audit-20261004/`。
本轮仅新增候选/审计产物、`.dockerignore` 排除规则与此报告，业务源文件未修改，未部署，未更新既有交付 ZIP。
