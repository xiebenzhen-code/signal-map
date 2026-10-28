# 阶段 0 README 审阅稿与公开面文本建议（2026-10-26）

本文件是**建议稿**，不覆盖根 `README.md` / `README_EN.md`，不创建 PR。

底稿：当前 `README.md` / `README_EN.md`（`README_SYNC: source=eb6666d5... updated=2026-10-22`）。

---

## 1. 本次建议的六处改动

| # | 改动 | 原因 |
|---|---|---|
| 1 | 首屏删除「Star 收藏 / Star to bookmark」链接 | 收藏引导与仓库首页应展示的内容无关；文末重复的那一处同样删除 |
| 2 | 保留演示视频、架构图、徽章，并给演示加一行时效说明 | 演示录制于 2026-10-21（Sites53 + API019），不能用它证明 API 027 的行为 |
| 3 | 把所有「不能证明 / 尚未 / 不承诺」类声明集中到「已知局限」一节 | 原文散落在五处，读者难以判断当前能力边界 |
| 4 | 本地运行命令改用远端存在的分支，并补 bash 版本 | 原命令指向 `fix/stability-closeout-20261019`，落后于当前分支 |
| 5 | 每个数字旁标注证据文件路径 | 原文的 912 项测试、17 路来源、Sites53+API019 均无就近证据指针 |
| 6 | 版本状态改为「仓库内可核验的最近记录」并显式说明 API 027 证据未入仓 | 避免用未入仓的线上结果充当仓库证据 |

---

## 2. 中文 README 建议稿

```markdown
<!-- README_SYNC: source=pending; updated=2026-10-26 -->
<p align="center">简体中文 · <a href="./README_EN.md">English</a></p>

# Signal Map

面向独立开发者和创作者的信息筛选工具：围绕具体问题读取公开来源，按日期、相关性和证据筛选，并说明没有得出结论的原因。

[试用入口](https://signal.benzhenlab.com/) · [问题反馈](https://github.com/xiebenzhen-code/signal-map/issues)

![Stage](https://img.shields.io/badge/status-limited_trial-2457ff)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/local_checks-Node.js_24%2B-43853d)
![Repository](https://img.shields.io/badge/repository-public-2ea44f)

[约50秒真实操作视频](docs/portfolio/signal-map-demo.mp4) · [录制方法与结果](docs/portfolio/DEMO.md)

> 演示录制于 2026-10-21，对应 Sites53 + API019。它展示的是当时的行为，不能用来证明 API 027 的效果。

![Signal Map 系统框架与验收边界](docs/portfolio/signal-map-architecture.png)

## 亮点

- **围绕问题检索**：把主体、时间窗口和排除条件转成计划，按预算及截止时间执行。
- **从材料走向证据**：读取官方更新、RSS/Atom 和已配置渠道，再做日期、任务相关性、去重与事件聚合；发布时间不与抓取时间混用。
- **记录实际执行**：来源已搜索、未搜索和失败分别记录；多轮历史不会被末轮「未搜索」覆盖，读取失败保留安全的细分错误码。
- **允许证据不足**：没有足够材料时可返回零结果，并说明零结果不等于没有变化。

适合关注特定产品、创作工具和公开技术动态。

## 信源与行业范围

[来源目录](source-registry/feed-catalog.ts)登记 **17 路订阅源，其中 11 路为官方发布方**。每次按实体或主题最多选 3 路订阅，另有既有检索路径。

| 方向 | 已登记来源 | 边界 |
|---|---|---|
| 影视与创作软件 | Kdenlive、OBS、Krita | 软件发布和工具变化，不覆盖整个影视产业 |
| 电商与独立站 | Shopify、WooCommerce | 开发者更新不自动等于商家政策或适用性结论 |
| 编程与开源 | Node.js、GitHub、Mozilla、Chrome | 各渠道可达性和验证程度不同 |
| AI 产品 | OpenAI | 不构成完整 AI 行业覆盖 |
| 中文资讯与社区 | IT之家、少数派、机核、阮一峰、InfoQ、开源中国 | 文章仍需核对原始来源、日期和任务相关性 |
| 航天与天文 | NASA | 读取成功不代表每条材料都与问题相关 |

登记、成功读取和事实可信是三种不同状态。历史云端读取与解析成功的记录见
[docs/verification/other-feeds-cloud-probe-20261021.md](docs/verification/other-feeds-cloud-probe-20261021.md)。

## 实现与验收状态

Web：React / vinext；API：Node.js；认证：Supabase Auth；账户持久化：PostgreSQL。

```text
问题、时间窗口与排除条件
  → 检索规划 / 预算 / 截止时间
  → 来源读取 / 安全检查 / RSS 或 Atom 解析
  → 日期与任务相关性 / 去重 / 证据聚合
  → 今日、信息与资料库
```

主要接口：`POST /api/signals`、`POST /api/research/plan`、`/api/research/stream`、
`/api/control/knowledge`、`POST /api/sources/check`。这些是产品内部接口，不是稳定公共 SDK。

| 能力 | 已有证据 | 尚未完成 |
|---|---|---|
| 来源读取与过滤 | 有限真实读取、确定性测试和执行日志 | 全行业覆盖、持续可达性及答案质量 |
| 账户记录持久化 | 测试账号接口保存、退出重登读回、浏览器显示新记录 | 更多账号、设备和范围验收 |
| 同浏览器账号切换 | `130009a` 本机草稿隔离修补及本地反例 | 新版本部署后 A→B→A 页面复验 |
| 登录后体验 | 已登录 `/control` 直回首页的代码与测试 | 新版本正式站点复验 |
| 长期记忆影响研究 | 存储和选择接线存在，自动参与默认关闭 | 跨次记忆作用的完整闭环 |
| 主动跟踪与提醒 | 有调度和通知相关实现 | 不作为当前已验收的生产承诺 |

**版本口径**：仓库内可核验的最近一次正式发布记录为 **Sites53 + API019**，见
[docs/verification/api-repair-release-20261021.md](docs/verification/api-repair-release-20261021.md)。
API 027 已于 2026-10-26 按
[docs/verification/api027-release-manual-20261026.md](docs/verification/api027-release-manual-20261026.md)
执行发布，但其线上验收记录尚未纳入仓库，因此本 README 不引用 027 的演示或数字。
**GitHub 最新代码不等于已经在线上运行。**

## 已知局限

以下声明集中说明当前能力边界，避免读者把「已实现」误读为「已验证」。

- **效果未经验证**：减少信息焦虑、辅助判断是项目目标，没有用户研究证明这些效果已经实现；工具不能自动保证信息真实。
- **覆盖有限**：不承诺全网覆盖、每次必有答案、持续自主监控或成熟公共 SDK。
- **相关性误拒仍是已知问题**：零结果只表示本轮没有可展示证据，不代表没有变化。
- **部分渠道可达性未恢复**：Chrome / FeedBurner 超时、WooCommerce 地址预检拒绝尚无恢复证据；AI＋教育等方向缺少专用来源和行业验收。
- **选题用途未验收**：选题价值、传播表现或持续主动筛选均未完成验收。
- **账号隔离线上复验未完成**：本机多账号草稿隔离已修补，正式站点复验仍待执行；共享设备勿保存敏感草稿。
- **「看到记录」不等于「影响研究」**：长期记忆自动参与默认关闭，跨次作用的完整闭环尚未验收。
- **演示时效**：演示视频对应 Sites53 + API019，不反映 API 027 及之后的行为。
- **仓库尚无 `LICENSE`**：未声明开源或商业使用授权；第三方依赖与字体各有其许可。

### 演示没有掩盖的失败

2026-10-21，正式站点的 Kdenlive 维护更新问题检索 20 条、聚合 18 个信号、最终展示 0 条。
读取确实执行了，但没有回答原题，答案质量未通过。视频保留真实结果，采用实际浏览器逐帧采集、
等待段 2 倍速、无音轨，不冒充原生高帧率连续录屏。

## 本地运行

建议 **Node.js 24+**。包声明最低 22.13.0，但完整测试参数需要更高版本，记录中的全量门禁使用 Node.js 24。
克隆需要仓库访问权限。

分支名以远端实际存在为准；若克隆提示分支不存在，请改用 `main` 或 `master`，并核对提交号后再运行。

PowerShell：

```powershell
git clone --branch p2n/stability-and-diagnosis https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

bash：

```bash
git clone --branch p2n/stability-and-diagnosis https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
npm ci
cp -n .env.example .env.local
```

先编辑 [.env.example](.env.example) 的本机副本。认证需要 `NEXT_PUBLIC_SUPABASE_URL` 和
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；账户持久化需要自己的 `DATABASE_URL` 及对应数据库表。
模型和可选渠道按需配置；`npm run db:migrate` 只对自己专用的开发库执行。

真实研究可能访问外部服务并产生模型或云费用。不要用生产数据库测试，不提交 `.env.local`、
密码、Cookie 或密钥。打开本地页面不代表认证、数据库或外部信源已经可用。

第一个终端启动 API（默认端口 8080）：

```powershell
npm run api:build
node --env-file=.env.local dist-api/server.mjs
```

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

打开[本地页面](http://127.0.0.1:3000)。生产代理与信源读取保留地址和 Origin 检查，
不应为联网问题关闭保护。

## 测试与工程记录

```bash
npm run quality
npm run build
npm run api:build
```

当前分支在提交 `7ea2d88` 上的执行记录：**980 项测试，974 通过、0 失败、6 项因数据库测试环境缺失跳过**；
quality / build / api:build 退出码均为 0。证据见
[docs/verification/phase0-public-surface-audit-20261026.md](docs/verification/phase0-public-surface-audit-20261026.md)
的第 5 节。lint 仍有既有警告，本阶段未复核数量。

条件跳过的 6 项不计作通过；测试数量不是覆盖率，也不是真实用户研究次数。

仓库有手动触发的[端到端工作流](.github/workflows/signal-map-agent-loop-e2e.yml)，
需要专用测试环境，不以文件存在代替 CI 实际通过。

- [README 事实核对记录](docs/verification/readme-evidence-20261022.md)
- [可编辑架构 SVG](docs/portfolio/signal-map-architecture.svg)
- [API019 发布与诊断](docs/verification/api-repair-release-20261021.md)
- [OBS / Kdenlive 云端读取](docs/verification/other-feeds-cloud-probe-20261021.md)
- [正式域名与演示交付](docs/verification/formal-portfolio-delivery-20261021.md)
- [本机账号隔离修补记录](docs/verification/local-account-isolation-repair-20261021.md)

## 数据、许可与反馈

服务端账户记录与本机草稿是两条路径。最新源码为每个账号绑定独立 IndexedDB 存储，并保留匿名旧库；
无归属历史数据不自动分配给登录账号。该修补线上复验尚未完成，共享设备勿保存敏感草稿。

仓库尚无项目级 `LICENSE`，不在这里声明 MIT、开源或商业使用许可。第三方依赖和字体有各自许可。

请通过 [Issue](https://github.com/xiebenzhen-code/signal-map/issues) 提供脱敏请求编号、时间、
版本与预期行为，不提供凭据。
```

---

## 3. English README proposed draft

```markdown
<!-- README_SYNC: source=pending; updated=2026-10-26 -->
<p align="center"><a href="./README.md">简体中文</a> · English</p>

# Signal Map

An information-filtering tool for independent developers and creators: research a specific question across
public sources, filter by date and relevance, and make evidence gaps visible.

[Try the app](https://signal.benzhenlab.com/) · [Report an issue](https://github.com/xiebenzhen-code/signal-map/issues)

![Stage](https://img.shields.io/badge/status-limited_trial-2457ff)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/local_checks-Node.js_24%2B-43853d)
![Repository](https://img.shields.io/badge/repository-public-2ea44f)

[Watch the roughly 50-second live demo](docs/portfolio/signal-map-demo.mp4) · [Recording method and outcome](docs/portfolio/DEMO.md)

> The recording is from 2026-10-21 and corresponds to Sites53 + API019. It shows behaviour at that time
> and cannot be used as evidence for API 027.

![Signal Map architecture and validation boundaries](docs/portfolio/signal-map-architecture.png)

## Highlights

- **Question-led retrieval:** turn entities, time windows and exclusions into a plan, then execute within budgets and deadlines.
- **Evidence processing:** read official updates, RSS/Atom feeds and configured channels; check dates and task relevance,
  deduplicate and aggregate events. Publication time stays distinct from retrieval time.
- **Execution visibility:** distinguish searched, not searched and failed sources. Later rounds do not erase earlier
  history, and failures keep bounded error codes.
- **Explicit evidence gaps:** a run may return nothing, and nothing found does not mean nothing changed.

Useful for following particular products, creative tools and public technical developments.

## Sources and domain coverage

The [source catalog](source-registry/feed-catalog.ts) registers **17 feeds, including 11 official publishers**.
Each run selects at most three feeds by entity or topic, alongside existing search paths.

| Area | Registered sources | Scope |
|---|---|---|
| Film and creative software | Kdenlive, OBS, Krita | Software releases and tool changes, not the entire film industry |
| E-commerce and independent stores | Shopify, WooCommerce | Developer updates do not establish merchant policy or applicability |
| Programming and open source | Node.js, GitHub, Mozilla, Chrome | Reachability and validation differ by channel |
| AI products | OpenAI | Not comprehensive AI-industry coverage |
| Chinese-language media and communities | IT之家, 少数派, 机核, 阮一峰, InfoQ, 开源中国 | Articles still need original-source, date and relevance checks |
| Space and astronomy | NASA | A readable feed does not make every item relevant |

Registration, successful reading and factual credibility are three separate claims. Historical cloud
read-and-parse records are in
[docs/verification/other-feeds-cloud-probe-20261021.md](docs/verification/other-feeds-cloud-probe-20261021.md).

## Implementation and validation status

Web: React / vinext. API: Node.js. Authentication: Supabase Auth. Account persistence: PostgreSQL.

```text
Question, time window and exclusions
  -> Retrieval planning / budgets / deadline
  -> Source reading / address checks / RSS or Atom parsing
  -> Date and task relevance / deduplication / evidence aggregation
  -> Today, Information and Library views
```

Endpoints: `POST /api/signals`, `POST /api/research/plan`, `/api/research/stream`,
`/api/control/knowledge`, and `POST /api/sources/check`. These are internal product interfaces,
not a stable public SDK.

| Capability | Existing evidence | Still outstanding |
|---|---|---|
| Source reading and filtering | Selected real-source probes, deterministic tests and execution logs | Broad coverage, sustained reachability and answer quality |
| Account persistence | Test-account API save, sign-out/sign-in read-back and browser rendering | Wider account, device and scope acceptance |
| Same-browser account switching | Local-draft isolation fix `130009a` and local counterexamples | Post-deployment A→B→A browser verification |
| Login navigation | Committed code and tests send authenticated `/control` visits home | Verification on the updated formal site |
| Memory influencing research | Storage and selection wiring exists; automatic participation off by default | End-to-end cross-run influence validation |
| Proactive tracking and reminders | Scheduler and notification code exists | Not claimed as an accepted production capability |

**Version basis:** the most recent formal release record that can be verified inside this repository is
**Sites53 + API019**, see
[docs/verification/api-repair-release-20261021.md](docs/verification/api-repair-release-20261021.md).
API 027 was released on 2026-10-26 following
[docs/verification/api027-release-manual-20261026.md](docs/verification/api027-release-manual-20261026.md),
but its online acceptance record is not yet in the repository, so this README cites neither demo nor
numbers from 027. **The newest GitHub code is not necessarily running online.**

## Known limitations

- **Outcomes unproven:** reducing information anxiety and supporting judgment are goals, not demonstrated user
  outcomes. The tool cannot automatically guarantee that a claim is true.
- **Bounded coverage:** no whole-web coverage, no guaranteed answer, no continuous autonomous monitoring, no mature public SDK.
- **False rejection remains a known problem:** an empty result means no displayable evidence in this run,
  not that nothing changed.
- **Some channels are unreachable:** Chrome/FeedBurner timeouts and WooCommerce address-preflight rejection have no
  confirmed recovery. AI-plus-education lacks dedicated sources and domain acceptance.
- **Content-research use is unvalidated:** topic value, audience performance and continuous proactive filtering remain untested.
- **Online account-isolation re-check outstanding:** local multi-account draft isolation is fixed, formal-site
  verification is pending. Do not keep sensitive drafts on shared devices.
- **Seeing a saved record is not evidence it influenced research:** automatic memory participation is off by default
  and the cross-run loop is not yet validated.
- **Demo age:** the recording reflects Sites53 + API019, not API 027 or later behaviour.
- **No `LICENSE` yet:** no open-source or commercial-use license is declared. Third-party dependencies and fonts
  carry their own licenses.

### A demo that keeps the failure visible

On 2026-10-21, a real Kdenlive maintenance-update query scanned 20 items, aggregated 18 signals and displayed zero.
Reading executed, but the question did not receive its requested answer: answer-quality acceptance failed. The
recording preserves that outcome. It uses actual browser-frame capture, waiting sections at 2x speed and no audio.

## Run locally

Use **Node.js 24+** for the documented checks. The package minimum is 22.13.0, but the full test command needs a
newer runtime; the recorded gate used Node.js 24. Repository access is required.

The branch name must exist on the remote. If cloning reports a missing branch, use `main` or `master` and verify
the commit before running.

PowerShell:

```powershell
git clone --branch p2n/stability-and-diagnosis https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

bash:

```bash
git clone --branch p2n/stability-and-diagnosis https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
npm ci
cp -n .env.example .env.local
```

Edit your local copy of [.env.example](.env.example) first. Authentication needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; account persistence needs your own `DATABASE_URL` and matching tables.
`npm run db:migrate` is the migration entry point; use only a dedicated development database you control.

Real research can contact external services and incur model or cloud charges. Do not test against a production
database or commit `.env.local`, passwords, cookies or keys. Opening a local page does not validate authentication,
database access or external sources.

Start the API in the first terminal (default port 8080):

```bash
npm run api:build
node --env-file=.env.local dist-api/server.mjs
```

Start the Web app in a second terminal:

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

```bash
SIGNAL_MAP_FRONTEND_RUNTIME=node API_UPSTREAM_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open the [local app](http://127.0.0.1:3000). Production proxying and source readers retain address and Origin
checks; do not disable protections to work around connectivity problems.

## Tests and engineering records

```bash
npm run quality
npm run build
npm run api:build
```

Recorded on branch `p2n/stability-and-diagnosis` at commit `7ea2d88`: **980 tests, 974 passed, zero failed,
six skipped because the database test environment was absent**; quality, build and api:build all exited 0.
Evidence: section 5 of
[docs/verification/phase0-public-surface-audit-20261026.md](docs/verification/phase0-public-surface-audit-20261026.md).
Lint retains existing warnings; the count was not re-checked in this phase.

Conditional skips are not counted as passes. Test counts are not coverage percentages or real-user research counts.

The manually triggered [end-to-end workflow](.github/workflows/signal-map-agent-loop-e2e.yml) requires a dedicated
test environment. Its existence is not evidence of a passing CI run.

- [README evidence record](docs/verification/readme-evidence-20261022.md)
- [Editable architecture SVG](docs/portfolio/signal-map-architecture.svg)
- [API019 release and diagnostics](docs/verification/api-repair-release-20261021.md)
- [OBS / Kdenlive cloud reads](docs/verification/other-feeds-cloud-probe-20261021.md)
- [Formal-domain and demo delivery](docs/verification/formal-portfolio-delivery-20261021.md)
- [Local-account isolation repair record](docs/verification/local-account-isolation-repair-20261021.md)

## Data, license and feedback

Server account records and browser drafts are separate paths. The latest source binds each account to distinct
IndexedDB storage and preserves the anonymous legacy store. Unowned historical data is not automatically assigned
to a signed-in account. Online acceptance is still outstanding; do not keep sensitive drafts on shared devices.

There is no project-level `LICENSE`. No MIT, open-source or commercial-use license is claimed here. Third-party
dependencies and fonts have their own licenses.

For a reproducible [Issue](https://github.com/xiebenzhen-code/signal-map/issues), share a redacted request ID,
timestamp, version and expected behavior, never credentials.
```

---

## 4. 数字与证据对照表

| 声明 | 数值 | 证据路径 | 备注 |
|---|---|---|---|
| 订阅源数量 | 17 路，其中 11 路官方发布方 | `source-registry/feed-catalog.ts` | 代码登记事实，不等于可达性 |
| 每次选源上限 | 最多 3 路 | `research/source-classifier.ts`、`agent/source-selector.ts` | 与 README 原文一致 |
| 测试总数 | 980（974 通过 / 6 跳过 / 0 失败） | 本目录 `phase0-public-surface-audit-20261026.md` §5 | 本轮在 `7ea2d88` 执行 |
| 门禁退出码 | quality 0 / build 0 / api:build 0 | 同上 | 条件跳过不计通过 |
| 最近正式发布 | Sites53 + API019 | `docs/verification/api-repair-release-20261021.md` | 仓库内可核验 |
| API 027 | 2026-10-26 发布手册 | `docs/verification/api027-release-manual-20261026.md` | 线上验收证据未入仓 |
| Kdenlive 失败演示 | 20 抓取 / 18 聚合 / 0 展示 | `docs/portfolio/DEMO.md` | 演示录制日的行为 |

已被移除的旧数字：`912 项测试 / 906 通过`、`eb6666d` 门禁记录。它们对应 2026-10-22 的文档快照，
不代表当前分支；若需要保留，应写进「历史记录」而不是首屏。

---

## 5. PR 描述草稿

```markdown
## 改了什么

- 公开面审计：`certs/` 只含两份公共 CA 证书；全分支文件名扫描未命中私钥模式；结论标注覆盖边界。
- 明确 `outputs/` 四个被跟踪文件为一次性诊断生成物，给出 `git rm --cached` + `.gitignore` 方案（未执行）。
- 根目录两份 2026-10-02 报告给出归档位置建议（未移动）。
- postgres 诊断端点：对比「加诊断令牌」与「移除路由」，推荐令牌门，并附惰性失败测试补丁（未实现）。
- README 建议稿：删收藏引导、集中已知局限、命令改指向当前分支并补 bash、数字附证据路径。

## 证据

- 基线：HEAD `7ea2d88`，父提交 `cf164081...`（API 027 源码）。
- 门禁：quality 0（980 项 / 974 通过 / 6 跳过 / 0 失败）、build 0、api:build 0。
- 红灯复现：应用补丁后 25 项中 1 项失败（实际 401，期望 404），其余 4 项守护断言通过；补丁随后已还原。
- 审计明细：`docs/verification/phase0-public-surface-audit-20261026.md`。

## 风险

- 远端实时 HEAD 未读取（网络不可达），基线仅依据本地远端引用缓存。
- `e5e7439` 与 `CURRENT-BASELINE-20261026.md` 不存在，基线文档链路不完整。
- 历史仅做文件名级扫描，不能据此声称仓库无泄漏。
- 未实现任何生产修改；`outputs/` 清理与报告归档都只是方案。
- README 建议稿未覆盖根文件，合并前需人工核对演示与版本口径。

## 不包含

- 不部署、不发起线上研究、不调用付费模型。
- 不改业务逻辑、数据库结构、安全检查或筛选门槛。
- 不推 master、不强推、不改写历史、不改仓库设置、不选许可证。
```

---

## 6. About、网站与 topics 建议

**About 描述（推荐，≤350 字符）**

```text
围绕具体问题读取公开来源、按日期与相关性筛选，并如实说明没有得出结论的原因。React + Node.js + PostgreSQL，
支持 RSS/Atom 与官方更新源，零结果不解释为没有变化。
```

**简短版（若需更短）**

```text
Question-led research over public sources, with explicit evidence gaps instead of confident guesses.
```

**Website**

```text
https://signal.benzhenlab.com/
```

（与 README 首屏「试用入口」一致；若该域名进入维护状态，应改为仓库内说明页而不是留一个不可用链接。）

**Topics 建议（按优先级）**

必选：`rss`、`information-filtering`、`decision-support`、`typescript`、`react`、`supabase`、`postgresql`、`llm`

可选补充：`evidence-based`、`news-aggregator`、`research-tool`

不建议添加：`awesome-list`、`openai`（易被理解为官方项目）、`dataset`（本仓库不含数据集）。

---

## 7. LICENSE 三种选择（不替你决定）

| 选项 | 他人可做什么 | 他人必须做什么 | 你的义务 | 对第三方依赖的影响 |
|---|---|---|---|---|
| **MIT** | 商用、修改、再分发、私用 | 保留版权声明与许可全文 | 无担保；需在仓库放 `LICENSE` 并在 README 标明 | 不改变依赖许可；你的代码可与 GPL 依赖共存，但整体分发时需满足该依赖条款 |
| **Apache-2.0** | 同上，另含明确专利授权 | 保留声明、附 `NOTICE`（若有）、标注修改 | 同上，另需处理专利终止条款 | 与多数 MIT/Apache 依赖兼容；对专利环境更稳妥，文本更长 |
| **暂不声明** | 默认保留全部权利；他人无授权复制、修改、分发 | 不适用 | 无额外义务 | 不产生兼容性问题，但访客无法合法复用，Issue/PR 的授权边界也含糊 |

补充事实（供决策，不构成建议）：

- 仓库当前无 `LICENSE` 文件，README 已如实写明「未声明开源授权」。
- 依赖清单含 MIT/Apache-2.0/ISC 类包（`react`、`next`、`pg`、`vinext`、`eslint` 等），未发现 copyleft 依赖；
  精确许可应以各包 `package.json` / `LICENSE` 为准。
- 演示素材（`docs/portfolio/*`）与字体可能另有条款，选择许可证时需要单独确认是否随代码一并授权。
- 若选择 MIT 或 Apache-2.0，建议同时更新 README 的「数据、许可与反馈」小节与 GitHub 的 license 识别。
