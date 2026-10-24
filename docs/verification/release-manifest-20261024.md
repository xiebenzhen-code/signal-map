# Signal Map 统一 Release Manifest 与部署流程（2026-10-24 起生效）

本文件是正式版本的可追溯部署清单与唯一部署流程规范。四态严格区分：
**[MERGED] 源码已并入 master ／ [BUILT] 已产出可核验构建 ／ [DEPLOYED] 已部署且回读运行身份 ／ [VERIFIED] 已通过真实验收**。

## 一、当前统一版本清单（基线：master `6238890e3e8f895f316626bbce73acac68ef525a`）

### master
- **SHA**: `6238890`（= `33635cc` + Sites55 移植 4 文件）
- 状态: **[MERGED]**
- 构成: `33635cc`（RSSHub 两源接入 fcc6bbb、诚实状态修补 2984cb0、验证文档 ×3、站点 403 诊断）+ `6238890`（Sites55 状态文案移植：types/today-copy/page.tsx/tests，语义差异 61+/9-）
- 门禁: typecheck 0 / lint 0 err（28 既有 warning）/ 专项 Feed+UI 45+86 全过 / 全量离线 937 tests・931 pass・0 fail・6 skipped（DATABASE_URL 门控）/ `npm run build` 0

### Web（CloudBase Sites）
- 线上版本: **Sites55**（`appgver_46d5b43979b48191b1b482f099afad3c`，发布 `appgdep_6adbd…` succeeded，2026-10-23 21:35 UTC）
- 构建源: Sites 平台上传快照 `0d1457397bea6a111caf3df68d3b1d452e5f83ee`（本地永久留档 `outputs/frontend-status-release-20261024/sites-source/`，HEAD=0d14573、工作树零改动；`sites-build.tar.gz` 与云端归档哈希不一致，不作为恢复依据）
- 状态: **[DEPLOYED]**；与 master 关系: Sites55 语义 delta 已 100% 移植入 master（6238890）；**master 尚未重新部署**（下次 Web 发布应以 master 确定提交构建并回读版本号）
- 回退参照: Sites54（`appgver_07e94092…`）

### API（CloudBase Run `signal-map-api-preview`）
- 线上版本: **DeployId 024**（镜像 `signal-map-api-preview-024-20261024054953`，digest `sha256:37946680…`，normal/100%承流；运行时 6 文件哈希核验一致）
- 构建源: `33635cc`（api-source-manifest.json base）
- 状态: **[DEPLOYED]**；与 master 关系: 差 = 仅 6238890 前端 4 文件（不影响 API 运行时）；**API 未随本轮重发**（需单独授权）
- 回退参照: 023

### RSSHub（CloudBase Run `signal-map-rsshub`）
- 线上版本: `signal-map-rsshub-001`（**平台故障中**: MinNum=1 已存但 Pod=0、ScaleStatus=zero；`-002` create_failed；TaskId 2443142 `DescribeVersion_internal_error_`，工单素材齐备）
- 镜像: `ghcr.io/diygod/rsshub@sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff`（**外部固定依赖，源码不并入本仓**；P2-D 已隔离验证该 digest 容器/双 Feed/重启恢复全 PASS）
- 状态: **[DEPLOYED 但不可用]**；迁移方案见 `outputs/p2e-migration-plan-20261024.md`（候选: CloudBase v2 新服务 + ACCESS_KEY；待授权）
- 计费注意: 平台自愈后 MinNum=1 将自动计费（≈156 资源点/日）

### 尚未通过的真实验收门禁（全部如实保留）
1. RSS 两路 Feed 生产读取（P0 阻塞于 RSSHub 平台故障；隔离环境已验证通过）
2. 一次完整真实研究经修补后全链验收（研究预算未授权）
3. 正常完成且有信号的 Web 分支呈现
4. 生产 API 用 master（≥6238890）构建部署后的运行身份回读

## 二、统一部署流程（今后一切生产部署强制执行）

1. **来源**: 仅从 master 的确定提交出发（记录 SHA；禁止从工作树/未合并分支直接部署）。
2. **门禁**: 先过对应组件质量门禁（typecheck+lint+全量离线测试+build；API 另加 api:build）。
3. **构建身份**: 产出可核验身份——API: 镜像 tag+digest+SOURCE-MANIFEST 哈希；Web: 源提交 SHA+发布 versionId；RSSHub: 固定镜像 digest+配置版本。
4. **独立部署**: Web、API、RSSHub 各自独立发布，禁止捆绑变更。
5. **回读身份**: 部署后回读实际运行版本（DeployId/versionId/digest），与预期核对。
6. **最小真实健康检查**: Web=关键文案/渲染；API=`/health`+一次非研究端点；RSSHub=根路径+带鉴权路由各一次。
7. **更新本 Manifest**: 状态推进必须落档（MERGED→BUILT→DEPLOYED→VERIFIED 逐级，禁止跳级标注）。

**红线**: 禁止仅凭部署成功或 HTTP 200 宣称研究主链验收通过；RSSHub 镜像按外部固定 digest 依赖管理。

## 三（续）｜2026-10-24 P2-E 修订 + P2-F 统一后的版本对账

### 版本对账表（当前 vs 待部署）——P2-G 更新
| 模块 | 线上版本(源) | master 状态 | 待部署 |
|---|---|---|---|
| Web | Sites55（Sites 快照 `0d1457397bea6a111caf3df68d3b1d452e5f83ee`） | 语义 delta 已全部并入 | 下次发布以 master 确定提交构建（未授权） |
| API | 024（源 `33635cc`，镜像 digest `sha256:37946680f3cd14fe8add566ca0e2ec801d9e9290dbeb109bd8a21233a2a6ad3c`） | 领先：Sites55 移植 + relay 配置化 + P2-G 加固 | **唯一候选 025 = master `3f0d84cdebf85d8a4a3a316ef1ed5e10702426fb`**（未授权发布；`0ab6cf2` 为其历史前置，不再是候选） |
| RSSHub | rsshub-001（digest `sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff`）故障中 | 外部固定依赖（不并入本仓） | Lighthouse 宿主迁移待授权（见下） |

### P2-G 新增（2026-10-24，`3f0d84c`）
- **严格 origin 解析**：`RSSHUB_BASE_URL` 经 WHATWG URL 严格校验——仅 HTTPS、无 userinfo、无路径、无查询、无 fragment（`base_not_origin` 拒绝）；运行时 SSRF/DNS/TLS 门禁不变。
- **生产密钥策略**：`NODE_ENV=production` 缺 `RSSHUB_ACCESS_KEY` → relays 拒绝启用（`missing_key`→`not_configured`，零抓取，无静默开放代理）。
- **安全测试 14 用例**：严格拒/无 key 拒/跨域跳转不携带 key（读取器跳转 URL=Location 原样）/超时码映射/缓存复用零泄漏。门禁：tsc 0 / lint 0 err / 951・945・0・6s / build 0。
- **RSSHUB_KEY_TRANSPORT 风险（未闭合，生产不批）**：当前实现 key 走 URL query——TLS 保护传输，但会出现在 relay 自身访问日志与其上游日志中；跨域跳转已证不携带。**生产批准前置**：固定 HTTPS 网关 `X-Relay-Key` 头部鉴权+剥离方案（需安全读取器支持自定义头，后续补丁）。

### Lighthouse 宿主（P2-G 实时只读核实，非历史推断）
- **`lhins-pfzwcoao`**：**RUNNING**，ap-shanghai-4，**2 CPU / 2 GB**，Ubuntu Server 22.04 LTS，有公网 IP，到期 2026-11-17（NOTIFY_AND_MANUAL_RENEW）。
- 防火墙现开 22/80/ICMP——**443/1200 未开**（迁移需另授权加规则+反代）；Docker 状态/磁盘余量/月费 UNKNOWN（需 SSH 或用户确认）。
- 结论：**可复用性初步成立**（资源 2C2G 足够 0.25C/512MiB RSSHub），上线前缺 Docker/443 核验。

### RSSHub 宿主修订（P2-E STEP 2，不依赖 CloudBase Run 控制面）
| 候选 | 结论 |
|---|---|
| 用户腾讯云 Lighthouse 轻量应用服务器（`lhins-*` 体系，2026-10-18 文档先例） | **首选待核**：账号内既有；规格/区域/负载/Docker 状态 UNKNOWN（本会话无该通道）——需用户确认实例身份后按本清单核验 |
| 本机 Windows Docker Desktop | P2-D 已验证可跑（同 digest `sha256:5503…5ff`、0.25C/512MiB 双 Feed 全过）；**受阻于无合规公网 HTTPS 入口**（无隧道工具），仅作应急备选 |
| CloudBase Run（任何形态，含 v2） | 排除：控制面故障未结（TaskId 2443142 `DescribeVersion_internal_error_`），与目标相悖 |
| 新购轻量/CVM | 本轮禁止；若 Lighthouse 不可用，待单独授权评估 |

安全接入设计（随 `0ab6cf2` 已就绪）：HTTPS 反代 + RSSHub ACCESS_KEY；API 侧 RSSHUB_BASE_URL/KEY env；固定两条路由；SSRF/DNS/TLS 零放宽。

## 三、变更历史
- 2026-10-24: 建立。master 7268bf8→33635cc（ff, RSSHub 分支收口）→6238890（ff, Sites55 移植）。
- 2026-10-24（二）: master 9309611→0ab6cf2（relay 配置化+测试）；版本对账与宿主修订入清单。
- 2026-10-24（三）P2-G: master 9347a23→3f0d84c（严格origin+生产key策略+14安全用例）；Lighthouse lhins-pfzwcoao 实时核实入清单；候选 025 唯一化为 3f0d84c。
