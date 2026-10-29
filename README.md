<!-- README_SYNC: source=develop@e7d1b2b; updated=2026-10-28 -->
<p align="center">简体中文 · <a href="./README_EN.md">English</a></p>

# Signal Map

面向独立开发者和创作者的信息过滤与辅助判断工具：围绕一个具体问题读取公开材料，按日期和相关性筛选，保留出处与筛选理由；拿不准的放进「可能相关」，没有结论时说明原因。

[试用入口](https://signal.benzhenlab.com/) · [问题反馈](https://github.com/xiebenzhen-code/signal-map/issues)

![Stage](https://img.shields.io/badge/status-limited_trial-2457ff)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/local_checks-Node.js_24%2B-43853d)
![Repository](https://img.shields.io/badge/repository-public-2ea44f)

[约 50 秒真实操作视频](docs/portfolio/signal-map-demo.mp4) · [录制方法与结果](docs/portfolio/DEMO.md)

> 演示录制于 2026-10-21，对应 Sites53 + API019。它展示的是当时的行为，不能用来证明之后版本的效果。

![Signal Map 系统框架与验收边界](docs/portfolio/signal-map-architecture.png)

**状态：受限试用，准备冻结一个求职展示版本。** 仓库保持公开。本稿对应 `develop` 分支；线上是否包含其中的修改，以发布记录为准，GitHub 上的最新代码不等于已经在线上运行。

## 为什么做

信息越来越多，判断却没有变得更容易。同一件事反复传播，新闻、推测和营销混在一起，看得越多，有时越难决定该相信什么、该关注什么。

Signal Map 尝试让这个过程可以被检查：先明确问题，再取得材料，按时间和相关性筛选，保留原文供人核对。目标是减少无效信息的摄入、辅助判断；目前没有用户研究证明这些效果已经实现。

## 亮点

- **围绕问题检索**：把主体、时间窗口和排除条件转成计划，在预算和截止时间内执行。
- **安全读取**：公网地址预检、解析后固定连接地址、逐跳校验跳转、TLS 校验；中继凭据只走同源请求头，不进入 URL。
- **把「不确定」当作一等公民**：不确定的材料进入默认折叠、标注「未确认」的「可能相关」，不计入正式结果；零展示时给出六类原因之一。
- **如实记录执行**：来源已搜索、未搜索、失败分别记录；读取失败保留安全的细分错误码；发布时间与抓取时间不混用。
- **评测正在建立**：人工金标尚未完成，所以误零率和展示精度暂不公布。

项目是有预算和截止时间的研究工作流，不是自主运行的 agent。日期、去重、过滤和安全检查由确定性代码承担。

## 当前能力与证据

| 能力 | 已有证据 | 尚未完成 |
|---|---|---|
| 来源读取与过滤 | 有限的真实读取、确定性测试、执行日志 | 全行业覆盖、持续可达性、答案质量 |
| 不确定材料分流 | D06 完整冻结计划离线回放：抓取/链接去重后 25/25，正式关注 0、资料库 0、可能相关 5 个聚合簇；N4 的 25 条可能相关仅为受控展示门单测（[复核与逐条去向](docs/verification/d06-eval-dedup-repair-20261029.md)、[N4](docs/verification/n4-closeout-20261026.md)） | 线上页面复验；人工标注验证折叠是否漏掉必看 |
| 零展示原因与覆盖说明 | 每个来源的读取说明与六类零展示原因，有单测与渲染快照 | 线上页面复验 |
| 诊断入口令牌门 | 线上 API028 未配置令牌，两个诊断入口匿名 POST 均返回 404（[发布证据](docs/verification/api028-source-deployment-report.md)） | 已上线；不等于登录或研究效果验收 |
| 账户记录持久化 | 测试账号保存、退出重登读回、浏览器显示新记录 | 更多账号和设备的验收 |
| 同浏览器账号切换 | `130009a` 的本机草稿隔离修补及本地反例（[记录](docs/verification/local-account-isolation-repair-20261021.md)） | 新版本部署后 A→B→A 页面复验 |
| 长期记忆影响研究 | 账户存储与记忆选择接线存在，自动参与默认关闭 | 跨次记忆是否改善研究质量；与旧结论矛盾的新证据目前只保存为证据，不更新知识层 |
| 主动跟踪与提醒 | 有调度和通知相关实现 | 不作为当前已验收的生产承诺 |

## 来源与适用范围

[来源目录](source-registry/feed-catalog.ts)登记 **18 路静态订阅源，外加 1 路按配置启用的 RSSHub 中继，共 19 路，其中 10 路为官方发布方**（数量由脚本从目录统计）。登记、成功读取、事实可信是三种不同状态，目录数量不等于持续可用来源数。每次按实体或主题选择全部匹配的订阅源，不再限制为 3 路；仍保留排除条件、来源类型限制和中继配置门控。

| 使用方向 | 来源示例 | 当前边界 |
|---|---|---|
| 国内 AI 产品与产业动态 | 极客公园、36氪快讯 | 近期试用重点；有单次真实读取与结果记录，未证明长期稳定 |
| 影视与创作软件 | Kdenlive、OBS、Krita | 关注工具发布，不能代表整个影视行业 |
| 电商与开发工具 | Shopify、WooCommerce、Node.js、GitHub、Chrome | 各渠道可达性不同，开发公告不能直接当作业务适用结论 |
| 科技、游戏与航天资讯 | IT之家、少数派、InfoQ、开源中国、机核、NASA 等 | 已登记，不能据此宣称各行业均有效 |

极客公园走官方 RSS，媒体报道仍需核对证据。36氪快讯经独立 RSSHub 服务和 HTTPS 鉴权网关接入，目前只取最新 5 条，**不代表过去 7 天的全部新闻**；当前中继的可用性待复验。历史云端读取记录见 [other-feeds-cloud-probe-20261021.md](docs/verification/other-feeds-cloud-probe-20261021.md)。新增行业需要合适的来源和单独验收。

## 工程结构

```text
用户问题、时间窗口与排除条件
  → 规划与预算
  → 来源读取 / 安全检查 / RSS 与 Atom 解析
  → 日期、相关性、去重与信号聚合
  → 正式结果 / 可能相关 / 待判断材料
  → 原文、来源读取状态与筛选说明
```

Web：React / vinext；API：独立 Node.js 进程；认证：Supabase Auth；账户数据：PostgreSQL。主要接口：`POST /api/signals`、`POST /api/research/plan`、`/api/research/stream`、`/api/control/knowledge`、`POST /api/sources/check`，它们是产品内部接口，不是稳定的公共 SDK。

**模型使用**：规划与综合是两处可选的模型调用，具体模型通过环境变量配置（见 [.env.example](.env.example)）；规划超时会回退到确定性计划（`agent/runner.ts`）。其余检索、过滤、去重、日期与安全检查不依赖模型。API028 未配置模型提供商及 OpenAI/DeepSeek 密钥变量，规划与综合走默认确定性路径。该结论仅限 API028；Web 配置不能据此推断（[当前基线](docs/verification/CURRENT-BASELINE-20261028.md)）。

**测试隔离**：测试通过注入的请求与地址解析函数使用冻结快照，不访问真实网络，也不依赖当前时间。

## 验证与证据

在 `develop` 提交 `e7d1b2b` 的文件内容上，Node.js 24.21.0 下 `quality`、`build`、`api:build` 退出码均为 0：**1035 项测试，1029 通过、0 失败、6 项因数据库测试环境缺失跳过**。证据见 [develop 门禁记录](docs/verification/develop-e7d1b2b-gates-20261028.md)。lint 无错误，仍有既有警告。跳过项不计通过；这些数字不是覆盖率，也不是线上成功率。

D06 将完整冻结计划与旧式查询词重建计划并列回放；后者返回正式关注 0、资料库 1、可能相关 0，不能将那 1 张资料库卡算成正式关注。N4 受控评分展示门单测仍为 0/25，不能替代完整回放。9 条窗口外材料仍参与聚合；返回卡片日期未越界不代表底层证据都在窗口内。本轮没有人工金标，也不是线上端到端验收。

历史国内 AI 研究曾取得极客公园 30 条、36氪 5 条，去重后 34 条，返回 2 条信号。单次记录不能证明持续稳定或答案正确。

### 演示没有掩盖的失败

2026-10-21，正式站点的 Kdenlive 维护更新问题检索 20 条、聚合 18 个信号、最终展示 0 条。读取确实执行了，但没有回答原题，答案质量未通过。[历史演示及边界](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/DEMO.md)保留了这个结果，不把它当作当前全部能力通过的证明。

**版本口径**：线上 API028 对应源码 `41761804…`，Web 为 Sites58（Sites 源码 `265afcc…`）；回退 API 为027。Web 已含“可能相关”和零结果原因组件；本次目标 Web 发布尚未完成。详见[当前基线](docs/verification/CURRENT-BASELINE-20261028.md)。上方历史演示保留其原版本口径。

## 已知局限

以下集中说明当前能力边界，避免把「已实现」误读为「已验证」。

- **效果未经验证**：减少信息焦虑、辅助判断是目标，没有用户研究支持；工具不能自动保证信息真实。
- **没有人工金标**：误零率、展示精度、漏检率暂不可计算。折叠的「可能相关」是否漏掉必看，需要标注后才能回答。
- **相关性误拒仍是已知问题**：零结果只表示本轮没有可展示的证据，不代表没有变化。
- **跨语言匹配较弱**：中文约束遇到英文正文时容易被判为不确定。
- **覆盖有限**：不承诺全网覆盖、每次必有答案、持续自主监控或成熟的公共 SDK。
- **部分渠道可达性未恢复**：Chrome / FeedBurner 超时、WooCommerce 地址预检拒绝尚无恢复证据；36氪中继的当前可用性待复验。
- **记忆的局限**：「看到记录」不等于「影响研究」；与旧结论矛盾的新证据目前只写入证据层，不更新知识层。
- **账号隔离线上复验未完成**：本机多账号草稿隔离已修补，正式站点复验仍待执行；共享设备勿保存敏感草稿。
- **上线与验收边界**：Sites58 已含不确定材料分组与零结果原因组件，API028 的诊断入口已验证为404；目标 Web 更新仍被阻断，线上冻结夹具展示尚未复验。
- **选题用途和社媒采集留待后续**，不作为当前成果。
- **仓库尚无 `LICENSE`**：未声明开源或商业使用授权；第三方依赖与字体各有其许可。

## 本地运行

建议使用 Node.js 24+。包声明最低 22.13.0，但完整测试使用 Node.js 24；生产 Dockerfile 当前仍是 Node.js 22，尚未升级。

PowerShell：

```powershell
git clone https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

bash：

```bash
git clone https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
npm ci
cp -n .env.example .env.local
```

先编辑 `.env.local`：认证需要 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；账户持久化需要你自己的 `DATABASE_URL` 和对应数据库表；模型和可选渠道按需配置。`npm run db:migrate` 只对自己专用的开发库执行。真实研究可能访问外部服务并产生模型或云费用；不要用生产数据库测试，不要提交 `.env.local`、密码、Cookie 或密钥。

第一个终端启动 API（默认端口 8080）：

```bash
npm run api:build
node --env-file=.env.local dist-api/server.mjs
```

第二个终端启动 Web：

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

```bash
SIGNAL_MAP_FRONTEND_RUNTIME=node API_UPSTREAM_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

访问 http://127.0.0.1:3000 。页面能打开不代表认证、数据库和外部来源已经配置成功。生产代理与来源读取保留地址和 Origin 检查，不应为了联网问题关闭保护。

## 测试

```bash
npm run quality
npm run build
npm run api:build
```

条件跳过的 6 项不计作通过；测试数量不是覆盖率，也不是真实用户研究次数。仓库有手动触发的[端到端工作流](.github/workflows/signal-map-agent-loop-e2e.yml)，需要专用测试环境，不以文件存在代替 CI 实际通过。

## 维护、数据与反馈

计划在受控发布和一次页面复验后冻结展示基线，之后在开发分支上边求职边维护：记录问题、验证改进，再决定是否更新冻结版本，不承诺更新频率。下一步重点是人工评测、来源持续可达性、相关性误拒和记忆对判断的实际帮助。

服务端账户记录与本机草稿是两条路径。最新源码为每个账号绑定独立的 IndexedDB 存储，并保留匿名旧库；无归属的历史数据不自动分配给登录账号。

更多记录：[README 事实核对](docs/verification/readme-evidence-20261022.md) · [可编辑架构 SVG](docs/portfolio/signal-map-architecture.svg) · [OBS / Kdenlive 云端读取](docs/verification/other-feeds-cloud-probe-20261021.md) · [正式域名与演示交付](docs/verification/formal-portfolio-delivery-20261021.md)

请通过 [Issue](https://github.com/xiebenzhen-code/signal-map/issues) 反馈，附上脱敏的请求编号、时间、版本和预期行为，不要提供密码、Cookie 或密钥。
