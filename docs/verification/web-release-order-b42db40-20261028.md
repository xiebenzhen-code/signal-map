# 正式 Web 发布单（待用户确认）

状态：仅只读核对与发布准备；未保存新版本，未部署，未改环境变量。

## 已核实现场

- 正式域名：https://signal.benzhenlab.com
- 托管：OpenAI Sites，项目 `appgprj_6a90935d9d048191bc44242ef23b0fb4`，public；平台部署为 Cloudflare Worker。
- 最新保存版本 Sites58：`appgprj_6a90935d9d048191bc44242ef23b0fb4~appgver_00c2e4a4a16c81919cfb00e38eaf10b1`。
- Sites58 部署：`appgdep_6ae0018a715c8191b36830c9984b1446`，publish/succeeded，更新时间 `2026-10-27T01:43:51.470953+00:00`。
- Sites58 源码提交：`265afcc97a4eab81bd9631a2fd7a0cc07e0d4347`；本机 Sites checkout 对应 main 分支。平台返回版本和部署均匹配，但接口没有单独的“当前承流版本”字段，因此发布前再回读版本和部署，防止期间发生新发布。
- `.openai/hosting.json` 指向上述同一项目。`edgeone.json` 只是仓库内另一套构建配置，不能证明正式域名托管在 EdgeOne。GitHub preview/* 为历史开发分支；未查到 master 的工作流配置将正式域名绑定到这些分支。不能把分支名当作线上构建身份。
- Sites55 为历史版本，不再作为本次首选回退目标。
- 环境修订 9，共 10 键；秘密值未输出。非秘密 `API_UPSTREAM_URL` 当前为 `https://signal-map-api-preview-323338-4-1408253594.sh.run.tcloudbase.com`，与已发布 API028 服务一致。

## 发布源与执行（确认后）

1. 使用本地 master 固定提交 `b42db40949bb86825c217154856f708d3a234980`，tree `91442a5e9f0b5a475a79363e02019a83450c4d62`。它是 develop PR 合并提交，包含 ResearchDiagnostics 与对应快照测试。
2. GitHub 实时远端回读本轮被本机代理连接错误阻断；不能声称已实时核实 origin/master。发布前补一次回读，若不符则报告差异，不自动改源。
3. 新建隔离源码准备目录，从固定提交导出并逐文件校验 blob 字节；不上传当前脏工作区，不覆盖旧 Sites checkout。
4. 使用同一项目的新短期源码凭据与官方 site-workflow.mjs、Node24、build-site.mjs。正常推送 Sites 源码，记录 Sites commit SHA 与 GitHub提交/tree 的映射。若 helper 额外修改产品源码则停下核对。
5. 使用构建后的部署 archive 与 Sites commit SHA 保存版本，再部署该保存版本；不以源码 tar 替代部署产物，不用 GitHub SHA 冒充 Sites SHA。
6. 环境变量全部沿用修订9；API_UPSTREAM_URL 已正确，无需修改。不重新部署 API、不改数据库、DNS、服务器，不调用模型或发起研究。

## 验证与边界

- 部署终态必须 succeeded，记录 Version ID、Deployment ID、URL、Sites SHA、构建归档摘要。
- 打开正式页面一次，检查页面与静态资源正常渲染，无自动研究请求。
- 固定提交已有 `tests/research-diagnostics-ui.test.ts`：六类零结果快照、可能相关默认折叠与未确认标识；`tests/coverage-notice.test.ts` 锁定 UNCERTAIN 分流。
- 发布后用隔离浏览器的冻结响应夹具验证正式页面能展示 ALL_UNCERTAIN 原因与可能相关分组；仅拦截本地浏览器响应，不写生产数据库或真实研究接口。若当前浏览器工具不支持安全响应夹具，则改为本地同源构建快照渲染，并明确标注“线上该分支未验证”，不得用旧历史结果冒充新版本结果。
- 冻结数据只验证渲染，不证明真实采集、相关性质量或端到端研究成功。登录行为未执行则标未验证。

## 回退

首选回退 Sites58，版本 ID 如上。使用 Sites deploy_site_version 重新发布该保存版本，观察部署终态 succeeded，再检查正式页面。此次不修改环境，故回退无需配置变更。若发布前出现更新版本，以重新核实的当时正式版本更新回退目标并报告。

本单待用户确认后执行；本轮部署0、环境修改0、研究0。
