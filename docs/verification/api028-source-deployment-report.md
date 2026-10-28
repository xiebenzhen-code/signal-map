# API 028 源码发布报告

日期：2026-10-28（香港时间）

## 发布结果
- DeployId：028；平台任务号：2481492。
- 源码提交：41761804629795eff2a58ffdf74335fb98b0c716。
- 部署开始：18:38:33；镜像推送完成：18:45:55。
- 最终实时回读：028 正常、100% 承流、1 实例；027 正常、无承流，保留。
- 单次源码部署成功，未重试；未部署 Web，未发起研究或模型调用。

## 源码冻结
- 519 文件，与 Git blob 逐文件核验，不一致 0。
- 按用户要求排除 .env*，实际排除 .env.example；未上传 node_modules、outputs、日志或工作区改动。
- ZIP SHA256：9b0e2a2052a8db294f23ec89a41c0c2fe0c3444a846dbb4a9ca2ed37b4405231。
- 文件清单 SHA256：5309c75b27421cc540314d83a589d7cb34385c12e5d9ef403134c3b32849cf46。
- 平台解压日志回显源码提交 41761804629795eff2a58ffdf74335fb98b0c716。

## 镜像证据
- tag：signal-map-api-preview-028-20261028183840。
- digest：sha256:a062e4011a755c9e5b0de7d693d503a2897eaee02743e8a20a57cffaea5bbf9d。
- 平台日志将仓库路径掩码；不猜测未回读的完整镜像地址。
- 使用原 Dockerfile、默认 npm registry，无源码或 Dockerfile 修改。

## 配置
028 仅删除 SIGNAL_MAP_DIAGNOSTIC_TOKEN，继承其余 14 个键。未读取或打印值，未逐值比较；只操作目标行并核对键名。028 版本配置回读确认无诊断令牌键。

保留键：NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY、DATABASE_URL、POSTGRES_SSL、PGSSLNEGOTIATION、POSTGRES_CA_PATH、NODE_ENV、PORT、POSTGRES_POOL_MAX、POSTGRES_CONNECTION_TIMEOUT_MS、SIGNAL_MAP_ALLOWED_ORIGIN、SIGNAL_MAP_SERVER_INSTANCE_ID、RSSHUB_BASE_URL、RSSHUB_ACCESS_KEY。
MODEL_PROVIDER、OPENAI_API_KEY、DEEPSEEK_API_KEY 均未出现在键名清单，未新增。

## 验证
目标：https://signal-map-api-preview-323338-4-1408253594.sh.run.tcloudbase.com

| 请求 | 结果 |
|---|---|
| GET /health | 200，status=ok |
| 匿名 POST /api/diagnostics/postgres-transport | 404 |
| 匿名 POST /api/diagnostics/supabase-auth-transport | 404 |

curl 未带会话、令牌或 Origin；三个请求均退出 0。首次沙箱内请求因 DNS 失败返回 000，不视为服务器响应；沙箱外同样请求得到上表结果。详见 postdeploy-checks.json。
当前套餐的手动切流选项触发升级提示，未升级套餐；按用户授权采用自动切流后立即验证。

正式页面 https://signal.benzhenlab.com/ 打开一次，完成账户初始化后顶栏与表单渲染正常。没有点击研究。页面既有零结果为历史记录，不是本轮研究验收。未做登录、退出或业务效果新验收。

## 回退
未触发回退。若需回退：云托管 signal-map-api-preview → 部署版本 → 027 行“回退” → 核对后确认 → 回读 027 正常且 100% 承流。
回退使用 027 自己的版本配置，诊断令牌随该版本恢复，属于已知预期。

## 证据与边界
- freeze-result.json、source-manifest.json：源码身份。
- platform-deploy-log.txt：平台构建及部署日志。
- postdeploy-checks.json：三个匿名检查。
- traffic-final.jpg、formal-page.jpg：最终承流与页面截图。
- 本轮没有重跑完整工程门禁；本次仅执行用户授权的固定提交源码发布和上线检查。
- 健康及入口安全检查通过不代表过滤质量、长期来源稳定性或所有登录行为已经验证。
