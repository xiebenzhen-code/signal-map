# Sites58 能力核对（2026-10-28）

只读源码核对，未新增发布、研究或模型调用。

- 项目：`appgprj_6a90935d9d048191bc44242ef23b0fb4`；URL：https://signal.benzhenlab.com
- Version ID：`appgprj_6a90935d9d048191bc44242ef23b0fb4~appgver_00c2e4a4a16c81919cfb00e38eaf10b1`
- Deployment ID：`appgdep_6ae0018a715c8191b36830c9984b1446`；既有发布状态 succeeded。
- Sites 源码：`265afcc97a4eab81bd9631a2fd7a0cc07e0d4347`，独立 Sites Git 仓库提交，不能当作本仓库祖先。

## 源码证据

在该提交的 `app/components/research-diagnostics.tsx`：5–11 行定义六类中文零结果原因；18 行在 displayedCount 为零时调用 explainZeroDisplay；31–32 行渲染原因；28 行读取 possibleRelated；43–51 行使用默认折叠的 details 渲染并标注“未确认”。

`app/page.tsx:63` 导入 ResearchDiagnostics；1718 行附近在非加载、无错误且 response 存在时渲染，传入 filteringSummary 与 coverage.outcomes。

结论：Sites58 已有“可能相关”和零结果原因的渲染能力。未执行线上冻结夹具展示验收，不代表任意真实响应一定带有相关数据。

## 目标 b42db40 新增的九个文件

- `.github/workflows/build-api-image.yml`
- `docs/verification/api028-deployment-order-pending.md`
- `docs/verification/api028-release-manual-20261027.md`
- `docs/verification/develop-e7d1b2b-gates-20261028.md`
- `docs/verification/n4-closeout-20261026.md`
- `source-enrichment/detail-reader.ts`
- `tests/detail-fetch-safety.test.ts`
- `tests/fixtures/detail-read.ts`
- `tests/specialized-detail-safety.test.ts`

这些组件并非本次目标新增文件。完整前置对比与停止原因见 [Web 阻断报告](web-b42-release-blocked-20261028.md)。
