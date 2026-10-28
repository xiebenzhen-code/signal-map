# 发布记录整理验证 · 2026-10-28

基线 develop `5bf11d568c3daab99cbccd2420078064d40891d7`；仅报告及 README 修改，未改产品代码。

Node v24.21.0；npm lifecycle 使用同源 F:/node.exe。依赖复用本机 develop-consolidation-20261028 的 node_modules 目录联接，未安装或修改依赖。

| 命令 | 退出码 | 结果 |
|---|---|---|
| npm run quality（允许本机回环） | 0 | 1035项，1029通过，0失败，6跳过；knip及依赖检查通过 |
| npm run build | 0 | Build complete |
| git -c core.whitespace=cr-at-eol diff --check | 0 | 无空白错误 |
| README 中英本地链接检查 | 0 | 两份文档均0缺失 |

quality 首次因没有依赖找不到 tsc 退出1；建立依赖联接后，沙箱内运行退出1，5项HTTP测试因本机回环 EACCES 失败（1024通过、5失败、6跳过）。允许回环后原样完整重跑退出0，未改测试或断言。6项跳过为 DATABASE_URL 条件门控，不计通过。

日志在本机父目录：
- release-records-quality-20261028.log（沙箱失败记录）
- release-records-quality-unrestricted-20261028.log（完整成功记录）
- release-records-build-20261028.log

绝对目录：`C:/Users/25186/.codex/visualizations/2026/09/26/01a0deb0-330b-7250-8af8-66d3edbccfbc/`。日志未加入仓库。本次不重复 api:build；用户要求为 quality，工程完成规则另要求 build。

未部署、未推送、未发起线上研究，未读取配置明文。
