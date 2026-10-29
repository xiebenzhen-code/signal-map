# D06 完整计划回放与链接去重复核（2026-10-29）

## 范围与方法

基线 develop `78e8cd0809539f0cca61045cf9648b611593b689`。未改相关性、可靠性或日期规则；未部署、未追加研究、未调用模型。

冻结 plan 是 `tests/fixtures/d06-plan.json` 内完整计划（包括 entities、resolvedEntities 及存在时的 topicProfile），它本身是历史离线重建产物，不是历史线上运行计划。重建 plan 刻意保留旧脚本“仅传 searchCombinations”的路径作为对照；不声称是当前 planQuery 的完整输出。完整计划经内部 debug 参数克隆传入，不来自 HTTP、环境变量或配置。来源执行仍仅允许 registered-feeds。

使用同一份真实 Chrome RSS 和固定时钟 2026-10-20T08:30:06.367Z；无冻结详情 HTML，明确使详情读取不可用，不补抓正文；翻译关闭。两模式均消费夹具，脚本禁止所有网络入口，网络请求与模型调用均为 0。没有人工金标，不计算精度或误零率。

## 去重前后（同一修正后的评测脚本）

表头“标题去重后”沿用请求用语；修复后实际按规范化链接去重，而非按标题判同事件。retrievedCount 是流水线检索计数，不再称 admitted。正式关注只含 MUST_READ/WORTH_WATCHING；资料库单列，不将 LIBRARY_ONLY 当作正式关注。

| 阶段 | plan | 抓取数 | retrievedCount | 标题去重后 | 正式关注 | 资料库 | 可能相关 | 窗口外进入返回卡片数 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 修复前 | frozen | 25 | 13 | 13 | 0 | 0 | 5 | 0 |
| 修复前 | rebuilt | 25 | 13 | 13 | 0 | 1 | 0 | 0 |
| 修复后 | frozen | 25 | 25 | 25 | 0 | 0 | 5 | 0 |
| 修复后 | rebuilt | 25 | 25 | 25 | 0 | 1 | 0 | 0 |

25 条保留后仍聚合为 5 个簇；“可能相关 5”是簇级卡片数，不是只有 5 条来源材料。冻结模式 5 簇均 UNCERTAIN，重建模式 5 簇均 MATCH；重建模式只返回 1 张资料库卡。不能据此推断质量改善、日期安全或线上已生效。

## 25 条逐项去向（每种计划分别列出）

decision/reason 来自最终簇的真实 filteringDetails；不是逐条材料独立运行判定的结果。未进入聚合的材料记 NOT_RETAINED_BEFORE_CLUSTER，decision/reason 为空，不伪造筛选理由。POSSIBLE_RELATED 表示材料所属簇进入折叠组；不表示一材料一卡。窗口内含起止端点。

### frozen

| ID | 原标题 | 发布时间 UTC | 窗口内 | 去向：前 → 后 | 簇 decision：前 → 后 | 簇 reason：前 → 后 |
| --- | --- | --- | --- | --- | --- | --- |
| D06-01 | [Chrome Dev for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-desktop-update_0562111902.html) | 2026-10-16T15:43:33.041Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-02 | [Chrome Dev for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-android-update_0193953929.html) | 2026-10-16T13:13:32.498Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-03 | [Chrome Beta for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-desktop-update_02089051700.html) | 2026-10-16T09:13:33.426Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-04 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01464551208.html) | 2026-10-15T23:00:00.000Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-05 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update_01173306270.html) | 2026-10-15T22:58:31.889Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-06 | [Extended Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/extended-stable-update-for-desktop_01598036246.html) | 2026-10-15T21:20:05.224Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-07 | [Stable Channel Update for Desktop](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_01886704284.html) | 2026-10-15T20:50:35.703Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-08 | [Early Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/early-stable-update-for-desktop_01549127219.html) | 2026-10-14T20:46:06.194Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-09 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_02125536954.html) | 2026-10-14T20:25:53.845Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-10 | [Chrome Beta for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-ios-update_0317100573.html) | 2026-10-14T17:13:33.604Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-11 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update_01506840435.html) | 2026-10-14T13:28:32.349Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-12 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01360129943.html) | 2026-10-13T22:00:00.000Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-13 | [Beta Channel Update for ChromeOS / ChromeOS Flex](http://chromereleases.googleblog.com/2026/10/beta-channel-update-for-chromeos_0596170668.html) | 2026-10-13T21:16:57.530Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-14 | [Stable Channel Update for Desktop](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_01668083673.html) | 2026-10-13T20:53:43.905Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-15 | [Extended Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/extended-stable-update-for-desktop_0571684596.html) | 2026-10-13T20:40:37.365Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-16 | [Chrome Stable for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-stable-for-ios-update_01885421664.html) | 2026-10-13T16:13:33.466Z | 是 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-17 | [Stable Channel Update for ChromeOS / ChromeOS Flex](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-chromeos.html) | 2026-10-09T23:46:54.569Z | 否 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-18 | [Chrome Dev for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-android-update_01912086225.html) | 2026-10-09T14:43:32.230Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-19 | [Chrome Dev for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-desktop-update_0380080721.html) | 2026-10-09T14:28:32.819Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-20 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01286554645.html) | 2026-10-07T22:30:00.000Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-21 | [Long Term Support Channel Update for ChromeOS](http://chromereleases.googleblog.com/2026/10/long-term-support-channel-update-for.html) | 2026-10-07T18:30:32.914Z | 否 | POSSIBLE_RELATED → POSSIBLE_RELATED | UNCERTAIN → UNCERTAIN | UNCERTAIN_TASK_CONSTRAINT → UNCERTAIN_TASK_CONSTRAINT |
| D06-22 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update.html) | 2026-10-07T17:28:32.223Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-23 | [Early Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/early-stable-update-for-desktop.html) | 2026-10-07T17:18:55.747Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-24 | [Chrome Beta for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-desktop-update.html) | 2026-10-07T15:13:34.219Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |
| D06-25 | [Chrome Beta for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-ios-update.html) | 2026-10-07T14:58:33.042Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → POSSIBLE_RELATED | 未执行 → UNCERTAIN | — → UNCERTAIN_TASK_CONSTRAINT |

### rebuilt

| ID | 原标题 | 发布时间 UTC | 窗口内 | 去向：前 → 后 | 簇 decision：前 → 后 | 簇 reason：前 → 后 |
| --- | --- | --- | --- | --- | --- | --- |
| D06-01 | [Chrome Dev for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-desktop-update_0562111902.html) | 2026-10-16T15:43:33.041Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-02 | [Chrome Dev for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-android-update_0193953929.html) | 2026-10-16T13:13:32.498Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-03 | [Chrome Beta for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-desktop-update_02089051700.html) | 2026-10-16T09:13:33.426Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-04 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01464551208.html) | 2026-10-15T23:00:00.000Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-05 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update_01173306270.html) | 2026-10-15T22:58:31.889Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-06 | [Extended Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/extended-stable-update-for-desktop_01598036246.html) | 2026-10-15T21:20:05.224Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-07 | [Stable Channel Update for Desktop](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_01886704284.html) | 2026-10-15T20:50:35.703Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-08 | [Early Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/early-stable-update-for-desktop_01549127219.html) | 2026-10-14T20:46:06.194Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-09 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_02125536954.html) | 2026-10-14T20:25:53.845Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-10 | [Chrome Beta for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-ios-update_0317100573.html) | 2026-10-14T17:13:33.604Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-11 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update_01506840435.html) | 2026-10-14T13:28:32.349Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-12 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01360129943.html) | 2026-10-13T22:00:00.000Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-13 | [Beta Channel Update for ChromeOS / ChromeOS Flex](http://chromereleases.googleblog.com/2026/10/beta-channel-update-for-chromeos_0596170668.html) | 2026-10-13T21:16:57.530Z | 是 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-14 | [Stable Channel Update for Desktop](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_01668083673.html) | 2026-10-13T20:53:43.905Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-15 | [Extended Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/extended-stable-update-for-desktop_0571684596.html) | 2026-10-13T20:40:37.365Z | 是 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-16 | [Chrome Stable for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-stable-for-ios-update_01885421664.html) | 2026-10-13T16:13:33.466Z | 是 | LIBRARY_ONLY → LIBRARY_ONLY | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-17 | [Stable Channel Update for ChromeOS / ChromeOS Flex](http://chromereleases.googleblog.com/2026/10/stable-channel-update-for-chromeos.html) | 2026-10-09T23:46:54.569Z | 否 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-18 | [Chrome Dev for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-android-update_01912086225.html) | 2026-10-09T14:43:32.230Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-19 | [Chrome Dev for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-dev-for-desktop-update_0380080721.html) | 2026-10-09T14:28:32.819Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-20 | [Chrome for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-for-android-update_01286554645.html) | 2026-10-07T22:30:00.000Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-21 | [Long Term Support Channel Update for ChromeOS](http://chromereleases.googleblog.com/2026/10/long-term-support-channel-update-for.html) | 2026-10-07T18:30:32.914Z | 否 | FILTERED → FILTERED | MATCH → MATCH | LEGACY_QUERY_TERM_MATCH → LEGACY_QUERY_TERM_MATCH |
| D06-22 | [Chrome Beta for Android Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-android-update.html) | 2026-10-07T17:28:32.223Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-23 | [Early Stable Update for Desktop](http://chromereleases.googleblog.com/2026/10/early-stable-update-for-desktop.html) | 2026-10-07T17:18:55.747Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-24 | [Chrome Beta for Desktop Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-desktop-update.html) | 2026-10-07T15:13:34.219Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |
| D06-25 | [Chrome Beta for iOS Update](http://chromereleases.googleblog.com/2026/10/chrome-beta-for-ios-update.html) | 2026-10-07T14:58:33.042Z | 否 | NOT_RETAINED_BEFORE_CLUSTER → FILTERED | 未执行 → MATCH | — → LEGACY_QUERY_TERM_MATCH |

## 日期只读结论（本轮不修）

- `research/research-pipeline.ts:1998-2007`：聚合成员排序后直接拼接全部 title/snippet 为 clusterText；没有先按请求窗口逐条移除旧材料。
- `research/research-pipeline.ts:2084-2115`：validateTimestamp 只验证时间有效性；聚合取最早事件与最新发布日期，存在跨日更新时用新日期计算 freshness。窗口外的合法日期仍可进入成员集。
- `research/research-pipeline.ts:2193-2229`：withinWindow 在聚合后计算；资料库常规分支没有强制逐成员在窗口内。`research/candidate-selection.ts:109-118` 的 freshnessEligible 用于优先保护候选，不等于剔除所有窗口外成员。
- `research/research-pipeline.ts:2534-2609`：正式门禁沿用现有分数、事件状态等条件；没有逐条证据按日期隔离的保证。新成员让簇显得新鲜时，旧成员文本仍可能影响相关性、主张、冲突和后续结论。
- D06 有 16 条窗口内、9 条窗口外材料。修复后 9 条旧材料均有簇级去向；冻结模式进入可能相关簇，重建模式所属簇被过滤。返回的正式关注和资料库卡片均没有窗口外 publishedAt，但这仅检查卡片日期，**不等于其底层证据全部在窗口内**。本轮正式关注为 0，未证实发生了窗口外正式结论泄漏，也不能证明其他题没有风险。

## TDD 与风险

- 评测契约红灯：预期 2 个计划模式，旧脚本只产出 1 个，退出 1；修正后重复执行结果一致、完整冻结计划深比较相等，退出 0。
- 去重红灯：3/3 失败（10-13/10-15 同名公告丢失、同链接改标题未去重、25 变 13）；修复后 3/3 通过，加评测契约共 4/4，跳过 0。
- 同 URL 的主机大小写、默认端口、fragment 归一后判同；不同 URL 保留，即便标题相同。没有合并追踪参数、HTTP/HTTPS 或转载关系，因此可能保留更多重复来源；聚合与可靠性规则不变。无效 URL 退回完整标题与发布日期键，未新增读取权限。
- N4 “0 正式、25 可能相关”仅是受控评分的展示门单测，不是完整评测的当前结果；README 中英文已区分两者。

## 证据位置

完整 JSON/Markdown、逐项来源 URL、完整 QueryPlan、红绿测试日志和门禁日志在本机同级目录 `d06-eval-dedup-repair-20261029/`（仓库外），before/after 分开保存。冻结输入在仓库 tests/fixtures；脚本输出记录两输入 SHA256。

## 回滚

各功能独立提交，可对相应 SHA 执行 git revert；回滚评测提交前先回滚依赖其输出口径的 README。发布未执行，线上版本未改变。

## 最终门禁（Node v24.21.0）

| 命令 | 退出码 | 证据日志（仓库外同级目录） |
|---|---|---|
| npm run quality | 0 | d06-eval-dedup-repair-20261029/quality.log |
| npm run build | 0 | d06-eval-dedup-repair-20261029/build.log |
| npm run api:build | 0 | d06-eval-dedup-repair-20261029/api-build.log |

quality：1058 项，1052 通过、0 失败、6 跳过；lint 0 error / 29 warning。6 项均因 DATABASE_URL 未配置跳过（knowledge chain、P3 去重、Phase 4 记忆、迁移往返、偏好持久化、偏好对 attention），不计通过。专项 coverage-notice + candidate-dedup + eval-frozen：11/11 通过，跳过 0，日志 targeted-final.log。

首次沙箱内 quality 退出 1：5 个既有回环 HTTP 用例出现 EACCES/502，日志 quality-sandbox.log；未修改测试，改在沙箱外重跑完整三项，以上为实际终态。未跳过检查或删除断言。