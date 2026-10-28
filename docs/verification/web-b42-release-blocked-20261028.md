# Web b42db40 发布收口

结果：前置源码比较通过，Sites 源码通道阻断，未保存版本、未部署。

## 前置核对

- 主仓库无 `265afcc97a4eab81bd9631a2fd7a0cc07e0d4347` 对象；merge-base --is-ancestor 退出128，不得解释为已经证明“不是祖先”。
- 从 Sites checkout 读取该提交的516文件，与 master `b42db40949bb86825c217154856f708d3a234980` 的525文件比较 Git blob：旧文件缺失0，不同21，目标新增9。
- 不同文件：Dockerfile、package.json、README.md、README_EN.md；research/research-pipeline.ts；source-enrichment/custom-source.ts、detail-enricher.ts、resolvers/hugging-face.ts、resolvers/product-hunt.ts、safe-url.ts、types.ts；source-registry/feed-catalog.ts；tests/budget-allocation.test.ts、detail-enrichment.test.ts、detail-selection.test.ts、evidence-entry.test.ts、registered-feeds.test.ts、reliability-positive.test.ts、source-enrichment.test.ts、wrapper-correspondence.test.ts、wrapper-resolution.test.ts。
- app/、lib/、backend/ 无差异或缺失。其余产品差异逐段核对为候选的安全读取、多来源及内部测试注入口修补，未发现 Sites 独有产品改动被候选遗漏。
- 固定目标 tree：`91442a5e9f0b5a475a79363e02019a83450c4d62`。GitHub 实时回读本轮仍受代理阻断，采用用户批准的本地 tree 口径。
- 明细：`C:/Users/25186/.codex/visualizations/2026/09/26/01a0deb0-330b-7250-8af8-66d3edbccfbc/web-b42-precheck.json`。

## 发布尝试

使用新短期凭据，通过官方 site-workflow.mjs 在新隔离目录打开同一 Sites 项目。Node v24.21.0。代理仅设置在助手进程环境，不写入仓库。助手在源码 ls-remote 阶段失败：无法通过127.0.0.1代理连接 git.chatgpt-team.site:443；独立TCP检查确认7897端口无法连接。停止助手，无提交、推送、构建或部署。

隔离目录：`C:/Users/25186/.codex/visualizations/2026/09/26/01a0deb0-330b-7250-8af8-66d3edbccfbc/web-b42-release-20261028`。仅初始化.git，HEAD尚不存在。凭据未保存到文件，后续需重新申请。

## 版本与验证

- 再次回读最新仍为 Sites58：`appgprj_6a90935d9d048191bc44242ef23b0fb4~appgver_00c2e4a4a16c81919cfb00e38eaf10b1`。
- 既有 Deployment ID：`appgdep_6ae0018a715c8191b36830c9984b1446`。本轮无新Deployment ID。
- 既有 Sites SHA：`265afcc97a4eab81bd9631a2fd7a0cc07e0d4347`。目标 GitHub b42db40 尚未生成 Sites 提交映射。
- 新版页面与冻结夹具：NOT RUN，不能认定新版本显示通过。
- 未改现有环境、API028、数据库、DNS；研究0。

## 续接与回退

恢复可用的 Sites Git 网络通道后，重新申请短期凭据并按既有发布单继续；不重复申请站点。发布前复查当前正式版本。当前未切换，无需回退；若后续发布失败需回退，重新部署上列Sites58保存版本并核对终态。
