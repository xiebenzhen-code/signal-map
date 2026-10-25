# RSSHub 发布候选收口（2026-10-25）

## 范围与身份

用户批准先收齐代码、部署模板和脚本并提交为发布候选。本轮不执行服务器部署或研究。
从 master 8be8574b3b5e7e322dc64a830574df31fe36c2f5 建立
codex/rsshub-release-candidate-20261025 隔离分支，接入代码已由其祖先
25032736aa4950f8cffe4dc3e747f6d7c2ae6b36 提供。
本轮联网 git ls-remote 核对远端 master 与上述基线一致，目标候选分支此前不存在。
候选完整身份以包含本报告的提交及提交后的远端回读为准。

## 已整理材料

- deploy/rsshub/start-local.sh：固定 digest、仅回环 1200、资源限额、日志轮转；无镜像或已有同名容器即停止。
- deploy/rsshub/verify-local.sh：一次本机 36氪 RSS 请求、12 秒截止、XML 与原文链接/日期校验；不会提交研究。
- deploy/rsshub/nginx.conf.template：443 TLS、单一固定路由、X-Relay-Key 鉴权并剥离、固定查询参数、限流与请求体限制。
- deploy/rsshub/release-candidate.json：Signal Map 基线、第三方镜像身份、目标新实例与未完成条件。
- deploy/rsshub/README.md：部署准备、服务器端密钥生成、网关前置条件、生产验收及回退步骤。
- deploy/rsshub/.gitignore：防止本目录密钥、证书、日志及运行记录误入 Git。
- source-registry/feed-catalog.ts：仅更正过时注释，共 5 行新增、7 行删除；无运行逻辑变动。

18 路静态来源、仅 36kr-flashes 走 relay、geekpark-news 直连官方 RSS，均继承当前 master。
第三方 RSSHub 源码没有复制进仓库；本仓库记录固定镜像 digest 与部署配置。
历史 nginx 设计稿中的无效指令 proxy_max_body_size 在新模板中改为 client_max_body_size。

## 本轮验证

| 项目 | 实际结果 |
|---|---|
| 两个 shell 脚本 bash -n | 退出 0 |
| verify-local.sh 内嵌 Python AST 语法检查 | 退出 0 |
| 候选 JSON 与启动脚本镜像身份一致性 | 通过；SHA 长度与 digest 格式检查通过 |
| npm run quality（允许本机连接的环境） | 退出 0；954 tests / 948 pass / 0 fail / 6 skipped |
| typecheck / lint | 退出 0；lint 0 errors / 29 warnings，均在本轮未改动的代码中 |
| knip / deps:check | 退出 0；174 modules / 385 dependencies，无违规 |
| npm run build | 退出 0；Vite 8.0.16 |
| npm run api:build | 退出 0；esbuild 0.28.1 |

首次借用旧主目录依赖时发现 Vite/React 等版本与候选锁文件不匹配，因此该轮结果作废。
随后改用现有隔离工作区的匹配依赖，逐项比对已安装顶层包与锁文件版本。
受限沙箱下本机 HTTP 测试报 EACCES 127.0.0.1；单文件复现确认连接权限阻断。
最终在允许本机连接的环境重跑完整 quality，取得上表结果。未为这些环境问题修改产品实现。
6 项跳过保持环境条件限制，不把它们计为通过。

正式日志保存在候选工作区 quality-rsshub-candidate-verified.log、
build-rsshub-candidate-final.log；交付时复制至主目录 outputs/rsshub-release-candidate-20261025。
Git diff 校验须遵守仓库现有行尾过滤；本轮新文件与提交后的目标 blob 使用 LF。

## 尚未取得的证据

目标新实例 lhins-lbffbux2 / 124.220.183.159 的 Docker 安装来自用户截图；
此前镜像下载尚未确认完成，本轮未连接服务器补判。
中继域名、证书、云防火墙、nginx -t、鉴权正反例、公网 1200 不可达、
目标 API 同款安全读取器与解析器双路实读，以及一次页面研究，均未验证。
nginx 文件仍为模板，不能直接启用；两份脚本的语法通过不等于服务器运行成功。
API 024 为此前报告的在架版本，本轮未实时核对，不预设下一次部署编号。

## 交付边界

独立候选分支用于保存与审阅，不合并 master、不打 tag、不改正式站点。
后续从本提交 git archive 导出完整源码，并生成逐文件 SHA256、ZIP SHA256 与身份记录；
这些派生文件放 outputs，不混入源码提交。部署完成后另补实际运行身份与验收报告提交。
主工作区原有证书删除、学习文档修改及未跟踪材料保持原样。
本轮生产部署 0 次、研究提交 0 次、生产配置修改 0 次。
