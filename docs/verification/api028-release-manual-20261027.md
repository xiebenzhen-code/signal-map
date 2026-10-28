# API 028 发布手册（草稿，未执行）

日期：2026-10-27。基线：分支 `p2n/stability-and-diagnosis`，唯一构建源 `439c7fc3acfcba80b0e493128d5709440199fa47`（`ec2cf97` 去掉注册源 3 路上限 → `527e1a9` 详情读取逐跳校验与地址固定 → `439c7fc` Product Hunt / Hugging Face 读取器改走安全路径）。三个提交只改 API 侧，Web 不发布。**本文只写步骤，不构成发布授权**。执行前需单独授权，且每服务仅一次部署。

本手册以 `api027-release-manual-20261026.md`（提交版本）为底本改写。与 027 手册的差异：序号与回退目标顺延；源码冻结改为在独立干净工作区进行；第 6 节第 3、4 项按 2026-10-27 的裁定改写；新增第 6 节第 8 项（只读回读环境变量键名）。

## 0. 前置事实与纪律

| 项 | 内容 |
|---|---|
| 服务 | CloudBase Run `signal-map-api-preview` |
| 镜像仓库 | `ccr.ccs.tencentyun.com/tcb-100046649407-oeth/ca-ywgpdtav_signal-map-api-preview` |
| 标签格式 | `signal-map-api-preview-<NNN>-<YYYYMMDDHHMMSS>` |
| 承流 | `FlowRatio 100`、`HasTraffic true`、`status normal` |
| 回退目标 | 当前在架版本（按既有记录为 **DeployId 027**；发布前必须实时回读确认） |
| 付费上限 | 全文只有第 7 节允许一次真实研究；其余步骤必须免费 |
| 禁止 | 不推 master、不改判定规则、不改 Dockerfile、不读密钥明文、不重发研究 |

## 1. 发布前实时取证（只读，免费）

1. 回读当前承流版本：DeployId、BuildId、RunId、镜像 tag、`OnlineVersionInfos`、`FlowRatio`、`HasTraffic`。
2. **把回读结果记为回退目标**。若在架不是 027，记录差异，并以实时结果作为回退目标。
3. 回读该版本镜像 digest；平台可能不返回，返回 `UNKNOWN` 时不得以 tag 或 health 代替源码身份。
4. 记录实例数、规格、环境变量**键名**（不读取值），确认 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` 是否配置；生产应为未配置。

## 2. 源码冻结

0. 在独立干净工作区中冻结：`git worktree add <新路径> 439c7fc3acfcba80b0e493128d5709440199fa47`（detached），不改动原开发工作区（其中保留的未提交修改和未跟踪的审计资产都不进入构建）。
1. 确认新工作区 HEAD 为上述 SHA，工作树干净（`git status --porcelain --untracked-files=no` 为空）。
2. 记录提交 SHA，作为本次唯一构建源。
3. 导出干净源码（`git archive`），记录 ZIP 字节数与 SHA256。
4. 逐文件与 Git blob 核对：对导出包内每个受跟踪文件计算哈希，与 `git cat-file -p <sha>:<path>` 对比，禁止 CRLF 污染目录入库。

## 3. 门禁（Node 24，全部在冻结源码上执行）

| 命令 | 通过标准 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（既有 warning 可保留，需记录条数） |
| `npm test` | 0 fail；跳过项必须全部为 `DATABASE_URL` 门控并记录条数 |
| `npm run knip` | exit 0 |
| `npm run deps:check` | exit 0 |
| `npm run build` | exit 0 |
| `npm run api:build` | exit 0，产出 `dist-api/server.mjs` |

每条命令记录：Node 版本、npm 版本、退出码、日志路径。任一失败即停止，不进入第 4 节。

> 已知环境问题：`npm run quality` 在 Node 22 下因 `--test-isolation=none` 不被支持而失败。Node 24 下若 npm lifecycle 仍将子进程解析到 Node 22，应以 Node 24 逐条执行等价命令并**明确标注“非单条 quality 整体通过”**，不得宣称整体通过。

## 4. 构建与镜像身份

1. `npm run api:build` 产出 `dist-api/server.mjs`，记录字节数与 SHA256。
2. 生成源码清单（`api-source-manifest.json`）：受跟踪文件路径 + blob 哈希 + 总哈希。
3. 构建镜像并推送，标签按第 0 节格式，序号为 `028`。
4. 记录镜像 digest（`sha256:…`）。平台不返回时写 `UNKNOWN`，并保留构建端 digest 作为替代证据。
5. **版本证据三件套**：提交 SHA + 源码清单哈希 + 镜像 digest/tag。三者缺一不得进入部署。

## 5. 部署（一次）

1. 提交一次部署，记录 taskId、开始时间。
2. 持续观察同一任务直至终态，**不重复提交**。
3. 记录 DeployId、BuildId、RunId、镜像 tag、`status`、`FlowRatio`、`HasTraffic`、`OnlineVersionInfos`。
4. 若 `status` 非 `normal` 或 `FlowRatio != 100`，立即进入第 8 节回退，不再继续验证。

## 6. 免费验证清单（不触发付费模型）

| # | 检查 | 通过标准 |
|---|---|---|
| 1 | `GET /health` | 200，返回体结构不变 |
| 2 | 一个非研究 GET 端点（如信号列表，未登录应 401 而非 500） | 状态码符合既有语义，无 5xx |
| 3 | `POST /api/diagnostics/postgres-transport`（匿名：不带会话、不带 `x-signal-map-diagnostic-token`、不带 Origin 头） | 通过：404。200：**安全门未生效，停止发布并回退**。401：生产配置了诊断令牌，与第 1 节“生产应为未配置”冲突，停止并报告。403：请求带了 Origin 头，去掉后复测一次。其他状态：停止并报告 |
| 4 | `POST /api/diagnostics/supabase-auth-transport`（同上，匿名） | 同第 3 项：通过 404；200 停止并回退；401/403/其他同第 3 项处理 |
| 5 | 首页 `GET /` | 200，关键文案渲染正常 |
| 6 | 运行身份回读 | DeployId/镜像 tag 与第 5 节记录一致 |
| 7 | 运行时文件哈希 | 抽查 ≥3 个运行时文件与源码清单一致（有执行通道时） |
| 8 | 环境变量键名回读（只读） | 记录 `MODEL_PROVIDER` 等键是否存在，不读取任何值、不修改；仅记录，不作为通过条件 |

全部通过才可进入第 7 节。任一项失败：报告并以第 8 节回退。

## 7. 一次付费端到端（仅一次，需单独额度授权）

**固定题面**（不得改写）：
> 过去7天，36氪快讯和极客公园报道了哪些与国内AI产品或产业有关的新进展？保留原始出处和发布日期，区分已确认信息与待核对线索。

**提交纪律**：页面或 API 只提交一次；提交后只读轮询同一请求，不重发。

**通过标准（全部满足才算通过）**：

1. 请求返回终态，记录 `requestId`、`status`。
2. 两路来源 coverage 均为 `searched_with_results`，`requestCount`、`resultCount` 齐全；极客公园 30 条、36氪 5 条为参考值，允许合理波动，但**不得出现 FEED_TIMEOUT 后仍宣称读取成功**。
3. `overview` 与 `filteringSummary` 口径可解释：`scanned`、`deduplicated`、`displayedCount` 三者给出且不互相冒充。
4. 每条正式展示信号具备：标题、原始 `sourceUrl`、`publishedAt`、`topicRelevance.decision`、`reason`。
5. `possibleRelated` 与正式结果分离；`possibleRelated` 条目不得出现在正式结果区。
6. 覆盖声明诚实：命中 `limit=5` 时必须出现“仅取得最近一段时间”类提示；读取失败必须写明失败码，不得渲染为“无更新”。
7. 无无依据结论：不得把单一媒体报道表述为已确认事实；`verificationStatus` 与文案一致。
8. 日期检查：不得出现 `publishedAt` 晚于请求时刻的条目被当作已发布事实展示；发现即记录为缺陷，不改门槛强行通过。

**不通过的处理**：保留完整响应与日志，记录 requestId，停止；不重发研究、不临时放宽门槛。

## 8. 回退到 027（或第 1 节实时确认的在架版本）

1. 进入 CloudBase Run 版本列表，选择第 1 节记录的 DeployId（027）。
2. 将流量切回该版本，`FlowRatio 100`，确认 `HasTraffic true`、`status normal`。
3. 回读 `OnlineVersionInfos`，确认仅目标版本承流。
4. 复跑第 6 节第 1、2、5、6 项（免费检查），确认恢复。
5. 记录回退时间、操作人、回退前后 DeployId 对照。
6. **不删除 028 版本**，保留为证据；不删除镜像。

回退触发条件：第 5 节终态异常、第 6 节任一安全检查失败、第 7 节出现 5xx 或空响应且无法在只读范围内解释。

## 9. 发布后落档

更新 Release Manifest，逐级标注 **[MERGED] → [BUILT] → [DEPLOYED] → [VERIFIED]**，不得跳级。必须写清：

- 提交 SHA、源码清单哈希、镜像 tag 与 digest（或 `UNKNOWN`）
- DeployId / BuildId / RunId
- 三条门禁结果与 Node 版本
- 免费验证 7 项结果
- 付费端到端是否执行、requestId、通过/失败项
- 回退目标与回退步骤是否被触发

## 10. 本手册明确未做的事

- 未构建、未推送镜像、未部署、未切换流量。
- 未调用付费模型、未提交研究、未读取任何密钥或环境变量值。
- 未修改判定规则、数据库、Dockerfile、生产运行时。
- 028 的 digest、DeployId 等身份字段全部留空，必须由实际发布过程填写，**不得预先编造**。

## 11. 第 6 节第 3、4 项口径依据（2026-10-27 裁定）

- `439c7fc` 中 `backend/postgres-transport-probe.ts:153-162`：`withSession` 只检查 Origin，随后第一道就是令牌门；`SIGNAL_MAP_DIAGNOSTIC_TOKEN` 未配置时返回 404。
- 原开发工作区中曾有一处未提交修改，把第 3 项写成“期望 401/403、404 需排查”。该修改写于 2026-10-26 10:34，早于同日 16:44 给探针加令牌门的提交 `e4caa59`，按现行代码已过时，不予采用；其中“返回 200 必须回退”一条予以采纳，并扩展到第 4 项。
