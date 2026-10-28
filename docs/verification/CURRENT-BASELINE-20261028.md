# 当前发布基线 · 2026-10-28

本页记录本轮已有发布事实；本次仅整理文档，不部署、不研究。开发分支 develop 与线上源码分别记录，不将两者等同。

| 对象 | 当前记录 | 证据 |
|---|---|---|
| API | 028，源码 `41761804629795eff2a58ffdf74335fb98b0c716`，任务 `2481492`，normal、100% 承流 | [源码发布报告](api028-source-deployment-report.md) |
| API 回退 | 027；标签 release/api-027 指向 `cf164081e5398be93f30841ba811dca17dc4a2ff` | 同上 |
| Web | Sites58，Sites 源码 `265afcc97a4eab81bd9631a2fd7a0cc07e0d4347` | [能力核对](sites58-diagnostics-capability-20261028.md) |
| Web 发布目标 | 本仓库 b42db40，尚未发布；当前仍为 Sites58 | [发布单](web-release-order-b42db40-20261028.md)、[阻断报告](web-b42-release-blocked-20261028.md) |

## API 配置与验证

API028 未配置 MODEL_PROVIDER、OPENAI_API_KEY、DEEPSEEK_API_KEY，规划与综合走默认确定性路径。此结论仅限 API028；Sites 键名记录中存在 DEEPSEEK_API_KEY，未读其值，不能推断整个 Web 或全部生产环境无模型凭据。

API028 删除 SIGNAL_MAP_DIAGNOSTIC_TOKEN，其余 14 个键沿用。GET /health 为 200；两个诊断入口匿名 POST（无会话、令牌、Origin）均为 404。回退至027时恢复027自身配置（含其诊断令牌）属于预期。

## Web 能力与验收边界

Sites58 已包含 research-diagnostics.tsx 并由首页引用，支持默认折叠的“可能相关／未确认”和零结果原因。此轮为源码核对，线上冻结夹具展示未执行；不宣称页面场景已验收。

## 版本标签

release/api-028 应指向上述4176180源码；标签不代表本轮新增部署。历史基线与演示保留原日期，当前状态以本页为准。

本轮文档门禁：[验证记录](release-records-gates-20261028.md)。
