# 反馈语义分流与接线验证报告

日期：2026-10-02。范围：当前工作区续作；未提交、未推送、未部署、未更新交付包。

## 起始状态与实施范围

开始时工作区已有类型分流和一份未注册的 feedback-consumption 测试；研究管线存在重复 `for` 引起的缺失右括号，typecheck exit 2。既有测试注入了整个研究响应，未执行真实管线，其两处失败不能证明管线语义缺陷。本轮先恢复语法，再以真实 runAgent + 真实 runResearchPipeline + 注入 HTTP 响应重写接线测试。

保留无关工作区改动。以下是本轮续作文件，不把 HEAD 到工作区的累计 diff 当作本轮改动量。

| 文件 | 本轮处理 |
|---|---|
| agent/runner.ts | 保留已有按类型分流；合并草稿和服务端记录按行去重；带反馈前缀的历史服务端多行记录先归一化再合并 |
| research/research-pipeline.ts | 修复重复循环语法；分词前排除 Changed after evidence 标签记录、去掉 Not useful 标签；普通手写判断仍走原匹配路径；移除未完成的新增强制降级分支，沿用原评分与选择机制 |
| backend/feedback-records.ts | 保存前将标题换行转为空格，保持反馈边界 |
| app/page.tsx | 本地反馈草稿与 POST 标题使用相同换行归一化；未新增页面功能或研究触发 |
| tests/feedback-consumption.test.ts | 11 个真实 runner 与管线接线测试；HTTP 统一注入，禁止真实模型调用 |
| tests/feedback-persistence.test.ts | 加一项多行标题保存契约反例，现 11 项 |
| package.json | 注册 feedback-consumption；注册文件数 82 → 83 |

## 最终消费契约

- KNOWN_INFORMATION → relatedKnowledge / knownInformation → 原有已知事实比较。
- JUDGEMENT → userJudgements，不能只从已知信息排除后丢弃。
- Not useful → 去掉标签后按既有关键词匹配扣分；评分公式保持 min(18, matchedCount × 6)。不承诺每条负向反馈必然变成 LIBRARY_ONLY。
- Changed after evidence → 保留用户判断输入，但不参与无用扣分；不提升可靠性或核验状态。
- 未加标签的手写判断 → 保留原有匹配扣分行为，本轮未重新定义其产品语义。
- TRACKED_ENTITY / TRACKED_EVENT → 保留对应跟踪字段分流，不作为已知事实。
- QUESTION / GAP / NOTE 不进入 knownInformation；其完整消费闭环不属于本轮四类反馈验收范围。

## 有效红→绿

修正测试材料的仓库标题、账号隔离构造，并使用真实候选审计后：10 项中 5 失败 / 5 通过（exit 1）。失败对应 changed_view 扣分、判断重复合并、负向标签误伤无关内容、阅读历史额外扣分、已知信息重复合并。修补后 10/10 通过（exit 0）。

审查发现多行标题续行泄漏；新增两项反例：22 项中 2 失败 / 20 通过（exit 1）。归一化修补后通过。最终相关五文件测试 86/86、0 失败、0 跳过，exit 0。

已知信息被正确过滤时，测试检查真实候选审计的 knownFactPenalty=74 与来源，而不是要求被过滤信息必须展示。新信息测试则明确要求非空版本信号。

阅读历史注入对照：同一标题在 evidenceHistory 中按既有机制判定为读过；加入 changed_view 不再额外扣无用分。该测试是管线注入，不等于当前前端传递了阅读历史：现有 createResearchRequest 明确发送 evidenceHistory 空串，本轮未改该契约。

## 页面实际观察与未完成验收

真实前端 localhost:3000 页面恢复后，显示历史综合视频工作流问题、“检索到 10 条、0 条通过筛选”与空结果；没有反馈按钮所需的真实卡片。本轮只读查看，没有点击研究或反馈，没有使用 demo / fixture / API 直调替代。临时检查标签已关闭，未重启服务。

因此真实按钮 → POST → 数据库保存 → 重开页面 → 下一次真实研究消费：仍未完成。单次真实研究、长期成长及自主学习均不在本轮证明范围内。

## 边界与审查

独立只读代码审查已执行，标准反馈分流及新多行记录归一化无新增阻断问题。旧浏览器草稿若已包含多行 Changed after evidence 字符串，扁平化后仍无法安全区分标题续行与手写判断；本轮不迁移历史本地数据，也不根据续行猜测边界。历史服务端独立记录已归一化兼容。

新增来源、Provider、依赖、库表、migration、真实模型调用、真实研究提交、反馈业务写入、删除测试记录：均为 0。验证使用内存仓库与 HTTP 替身，不连接真实库。浏览器正常恢复产生的后台请求数量未统计，不宣称全部网络请求为 0。

## 最终门禁

| 命令 | 退出码 | 最终结果 |
|---|---|---|
| 相关五文件测试 | 0 | 86 pass / 0 fail / 0 skipped |
| KNIP_DISABLE_RAW_TRANSFER=1 npm run quality | 0 | typecheck、lint、tests 657（652 pass / 0 fail / 5 skipped）、knip、deps:check 全通过；152 modules / 326 deps |
| npm run api:build | 0 | 后端构建通过 |
| npm run build | 0 | 最终前端 Build complete |
| git diff --check | 0 | 无空白错误，只有既有 CRLF 提示 |

5 skipped 为未配置测试数据库的集成测试，不能视为已执行真实数据库验收。knip 开关只作用于验证进程，运行后移除，未写入任何持久配置。

前端构建首次在沙箱内因 spawn EPERM / 原生依赖解析失败 exit 1，原命令在沙箱外重跑 exit 0，无依赖或构建规则修改。多行标题修补后已重新执行最终 quality 与两项构建；不使用修补前的绿色结果替代。

## 结论

本轮语义修补与离线完整接线验证通过。真实页面无卡片，按钮级验收未执行；下一次真实研究消费、长期成长、生产稳定性仍未验收。报告后停止，不自动提交研究或更新交付包。
