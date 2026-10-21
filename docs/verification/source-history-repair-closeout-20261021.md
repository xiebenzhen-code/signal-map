# 信源执行历史与细分错误码修补收口 — 2026-10-21

## 结论

LOCAL_VERIFIED，未部署、未 commit/push、未提交线上研究。修复两个已取证问题；不宣称 Chrome 或 WooCommerce 的网络读取恢复。

## 基线与边界

在 `C:/Users/25186/AppData/Local/Temp/smfix/mem-worktree` 实施。发布基线为 `outputs/login-sources-candidate-20261020`，其清单摘要为 `bbe96f2db1e3855d1a0c970b3c9ef873be284077436cd0048dc0c1a24cc3395f`；不能用工作区 HEAD 代替这一含既有登录/来源 overlay 的基线。

原登录页、package.json、来源目录、登录测试及网页捕捉 skill 与该候选逐字节一致。主仓库既有未提交改动未覆盖。未调整网络、DNS、私网保护、超时、来源数量或产品界面。

## 实际修复

1. `agent/research-run-state.ts` 合并轮次/切片时累计 coverage.outcomes，而不直接采用最后一次 coverage。
2. `research/source-coverage.ts` 保留原始执行历史，摘要按来源名称去重。具体来源的已执行记录不会被后续 generic not_searched 覆盖；同一来源成功和失败均保留，失败不因成功消失；未执行的另一具体 feed 不被隐藏；缓存 requestCount=0 不增加来源覆盖等级。新增 sourceId 区分 provider 下具体 feed。既有请求记账算法未改。
3. `research/registered-feeds.ts` 将有限固定 FEED 错误码及 HTTP 100–599 码写入 detailFailureCode，未知错误映射 FEED_READ_FAILED，避免原始异常或凭据进入日志。
4. `research/research-pipeline.ts` 在 search_finished 的 providerOutcomes 和 providerErrorCodes 中传播细分错误码，逐来源记录同时包含 sourceId。

本轮 4 个生产文件 + 3 个测试文件；相对发布候选按换行归一后的差分为 +80/-12。补丁材料仅含这 7 个文件，不是完整可上传发布包。

## 验证证据

- 首轮两个新增反例先红（source-history-red.log），修复后定向 94/94。
- 续接复核发现测试原先只匹配错误汇总。改为直接断言 providerOutcomes.detailFailureCode 后先红（source-history-provider-detail-red.log），补齐逐来源字段后定向重新 94/94。
- 最终 npm run quality 退出 0：902 tests / 896 pass / 0 fail / 6 skipped。6 项均因 DATABASE_URL 未配置，数据库端到端未验证。
- typecheck、knip、deps:check 均通过；依赖检查 171 modules / 378 dependencies 无违规。lint 0 errors / 28 warnings；不宣称零警告。
- npm run build 退出 0；npm run api:build 退出 0。构建给出的路由静态分类提示未改。
- 独立只读审查完成，最终补齐重新复核，未发现需要追加修复的问题。审查未代替测试。
- 七个交付文件哈希与最终验证工作区重新核对一致。

## 未做及下一步

未部署、未变更云配置、未发起线上研究，不据本地通过宣称线上生效。Chrome 具体失败原因与 WooCommerce 本次预检失败原因仍需发布后的细分码取证，仍不能认定网络已修复。数据库集成因环境未配置未验。费用与实际账单 UNKNOWN。

后续若安排受控发布，应基于原发布候选叠加这七份文件，生成新的完整候选清单，再按原发布流程核对；本轮没有发布授权，不实施。离线修补已完成，到此停止。

补丁、基线/新文件哈希、红绿测试与构建日志位于 `outputs/source-history-repair-20261021/`。暂停报告保留为历史；本报告取代其“待完整验证”状态。
