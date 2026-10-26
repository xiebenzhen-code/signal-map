# API 027 当前版本审计与受控交付
2026-10-26（香港时间）。本轮为版本核对、离线证据复核、门禁复跑及有限页面检查，不是新增研究验收。

## 结论
产品源码 cf164081e5398be93f30841ba811dca17dc4a2ff 已在公开远端分支 p2n/stability-and-diagnosis。
工程门禁本轮通过；正式网页与内容质量仍有阻断，不能写成“无登录和过滤问题”或“完整端到端 PASS”。
本次交付提交仅添加本文及设计基线，API 027 的产品源码身份继续固定为 cf16408，不重新部署。

## 1. GitHub 实时核对
- 仓库 visibility=public。
- 分支 refs/heads/p2n/stability-and-diagnosis 的远端 SHA=cf164081e5398be93f30841ba811dca17dc4a2ff（追加本文前读回）。
- 默认 master=8be8574b3b5e7e322dc64a830574df31fe36c2f5，未移动 master、未改默认分支、未 force。
- 两个分支 protected=false，仓库 rulesets=[]；该提交的 Actions runs 查询为 0。
- 工作流 .github/workflows/signal-map-agent-loop-e2e.yml 仅 workflow_dispatch，使用 Node 22；含 api:build 与专用 E2E，但没有自动 quality/build 门禁。
- Dockerfile 只有 npm ci 与 api:build，平台能构建 API 不代表执行了完整质量检查。
因此：当前存在人工漏步骤或绕过门禁的流程风险；本轮仅审计，不更改仓库保护设置。

## 2. 本轮运行证据
| 项 | 结果 |
|---|---|
| Node | v24.21.0 |
| npm run quality | exit 0；979 / 973 pass / 0 fail / 6 skipped |
| npm run build | exit 0 |
| npm run api:build | exit 0 |
| test 接入完整性 | 116 个磁盘测试文件=116 个显式登记文件；missing 0 / unlisted 0 |
| 源码构建身份 | 干净 cf16408 解包，507/507 Git blob 一致，mismatch 0 |
| lint | 0 errors / 30 warnings；含既有未跟踪诊断脚本警告，未通过删除文件清零 |

quality 在允许本机回环环境中原样重跑完成。第一次受限环境结果为 979 / 968 pass / 5 fail / 6 skipped；失败位于 proxy-auth-http，包含 EACCES 127.0.0.1 与由此导致的 502。两次日志均保留。
构建复用既有 node_modules，不是一次全新 npm ci 安装验证；没有移除安全 shim。
6 skipped 是 DATABASE_URL 条件用例，数据库持久化与跨账号实时验收仍未在本轮覆盖。

本地证据目录：outputs/api027-audit-20261026/
- quality-verified.log 与 quality-verified-result.json
- build-verified.log、api-build-verified.log 及各自 result.json
- audit-summary.json、browser-home.txt/png、api-health.txt
- quality.log 为首次失败日志，不覆盖为成功
这些日志不随本次公共文档提交上传。

## 3. API 027 与正式网页分开
- 交付报告记 API 027 normal/100%，tag signal-map-api-preview-027-20261026123332；本轮浏览器读取 API /health 得到 status=ok。
- 腾讯云控制台当前显示登录页；没有重新查询承流 DeployId、配置或 digest，健康结果不证明提交/镜像身份。
- 正式网页未随 027 发布；本轮真实 DOM 仍有导航套话、PCB 条目和标题/正文复读。
- 当前网页显示 34 条检索、4 条通过、3 条可阅读，与 027 SSE 的 0 条展示不同。没有同 run 关联，不能据此把缓存/旧结果直接定为 027 回归。
- 本轮 /control 加载后返回首页，资料库入口可达；没有退出重登和切换第二账号。只验证已有会话导航，不判完整登录通过。
- 直接浏览 /api/auth/me 曾出现腾讯云测试域名提示页；这是文档导航观察，未据此推断页面 fetch 登录失败，未读取 Cookie/令牌。

## 4. 这次 SSE 验收遗漏了哪些步骤
源码位置均对应 cf16408：
- backend/handlers.ts:722-743：handleResearchStream 校验会话后直接调用 runResearchPipeline。
- information/research-request.ts:10：正常页面的请求入口为 /api/signals。
- backend/handlers.ts:207 起：handleSignals 建立 requestId、tracer、执行截止时间、身份/范围及调度路径。
- backend/handlers.ts:162-177：输入 industry 与 currentQuestions 分别解析，不自动把行业长句补入 currentQuestions。
- research/query-planner.ts:559：requestedQuestion=input.currentQuestions。
- research/topic-relevance.ts:586-610：广义 AI 题面分支依赖 requestedQuestion 等条件；:115-137 为 topicTerms 提取。

原始 research-sse.log 为 67,114 B：scanned 35、dedup 34、signals 0、topicMismatch 32、lowReliability 2、uncertain 0，requestedQuestion=""，无 requestId。
这不是完整页面 /api/signals 运行，也没有证明调度、记忆读取/写入或完整运行轨迹。
参数与分支缺口已有源码和响应互证；没有同次 clusterText，不把它升级为全部误拒的唯一根因。
无 UNCERTAIN 的样本不能证明该分支线上正确；零正式信号不能验证正式卡片字段/摘要质量。
日期未晚于 fetchedAt 仅是一项时间一致性检查，不是独立日期真值或完整七日范围验证。
实际模型调用与费用未凭账单确认，不把“提交研究”自动等同于付费模型调用。

## 5. 对用户截图的判定
第一张是网站导航/栏目文本，不是有效事件；第二张反复呈现标题和摘要，缺少相对标题有增量的说明。
源码 research/research-pipeline.ts:2342/:2414 中摘要存在回退到 snippet/title 的路径；这说明存在复读的呈现风险，不能单凭源码锁定当前截图来自该提交。
应先解决版本/旧结果关联，再用已有真实材料修清洗与卡片契约；不靠降低可靠性或强行增加结果数量补救。

## 6. 简短后续计划
1. 统一页面、API、请求体和历史结果身份；验证正常登录入口及会话恢复。
2. 离线复用 027 材料，先复现导航污染、标题复读和疑似误零，再做最小修改；独立人工检查内容是否有用。
3. 增加 Node 24 自动 quality/build/api:build 和受保护发布条件。任何跳过、失败、缺证单列，不把 PARTIAL 写成 PASS。
本轮不实施以上修补。源码冻结不等于内容验收结案，不新增行业、来源或系统。

## 7. 范围与原样保留
- 本轮部署 0、线上研究 0、产品规则改动 0、生产配置修改 0。
- 未读取密码、Cookie、令牌、relay key 或环境变量值；未再次注册测试账号。
- 主工作区证书删除、学习文档修改，以及 p2n 工作区已修改的发布手册和两个未跟踪诊断脚本均保留。
- root README 和 README_EN 在代码工作区仍存在；审阅稿未覆盖它们。README 全面替换待单独审定。
- 设计基线见 ../portfolio/CURRENT-BASELINE-20261026.md。
