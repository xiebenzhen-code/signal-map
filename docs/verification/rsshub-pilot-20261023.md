# RSSHub 独立服务试点 — 2026-10-23

## 边界与身份

用户已批准在现有腾讯云环境中新建独立 RSSHub 服务，并知悉运行费用。额度剩余不超过 10% 时停止，保存现场并提供续接指令。现有 Signal Map API、网页、地址安全检查与筛选规则不变。

产品比对基线为隔离工作区 `7268bf8`，不是主目录的旧源码。主目录既有删除证书及学习文档修改保持原样。本轮尚未提交产品代码、研究或模型请求。

## 本地直接证据

官方镜像：`ghcr.io/diygod/rsshub@sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff`。
上游 revision：`70e402bc2033a83c4622e8c5a8e67cff481d644e`，AGPL-3.0。

本机容器 `signal-map-rsshub-pilot-20261023`：仅绑定 `127.0.0.1:1201`，1 CPU / 512MB，内存缓存，无凭据、代理、浏览器、Redis 或模型依赖。瞬时内存约 153.8MiB，不作为生产容量承诺。内存缓存不是持久预抓取或定时采集系统。

| 来源 | 本机实际读取 | 产品解析器 |
|---|---|---|
| 36氪快讯 `/36kr/newsflashes?limit=5` | HTTP 200，4567B，2155ms | raw5 / normalized5，原始文章链接与日期保留 |
| 极客公园 AI `/geekpark/304?limit=5` | HTTP 200，66537B，3216ms | raw5 / normalized5，原始文章链接与日期保留 |
| 量子位原生 RSS | 安全读取器 FEED_PRIVATE_ADDRESS，requestCount=0 | 未读正文、未解析、未绕过 |

10 条是可解析候选，不是 10 条已核实事实。来源均为行业媒体，不能包装为官方声明。

`outputs/rsshub-pilot-20261023/probe-results.json` 为实际读取记录。两份 XML 仅供本地复现，不应将完整正文自动上传 GitHub。

`replay.mjs` 用上述真实正文与 fixture reader 回放现有选择及候选接口：两路均 5 条候选、无失败；official-only 排除媒体来源，显式排除实体生效，sourceType=industry_media；registry 已恢复。该回放 HTTP=0、模型=0、生产写入=0，不证明腾讯云可达或最终研究结论质量。

`compose.yaml` 配置校验 exit 0。尚无产品源码改动，未用完整 quality/build 的历史数字冒充本次 Docker 验证。

## 路由审查

只复用官方 RSSHub。极客公园路由无需配置或浏览器。36氪 newsflashes 使用列表路径；未调用上游实现中其他文章路径的 WAF 处理。掘金实现包含 WAF challenge 处理，首期不采用；量子位优先原生 RSS；机器之心对应目录本次 404，不猜旧路由。

## 云端发布现场（持续更新）

环境 `signal-map-prod-d7feg55r886aa857`，新服务 `signal-map-rsshub`。
已通过控制台提交一次镜像部署：DeployId **001**，taskId **2432393**，开始时间控制台显示 **2026-10-23 05:01:16**。

配置：端口1200，0.25CPU/0.5GB，自动扩缩容最小0/最大1，公开默认域名开启、内网地址关闭；不注入云开发 API Key。环境变量仅 NODE_ENV=production、CACHE_TYPE=memory、CACHE_EXPIRE=3600、REQUEST_RETRY=0、REQUEST_TIMEOUT=10000、NO_LOGFILES=true。

本地 1CPU 验证不等同于云端 0.25CPU 性能验证。最小0会冷启动，缓存随实例消失；需在正式接入前实测，不能声称实时稳定抓取。

控制台 URL：
https://tcb.cloud.tencent.com/dev?envId=signal-map-prod-d7feg55r886aa857#/platform-run/service/deploy/detail?serverName=signal-map-rsshub&deployId=001&taskId=2432393&envId=signal-map-prod-d7feg55r886aa857

终态：001 **正常、100%流量、1个实例**；`check_eks_virtual_service : succ`。服务配置读回与填写一致，部署截图及 AX 记录见 outputs 试点目录。

真实公网地址：`https://signal-map-rsshub-323338-4-1408253594.sh.run.tcloudbase.com`。平台明确标记默认域名仅供开发测试，存在访问限制与稳定性风险；尚未绑定正式子域名。

云端实读分层：
- Windows 端使用产品安全读取器访问该域名，两路均 `FEED_PRIVATE_ADDRESS`、requestCount=0。记录 `cloud-endpoint-results.json`；这不是云端来源失败，亦非成功接入。未改 DNS/私网保护或使用裸 fetch 冒充产品读取。
- 内嵌浏览器经 CloudBase 自有测试域名提示页后，两路均实际显示 RSS XML，每路5个 item，包含原始文章链接和发布日期。生成时间分别为 2026-10-22T21:04:01Z、21:04:08Z。这证明新部署 RSSHub 能向浏览器提供两路材料；不是 Signal Map API 容器安全读取验收，未测长期稳定性。
- 原始浏览器证据 `cloud-36kr-browser.txt`、`cloud-geekpark-browser.txt`；服务截图 `cloud-service.png`。

产品目录仍未导入两路；`source-candidates.json` 保持 disabled/cloudVerified=false。尚无全链路研究验收。

## 续接顺序

1. 先查额度；剩余<=10%停止新操作，交接同一任务，不创建重复服务。
2. 新服务001已成功，不重复创建或部署。先在 Signal Map API 021 的运行环境，用现有安全读取器各读上面两路一次（format=feed）；本地DNS预检拒绝不代表云端也拒绝。若无执行通道则交付整体 Webshell 命令，不循环探测。保留保护，禁止硬编码IP绕过。
3. 正文取得后再交同一产品解析器，记录原始URL、日期、计数、细分码。生产使用前需确定稳定服务域名、访问范围和成本，默认测试域名不直接包装为正式来源服务；不在本轮擅自改 signal.benzhenlab.com 路由。
4. 云端通过后，在最新隔离 Git 基线只增加两条媒体目录项及配套测试；publisherHosts 保留原出版社，不能写 RSSHub 域名。先红后绿，quality/build；不得使用 localhost 或放宽私网保护。
5. 接入发布单独收口；不扩行业、不改算法、不增加浏览器破解、代理池、付费接口或批量研究。费用未查账单，保持 UNKNOWN。

## 续接执行记录（2026-10-23）

### 步骤 1 额度核查（只读）

`queryEnv(action=usage)` 与 `queryEnv(action=info)`：
- 计费周期 2026-10-07 → 2026-11-07；套餐个人版（baas_personal，预付费），到期 2026-11-07 23:59:59，自动续费开启，`EnableOverrun=true`，`UsageStatus=normal`，无欠费隔离。
- 本周期已扣资源点约 10327.31（EKS CPU 4838.39 + EKS Mem 5477.94 + NAT 流量 10.98 + 网关调用约 3），主体是常驻 API 与 RSSHub 服务的机时。
- **余量百分比仍为 UNKNOWN**：平台 API 只返回已用量、不返回套餐总点数，无法计算剩余比例；按本报告约定保持 UNKNOWN。本续接只执行零增量成本操作（在已运行容器内一次性读取；无新部署、无新服务、无模型调用、无研究会话），不触及需要先确认余额的动作。

### 步骤 2 执行通道结论

- CloudBase MCP 无 CloudRun 容器 exec 能力：`manageCloudRun` 仅 init/download/run（本地函数型）/deploy/updateConfig/traffic/delete；`queryFunctions`/`callCloudApi`/`managePermissions`/`manageFunctions` 均为查询或函数管理。确认无执行通道，按 2026-10-21 既定协议交付整体 Webshell 命令，不循环探测。
- `/api/sources/check` 仅页面模式且响应剥离 content：既不能验证 feed 读取，也不能取得正文交解析器；页面路径遇 XML content-type 返回 expected failed「当前仅支持公开网页正文，不支持这种文件类型。」——这是该端点的预期失败语义，不得误判为「失败即停」意义上的失败，也不能冒充 feed 读取。
- 容器可行性依据：Dockerfile 为 `COPY . .`，`.dockerignore` 不排除 TS 源码，/app 内有 `source-enrichment/custom-source.ts` 等源码；`package.json` 为 `"type":"module"`、engines node≥22.13，镜像 node:22-bookworm-slim 支持 `--experimental-strip-types`；`dist-api` 是单文件入口 bundle，不能按模块 import，故执行脚本必须走 /app 源码。

### 交付物（outputs/rsshub-pilot-20261023/）

- `api-runtime-feed-read.mjs`：容器内执行脚本。导入产品读取器 `readCustomSource(url,{format:'feed',deadlineAt:Date.now()+12000})` 与产品解析器 `parseRegisteredFeed(content,feed)`，两路各读一次；无重试、无自定义 lookup/request 缝隙、无硬编码 IP、无 localhost、不放宽私网保护、不改环境变量、不写 /app、无模型调用；失败记录 FEED_* 细分码并即停（exit 1）；readable 则解析同一响应并记录原始 URL、日期、raw/normalized 计数与前 3 条样本；正文与报告 JSON 落盘到 /tmp/rsshub-pilot-api-runtime/；记录所加载两个模块的路径与 sha256 作为版本证据。
- `api-runtime-webshell-command.sh`：整体命令（heredoc 写脚本 + 执行 + 打印报告），与 .mjs 经字节级 round-trip 校验一致，`bash -n` 通过。
- `build-webshell-command.mjs`：上述 .sh 的生成器（防漂移）。

### 本地冒烟（2026-10-23 05:19 +08；非云端证据）

- 冒烟 A（无 DoH，win32/node24）：`FEED_PRIVATE_ADDRESS`、requestCount=0、约 20ms、verdict=STOP、exit 1——地址保护在本机生效且失败即停；与 001 部署后 Windows 端复现一致，再次说明本机 DNS 预检拒绝不代表云端拒绝。
- 冒烟 B（`SOURCE_DOH_URL=https://doh.pub/dns-query`，走产品自身 DoH 路径）：两路均 readable、requestCount 各 1；36氪快讯 4612B、raw5/normalized5（sha256 20352164…）；极客公园 AI 66582B、raw5/normalized5（sha256 732e0f34…）；原始文章链接（36kr.com / geekpark.net）与发布日期保留；verdict=CLOUD_READ_AND_PARSE_OK、exit 0。reader sha256 8f87a941…、parser sha256 b066051c…（主仓 HEAD 3ff79de 版；reader 在 7268bf8..HEAD 间无差异，parser 两版签名与对本两路的行为一致）。
- 边界：冒烟 B 是本机经公共 DoH 的产品路径验证，**不是** Signal Map API 021 运行环境证据；既有浏览器证据（cloud-36kr-browser.txt / cloud-geekpark-browser.txt）同样不等于产品接入成功。云端执行结果待用户在 API 021 容器回填后登记。

### 云端判定表（供回填判定）

| 观察 | 含义 | 动作 |
|---|---|---|
| exit 0 / verdict=CLOUD_READ_AND_PARSE_OK | 产品读取器+解析器在 API 运行环境两路通过 | 才可进入步骤 4（目录项+测试+quality/build） |
| FEED_PRIVATE_ADDRESS | 云端也解析到非公开地址 | 记录即停；不放宽保护、不硬编码 IP |
| FEED_TIMEOUT / FEED_ETIMEDOUT / FEED_ECONNRESET | 容器出网或上游超时（历史记忆：间歇性超时） | 记录即停 |
| FEED_HTTP_401/403、FEED_HTTP_5xx | 上游拒绝或错误 | 记录即停 |
| FEED_CONTENT_TYPE_UNSUPPORTED | 路由未返回 feed 内容类型 | 记录即停 |
| FEED_ENOTFOUND / FEED_EAI_AGAIN | 解析失败 | 记录即停 |
| readable 但 parse.error=FEED_INVALID_XML / FEED_UNSUPPORTED_FORMAT | 内容异常 | 记录即停 |
| readable 但 normalizedCount=0 | 解析零候选（publisherHosts 过滤或路由内容变化） | 记录即停 |
| 模块加载失败 / flag 报错 | /app 源码缺失或 node 版本问题 | 记录 `node -v` 即停；不得改 import dist-api/server.mjs（会启动服务） |

### 未改变的门

- `source-candidates.json` 维持 disabled/cloudVerified=false；产品目录仍未导入两路；signal.benzhenlab.com 路由不改；接入发布单独收口。
- 步骤 4 的「最新隔离 Git 基线」= 隔离工作区 7268bf8（mem-worktree；另一隔离目录 gitbaseline-d2d5118 建于 2026-10-05、早于本试点，非最新）。

## 接入执行记录（2026-10-23）

### 云端回填（用户提供）

用户在 Signal Map API 021 运行环境执行整体 Webshell 命令并回填：`verdict=CLOUD_READ_AND_PARSE_OK`、`modelCalls=0`、`researchSubmissions=0`。两路均 readable 并由同一产品解析器产出候选。该证据只覆盖传输与解析，不覆盖长期稳定性、可用性或内容真实性。

### 接入范围（仅两路）

- 基线：隔离工作区 `mem-worktree` @ `7268bf8`（origin/master，最新产品线；主目录所在 `preview/auth-error-mapping-fix` 停在旧候选 3ff79de，本轮未使用它，也未覆盖主目录既有的证书删除与学习文档改动）。
- 分支：`feat/rsshub-media-feeds-20261023`。
- 改动：`source-registry/feed-catalog.ts` 追加 2 条媒体目录项——`36kr-flashes`（`/36kr/newsflashes?limit=5`，publisherHosts `["36kr.com"]`）、`geekpark-ai`（`/geekpark/304?limit=5`，publisherHosts `["geekpark.net"]`）；均 `official:false`、`topics:[]`（不参与主题扩展选择）、`cloudVerified:true`。
- `cloudVerified` 依字段定义只表示传输证据，注释中关联本报告；不解释为长期稳定性或内容真实保证。`publisherHosts` 保留原出版社，未写 RSSHub 域名；未改解析器、筛选门槛、超时、DNS/私网保护；未新增爬虫、代理、浏览器抓取、定时采集或付费接口。

### 先红后绿

- 红：新增 6 例先跑，`tests 26 / pass 20 / fail 6`、exit 1（失败均为目录项不存在引起的选择与解析断言失败）。日志 `outputs/rsshub-int-red.log`。
- 绿：追加目录项后同一文件 `pass 26 / fail 0`、exit 0。日志 `outputs/rsshub-int-green.log`。
- 覆盖：命名出版社精确选择；official-only 不选两路；显式排除出版社时 reader 零调用（`not_searched` / `no_candidate_source`）；真实材料保真（原始文章 URL、发布日期、标题逐字保留）；中继域名链接被拒；重复链接去重；DOCTYPE 与含凭据 URL 被安全拒绝；候选身份 `industry_media` / `news` / authority 60 / 社区；传输失败记为 `failed` 且带 FEED_* 细分码，不写成“没有结果”；可读空 feed 记为 `searched_no_results`；研究管线门控与 400 天时效筛除。
- 夹具为两路真实响应裁剪：标题、链接、日期原样，描述截断，避免把文章全文提交进仓库。

### 门禁（隔离工作区，node 24 驱动）

| 步骤 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 errors，28 个既有 warning） |
| 全量测试（`node --experimental-strip-types --test --test-isolation=none`，113 文件） | `929 tests / 923 pass / 0 fail / 6 skipped`，exit 0 |
| `npm run knip` | exit 0 |
| `npm run deps:check` | exit 0 |
| `npm run build` | exit 0（vinext build complete） |
| `npm run api:build` | exit 0（`dist-api/server.mjs` 1,527,777 B） |

跳过原因：6 个 skipped 全部是 `DATABASE_URL` 未配置的 PostgreSQL 用例（`postgres-*` 门控）。`npm run quality` 的测试步骤在 npm 注入的 node 22 下报 `bad option: --test-isolation=none`，因此全量测试改由 node 24 执行同一条命令，其余步骤按 `npm run quality` 原样执行。
