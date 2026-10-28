# API028 部署单（待用户确认，不执行）

日期：2026-10-27。

- 当前本地候选：`41761804629795eff2a58ffdf74335fb98b0c716`，父提交 `439c7fc3acfcba80b0e493128d5709440199fa47`；仅 Dockerfile 的 NPM_REGISTRY 参数变更。未推送。新源码清单与镜像身份仍待成功构建后重建，不沿用旧身份。
- 服务：CloudBase Run `signal-map-api-preview`，环境 `signal-map-prod-d7feg55r886aa857`。
- 回退参照：027；真正发布前重新只读确认承流与可回退状态。
- 镜像：改由本文件末节的GitHub Actions构建并推送；地址及digest待实际运行后填写。失败构建的tag不代表已有镜像。当前未推送镜像、未创建028、未切流。

## 028 环境变量变更

从027版本配置继承，**只删除 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` 一个键**，不以掩码代替值，不读取明文。以下14键及值原样保留：

1. NEXT_PUBLIC_SUPABASE_URL
2. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
3. DATABASE_URL
4. POSTGRES_SSL
5. PGSSLNEGOTIATION
6. POSTGRES_CA_PATH
7. NODE_ENV
8. PORT
9. POSTGRES_POOL_MAX
10. POSTGRES_CONNECTION_TIMEOUT_MS
11. SIGNAL_MAP_ALLOWED_ORIGIN
12. SIGNAL_MAP_SERVER_INSTANCE_ID
13. RSSHUB_BASE_URL
14. RSSHUB_ACCESS_KEY

以上来自既有027实时核对记录，本文件没有重新读取生产配置。历史核对中 OPENAI_API_KEY、DEEPSEEK_API_KEY、MODEL_PROVIDER 均不存在；不新增。

## 批准发布前的本地条件

构建退出0；记录源码提交、清单哈希、镜像ID/本地RepoDigest（不存在则明确记录）；本地容器不注入生产配置或令牌，验证 GET /health 为200，两个匿名诊断POST均404。未完成项不得当作通过。

## 获批后的免费验证

- 028状态 normal、承流100%，镜像身份与批准版本一致。
- GET /health：200。
- 匿名 POST /api/diagnostics/postgres-transport：404。
- 匿名 POST /api/diagnostics/supabase-auth-transport：404。
- 两个POST不带会话、诊断令牌、Origin。200立即回退027；401及其他状态停止并报告；403核对是否误带Origin。
- 正式页面打开一次，确认基本渲染；Web为独立发布对象，本次不发布Web，页面打开不能证明登录或研究效果。
- 不发研究，不执行付费端到端。

回退027会恢复027原有诊断令牌配置，属于已授权的预期行为。部署需用户另行确认，本单本身不构成执行动作。

## 本地RSSHub

只读 `docker inspect` 确认 `signal-map-rsshub-pilot-20261023` 的绑定为 `127.0.0.1:1201 -> 1200/tcp`，已经满足仅回环要求。本轮未重建、启动或修改该容器。


## 2026-10-28：改为 GitHub Actions 构建镜像（尚未运行）

上述本地构建路径由本节替代。工作流 `.github/workflows/build-api-image.yml` 只允许 workflow_dispatch，输入完整提交SHA。Node24依次执行npm ci、quality、build、api:build，全部成功后才检出同一SHA构建linux/amd64镜像。Dockerfile默认官方npm源，不传NPM_REGISTRY。

仓库管理员预先设置变量TCR_NAMESPACE与secrets.TCR_USERNAME/TCR_PASSWORD；不要把值写入文档。镜像地址为 `ccr.ccs.tencentyun.com/<TCR_NAMESPACE>/signal-map-api:<完整SHA>`，禁止latest。运行后从任务摘要填写：
- 源码SHA：待实际手动运行输入后记录；本任务基线41761804629795eff2a58ffdf74335fb98b0c716。
- 镜像地址：待运行后填写。
- 镜像digest：待运行后填写，必须由构建推送输出取得，不用tag替代。

部署方式改为CloudBase控制台按镜像部署，优先使用已记录的image@sha256:digest；保留原有本地健康/诊断验证及发布前确认要求。028只删除SIGNAL_MAP_DIAGNOSTIC_TOKEN，其余14键及值原样保留，回退027恢复其旧配置。免费验证与页面打开步骤不变。本轮不运行工作流、不登录仓库、不推镜像、不部署、不发研究。

注意：手动工作流通常需先存在于默认分支才会显示触发入口；本任务不推master、不合并。由用户审阅并按仓库流程引入后再运行，当前本地提交不代表远端可触发。

