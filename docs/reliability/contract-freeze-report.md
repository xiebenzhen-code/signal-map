# 三项剩余契约核对与版本冻结（2026-10-04）

只读核对 + 必要最小修补；研究提交 0；不部署/不打包。冻结基线见文末。

## 契约1：相同部分证据重复出现不推进修订；更强证据才判更新 ✅（发现缺陷并已修）
- **复现（真实数据实锤）**：`pk-98wux9`（Adobe 文章，partially_verified，同 URL 同强度）修订 **34→35**、cls:UPDATES——上一轮验收中"语义修正生效"的 UPDATES 实为**同强度证据复现被推进修订**，属契约违规。
- 链路：`matchPersistedKnowledge` UPDATE → `compareKnowledge` UPDATES → `shouldAdvanceRevision(["NEW","UPDATES","CONTRADICTS"])` → 修订推进。
- **修复**（`agent/evaluation.ts`）：未决（partial/unverified/conflicting）记录的同主张比较加入强度判定——更强（验证等级更高 **或** 带来新源 URL）→ UPDATE；同/更弱且无新源 → **DUPLICATE**（无新信息，不推进修订、不写入）。verified 记录与无快照历史记录行为不变。
- 红→绿：新增 2 用例（同证据复现→NO_INFORMATION_GAIN 红；同源更强验证→UPDATED 守护）→ 6/6；回归 agent-runner/novelty-attribution/research-policy/postgres-memory-e2e/topic-relevance 86/86。

## 契约2：真实数据库日期回填（专用测试身份）✅ PASS
- `scripts/tmp-backfill-contract.ts`：专用合成命名空间（`event/claim/evidence-test-backfill-20261004`），经真实 PostgresSignalRepository 三步验证：
  1. 无日期写入 → `published_at: null`
  2. 同 claim+URL 带日期 → **回填 `2026-09-08T00:00:00.000Z`**
  3. 再次无日期 → **日期保留**（COALESCE 不被空值覆盖）
- `CONTRACT: PASS`；合成行逐层清理（evidence→claim→event），残留 0；真实用户记录未触碰。

## 契约3：本次 3 条候选的准确去向（requestId `signals-f56f937f`，run `agent-run-4c73f402`）
| 候选 | 类型 | 证据 | 注意力 | 最终去向 |
|---|---|---|---|---|
| Adobe 文章（自选来源） | **文章级证据**（industry_media/B，partially_verified） | `evidence-1x1gxx5`（accepted，published_at 待回填） | LIBRARY_ONLY | 知识库 UPDATES（修订推进 34→35，旧语义；本轮已修）→ 入库不展示 |
| gemini-cli fix（上轮遗留） | 文章级（primary/S，pub 09-25） | `evidence-14htpaj`（accepted，触碰刷新 last_seen） | LIBRARY_ONLY | 既有事件保留，无新知识变更、无修订 |
| **Adobe 官方首页**（company-registry 注册条目，authority 95/primary） | **官方首页**（站点级列表壳） | **无证据行**——证据评估拒绝 `insufficientContent: 1` | 无 | 无 claim/无知识变更/无修订 |

**官方首页与文章级证据的区分**：注册表把 Adobe 官方首页真实带入候选池（配置消费再次实证），但首页列表壳在证据阶段因内容不足被拒——文章级证据仍由自选来源文章承担。这一拒绝是内容质量门的正确行为，非缺陷。

## 门禁（冻结基线）
| 检查 | 退出码 | 结果 |
|---|---|---|
| quality（typecheck+lint+全测+knip+deps:check） | 0 | **725 tests / 720 pass / 0 fail / 5 skipped**；knip PASS；163 模块/352 依赖无违规 |
| api:build / build / git diff --check | 0 / 0 / 0 | — |

本轮修改：`agent/evaluation.ts`、`tests/memory-match-semantics.test.ts`（+2）、验证脚本 `scripts/tmp-backfill-contract.ts`、`scripts/tmp-trace-newsroom.ts`。

## 未通过的用户价值场景（冻结时如实列出）
1. **"过去30天值得测试的 AI 剪辑更新"→ 今日阅读 0 条**：Adobe 文章级证据仍为 partially_verified 单来源（可靠性 62<70），官方首页证据被 insufficientContent 拒绝；用户在"今日"看不到该问题的任何可读条目，仅资料库保留。**场景未通过**（门槛如实执行，需更强证据而非放水）。
2. **Adobe 文章的发布日期尚未进入既有证据行**：提取/候选已通、真库回填契约 PASS，但本次运行遗留的 `evidence-1x1gxx5.published_at` 仍为 NULL，需下一次真实运行自然回填——页面时间线仍无法放置该条目。**场景部分未通过**。
3. **修订号历史残留**：`pk-98wux9` 已累积至修订 35（历史缺陷推进）；新契约阻止未来同类推进，历史不回退（不删记录约束）。
4. gemini-cli 遗留事件保留在库（claim 文本质量低，为上轮缺陷遗留数据）；新契约下不再产生增益，不会再被推送。

## 冻结说明
当前工作树为冻结基线（未 commit，按既有约束不提交）：11 个修改/新增源文件 + 测试与存档。门禁全绿（725/720/0/5）。报告后冻结，不再改动。
