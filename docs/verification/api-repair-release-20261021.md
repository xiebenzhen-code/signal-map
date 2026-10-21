> 2026-10-21 收口更正：下文保留原发布报告。第四节 Chrome 的“DNS/连接已过、正文超时”超出证据：requestCount 在连接完成前计数，实际超时阶段 UNKNOWN。sources/check 使用网页模式5秒，不能替代 feed 模式12秒验证。WooCommerce本次只证明非公网地址预检拒绝，不能据此确定昨夜请求同因。后续用户回传 API019 HTTPS FeedBurner 读取 FEED_TIMEOUT，OBS/Kdenlive 读取解析成功，见同目录后续诊断报告。

# 受控交付报告：Git 收口 + API 019 + 两路来源诊断（2026-10-21）

## 一、Git 提交与远端回读身份

- 隔离工作区：`C:/Users/25186/AppData/Local/Temp/smfix/mem-worktree`，分支 `fix/stability-closeout-20261019`，基线 `b14c0c006e11d399d6904fb97673f3f75442b31f`。
- 新提交：**`dac6056`**（完整 SHA `dac60565ed063532c508eeeae3f625b608146cb6`，父 b14c0c0）。
- 提交内容（12 个唯一路径，工作区漂移的 27 个日志文件未纳入）：
  - **溯源补齐（5 项，已随 018 上线但未入 Git）**：`app/control/page.tsx`（登录直回首页）、`package.json`（测试清单）、`source-registry/feed-catalog.ts`（17 路目录）、`tests/login-navigation.test.ts`（新）、`.agents/skills/web-platform-source-capture/SKILL.md`（新）。
  - **本轮修复（7 补丁，PATCH-MANIFEST 7/7 哈希核对）**：`agent/research-run-state.ts`（轮次/切片合并累计 coverage）、`research/source-coverage.ts`（保留逐来源执行历史+sourceId）、`research/registered-feeds.ts`（安全 FEED_* 细分码白名单+FEED_READ_FAILED 回退，不落原始异常/凭据）、`research/research-pipeline.ts`（providerOutcomes/providerErrorCodes 透传细分码）、三个测试文件（先红反例）。
- **push**：`bb53ed3..dac6056` 快进推送至远端同名分支（bb53ed3 是 b14c0c0 祖先，**非 force**，无历史改写）。
- **远端回读**：`git ls-remote` → `refs/heads/fix/stability-closeout-20261019 = dac60565ed063532c508eeeae3f625b608146cb6`，与本地提交一致。
- 未合并主分支、未打 tag、未建 release。既有登录、17 路信源目录、测试与网页捕捉 skill 全部保留；主工作区无关漂移未触碰。

## 二、完整候选清单及与发布基线差分

- 候选：`outputs/api-repair-candidate-20261021/`，**448 源文件**（清单自身不计入）。
- 清单：`SOURCE-MANIFEST.sha256` 文本 SHA256 = **`9f051c91809df1bf8bd9b8a82316fd31a4fa2897faaeca0718b2b569a1bb151f`**；逐项自校验 0 错误；身份文件 `outputs/api-repair-candidate-20261021-identity.json`。
- 与发布基线 `outputs/login-sources-candidate-20261020`（清单 `bbe96f2d…3395f`，即线上 018 的源）差分：
  - 路径集合 **448/448 完全一致**（无增无删）；
  - 内容差异**恰为 7 个补丁文件**（上列），其余 441 项逐字节一致；
  - 7 个补丁文件 SHA256 = `PATCH-MANIFEST.sha256` = `identity.json.patchedSha256` 三方一致（交付审查 C 项 PASS）。
- 继承验证（文件身份一致，不重复全量）：`source-history-repair-closeout-20261021.md` LOCAL_VERIFIED——`npm run quality` 退出 0（902 tests / 896 pass / 0 fail / 6 skipped，DB 环境跳过）、typecheck/knip/deps:check 通过、build 与 api:build 退出 0、两份先红日志在案。本轮未修改生产代码（提交即补丁原样），证据有效。

## 三、API 发布结果

- 发布前实时核对（子代理 B）：承流 **018**（BuildId 2609040742，镜像 `…-018-20261020220910`）＝回退目标；Web 013 未动；旧服务 `signal-map-api` 未触碰。
- 部署：taskId **2414896** → **DeployId 019 / BuildId 2609076235 / RunId multi_tenant_1xJLzB2a8O9gkO / 镜像 `…-019-20261021102332`**（本次回执 buildId 与部署记录一致）；CreateVersion 485s、ReleaseVersion 5s 均 finished、无 FailReason；**normal / FlowRatio 100 / HasTraffic true**。单次部署，持续观察同一任务，未重复提交。
- 配置零差异：Port 8080 / Dockerfile / BuildDir `.` / Cpu1 Mem2 / Min0 Max1 / CPU 50% 策略 / OA+PUBLIC+MINIAPP / EnvParams 13 键同集（值脱敏）/ VpcConf 现值。
- 健康：`/health` → 200 `{"status":"ok"}`（4.1s）。
- **镜像 digest：UNKNOWN**（平台不返回；版本号与 health 不替代源码身份）。源码关联证据：部署目录=`outputs/api-repair-candidate-20261021`（清单 `9f051c91…`），该清单与提交 `dac6056` 的生产文件经逐文件哈希核对一致（7 补丁=PATCH-MANIFEST=工作区=候选；5 overlay 候选=基线=staged）。
- 未发布 Web，未回退。

## 四、两路来源诊断（API 019 容器内产品现有安全读取器，各一次）

通道：现有产品接口 `POST /api/sources/check`（真实容器执行、同款安全读取器与 DoH 配置、5s 截止；非新增接口、非研究、不调模型）。响应即证据（不输出环境变量与正文）。

| 来源 | status | reason（产品文案） | requestCount | 耗时 | 判读 |
|---|---|---|---|---|---|
| Chrome Releases（chromereleases.googleblog.com/feeds/posts/default） | failed | 读取超时，请稍后再检查。 | **1** | 7.0s（含 5s 截止） | 请求已发出（DNS/连接已过），正文读取在截止内未完成——**读取超时**，与昨夜 trace `req=1 + upstream_error` 吻合 |
| WooCommerce（developer.woocommerce.com/feed/） | blocked | **来源解析到非公开地址，未进行抓取。** | **0** | 1.5s | DNS 解析阶段即判非公网地址，安全检查在抓取前拒绝——**确证预检失败**，与昨夜 trace `req=0` 特征一致并升级为实证 |

- 两者与 2026-10-21 凌晨日志取证的判读完全一致：Chrome=网络级超时；WooCommerce=DNS 解析到非公开地址（私网保护按设计生效，未放宽）。
- UNKNOWN：Chrome 读取阶段的上游 HTTP 状态码与响应头（截止内未完成）；`FEED_*` 细分码本身未在 sources/check 响应中出现（该码在研究管线 outcome 的 `detailFailureCode`，本接口返回产品文案）——细分码透传效果待下一次含该来源的真实研究取证。
- 未修网络、未延长超时、未放宽私网保护、未追加请求。

## 五、状态汇总

**已完成**
1. 三项并行核对（版本身份 / 云端实时状态 / 交付审查）全部通过；
2. Git 收口：提交 `dac6056`（12 文件），快进推送，远端回读一致；
3. 完整候选 `api-repair-candidate-20261021`（448 文件，清单 `9f051c91…`），与基线差分恰为 7 补丁；
4. API 受控发布 **019**（一次，配置零差异，健康 200）；
5. Chrome/WooCommerce 各一次容器内只读诊断，失败性质均实证定位。

**未执行 / BLOCKED**
- Web 未发布（本轮范围仅 API）；旧服务未触碰。
- `FEED_*` 细分码的线上实证：需等下一次真实研究（含 Chrome/WooCommerce 来源）后按 requestId 取 `detailFailureCode`——本轮未提交研究（按指令）。
- 数据库端到端（6 项 skip）仍未验（环境未配置）。

**UNKNOWN**
- 019 镜像 digest；Chrome 上游 HTTP 状态/响应头；模型与云费用；账户额度。

**最小下一步（仅一项）**
下次例行验收时，提交一次含 Chrome/WooCommerce 来源的真实研究，按 requestId 从 CLS 取 `providerOutcomes.detailFailureCode`，验证细分码透传上线生效；其余不动。

**边界重申**：提交成功≠上线成功（本报告以 019 承流为上线证据）；部署成功≠来源恢复（Chrome 仍超时、WooCommerce 仍被私网保护拒绝——这是定位而非修复）；零结果≠没有信息。完成即停。
