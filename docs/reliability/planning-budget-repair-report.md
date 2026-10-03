# 规划预算与超时原因修补报告

日期：2026-10-03。基线：HEAD cc65d6e + 当前未提交工作区。

## 结论与根因

本轮离线修补和门禁通过，尚未重启运行服务或提交新的真实研究，不构成反馈后真实研究验收通过。

实际日志中 signals-b80d8c61-a4b1-48af-bce9-d3864f9463e2 的规划约 20644ms，首次检索预算仅剩 435ms，canStartRetrieval=false，没有 search_started。runner 报 WORKER_DEADLINE，服务层又丢失错误码，接口误提示来源暂时不可用。因此本次失败证据支持规划预算耗尽，不支持将其归因 VPN 或来源服务故障。

## 实施范围

- agent/budget-manager.ts：modelPlanningTimeoutMs 上限 8000ms，并预留当前 planningGuard 与 retrievalGuard+1 的较大值；不扩大总 deadline。
- agent/runner.ts：首次、fallback 和后续规划均使用该上限。超时先确定回退，再取消模型 HTTP；沿用已生成的确定性计划。晚到计划不能覆盖最终计划，晚到拒绝由 Promise.race 接收。适配器内部 timeout 也记录 budget_checked / MODEL_PLANNING_TIMEOUT / deterministic_plan 诊断，该事件可通过现有后端日志白名单。
- agent/types.ts、agent/models/types.ts：规划输入可携带 AbortSignal；失败记录支持 retrieval 阶段。
- agent/models/protocol.ts、deepseek-adapter.ts、openai-adapter.ts：外部取消传到真实 fetch，signal 不发往模型提示词；超时覆盖响应头与正文读取，结束后清理计时器。
- research/research-service.ts：无响应的失败保留真实错误码与脱敏原因。
- backend/handlers.ts：WORKER_DEADLINE 显示达到时间上限，不再称来源不可用；HTTP 状态保持 502。
- app/page.tsx：优先显示接口具体 reason，而不是被通用 error 遮盖。
- 四个既有测试文件新增 9 用例：budget-manager、agent-runner、public-alpha-research、model-providers。它们已在全量测试列表，无新增注册或依赖。

未调整证据、相关性、注意力或反馈语义门槛；未改数据库配置、来源、表或迁移。

## 红到绿及实际验证

首批 4 个反例：修补前 3 个断言失败、1 个规划挂起被测试超时取消；修补后全部通过。覆盖预算预留、卡住的规划取消并启动检索、首次检索前超时保留错误码、服务层不替换原因。

新增回归覆盖两家模型取消、响应正文挂起、晚到计划不覆盖、HTTP 超时文案。既有真实延迟的多轮验证检索回归通过。

| 验证 | 退出码 | 结果 |
|---|---|---|
| 五文件专项 | 0 | 77 pass / 0 fail |
| KNIP_DISABLE_RAW_TRANSFER=1 npm run quality（最终代码） | 0 | 678 tests / 673 pass / 0 fail / 5 skipped；typecheck、lint、knip、deps:check 全通过 |
| npm run api:build（最终代码） | 0 | 通过 |
| npm run build（最终代码） | 0 | 通过 |
| git diff --check | 0 | 无空白错误，既有 CRLF 提示保留 |

中间类型失败仅为新增测试使用不存在的 debug.fetch 与未标注 response.json 类型，均已修正。前端构建第一次受沙箱 spawn EPERM 阻止，在允许子进程的环境重跑通过，未调整依赖或规则。最终质量检查在日志接线调整后重跑通过。

独立只读审查未发现阻断缺陷；其提示的默认 8 秒内层超时诊断遗漏与白名单接线已修正。

## 边界与下一步

本轮没有真实研究提交、付费模型调用、真实反馈点击、删除测试记录、commit/push/deploy 或更新交付包。离线用例均使用替身；门禁按现有测试执行，5 skipped 保留。没有重启当前后端，不能声称运行中的进程已加载本轮代码；两个构建产物已更新。

下一轮先核实并重启本项目后端加载当前代码，再以最多两次真实提交完成研究→反馈保存→重开→再次研究消费反馈。每一次请求独立保存脱敏响应、阶段日志、页面与 requestId；若失败，按实际阶段停止，不自动追加修复。只有真实闭环通过才升级该场景结论，不能据此宣称跨行业、长期学习或自主学习已验证。
