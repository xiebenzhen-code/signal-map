<!-- README_SYNC: source=p2n/stability-and-diagnosis-N4-working-tree; review-draft=v2; updated=2026-10-26 -->
<p align="center">简体中文 · <a href="./README_EN.md">English</a></p>

# Signal Map

围绕一个问题读取公开材料，按时间和相关性过滤，保留出处和筛选理由。拿不准的放进“可能相关”，不当作结论；没有结果时说明原因。

面向需要在大量公开信息里做初步判断的独立开发者和创作者。

**亮点**

- **有预算和截止时间的研究工作流**：规划实体、时间窗口与排除条件，读取与处理受执行预算和截止时间约束。
- **公网读取安全**：公网地址预检、DNS 解析后固定已验证地址、逐跳校验重定向，中继凭据只经同源请求头传递，不进入 URL。
- **UNCERTAIN 分流、“未确认”标识与零结果解释**：不确定材料进入默认折叠的“可能相关”并标注“未确认”，不计入正式结果；无展示结果时给出分类原因。

[试用入口](https://signal.benzhenlab.com/) · [反馈问题](https://github.com/xiebenzhen-code/signal-map/issues)

**状态：** 受限试用；本稿对应本地 N4 候选，线上是否包含这些修改以发布记录为准。其余限制见[已知局限](#已知局限)。

## 演示

仓库内有一段真实录制的演示视频：[`signal-map-demo.mp4`](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/signal-map-demo.mp4)（1920×1080，约 50 秒，无音轨），说明见 [`DEMO.md`](https://github.com/xiebenzhen-code/signal-map/blob/5142a6705b7cdb5f3b133d6a9567da9256019182/docs/portfolio/DEMO.md)。

| 项目 | 内容 |
|---|---|
| 录制日期与版本 | 2026-10-21；正式域名，Sites53 + API019。早于 N4 候选，**不包含** N4 的“可能相关”与零结果说明界面 |
| 研究问题 | 过去 30 天 Kdenlive 的维护更新（发布日期、适用版本、官方链接） |
| 结果 | 扫描 20 条，聚合 18 个信号，**展示 0 条**；详情抓取 5 次，成功 4 次。该问题的最终答案质量未通过 |
| 画面性质 | 真实浏览器画面，一次研究提交，没有伪造候选或计数；等待片段 2 倍速 |

尚无 N4 候选的新录制或 GIF，此处不使用示意图代替。N4 界面的静态渲染快照仅是测试夹具，不是生产页面截图。

## 评测与工程验证

两类证据性质不同，不互相替代。

### 人工效果评测

**尚未建立人工金标**，因此没有误零率、漏检率、展示精度或人工一致率可报告。也没有用户研究证明能减少信息焦虑。

- 历史国内 AI 单次研究：极客公园 30 条、36氪 5 条，去重后 34 条，返回 2 条信号。单次记录不能证明持续稳定或答案正确。
- 压缩比（输入条数与展示条数）只反映数量变化，不能单独证明过滤有效或焦虑减轻。

### 软件测试（本地 N4 候选）

2026-10-26，N4/N5 候选（提交 `cf16408`）在 Node.js 24 下：`npm run quality`、`npm run build`、`npm run api:build` 均退出 0。测试 **979 项，973 通过，0 失败，6 项因数据库测试环境条件跳过**。这是工程回归结果，不是覆盖率，也不是线上成功率。

- **D06 展示门控单测**：用冻结的 Chrome RSS 正文，25 条判为 UNCERTAIN；其余评分为受控输入，用于执行实际的两道展示门。结果为正式 0、可能相关 25，原链接保留。这不是生产端到端验收，也不评估过滤质量。
- 6 份界面组件静态渲染快照覆盖六类零结果原因、默认折叠与“未确认”标识。

依据见 `docs/verification/n4-closeout-20261026.md`。本稿为文档整理，未重新运行测试或产品功能。

## 快速运行

<!-- 发布前：分支已推送（cf16408）；需在全新克隆中实测下列命令，并决定是否固定为 git switch --detach cf16408。 -->

运行应用需要 Node.js ≥ 22.13（`package.json` 要求）；完整测试（`npm test` / `npm run quality`）需要 Node.js 24，Node 22 不支持测试脚本所用的 `--test-isolation=none`。需要自行准备认证与数据库配置；真实研究可能产生外部服务费用，不要连接生产库做测试。

<details open>
<summary>PowerShell</summary>

```powershell
git clone https://github.com/xiebenzhen-code/signal-map.git
Set-Location signal-map
git fetch origin
git switch --track origin/p2n/stability-and-diagnosis
npm ci
if (!(Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
npm run api:build
```

终端 1（API，默认端口 8080）：

```powershell
node --env-file=.env.local dist-api/server.mjs
```

终端 2（Web）：

```powershell
$env:SIGNAL_MAP_FRONTEND_RUNTIME = "node"
$env:API_UPSTREAM_URL = "http://127.0.0.1:8080"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

</details>

<details open>
<summary>bash</summary>

```bash
git clone https://github.com/xiebenzhen-code/signal-map.git
cd signal-map
git fetch origin
git switch --track origin/p2n/stability-and-diagnosis
npm ci
[ -e .env.local ] || cp .env.example .env.local   # 已存在则保留
npm run api:build
```

终端 1（API，默认端口 8080）：

```bash
node --env-file=.env.local dist-api/server.mjs
```

终端 2（Web）：

```bash
SIGNAL_MAP_FRONTEND_RUNTIME=node API_UPSTREAM_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

</details>

访问 http://127.0.0.1:3000。页面能打开不代表账户、数据库和外部来源已配置成功。数据库迁移为单独命令（`npm run db:migrate`），请在了解目标库后自行执行。内部接口不是稳定的公共 SDK。

## 架构与模型使用

```text
用户问题、时间与排除条件
  → 规划与预算
  → 安全读取 / RSS 与 Atom 解析
  → 日期、相关性、去重与信号聚合
  → 正式结果 / 可能相关 / 待判断材料
  → 原文、来源读取状态与筛选说明
```

Web 使用 React / vinext，独立 API 使用 Node.js，认证使用 Supabase Auth，账户数据使用 PostgreSQL。日期、去重和安全检查主要由确定性代码承担。

**模型角色（源码）**

- **规划**：生成紧凑 JSON 研究计划（最多 5 条查询），与确定性计划合并去重。
- **综合**：生成证据约束的结论，事实性结论必须引用已有证据编号，并经校验；校验发现问题时最多再调用一次修正。
- **配置入口**：`MODEL_PROVIDER`（`openai` 默认或 `deepseek`）；规划与综合模型分别由 `OPENAI_MODEL` / `OPENAI_SYNTHESIS_MODEL` 或 `DEEPSEEK_MODEL` / `DEEPSEEK_SYNTHESIS_MODEL` 指定；单次请求超时 `MODEL_REQUEST_TIMEOUT_MS`，默认 8000 ms。
- **失败兜底**：未配置密钥、超时、出错或返回无效时，规划沿用确定性计划，综合使用确定性回退结果；`MODEL_PROVIDER` 无法识别时返回配置错误。规划另受剩余预算限制。通常没有可靠证据时不调用综合模型，但存在未解决的证据冲突时仍可能调用，以保留冲突状态。
- 以上是源码默认值和配置入口，不代表线上实际使用的模型。

**长期记忆**：账户知识的保存、研究时的选择接线、跨次对结果质量的实际改善是三件事。前两者已有实现与测试；第三者尚未完成效果验收。

**来源目录**：18 路静态订阅源 + 1 路按配置启用的 RSSHub 中继。目录数量不等于持续可用来源数，也不是独立事实核验机构数。

| 使用方向 | 来源示例 | 当前边界 |
|---|---|---|
| 国内 AI 产品与产业 | 极客公园、36氪快讯 | 近期试用重点；有单次真实读取记录，未证明长期稳定 |
| 影视与创作软件 | Kdenlive、OBS、Krita | 只代表这些工具的发布信息 |
| 电商与开发工具 | Shopify、WooCommerce、Node.js、GitHub、Chrome | 各来源验收程度不同；开发公告不等于业务适用结论 |
| 科技、游戏与航天 | IT之家、少数派、InfoQ、开源中国、机核、NASA 等 | 已登记，不能据此宣称各行业有效 |

- **极客公园**：使用其官方 RSS 入口；媒体报道不自动等于事实已确认。
- **36氪快讯**：有历史成功记录；经独立 RSSHub 服务与 HTTPS 鉴权网关接入，**当前中继可用性待复验**。只取最新 5 条，不代表过去 7 天的完整信息。

## 已知局限

- **状态与发布**：N4 本地候选不等于线上已更新；历史部署记录不代表当前承流版本、网络配置或诊断入口状态。
- **评测**：无人工金标；误零率、漏检率、展示精度未知。D06 为展示门控单测，不是生产验收。
- **来源**：来源可达性不稳定且逐源不同；36氪中继待复验；新增行业需要合适来源和单独验收。
- **行为变化**：UNCERTAIN 不再进入正式结果，正式条数可能下降，材料移入“可能相关”。不应把数量下降直接视为回归或改善。
- **记忆**：跨次记忆是否改善研究质量，尚无验收。
- **运行时**：生产 Dockerfile 仍使用 Node.js 22；完整测试脚本需要 Node.js 24，Node 22 无法运行。
- **范围**：自媒体选题和广泛社媒采集为后续方向，不是已交付能力。不承诺持续自主运行；可选模型能力需单独配置，并可能产生费用。
- **演示**：现有视频录制于 N4 之前，展示的是旧版的零结果案例。

## 维护状态与许可证

计划在受控发布和一次页面复验后冻结展示基线；其后边求职边维护：记录问题，在开发分支验证，再决定是否更新冻结版本，不承诺更新频率。

仓库保持公开，但目前**没有项目级 `LICENSE`**，公开源码不等于已授予开源许可；本稿不声明 MIT 或其他协议。第三方依赖与素材遵循各自许可。反馈请附脱敏版本、请求编号及预期行为，不要提供密码、Cookie 或密钥。
