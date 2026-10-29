# D06 四项受限修补（2026-10-29）

基线 develop 9c2c4395e9d49e3d36769a29715af347806c4652。Node v24.21.0。未部署、未发起研究、未调用模型、未读取密钥；未降低可靠性和日期阈值。

## 提交与证据
- 对照组 9da1668：D03 OBS 完整诊断 plan + 原始 RSS，10 条。来源为 A-stage sources.json/case-manifest.json/snapshots/obs.xml，捕获 2026-10-20T08:33:33.035Z，RSS SHA256 b195c95b3aba4257ca01d726457aad7428e59754816b7406369bd8639c1489bb。H03 同 attempt 完整输入不可得，Kdenlive 精确捕获时刻不可得，未伪造。没有冻结详情 HTML；正文读取明确不可用。这是当前流水线回放，不是历史端到端复现。
- 冲突 2748883：research/research-pipeline.ts:1256 与 signal-fusion/claim-conflict.ts；仅跨记录的同主体同谓词相反极性触发。裸 incorrect/false 与 CVE 缺陷描述不触发；显式 conflicting 状态仍保留。
- 聚合 15bd849：research/research-pipeline.ts:1209/1246，提取平台、渠道、版本身份，且对全簇成员检查兼容；D06 原始 25 条不再因标题相似聚为五簇。完整流水线另有候选/日期/质量门，不能声称最终返回 25 条。
- 重复 0c254e6：signal-fusion/cluster.ts 的 buildSignalCluster，重复依据同 URL 或归一化可用全文，不再用同域推断重复；同官方域不同公告不因重复标成 NOISE。同内容转载不增加独立来源数；保留全部出处。
- 中文约束 b39bdff：research/topic-relevance.ts:265/282/308，从复合词提取既有任务概念；去除领域/时间/英文功能词；安全更新与浏览器安全得到安全，普通 Chrome Dev 公告不会仅因实体命中通过。

## 红绿验证
所有日志、逐条去向及各提交后 frozen/rebuilt JSON/Markdown 在仓库外：
C:/Users/25186/.codex/visualizations/2026/09/26/01a0deb0-330b-7250-8af8-66d3edbccfbc/d06-four-repairs/

- node --experimental-strip-types --test tests/eval-frozen.test.mjs：红 exit1（初始不支持对照 fixture），绿 exit0。OBS 初始计数预期20已按原始 XML 更正为10，并非产品修改。
- tests/d06-conflict.test.ts：红 exit1，2项失败；与 tests/signal-fusion.test.ts 绿 exit0、17/17。
- tests/d06-event-grouping.test.ts：红 exit1、2项失败，绿 exit0、2/2；提取函数的 Set 转译目标先修正为 ES2022 后再确认红灯。
- tests/d06-source-duplicates.test.ts：先红后绿；真实 D06 同官方站不同公告与同文转载反例，现有融合用例保持通过。
- tests/d06-security-constraints.test.ts：红 exit1、2项失败；与既有 task/topic 用例绿 exit0、28/28。
- 每项提交后：node --experimental-strip-types scripts/eval-frozen.mjs --output-dir <阶段目录>；OBS 追加 --fixture tests/fixtures/d03-plan.json。每次 exit0，networkRequests=0、modelCalls=0。exit0 仅表示回放完成。

## 日期出口与门禁兼容调整（必须披露）
聚合拆分暴露 D06 rebuilt 两条窗口外资料库卡片；OBS 基线本身有四条窗口外卡片。为达到本轮窗口外返回必须0，research/research-pipeline.ts:2236 将已计算的 withinWindow 用于资料库准入，不改窗口数值、不豁免来源。步骤2起两案例两模式均为0；基线与步骤1的 OBS 为4，不能写成全程0。

第一次完整 quality exit1：1068项、1052通过、10失败、6数据库条件跳过，build/api:build均0。没有把失败算通过。
测试后续调整逐项披露：
1. comfyui-pipeline-window、upgrade-context-wiring、feedback-semantics、reliability-positive 的历史9月夹具冻结测试时钟（分别9月22日或10月1日），业务断言不改。不会以当前10月29日解释旧材料。
2. coverage-notice 的25条 UNCERTAIN 展示门用例显式注入 UNCERTAIN：只隔离展示门，保留全部原断言；真实分类另由安全约束测试和完整plan评测验证，不再声称真实D06全部UNCERTAIN。
3. public-alpha-research 的窗口外 BACKGROUND 旧断言改为不得出现在返回卡片；这是本轮严格日期出口的明确行为变化，不把旧预期包装成原样通过。
4. 新安全约束测试 matchedTaskConstraints 可选字段使用可选链，修正类型错误。

## D06 累计对比
正式关注仅 MUST_READ/WORTH_WATCHING；资料库 LIBRARY_ONLY 分列；不以资料库数量冒充正式关注。

| 阶段 | plan | 正式关注 | 资料库 | 可能相关 | 窗口外返回 |
|---|---|---:|---:|---:|---:|
| baseline | frozen | 0 | 0 | 5 | 0 |
| baseline | rebuilt | 0 | 1 | 0 | 0 |
| step1 | frozen | 0 | 0 | 5 | 0 |
| step1 | rebuilt | 0 | 1 | 0 | 0 |
| step2 | frozen | 0 | 0 | 13 | 0 |
| step2 | rebuilt | 0 | 11 | 0 | 0 |
| step3 | frozen | 0 | 0 | 13 | 0 |
| step3 | rebuilt | 0 | 11 | 0 | 0 |
| step4 | frozen | 0 | 3 | 0 | 0 |
| step4 | rebuilt | 0 | 11 | 0 | 0 |

OBS 对照：baseline/step1 两模式0/4/0/4，step2—step4两模式0/0/0/0。OBS全部较旧，不能作为近期有效卡片的正向效果证明。

## 限制与回滚
- 无人工金标，不计算精度/误零率，不声称线上已修复。D06 正式关注仍0。
- 冻结plan与rebuilt语义不同；rebuilt沿用脚本既有queries-only重建路径，不代表历史运行plan，两个模式不可混用作效果分母。
- 冲突解析是保守的显式句式匹配，未覆盖所有语义矛盾；全文重复为精确归一比较，不证明改写转载的独立性。
- 发布身份识别覆盖本次D06的ChromeOS/Android/iOS/Desktop及已列渠道；其他平台表达须另有反例再扩展。
- 无详情HTML，控制集仅一个，不能推导跨行业稳定性。
- 各业务提交可分别 git revert；后续测试/报告提交另列。没有重写历史。

## 最终门禁与推送
Node v24.21.0：quality=0（1068项，1062通过，0失败，6项DATABASE_URL条件跳过、不计通过）；build=0；api:build=0。日志 final3-quality.log/final3-build.log/final3-api-build.log，退出码 final3-gates.json。推送结果另行回读。
