# RSSHub 网关候选修正与版本核对

范围：只修正候选模板、同步已取得证据、核对 Git 版本并交付后续指令。完成即停。

## 本轮现场

隔离分支 codex/rsshub-release-candidate-20261025，起点
c0818d1f76d91c1fa3948a1a8fd7ee2b4eb4eb39；远端回读起点一致。
远端 master 为 8be8574b3b5e7e322dc64a830574df31fe36c2f5，
接入代码祖先为 25032736aa4950f8cffe4dc3e747f6d7c2ae6b36。
本轮候选将以包含本文的新提交为准，旧 c0818d1 包未包含哈希桶修正，不再作为新服务器配置的完整基线。

## 最小修正

nginx.conf.template 仅在首行新增 map_hash_bucket_size 128;，与原模板比对确认其余字节不变。
64 字符鉴权键使 nginx 1.24.0 的默认 map 哈希桶不足，用户终端曾报 could not build map_hash。
用户补上 128 后 nginx -t 成功、reload 成功、443 监听且本机无密钥返回 401。
依据：https://nginx.org/en/docs/http/ngx_http_map_module.html#map_hash_bucket_size
此修正不改鉴权键、不降低 TLS 或地址保护、不改 RSS 超时与筛选门槛。

域名替换为 rsshub.benzhenlab.com 后，候选 nginx 配置 SHA256：
e3d2bea0eb766668072aab11e9916f30b4975402bbc318daa9fe928d9a166413
该值用于后续服务器只读比对。本轮没有读取服务器文件，因此不能声称运行配置逐字节一致。

## 已有证据及边界

| 项目 | 证据 | 性质 |
|---|---|---|
| 镜像 digest 到位 | 用户镜像 inspect 与 pull 完成截图，匹配固定 digest | 用户操作回传 |
| RSSHub 本机读取 | 5030 字节、5 条，标题/原始链接/日期齐全 | 用户操作回传 |
| 证书 | 域名匹配、密钥公钥匹配；到期 2027-01-23 01:59:59 UTC | 用户操作回传 |
| nginx 修正 | nginx -t 成功；443 监听；无密钥 401 | 用户操作回传 |
| 本机 HTTPS 带鉴权 | 200、0.690222 秒、5 条 RSS | 用户操作回传 |
| 公网无密钥 | 401、TLS_VERIFY=0、2.110084 秒 | 本会话前一轮外部 curl 直接观察 |
| 生产 API 实读 | 尚未取得 | 未验证 |
| 当前 API 承流 SHA/DeployId | 024 仅为历史报告，不能当本轮实时状态 | 未验证 |
| 公网带密钥、重定向与限流正反例 | 尚未完整取证 | 未验证 |
| 长期可用性与证书续期 | 未验收；90 天证书必须续期并更新部署 | 未验证 |

release-candidate.json 已移除已完成的基础设施待办，状态改为 RELAY_READY_API_ACCEPTANCE_PENDING。
runtimeMatchesCandidate 继续为 false，防止将截图行为与当前文件哈希等同。

## 验证与交付

本轮完整 npm run quality 退出 0：954 tests / 948 pass / 0 fail / 6 skipped。
typecheck、knip、deps:check 均通过；lint 为 0 errors / 29 既有 warnings。
npm run build 退出 0；本轮未修改应用源码、依赖、测试或 API 构建输入，未重复 api:build。
模板与父提交逐字节比较，确认只新增首行 map_hash_bucket_size 128;。
门禁日志 quality-rsshub-hash-fix.log、build-rsshub-hash-fix.log 随本轮派生交付留档。
新提交推送后回读 SHA，重新 git archive（关闭 autocrlf）并与所有 Git blob 逐字节比对。
导出和日志放 outputs/rsshub-gateway-alignment-20261025，不含证书、私钥或真实 relay 密钥。

本轮服务器操作 0 次、生产部署 0 次、配置修改 0 次、研究提交 0 次。
后续按 docs/verification/rsshub-api-next-stage-instructions-20261025.md 执行；本轮不继续接入。
