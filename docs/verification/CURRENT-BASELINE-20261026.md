> 历史记录：当前发布状态见 [2026-10-28 基线](CURRENT-BASELINE-20261028.md)。

# CURRENT BASELINE — 2026-10-26

本文件是本轮工作的**基线权威记录**。若其他文档中的提交号、分支或门禁数字与本文冲突，以本文为准；
本文未覆盖的范围一律按 `UNKNOWN` 处理，不得推断。

## 1. 版本身份

| 项目 | 值 |
|---|---|
| 仓库 | `https://github.com/xiebenzhen-code/signal-map` |
| 分支 | `p2n/stability-and-diagnosis` |
| 创建本文件时的 HEAD | `0ed7a6a7279b6a5843d115d23bc0a13c058aabb8`（见下方说明） |
| API 027 产品源码提交 | `cf164081e5398be93f30841ba811dca17dc4a2ff` |
| 最近交付文档提交（0b 之前） | `d45cf54cc206810d13a2cc15bfc69653fa8e4f38` |
| 本地缓存 `origin/master` | `8be8574`（仅本地引用，未实时回读） |

**关于 HEAD 的说明**：本文件自身也是一个提交，因此无法在内容里写入包含自己的哈希。
上表的 HEAD 指**写入本文件之前**的分支头。核对方式：`git log --oneline -1 -- docs/verification/CURRENT-BASELINE-20261026.md`
给出本文件的提交，其父提交应等于上表 HEAD。

## 2. 已作废/不可用的基线引用

| 引用 | 状态 | 说明 |
|---|---|---|
| `e5e7439` | **不可解析** | 当前对象库中不存在（`fatal: Not a valid object name`）。此前任务书中把它列为「最近交付文档提交」，该引用作废，不再使用。 |
| 旧 `master` (`8be8574`) | 不作为基线 | 仅作拓扑比较，落后本分支 8 个以上提交，不能代表当前产品源码。 |
| 更早的 `README_SYNC: source=eb6666d` | 仅作历史参考 | 该标注对应 2026-10-22 的文档快照，早于 API 027。 |

`cf16408` 仍然是 API 027 的唯一产品源码身份；任何「API 027 源码」的表述都必须能追到该提交。

## 3. 本轮门禁（Node 24）

执行点：`0ed7a6a`（0b-3 与 0b-4 全部落地之后，本文件写入之前）。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run quality` | **0** | 986 项测试：980 通过、6 条件跳过、0 失败；lint `30 problems (0 errors, 30 warnings)`；typecheck / knip / deps:check 通过 |
| `npm run build` | **0** | vinext build 完成 |
| `npm run api:build` | **0** | `dist-api/server.mjs` 产出成功 |

- 条件跳过的 6 项**不计作通过**，原因是数据库测试环境缺失。
- 测试数量不是覆盖率，也不是真实用户研究次数。
- 本文件只记录上述执行点；此后若再改动代码，必须重新执行并更新本表。

## 4. 本轮已落地的行为变更（供后续阶段引用）

| 提交 | 内容 |
|---|---|
| `1efd19f` | 新增 6 条探针红灯测试（会话 + 令牌门语义） |
| `e4caa59` | 新增 `backend/diagnostic-token.ts`；postgres 与 supabase 探针共用 `evaluateDiagnosticToken`（`timingSafeEqual`）；postgres 探针改为可注入 `resolveAuth` / `runProbe` 的工厂 |
| `18e33fe` | `git rm -r --cached outputs`（4 个一次性转录不再被跟踪） |
| `b4cbb03` | `.gitignore` 增加 `!certs/*.pem`，公共 CA 可继续新增，其他 `*.pem` 仍被忽略 |
| `0ed7a6a` | 两份 2026-10-02 报告移入 `docs/archive/` 并加「历史快照」首行标注 |

诊断端点语义（实现后，未部署）：

- 未配置 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` → `404`（默认关闭，不暴露端点）。
- 已配置但请求头缺失或错误 → `401`。
- 令牌正确但无有效会话 → `401`（postgres 探针；supabase 探针不需要会话）。
- 仅 `POST`；非 `POST` → `405`。

线上仍运行 API 027（DeployId 027），**上述诊断门尚未部署**，不得据本文声称生产行为已变更。

## 5. UNKNOWN 清单

以下项目在本轮**未被证明**，不得对外表述为已完成或安全：

| 项目 | 状态 | 原因 |
|---|---|---|
| 远端实时 HEAD | `UNKNOWN` | 本机到 `github.com:443` 连接失败；仅有本地远端引用缓存 |
| 远端未取回分支/标签 | `UNKNOWN` | 未 `fetch`，无法枚举 |
| 历史内容级密钥扫描 | `UNKNOWN` | `gitleaks` 与 `trufflehog` 均未安装，未执行；仅做过文件名级扫描与局部正则 |
| 已删除对象/悬空提交中的凭据 | `UNKNOWN` | 未做对象库全量遍历 |
| `outputs/` 清理后的历史影响 | 已澄清 | 文件仍存在于先前提交历史中，本次仅停止跟踪，未改写历史 |
| README「N4 working tree」底稿 | `UNKNOWN` | 所有 worktree 的 README 均为 `source=eb6666d`（2026-10-22），不存在 N4 版本；已向用户索取 |
| API 027 线上验收证据入仓 | `UNKNOWN` | 证据文件仍在本地临时目录，未纳入仓库 |
| 产品效果（答案质量、用户价值） | 未验收 | 不属于本轮范围 |

## 6. 约束复述（本轮生效）

不部署、不追加线上研究、不调用付费模型、不读密钥、不改数据库结构、不放宽安全/日期/可靠性门槛、
不推 `master`、不强推、不改写历史、不改仓库设置、不替用户选择许可证。

模型预标与人工标注必须区分：自动判定结果**不得**表述为人工金标。
