# RSSHub 受限修补轮次 — 2026-10-23

## 当前交付

本地修补与完整门禁通过。API发布与一次真实研究复验尚未执行：腾讯云控制台退出登录，本会话无CloudBase连接器。已请求用户手动登录，不读取凭据、不绕过认证、不重复发布。

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

本轮新增真实研究0次、部署0次；模型调用未由本轮主动发起。云费用与账单未查询，UNKNOWN。额度开工剩余77%/81%，高于10%线。
