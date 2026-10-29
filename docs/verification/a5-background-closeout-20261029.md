# A5：窗口外背景区

基线：develop `fde72578a14dc3899c1cff5f13016840a9db559d`。本轮不部署、不推送、不调用模型、不发起线上研究。

## 改动

- `research/background.ts` 在详情、聚类和判断前将日期有效且超出窗口的材料隔离为四字段元数据。详情补全后再次隔离；验证使用的 primary 集合同样移除历史材料。
- `research/types.ts`、`information/types.ts` 增加可选 background；`agent/research-run-state.ts` 跨轮按 URL 合并，避免后一轮覆盖前一轮背景。
- `app/components/research-diagnostics.tsx` 默认折叠，标注“窗口外，仅供参考”，仅显示标题、来源、链接和日期；`app/page.tsx` 接线。
- `scripts/eval-frozen.mjs` 增加背景数；窗口外返回卡片计数仍只统计正式卡片与折叠消息，不把背景算作卡片。

## TDD 与验证

专项红灯见仓库外 `a5-background-20261029/red.log`、`red-round.log`；绿灯见 `green.log`（26/26）。覆盖真实 D06、默认折叠渲染快照、跨轮合并、未来/缺失/无效/冲突日期不被包装成背景。

| 案例 | plan | 抓取 | 必看主卡 | 折叠消息 | 资料库 | 可能相关 | 背景 | 窗口外返回卡片 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| D06 | frozen |25|1|2|0|0|9|0|
| D06 | rebuilt |25|1|10|0|0|9|0|
| OBS D03 | frozen |10|0|0|0|0|10|0|
| OBS D03 | rebuilt |10|0|0|0|0|10|0|

回放网络请求和模型调用均为 0。条目级输出保存在仓库外 PRIVATE 文件，不公开盲标对照。新增背景未改变上述案例的正式主卡/折叠消息数。

## 旧测试调整（不改断言）

首次 quality：1081 项，1061 通过、14 失败、6 跳过。基线对照 4 文件 28/28 通过；新增早期窗口隔离使其中 9 项的陈旧日期夹具不再参与详情/判断。其余 5 项为沙箱回环 HTTP 连接失败，不能当作产品缺陷已定案。

- budget-allocation.test.ts、detail-enrichment.test.ts：冻结参考时间 2026-08-15，保留 2026-08-01 合成条目及所有断言。
- source-enrichment.test.ts：冻结参考时间 2026-09-19，保留原合成 Atom 和全部断言。
- observation-integration.test.ts：冻结参考时间 2026-10-20；合成 PCB 夹具日期由 8 月移到 10 月 18 日，使其继续测试“窗口内无关材料留痕”，并保留全部断言。没有改真实 D06 快照。
- 四文件复跑 28/28、跳过 0（fixture-recheck.log）。完整门禁最终结果见下节。

## 门禁

Node v24.21.0。最终 quality 0：1082 项，1076 通过、0 失败、6 项数据库环境条件跳过（不计通过）；typecheck/lint/knip/deps 均通过，lint 0 error/29 warnings。build 0、api:build 0；diff --check（cr-at-eol）0。完整日志在仓库外同级 `a5-background-20261029/`。

## 未验证与风险

未部署、未做真实浏览器或线上多轮验收；服务端渲染测试不替代浏览器验收。背景只包含本轮实际读到且日期有效的材料，不代表历史全量，缺日期材料不会被猜测成背景。现有读取/候选容量边界未扩大。

回滚：对本轮单独提交执行 git revert，不涉及数据库迁移。

## 本次涉及的概念

时间窗口隔离与数据分区；元数据和判断结果分离；多轮状态合并；冻结快照回归与服务端渲染快照。
