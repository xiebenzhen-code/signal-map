# C1a — Node SSR 前端运行适配报告（2026-10-06）

## 结论：部分通过

独立 Node SSR 构建、Linux Node22 生产镜像、页面 HTTP/资源/RSC 响应与严格离线门禁通过。浏览器 hydration、交互、导航及视觉验收未完成：当前浏览器工具只提供 visibility/viewport，没有外网阻断接口，无法证明浏览器只访问本地，按授权要求没有导航页面。不能将 HTTP 验收冒充浏览器验收，不能宣称 C1a 完整通过或已部署腾讯云。

## 基线与实际改动

基线 SHA：`e15eabea03fd4c49c31261ea3fb03d5a7b9695d2`；分支 `codex/tencent-runtime-migration`；HEAD 未变，无 commit/push。

仅在本报告所在迁移工作区修改：

| 文件 | 作用 |
|---|---|
| vite.config.ts | 显式选择 Node；将 Sites 插件、hosting JSON、Cloudflare 插件及工具环境设置延迟到原构建分支 |
| package.json | 增加 build:node/start:node，并注册 3 项配置行为测试；依赖版本不变 |
| scripts/frontend-node.mjs | 调用锁定 vinext 原生 CLI；指定 PORT/HOST，检查完整入口与客户端目录，转发停止信号 |
| Dockerfile.frontend | 独立前端镜像；锁定依赖 npm ci，断网 Node 构建，复制 dist、运行依赖、来源配置和公开 CA；不替换 API Dockerfile |
| tests/frontend-node-runtime.test.mjs | 加载真实 Vite 配置验证 Node、旧默认路径和错误目标，非字符串搜索测试 |
| docs/reliability/c1a-node-ssr-plan.md | 实施清单 |
| 本报告 | 验收结论与局限 |

## 最小设计及原因

已安装 vinext 的 CLI 支持原生 Node `build/start`；prod-server 使用 Node HTTP，支持 App Router RSC/SSR、静态资源与流式响应。没有安装新依赖，没有使用 next start、静态导出或自行重写 SSR server。

`npm run build:node` → 包装脚本设置 `SIGNAL_MAP_FRONTEND_RUNTIME=node` → Vite 只启用原生 vinext/既有 Tailwind → `dist/server/index.js`、`dist/server/ssr`、`dist/client` → `npm run start:node` 原生 Node 服务。

默认 `npm run build` 继续走原 Sites/Cloudflare 路径。Node 配置保留 vinext 自带的 cloudflare-build 扩展钩子，但不加载外部 vite-plugin-cloudflare；原生框架钩子不等于使用 workerd 运行时。

前端与 API 仍是两个服务。auth/connections/原本本地执行的 API 继续由前端路由 handler 处理，既有代理路径继续通过 `API_UPSTREAM_URL` 到 Node API。读取配置在请求时发生，未配置仍回退 `http://127.0.0.1:8080`。未修改 proxy、auth/session 或任何 route.ts，不改变方法/JSON/status 等历史契约；preferences 同域缺路由等基线限制继续保留。

## 构建、启动、停止复现

在迁移工作区执行：

```powershell
npm ci
npm run build:node
$env:PORT = '3101'
$env:HOST = '127.0.0.1'
npm run start:node
# 停止：当前终端 Ctrl+C。
```

本地脚本默认 Host=127.0.0.1、Port=3000。HOST/PORT 只在前端进程使用。以上普通启动命令不是严格离线验收证明；严格验收应使用下面的隔离容器。不得复制生产 .env、凭据或 Cookie。

```powershell
docker build -f Dockerfile.frontend -t signal-map-frontend:c1a-e15eabe .
docker run -d --name c1a-local --network none signal-map-frontend:c1a-e15eabe
docker exec c1a-local node -e "fetch('http://127.0.0.1:3000/control').then(r=>console.log(r.status))"
docker stop c1a-local
docker rm c1a-local
```

Dockerfile 在依赖安装阶段允许 registry 访问，`RUN --network=none npm run build:node` 明确禁止构建阶段公网访问。测试容器 network=none、没有发布端口；请求通过 docker exec 在容器内 loopback 执行。没有假设 network=none 发布端口可供宿主浏览器访问。

回到原构建：用原 `npm run build`/`npm start`，不要设置 SIGNAL_MAP_FRONTEND_RUNTIME=node。两种目标共用 dist；切换目标必须重新构建，不能混用旧产物。回退改动只在迁移工作区逐项审查处理，不 reset 原目录或冻结标签。

## 页面与运行边界矩阵

实际生产镜像 Node v22.23.3，无凭据、无 API 测试替身，所有网络请求仅容器 loopback。

| 项 | 实际证据 | 状态/限制 |
|---|---|---|
| 首页 /，重复请求 | HTTP200，HTML 含原“正在恢复本地认知状态…”加载壳 | 初始 SSR 通过；本地状态在客户端恢复，hydration 后内容未验证 |
| /control，重复请求 | HTTP200，SSR 包含“继续你的探索。”未登录页面 | HTTP 通过；按钮/刷新浏览器行为未验证 |
| /auth/callback，无参数和 code=c1a-invalid | 均200，原预创建账号提示 | 未做 OAuth/验证码交换 |
| /auth/reset-password，无参数和 type=invalid | 均200，原“设置新密码”及确认界面 | 未点击验证/提交，不发邮件、不改密码；客户端无效链接提示未验证 |
| 20 个本地 JS/CSS | 均200，正确 Content-Type，没有 HTML 冒充脚本 | 仅实际被初始 HTML 引用的本地资源；不冒充所有图片/字体都通过 |
| RSC /control 请求 | 200，text/x-component，实际响应体4628字节 | 协议响应通过；不等于浏览器 RSC 导航通过 |
| /api/auth/me | 200，user:null，private,no-store | 未配置认证的真实本地 handler 降级；不是 SDK 登录验收 |
| /api/control/knowledge，API 不可达 | 502，API_UPSTREAM_UNAVAILABLE，no-store | 原代理诚实失败，没有模拟业务成功 |
| /login | 404 | 未增加此页面 |
| 平台独立性 | 最终镜像无 .openai、vite.config.ts、生产 .env；完整 dist 启动正常 | 未依赖 Sites 会话或平台绑定；没有启动 workerd |
| 自动作研究 | 未执行浏览器 JS；HTTP 加载无研究提交，既有 home-research-trigger 等测试通过 | 不能宣称本轮浏览器自动请求计量完成 |
| 页面交互/视觉/Console | 没有浏览器安全隔离能力，不打开页面 | 未完成，无截图/Console 证据，不用 HTTP 替代 |

初次 HTTP 探针错误地假设首页已有 main；源码 `app/page.tsx` 的既有 `!hydrated` 分支明确只输出 div 加载壳，因此纠正验收假设，保留原失败日志，没有改 UI。修正后生产镜像真实请求通过。

## 红→绿与完整门禁

配置行为测试在固定旧 Linux 镜像运行：2 项失败、1 项通过（exit1）；Node 选择仍加载 Sites/外部 Cloudflare，错误目标没有拒绝。最小适配后 3/3 通过（exit0）。首次测试匹配范围包含 vinext 的原生空钩子，收窄为实际平台插件后在旧镜像再次证实仍为2红/1绿；两份日志保留，不制造业务失败。

完整门禁使用 Node v24.21.0 的独立 Linux 测试镜像，network=none；执行前公网 DNS=EAI_AGAIN、公网IP:443=ENETUNREACH，产品凭据存在键清单为空。保留既有断言；既有 origin-gate 等测试会调用研究 handler，但无法获取公网来源，没有把清空凭据当成离线证明。

| 命令/环节 | exit | 实际结果 |
|---|---|---|
| 受影响配置测试 | 0 | 3/3 |
| npm run quality | 0 | 744总、739pass、0fail、5skip；lint0errors/28既有warnings；knip0；deps0violations，165modules/357dependencies |
| npm run api:build | 0 | Node API 构建，职责不变 |
| npm run build | 0 | 原 Sites 前端构建回归 |
| npm run build:node | 0 | Node24 断网构建；Docker中Node22也构建成功 |
| docker build -f Dockerfile.frontend | 0 | npm ci 使用锁定依赖，Linux/amd64；没有宿主 node_modules |
| Linux生产启动/网络证明/HTTP探针 | 0 | Node22.23.3；12页面响应、20资源、4运行边界通过；运行时无公网出口 |
| git diff --check | 0 | 无空白差异错误 |

最终镜像：`signal-map-frontend:c1a-e15eabe`，本地 image ID `sha256:0f77a7be3fb50a928cac97016f985ceddea9a10fba54b4536ab1ae63aa6bd3d4`，linux/amd64，1,464,455,310 bytes。该标识是本地镜像，不是远端已发布 digest。生产进程 Running=true/RestartCount=0，无端口映射；测试容器已 stop/rm。

候选源码清单413文件（409基线+4新实施文件），全量复制哈希一致。测试依赖来自之前独立 Linux npm ci 的固定镜像，未链接原目录；生产镜像本轮独立 npm ci。报告文件在验收后加入，不伪称报告本身经过构建测试。

## 保护结果

原目录本轮快照：937→937，HEAD/branch/status/index原始字节哈希均相同，文件变化0；旧轮索引历史缺口不补证。冻结源码 ZIP SHA256 前后均 `e1aeb21204cac2150ded33825cafabfe5f619aa73efa6f561882baf2518f2601`。

迁移409个基线文件407字节哈希不变，仅 package.json/vite.config.ts 两项改变。保护模块、页面、样式、auth、API proxy、Agent/research/source/Provider/information仓储schema/本地存储、API Dockerfile、package-lock.json 均未变。未升级依赖，未动原服务。

## 安全、公网和下一阶段人工事项

- 本轮 npm ci 仍报告32漏洞（low1/moderate7/high22/critical2），与C0.5记录一致；没有自动修复。前端RSC官方DoS风险仍未解除，不能公开放行。
- HTTP HTML实际仍引用 Google Fonts 两个外部 CSS（Geist/Geist Mono）。未访问它们，这是基线 font shim 行为；不属于 Provider，但涉及无VPN视觉/资源可用性，后续需单独处理，不能声称所有资源已脱离海外访问。
- 既有 metadataBase=http://localhost:3000 未修改，公网分享链接仍需后续审查，不能扩大到 UI 改动。
- 原生框架公网协议信任来自 VINEXT_TRUSTED_HOSTS/VINEXT_TRUST_PROXY；本轮未设置或放宽。C1b需核验腾讯 HTTPS 终止、可信转发头与 Origin/cookie/恢复链接。不要无条件相信任意客户端转发头。
- 需要一个可证明浏览器只访问本地的隔离验收环境，再补 hydration、既有交互、导航/刷新、Console/Network、字体/图片和客户端无自动研究证据；不得用公网浏览器绕过本轮限制。
- 公网安全放行、腾讯预览部署、真实账号、DB、来源连通与无VPN用户体验均未执行，也不由本轮测试推导。

真实产品模型调用0、真实研究提交0、真实登录0、邮件0、数据库连接0。允许的联网仅构建依赖/镜像元数据获取；门禁及页面HTTP探针均无公网出口。未 commit/push/deploy，未改DNS/代理/云端配置，没有进入C1b。证据保留在封存目录 `c1a-20261006/`，仅清理本轮3个测试容器，镜像/日志/产物保留。报告后停止。
