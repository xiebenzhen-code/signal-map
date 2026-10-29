# 候选 ID 修复与冻结回放

基线：develop `49b204181aeac8f6ad326d6670c560c8ce10bd63`。Node v24.21.0。本轮不部署、不研究、不调用模型、不改阈值或数据库，不推 master。

## 修改

- `research/research-pipeline.ts:1274–1292、2390`：候选 ID 改为归一化 URL 的确定性 64 位指纹。沿用现有 URL 去重口径：移除 fragment，URL 标准化 host/default port，保留 path/query 大小写与标点。链接无法解析时，使用 JSON 编码的来源、标题、发布时间组合。
- 仅替换候选生成处的 ID；`unique()`、`clusterEvents()`、候选容量、判断阈值、时间门禁原样保留。
- `tests/candidate-dedup.test.ts`：新增 5 项回归，原 3 项断言不变。该文件已在 npm test 列表中，无需修改 package.json。

根因：同标题、不同链接的公告原本通过 URL 去重与事件聚合，随后标题哈希产生相同 ID，被 candidate-selection 的 seenIds 再次去重。不是抓取失败或相关性误拒。

## 红绿与门禁

- `node --experimental-strip-types --test tests/candidate-dedup.test.ts`：旧调用表达式确认红灯（退出 1，3 通过、5 失败）；修复后退出 0，8/8、无跳过。
- 覆盖同标题不同 URL、同归一化 URL、有效 path/query 区别、无链接时三字段回退；完整离线流水线验证 D06 chrome-14/chrome-15 在 frozen/rebuilt 中有不同返回簇，窗口外返回为 0。
- 首轮 quality 在 typecheck 发现 BigInt 字面量不兼容当前 TS target；改用 BigInt 构造函数后重新运行完整三项门禁。哈希算法及结果未改变。
- 最终 quality/build/api:build 均退出 0。全量 1106 项：1100 通过、0 失败、6 项 DATABASE_URL 条件跳过（不计通过）；lint 0 errors、29 warnings。`git -c core.whitespace=cr-at-eol diff --check` 退出 0。CRLF 行使用仓库现有口径校验，不把行尾 CR 当空白错误。

## 8 个案例的 ID 重复丢失条目数

计数来自 `onCandidateSelectionAudit` 的 duplicate 标记，并对其 clusterMembers 求条目数；不是按缺失返回行猜测原因。相同 case 的 frozen/rebuilt 独立回放。

| 案例 | 实际读取条目数 | frozen 修复前→后 | rebuilt 修复前→后 |
|---|---:|---:|---:|
| D01 Kdenlive 维护 | 20 | 0→0 | 0→0 |
| D02 Kdenlive 无任务约束 | 20 | 0→0 | 0→0 |
| D03 OBS | 10 | 0→0 | 0→0 |
| D04 Krita | 20 | 0→0 | 0→0 |
| D05 WooCommerce | 12 | 0→0 | 0→0 |
| D06 Chrome | 25 | 5→0 | 5→0 |
| D07 InfoQ | 20 | 0→0 | 0→0 |
| D08 36氪/极客公园 | 10 | 0→0 | 0→0 |

全部 32 次运行（8 案例 × 2 模式 × 前后）的窗口外返回卡片数均为 0，实际网络请求与模型调用均为 0。

## D06 人工标注对比

使用用户完成的原表，未改其字节；沿用已确认的标签别名与第七条选择，材料不足不进入相关指标分母。

| 指标 | frozen 前→后 | rebuilt 前→后 |
|---|---:|---:|
| 主卡命中 | 0/1→0/1 | 0/1→0/1 |
| 主卡必看召回 | 1/2→1/2 | 1/2→1/2 |
| 折叠必看召回 | 0/2→1/2 | 0/2→1/2 |
| 值得关注必看召回 | 0/2→0/2 | 0/2→0/2 |
| 必看召回合计 | 1/2→2/2 | 1/2→2/2 |
| 折叠噪声 | 2/2→3/5 | 5/9→7/13 |
| 人工必看/可看未被展示 | 8→6 | 4→2 |
| 抓取数/主卡数 | 25/1→25/1 | 25/1→25/1 |

召回改善不代表已解决语义优先级：第七条仍在折叠，不是主卡；新增可见材料也会带回用户标为可忽略的公告。未展示计数包含窗口外背景分歧，不据此降低日期门槛。

## 其他标题身份用法（仅盘点，未修改）

- `research/research-pipeline.ts:1265、2091`：旧 stableEventId 仍用于融合 evidenceId（标题哈希 + 簇内 index）。不是本次候选选择 ID；跨簇的证据身份仍值得单独核查。
- `information/observation.ts:95`：拒绝样本观察层按归一化标题分组，同标题样本可被合并。
- `research/research-pipeline.ts:965`：早期 URL 无法解析时的去重回退键为标题+日期，未含来源。本轮按要求不改变该去重规则。
- `agent/research-run-state.ts:29`：sourceUrl/id 都不存在时，使用标题+出版方作为轮次合并的最终回退。不是无条件标题唯一键。

## 证据与复现

仓库外产物目录：发布工作区的同级目录 `candidate-id-repair-20261029/`。

- `input-manifest.json`：8 案例完整 plan、原始快照 SHA256、时钟依据。
- `before/summary.json`、`after/summary.json`：16 行模式结果；各 case 的 results.json 包含候选选择审计。
- `before/comparison-final/`、`after/comparison-final/`：D06 对比汇总与 PRIVATE 逐条差异。
- `annotation-integrity.json`：用户标注 SHA256 及未修改确认。
- 同级 `candidate-id-replay-20261029.mjs` 和 `candidate-id-comparison-20261029.mjs`：离线回放与真实标注对比入口。before 使用 git show 49b2041 的流水线模块，仅重写 import 为绝对路径，其余依赖与 after 相同。
- 同级 `candidate-id-red-confirmed-20261029.log`、`candidate-id-green-20261029.log`、`candidate-id-final-*.log/.exit`：命令结果。

## 局限、风险与回滚

- 这是当前流水线对冻结材料的回放，不是历史线上全过程。没有冻结详情 HTML，详情读取明确失败并保留 RSS 摘要；翻译关闭，未读取生产配置值。
- D01/D02 原诊断时钟为日期末尾假设，并非精确抓取时间。D08 使用历史 RSSHub 极客公园快照，映射到当前官方源解析器；中继使用仅供内存夹具的假配置，两路均实际读到快照，不访问真实服务器。不能据此判断当前来源在线可用性。
- 候选 ID 会与历史标题 ID 不同；未迁移旧库、未验证历史记录跨版本身份衔接。已有 URL 身份路径保留，线上影响需另行验收。
- 64 位指纹有理论碰撞可能，不作为密码学安全保证；没有通过新增标题规则规避样本。
- 回滚本次提交即可；不需要改配置或数据库。

## 本次涉及的概念

实体身份与显示标题分离、归一化 URL、候选去重与事件聚合的边界；冻结回放、人工真值对比、召回与噪声的取舍。
