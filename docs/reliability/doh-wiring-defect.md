# 接线完整性缺陷记录（2026-10-03）

## 发现
`backend/custom-sources.ts` **缺少上一轮的检查端点 DoH 接线**——文件回到无 DoH import/lookup 注入的状态（与上轮 codemod 报告的"check handler wired to shared DoH"不符）。`source-enrichment/custom-source.ts` 的读取路径接线**仍在**（lookup 经 `getSourceDoHResolver()`）。

**解释**：后端 :8080 当前进程为 `--experimental-strip-types backend/node-server.ts`（源码模式），重启后加载的是当前磁盘文件。磁盘上 `backend/custom-sources.ts` 的接线丢失——可能原因：用户/其他进程在工作区改动间恢复或覆盖（工作区 147+ 改动由多轮构成，`git status` 无法区分）；上轮 codemod 写入后可能被后续文件操作还原。**不做推测性修补**——先记录缺陷。

## 对本轮的影响
- 页面检查端点（/api/sources/check）：**不消费 SOURCE_DOH_URL** → TUN fake-IP 下真实来源会被判 blocked（上轮实测行为）。
- 研究管线路径：`readCustomSource` 的 lookup 接线仍在 → **一旦 check 端点恢复接线，两端即共用同一配置**。
