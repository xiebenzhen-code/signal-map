# 修补后真实验收记录（2026-10-04）

requestId: `signals-f56f937f-4e5e-4ba7-a05f-2f39597a3356`（页面提交 1 次，无重试）
预算：研究提交 1（已用）；运行内模型调用归该次研究；检查端点 0；数据库只读 SELECT 3 轮、无手工写库。

## 一、本轮修补（红→绿）
| 修补 | 文件 | 红→绿 |
|---|---|---|
| 记忆比较语义：仅 `verified` 记录判 DUPLICATE；partial/unverified/conflicting 同主张 → UPDATE（升级不压制）；无快照记录保持旧行为 | `agent/evaluation.ts` | 新测试 4/4（红 3→绿）+ 记忆回归 70/70 |
| Adobe 发布方归属 | `source-registry/sources.json`（company Adobe，aliases adobe/premiere/after effects，domains blog/helpx.adobe.com，newsroom blog.adobe.com，**无 github 仓库——不扩 github 目标**） | 离线消费验证：loader ok、mergeCompanyRegistry 合入、resolver 对固定问题命中 |
| evidence published_at 回填契约 | `information/repositories/postgres.ts`（ON CONFLICT + COALESCE，空值不覆盖） | 15/15（红 1→绿） |

门禁：quality 723 tests / 718 pass / 0 fail / 5 skipped（exit 0）；api:build 0；build 0；git diff --check 0。

## 二、真实验证结果（逐项核对）

1. **无关 Release 排除** ✅：github provider 原始 40 条 → 聚合仅 **3 条**（上轮 21）；本轮 claims 窗口仅 2 条**既有**事件——gemini-cli 条为上轮遗留行的触碰刷新（last_seen），**非新准入**；离线复现证明本轮门判其 `TOPIC_MISMATCH`。
2. **配置真实消费** ✅：`company-registry: searched_with_results, resultCount:1`（上轮 no_results）——Adobe newsroom 候选真实进入管线。
3. **记忆语义在真实运行生效** ✅：`pk-98wux9` classification = **UPDATES**（旧语义下同主张会被判 DUPLICATE 压制）。
4. **日期去向（如实）**：真实 HTML 提取验证 `2026-09-08T00:00:00.000Z (labeled-date)`（真实 CardDate 块）→ 管线候选带日期；但既有 evidence 行 `published_at` 仍 NULL——upsert 缺陷本轮已修契约，**旧行回填在下一次研究运行时由 COALESCE 自然完成**（本轮研究预算已用完，未手工改库）。
5. **分数不预设** ✅：Adobe 可靠性 62 < 70（partially_verified 单来源），今日队列如实 caught_up（0 必读/可用更新）——门槛执行而非达标宣称。
6. 页面新文案上线（截图 `post-repair-acceptance-page.png`）："已保留到本次结果与资料库；是否出现在今日阅读列表取决于相关性、时间与证据，请以今日卡片为准。"

## 三、边界
- 旧行 published_at 回填与 Adobe 条目是否进今日队列，留待下次真实运行自然验证。
- 未 commit/push/deploy/打包；未删测试记录；未放宽任何门槛。
