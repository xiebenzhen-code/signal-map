# RSSHub 受限修补轮次 — 2026-10-23

## 当前交付

本地修补与完整门禁通过，提交2984cb03ab1926dbb1adf2c04e2d477cc07af187已推送并远端回读一致。最初因腾讯云退出登录阻断；用户随后完成登录，已继续提交一次API发布，尚待终态与复验。

基线：隔离工作区 mem-worktree @ d9c7c29；分支 codex/rsshub-bounded-closeout-20261023。保留主目录既有证书删除、学习文档改动及其他未跟踪材料。

## 已证实根因及修补

此前响应 requestId=signals-rsshub-accept-017d4bcc-ab54-47da-8a8c-bb96444dee89 同时记录两路FEED_TIMEOUT、needs_more_evidence和最后一条“研究完成 · 今天没有重要变化”。

单切片 research-pipeline 已能识别来源失败；但 agent/research-run-state.ts 的 mergeResearchResponses 直接拼接 previous.progress 与 next.progress，最后一轮空切片的quiet标签成为累计响应的末条完成提示。

修补仅在累计 signals 为空且累计 coverage 存在failed时，将最后一个complete事件改为“研究未完成 · 来源读取失败或证据不足，请稍后再试”。历史阶段、来源计数、错误码、筛选结果均保留；正常空结果和有结果的完成提示保持。

差分：2文件，44行新增、2行替换，原有CRLF保留。原有CRLF需使用 git -c core.whitespace=cr-at-eol diff --check，检查已通过。

## 超时调查结果：根因仍未证实，未猜测修补

- readCustomSource的feed读取上限为12秒，同时受调用者deadlineAt约束，取两者较早值。
- retrieveRegisteredFeeds对所选feeds使用Promise.all，36氪与极客公园不是逐个串行读取。
- 同一pipeline切片的feeds与首批搜索渠道并发启动，后续agent切片依序执行；research-service传入相同全局deadline，接口总窗口25秒。
- 本次已保存响应没有两路读取开始时的剩余预算、RSSHub实例冷启动时间或网络分阶段耗时，无法证明“前序搜索耗尽预算”或“冷启动”是该请求的确定根因。
- 因证据不足，本轮未调度重排、未加时、未预热定时器、未改DNS或私网保护。原定两项修补上限中只实施已证实的一项。

## 先红后绿及门禁

- tests/research-run-state.test.ts增加3项配对反例：失败早切片+正常空晚切片；两轮真正空结果；晚切片含信号。
- 先红：12测试/11通过/1失败，失败为错误quiet提示；exit1。
- 修后定向：38/38，exit0。
- 完整 npm run quality：**exit0**，932 tests / 926 pass / 0 fail / 6 skipped；typecheck0、lint0 errors/28既有warnings、knip0、deps:check0。
- Node24显式置于进程PATH后运行原始quality脚本；本次不是分项补跑冒充quality通过。
- npm run build与npm run api:build均exit0。
- 独立只读审查：本次两文件差分无可执行发现。审查者未独立重跑测试；进一步读取source-coverage因本机进程启动错误被阻断，主会话已读取该实现。

日志：outputs/rsshub-closeout-red.log、rsshub-closeout-green.log、rsshub-closeout-quality.log、rsshub-closeout-build.log、rsshub-closeout-apibuild.log。

## 发布和复验续接条件

1. 腾讯云登录后实时核对承流版本与回退目标。上一份记录为API022，不能当当前实时结果。
2. 由本轮提交干净导出，仅API发布一次，保留全部既有配置；不重建RSSHub001、不发布Web。
3. 发布成功、健康通过后，以上一轮同题和同上下文提交一次研究，记录来源是否成功、候选/信号/观察层以及complete标签。不得重试追求通过。
4. 未发布前不提交研究消耗复验机会；超时仍可能存在。若再次失败按具体证据分类停止，不追加修补轮次。

## 发布续接现场

登录恢复后实时确认022正常、100%承流、1实例。发布前表单保持：端口8080、目标目录`.`、Dockerfile、1核2GB、始终自动扩缩容0至1、CPU50%、公网出站开启、VPC关闭；13环境变量键已核对，未读取或输出其值，未修改变量。回退目标为022。

干净git archive候选：482文件，ZIP 8,302,347B，SHA256=40916db54dc520517bb08bbf181e797c00cb86fbd86ae855de812328af9b84ff。清单outputs/rsshub-closeout-20261023/manifest.json。

一次源码部署已受理：DeployId023 / taskId2438830，控制台开始时间2026-10-23 19:47:28。版本详情URL：
https://tcb.cloud.tencent.com/dev?envId=signal-map-prod-d7feg55r886aa857#/platform-run/service/deploy/detail?serverName=signal-map-api-preview&deployId=023&taskId=2438830&envId=signal-map-prod-d7feg55r886aa857

当前首读为创建中，不宣称已上线。不能再次点击部署。自动审批曾拦截一次可能混淆按钮索引的配置展开操作，未触发发布；改为逐项语义控件读取并完成配置核对后才提交。

## 停止线现场

最后额度实查：5小时used91%，**剩余9%**；周used29%，剩余71%。按用户<=10%停止要求，立即停止新操作。

最后一次页面读取：**023仍创建中**。已受理的平台任务会继续运行；未取消任务、未重复部署、未切流或回退。022为发布前100%承流及回退参照，但停止时023的后续自动切流状态尚未核实，不可把022历史值写成停手后的实时状态。

未执行健康检查和研究复验（0次），复验机会保留。脚本outputs/rsshub-closeout-20261023/retest/run-once.mjs与上一轮脚本SHA256完全一致：dfb5477d92709be3cbf91d96bc5d142b6f98eb312022f72d9635cd71cc2837c4。

续接唯一顺序：先查额度→读取task2438830/Deploy023终态（不创建新任务）→成功则核对100%承流及配置、健康一次→运行上述脚本一次→提取两路outcome、candidate/observation计数与最后complete提示→保存报告并停止。失败则保存具体失败步骤，不重试；已证明运行回归才按既定参照022回退。超时根因仍UNKNOWN，不宣称超时已修好。

本地代码已推送2984cb0；Git内报告为发布前快照，当前主目录本报告追加了发布受理与停止线现场，尚未追加提交。后续最终报告提交时仅同步该文档，不带入主目录无关改动。

本轮新增真实研究0次、部署提交1次；模型调用未由本轮主动发起。云费用与账单未查询，UNKNOWN。额度开工剩余77%/81%，发布受理前剩余19%/72%，高于10%线。

## 续接执行记录（2026-10-23 19:52–20:00）

### 部署：023 已成功上线（只读核对，未新建部署）

- 查询同一任务 taskId **2438830**：终态 **finished**；CreateVersion 484s（19:47:28→19:55:32）、ReleaseVersion 2s（19:55:33→19:55:35），FailReason 空。
- DeployId **023**：status **normal**、FlowRatio **100**、HasTraffic true；版本 `signal-map-api-preview-023`，镜像 `ccr.ccs.tencentyun.com/tcb-100046649407-oeth/ca-ywgpdtav_signal-map-api-preview:signal-map-api-preview-023-20261023194738`；`OnlineVersionInfos` 仅 023 @100%。
- 配置逐项保持：1C2G、MinNum 0 / MaxNum 1、Port 8080、13 个环境变量键、OpenAccessTypes OA/PUBLIC/MINIAPP、VpcConf 仍空（与 022 相同）。未修改任何配置项。
- 健康：`GET /health` → **200** `{"status":"ok"}`（0.30s）。
- 本次未触发回退，未判定运行回归；022 仍为回退参照。

### 复验：单次提交被站点边缘阻断，研究结果 0 条

- 运行前确认本轮无请求记录（retest 目录只有 `run-once.mjs`，脚本 SHA256 与上一轮一致），随后执行脚本 **1 次**；脚本内部 `attempts=1`，无重试。
- 结果：`POST https://signal.benzhenlab.com/api/signals` → **HTTP 403**、`content-type: text/html; charset=UTF-8`、耗时 **1226ms**；响应体是 Cloudflare "Attention Required!" 阻断页，**Cloudflare Ray ID: a4f08f03acf83385**，不是产品 JSON。
- 含义：请求在站点边缘被阻断，**未到达产品 API**，未创建研究会话、未触发来源读取与模型调用。因此本轮没有 36kr-flashes / geekpark-ai 的 outcome、requestCount、raw-normalized 计数或 FEED_* 细分码，也没有候选池、正式信号、observation 计数与末条 complete 标签可核对。
- 同一时刻 `GET /api/signals`（无认证）同样返回 403 HTML，与 POST 同源，属边缘规则而非 API 语义。
- 按约束：不追加第二次研究追求通过、不循环排查；复验机会已用尽，**“末轮空结果不提示今天没有重要变化”的修补效果仍未验证**。
- 不宣称 FEED_TIMEOUT 已修复；其根因仍 UNKNOWN。

### 结论

| 项目 | 状态 |
|---|---|
| 代码与 Git | 2984cb0 已推送；本轮仅追加本报告文档提交 |
| 部署 | 023 成功、100% 承流、配置保持、健康 200 |
| 本次研究 | 0 条（单次请求被 Cloudflare 403 阻断，未到达产品） |
| 未验证 | 两路来源成败与计数、候选/信号/观察层、complete 标签修补、超时根因 |

### 额度

- Codex 额度仍**读不到**：无 `codex` CLI，本地状态文件只有 `subscription_level=plus` 与重置历史，无任何额度数值 → 如实标 **UNKNOWN**。
- 本报告上一份可查读数（19:49 五小时剩余 9%）已过期，不作为当前值；腾讯云资源点不替代该额度。
