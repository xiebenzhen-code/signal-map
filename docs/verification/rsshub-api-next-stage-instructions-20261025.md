# WorkBuddy 下一阶段：RSSHub 接入与一次研究验收

## 目标与输入

将新 Lighthouse RSSHub 接入 Signal Map，完成一次受控发布与一次页面研究验收，完成即停。
读取 AGENTS.md、deploy/rsshub/README.md、release-candidate.json、
rsshub-gateway-alignment-20261025.md，以及本阶段交付的 ZIP 身份记录。
以用户收到的修正后完整候选 SHA 为准；不可直接沿用旧 c0818d1 ZIP。

## 1. 只读核对与停止线

先查 Codex 实时额度：剩余不超过 10% 即保存现场和剩余步骤，停止新操作；
读不到记 UNKNOWN，不用腾讯云资源点替代。不得因该停止线关闭现有服务。
从远端修正候选 SHA 建立隔离工作区，确认完整 SHA、父提交、干净导出与清单一致。
实时读取目标 API 的承流部署、源码/镜像身份、环境变量键名和回退目标；
API 024 仅是历史信息，不预设下一次版本号。
目标新服务器为 lhins-lbffbux2 / 124.220.183.159，勿操作历史 Lighthouse 实例。

## 2. 服务器只读复核

仅查看固定 RSSHub RepoDigest、容器运行状态、端口绑定、nginx -t、证书域名/到期时间。
不得 nginx -T、cat 私钥、打印 rsshub-secret.map、打印 relay 密钥或导出全部环境变量。
服务器网关配置仅输出 sha256sum：
/etc/nginx/conf.d/signal-map-rsshub.conf
预期 e3d2bea0eb766668072aab11e9916f30b4975402bbc318daa9fe928d9a166413。
哈希不同则只读调查差异，不覆盖服务器、不旋转密钥。
本阶段不重装容器、不重新生成证书、不再改 DNS/防火墙。

## 3. 配置与一次受控发布

RSSHUB_BASE_URL=https://rsshub.benzhenlab.com
RSSHUB_ACCESS_KEY 使用服务器已存在的 /etc/nginx/rsshub-access.key 对应值。
由用户通过受保护界面完成密钥写入；不向聊天索取密钥、不生成新密钥、不把它放入 URL。
不存在安全输入通道就停在配置步骤，交付可执行材料。
保留其余生产配置。先确认修改环境变量是否触发发布，避免先 updateConfig 后又 deploy 造成两次发布。

当前 API 运行代码若不支持候选的 X-Relay-Key 行为，不能用旧读取器冒充候选验收。
源码与两项配置应在同一次受控发布中生效；先做可行的候选预检，正式实读放在发布成功后。
只发布 API 一次；不发布 Web、不改域名映射、不合并 master、不打 tag。
关联真实 DeployId/BuildId/镜像 digest，观察同一任务到终态；未知字段保留 UNKNOWN。
构建失败不重试；健康失败或已证明回归按发布前记录回退。正常空结果不自动判回归。

## 4. 目标 API 生产实读（两路各一次）

在目标 API 运行环境使用候选同一 readCustomSource(format=feed) 与 parseRegisteredFeed：
- 36kr-flashes：https://rsshub.benzhenlab.com/36kr/newsflashes?limit=5，鉴权只走 X-Relay-Key。
- geekpark-news：https://www.geekpark.net/rss，按直连来源读取。

保留既有 DNS/DoH、私网/跳转检查、2MiB 限制及 12 秒 reader 上限。
记录所加载 reader/parser 模块哈希、状态、FEED_* 细分码、requestCount、raw/normalized、标题/原始链接/日期。
有代理并不自动变成官方出版社；保留 36kr.com/geekpark.net 的原始出处身份。
成功标准为两路均完成读取解析且 raw/normalized 大于 0；不强求固定条数，不以 HTTP 200 代替解析。
任一路失败即留证停止，不追加研究、不重试、不调超时或安全门槛。
无容器执行通道则提供整段 Webshell 命令，由用户执行；不得拿页面模式 sources/check 冒充 feed 验收。

## 5. 正式页面一次研究

仅两路实读通过、页面可用后，正常浏览器提交一次原题：
“过去7天，36氪快讯和极客公园报道了哪些与国内AI产品或产业有关的新进展？保留原始出处和发布日期，区分已确认信息与待核对线索。”
点击一次即记录；超时/脚本中断后先核对是否已提交，绝不再次点击。
收集 requestId、两路 outcome/请求计数/raw/normalized、候选/信号/观察层数量、
拒绝理由、最终 status/complete 文案和页面截图；必要时只查同一请求的 CLS 日志。
区分读取失败、读取成功但被过滤、证据不足、预算中止。零信号不等于没有新变化。
观察层仍是待核对材料，不能计为已确认答案。此次不验收长期记忆或跨账号隔离。

## 6. 报告并停止

分别报告版本对应、网关配置、API 发布、双路读取、研究内容与页面状态的 PASS/FAIL/BLOCKED/UNKNOWN。
留存脱敏日志、清单和报告；仅提交本轮明确材料，保留无关修改。
费用有实际账单/用量证据才填数值，否则 UNKNOWN。
明确禁止：第二次研究、第二次部署尝试、增加来源、改变筛选门槛、延长超时、
放宽地址保护、修改 Web/Cloudflare、清理任务板或顺带修补。完成或阻断即停。
