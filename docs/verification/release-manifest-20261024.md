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

### 版本对账表（当前 vs 待部署）
| 模块 | 线上版本(源) | master 状态 | 待部署 |
|---|---|---|---|
| Web | Sites55（Sites 快照 ） | 语义 delta 已全部并入 | 下次发布以 master 确定提交构建（未授权） |
| API | 024（源 ，镜像 digest ） | 领先：Sites55 移植 + relay 配置化 | **候选 025 = master **（未授权发布） |
| RSSHub | rsshub-001（digest ）故障中 | 外部固定依赖（不并入本仓） | 独立宿主迁移待授权（见下） |

### master 新增（本节）
-  feat(feeds): RSSHUB_BASE_URL/RSSHUB_ACCESS_KEY 受控配置——路由固定常量、缺配/非 https 即禁用并 not_configured 上报、密钥仅存在于出站请求 URL（outcomes/候选/failures/诊断零泄漏，测试锁定）。门禁：tsc 0 / lint 0 err / 945・939・0・6s / build 0。

### RSSHub 宿主修订（P2-E STEP 2，不依赖 CloudBase Run 控制面）
| 候选 | 结论 |
|---|---|
| 用户腾讯云 Lighthouse 轻量应用服务器（ 体系，2026-10-18 文档先例） | **首选待核**：账号内既有；规格/区域/负载/Docker 状态 UNKNOWN（本会话无该通道）——需用户确认实例身份后按本清单核验 |
| 本机 Windows Docker Desktop | P2-D 已验证可跑（同 digest 0.25C/512MiB 双 Feed 全过）；**受阻于无合规公网 HTTPS 入口**（无隧道工具），仅作应急备选 |
| CloudBase Run（任何形态，含 v2） | 排除：控制面故障未结（TaskId 2443142 ），与目标相悖 |
| 新购轻量/CVM | 本轮禁止；若 Lighthouse 不可用，待单独授权评估 |

安全接入设计（随  已就绪）：HTTPS 反代 + RSSHub ACCESS_KEY；API 侧 RSSHUB_BASE_URL/KEY env；固定两条路由；SSRF/DNS/TLS 零放宽。

## 三、变更历史
- 2026-10-24: 建立。master 7268bf8→33635cc（ff, RSSHub 分支收口）→6238890（ff, Sites55 移植）。
- 2026-10-24（二）: master 9309611→0ab6cf2（relay 配置化+测试）；版本对账与宿主修订入清单。
