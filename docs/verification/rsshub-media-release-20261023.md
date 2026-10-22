# RSSHub 两路信源接入与一次受控 API 发布 — 2026-10-23

## 1. 代码及离线验证状态：通过

- 基线：隔离工作区 `mem-worktree` @ `7268bf8`（origin/master，最新产品线；主目录所在 `preview/auth-error-mapping-fix` 停在旧候选 `3ff79de`，未使用；主目录既有的证书删除与学习文档改动保持原样）。
- 分支/提交：`feat/rsshub-media-feeds-20261023` / `fcc6bbba65ee7820b2f41f76da185f7dd24605cc`（3 文件、277 行新增、0 删除）。
- 改动：`source-registry/feed-catalog.ts` 追加 `36kr-flashes`、`geekpark-ai` 两条媒体目录项（publisherHosts `36kr.com` / `geekpark.net`，`official:false`，`topics:[]`，`cloudVerified:true` 只表示传输证据）；`tests/registered-feeds.test.ts` 追加 6 例；`docs/verification/rsshub-pilot-20261023.md` 记录接入与门禁。
- 先红后绿：红 `tests 26 / pass 20 / fail 6`（exit 1）→ 绿 `pass 26 / fail 0`（exit 0）。日志 `outputs/rsshub-int-red.log`、`outputs/rsshub-int-green.log`。
- 门禁：typecheck 0；lint 0 errors（28 个既有 warning）；全量测试 `929 / 923 pass / 0 fail / 6 skipped`；knip 0；deps:check 0；build 0；api:build 0。日志 `outputs/rsshub-int-*.log`。
  - 说明：`npm run quality` 的测试步骤在 npm 注入的 node 22 下报 `bad option: --test-isolation=none`，全量测试改由 node 24 执行同一条命令；其余步骤按 `npm run quality` 原样执行。
  - 6 个 skipped 全部是 `DATABASE_URL` 未配置的 PostgreSQL 用例。
- 未提交：原始文章全文（夹具为裁剪版：标题/链接/日期原样、描述截断）、凭据、临时日志、无关修改。

## 2. Git 提交与远端状态：已推送

- 本地提交 `fcc6bbb…`；推送到 `origin/feat/rsshub-media-feeds-20261023`；`git ls-remote` 回读同一 SHA。
- 未 force、未合并主分支、未打 tag；`origin/master` 仍为 `7268bf8`。

## 3. API 部署状态：成功（022，100% 承流）

- 候选：从提交 `fcc6bbb` 干净导出（`git archive`），480 文件 / 11,280,911 B，清单摘要 `553749f5c25804e01079d878cb598611a9c77300ec7a4ba82775ece6c9257e26`（`outputs/rsshub-int-20261023/manifest.json`）。
- 发布前承流：**021**（digest `sha256:388d28c2…`，100%）；回退目标 **019**（`signal-map-api-preview-019-20261021102332`）。
- 本次发布（唯一一次）：源码构建部署，buildId `2609202193`、runId `multi_tenant_1xK0w2AlZSEtZh`、taskId `2432463`、DeployId **022**。
- 任务终态：**finished**；CreateVersion 496s、ReleaseVersion 4s，FailReason 空；运行日志 `check_build_image : succ`（06:13:43）、`check_eks_virtual_service : succ`（06:13:44）。
- 版本身份：`signal-map-api-preview-022`，镜像 `ccr.ccs.tencentyun.com/tcb-100046649407-oeth/ca-ywgpdtav_signal-map-api-preview:signal-map-api-preview-022-20261023060659`；`OnlineVersionInfos` 仅 022、FlowRatio 100。
- 配置保持：1C2G、MinNum 0 / MaxNum 1、Port 8080、13 个环境变量键、OpenAccessTypes OA/PUBLIC/MINIAPP 均与发布前一致；`VpcConf` 仍为空（与 021 相同，数据库走 Supabase 公网 + CA）。合并结果由 deploy 返回的 `configMerge.verifiedAfterDeploy` 与发布后 `detail` 双向核对。
- 健康：`GET /health` → 200 `{"status":"ok"}`（0.98s）；`GET /api/signals` → 405 `{"error":"Method not allowed"}`（预览域名 0.97s、正式站点代理 1.79s，同一 API 语义），说明进程与路由存活、站点代理上游连通。instanceId 仅作健康佐证，版本证据=部署记录+版本列表+镜像 tag。
- 回退目标：**021**（normal / 0% / digest `388d28c2…`）；更早 019（normal / 0%）。
- 未触碰：`signal-map-rsshub`（001）、`signal-map-web-preview`、旧 `signal-map-api`；未发布 Web；未改正式域名与路由。

## 4. 产品完整研究效果：本轮未验证

- 未提交研究会话、未调用模型；两路信源在真实研究中的召回质量、时效筛选效果与长期稳定性均未验证。
- `cloudVerified` 只表示传输与解析在 API 运行环境通过，不表示长期稳定性、可用性或内容真实性。
- 默认域名 `*.sh.run.tcloudbase.com` 是平台开发测试域名，存在访问限制与稳定性风险，尚未绑定正式子域名；RSSHub 服务 0.25CPU/0.5GB、最小 0 实例会冷启动，内存缓存随实例消失。

## 已知限制与阻断

- **Codex 账户额度：通道阻断（UNKNOWN）**。无 `codex` CLI；本地状态文件只记录 `subscription_level=plus`，没有任何额度数值，无法读取当前剩余比例。上一份可查记录（2026-10-22 14:57 报告）为周额度剩余 2%，其后本会话多轮工作持续进行，该读数已过期。腾讯云资源点不能替代该额度。本轮未因此扩大执行范围。
- **CCR 未登录**（`docker manifest inspect` 返回 unauthorized），本地构建推送不可用；因此走云端源码构建，与 021 之后既有通道一致。
- 站点 `/api/health` 返回 404 HTML（站点代理未映射该路径），不是 API 故障证据；`/api/signals` 的 405 JSON 已证明代理可达。

## 证据位置

- 门禁日志：`outputs/rsshub-int-red.log`、`rsshub-int-green.log`、`rsshub-int-fulltests.log`、`rsshub-int-quality.log`、`rsshub-int-knip.log`、`rsshub-int-deps.log`、`rsshub-int-build.log`、`rsshub-int-apibuild.log`
- 候选与清单：`outputs/rsshub-int-20261023/manifest.json`、`outputs/rsshub-int-20261023/candidate/`
- 试点与接入：`docs/verification/rsshub-pilot-20261023.md`
