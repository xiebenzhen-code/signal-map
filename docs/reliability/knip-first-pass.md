# 里程碑记录（2026-10-03）：knip 首次完整通过

`npm run quality` 首次全链路通过，**包括 knip（此前连续 OOM 失败）**。

| 阶段 | 结果 |
|---|---|
| typecheck | PASS |
| lint | 0 errors / 27 warnings（warnings 需后续单独清理，不计失败） |
| test | 707 tests / 702 pass / 0 fail / 5 skipped |
| **knip** | **PASS（首次）**——此前 oxc-parser ArrayBuffer 内存分配失败（Node 24.20 + 空闲内存 ~2.4GB），本次空闲内存提升后通过 |
| deps:check | 163 modules / 351 dependencies，无违规 |

环境备注：knip 通过与本轮代码改动无关（DoH 修改不涉及 knip 扫描的未使用导出判定路径），根因是**可用内存恢复**——空闲物理内存从 ~2.4GB 升至足够 oxc-parser raw-transfer 分配的水平。此为环境性恢复证据，供后续 knip 排障参考。
