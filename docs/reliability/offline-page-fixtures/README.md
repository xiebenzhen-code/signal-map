# 离线页面呈现验收记录（任务二最终验收）

日期：2026-10-01 · HEAD：`cc65d6e`（工作区未提交改动之上） · 全部为**离线替身驱动**，未发真实研究请求。

## 2026-10-01 追加：建议行动展示验收（app/page.tsx 详情弹窗新增"建议行动"区块后）

| 状态 | 页面观察 | 判定 |
|---|---|---|
| 软件发布（非空 action） | 详情弹窗"解读"之后出现"建议行动"区块："针对该变化做最小验证：* Add transparent background support for GPT Image 2 partner nodes。按证据所指入口实际操作一次，对比变化前后的结果并记录。"——与 fixture 响应的 `action` 字段逐字一致 | ✅ `action-1-software-release.png` |
| 无入口公告（非空 action） | 建议行动："该变化的具体内容已在证据中列出，但当前没有公开可执行入口；建议核查原文确认适用范围，不安排立即测试。"——无"触发一次/运行一个/做最小验证"类运行指令 | ✅ `action-2-no-entry.png` |
| 空.action（置空变体 `empty-action.json`） | 弹窗无"建议行动"标题与空区块，解读/证据/原始来源正常渲染 | ✅ `action-3-empty-action.png` |
| 回归 | 软件列表 v0.37.0/v0.36.0 徽章 ✓、2 条 releases 官方链接锚点 ✓、中性文案未泄漏到软件视图、软件未知条件（商用许可、成本）可见 ✓ | ✅ |

## 驱动方式

1. 用注入替身驱动真实管线离线生成两份完整响应（`software-release.json` / `neutral-announcement.json`，见各自 `_offlineFixture` 标注）。
2. 以替身后端（`scripts/tmp-offline-fixture-server.mjs`，health 返回 `instanceId: "offline-fixture"`）临时替换 :8080，按提交的问题文本返回对应 fixture。
3. 真实前端（vinext dev :3000，当前工作区源码）+ 真实浏览器（ZCode IAB）渲染页面并截图。

## 逐项判定

### 1. 软件发布（fixture: software-release；问题："ComfyUI 最近一个月在 GitHub 发布了哪些版本？有哪些值得升级的改动？"）

| 检查项 | 页面观察 | 判定 |
|---|---|---|
| 版本可见 | 必读卡：蓝色徽章 `v0.37.0` + `2026/9/21`；第二条 `v0.36.0` | ✅ |
| 具体变化 | 卡片标题与摘要为要点原文（"Add transparent background support for GPT Image 2 partner nodes"） | ✅ |
| 来源链接 | 证据弹窗内真实锚点：`来源：GitHub · comfyanonymous/ComfyUI` → `https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0`，另有 "原文 ↗" | ✅ |
| 未知条件 | 为什么值得关注："证据未说明商用许可、成本，升级价值需结合你的使用场景验证。"（v0.36.0 卡另含"硬件与兼容性"） | ✅ |

截图：`page-1-software-release-list.png`、`page-1-software-release-evidence-modal.png`。

### 2. 中性公告（fixture: neutral-announcement；问题："ComfyUI 社区本周例会安排有哪些更新？"）

| 检查项 | 页面观察 | 判定 |
|---|---|---|
| 变化可见 | 标题与摘要："每周项目例会时间由周三 14:00 变更为周四 14:00，自下周一起生效，会议室不变" | ✅ |
| 适用条件 | 为什么值得关注："…请核查原文确认适用范围与生效条件。" | ✅ |
| 无软件文案 | 整页无 升级/硬件/兼容/商用许可 字样（DOM 全文核对） | ✅ |

截图：`page-2-neutral-announcement-list.png`。

### 3. 无执行入口（同 neutral fixture 的公告信号，executionEntry 为空）

| 检查项 | 页面观察 | 判定 |
|---|---|---|
| 提示核查原文 | 为什么值得关注含"请核查原文确认适用范围与生效条件" | ✅ |
| 不建议立即运行 | "不安排立即测试"出现在 API 的 `action` 字段中，**但页面未渲染 action 字段**（证据：`app/page.tsx` 无 action/executionEntry 渲染；详情弹窗 DOM 全文无"可执行入口/立即测试"） | ⚠️ 缺口 |

截图：`page-3-no-entry-evidence-modal.png`（弹窗只呈现 为什么值得关注/事实/证据/解读 四段）。

## 结论

- 第 1、2 项：**页面级通过**。
- 第 3 项：**部分通过**——"核查原文"提示可见（经 whyItMatters），但 `signal.action`（能做什么/怎么验证的明确建议）在前端没有呈现位置。
- 最小修补建议（**本轮未实施**，按任务要求停止）：在详情弹窗"解读"段之前渲染一行"建议行动"，取 `signal.action`（无 `executionEntry` 时自然显示"核查原文，不安排立即测试"），约 5–10 行 JSX；列表卡可保持不变。

## 边界

- 离线回放只证明**呈现**，不证明当前检索能力；`dataOrigin` 字段来自替身标注，不代表真实抓取。
- 本次页面验收材料归属：软件发布 fixture = ComfyUI 版本问题；中性公告 fixture = 虚构例会公告（对齐 ComfyUI 实体仅为通过实体锚定准入）。**均不得用作综合视频工作流问题的验收证据。**
- 保存响应 `acceptance-final-submission-3.json`（requestId `signals-eb0f8d42-aa55-443f-9dec-50cde8b24173`）属 ComfyUI 版本问题的真实历史提交，其呈现为任务二修补**前**的模板句形态，仅作修复前对照。
