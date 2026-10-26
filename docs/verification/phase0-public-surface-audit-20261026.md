# 阶段 0 公开面收口审计（2026-10-26）

本文件只记录只读检查结果与整理方案。**没有移动、删除、改写任何文件或历史，没有修改产品逻辑。**

## 0. 基线与冲突

| 项目 | 实际值 |
|---|---|
| 仓库 | `https://github.com/xiebenzhen-code/signal-map` |
| 分支 | `p2n/stability-and-diagnosis` |
| HEAD | `7ea2d88e20b2395c2afb58551f6bc74f4b47f07e` |
| HEAD 父提交 | `cf164081e5398be93f30841ba811dca17dc4a2ff`（与指定 API 027 源码一致） |
| 本地缓存 `origin/master` | `8be8574` |
| 本地拓扑 | 领先 `origin/master` 8 个提交，落后 0 |

### 已报告的基线冲突（未擅自处置）

1. 指定文档提交 `e5e7439` 在当前对象库中不可解析（`fatal: Not a valid object name`）。
2. `CURRENT-BASELINE-20261026.md` 在当前工作树、Git 索引和已取回历史中均不存在。
3. 远端实时 HEAD 未能读取：本机到 `github.com:443` 的连接失败（`Failed to connect ... over proxy`）。上表远端值来自**本地已有远端引用缓存**，不是本轮实时回读。

处理方式：不使用旧 `master` 替代基线，不重置、不强推、不改写历史；上述三项按 `UNKNOWN` 记录，并作为本阶段未验证项保留。

### 工作区既有修改（保留未动）

- `M docs/verification/api027-release-manual-20261026.md`
- `?? diag-background.mjs`
- `?? diag-vintage.mjs`

## 1. certs 与历史敏感路径（只读）

### 1.1 `certs/` 文件清单

| 路径 | 大小 | 首行标记 | 判定 |
|---|---|---|---|
| `certs/prod-ca-2021.crt` | 1390 B | `-----BEGIN CERTIFICATE-----` | 公共 CA 证书（非私钥） |
| `certs/supabase-ca.pem` | 2772 B | `-----BEGIN CERTIFICATE-----` | 公共 CA 证书（非私钥） |

两个文件均只读取首行标记与大小，**未打印任何证书正文**。

### 1.2 全部分支历史中的文件名扫描

扫描范围：`git log --all --name-only`（本地已取回的全部引用）。

命中（按文件名模式：`.env*`、`*.key`、`*.pem`、`*private*key`、`id_rsa`、`id_ed25519`、`credentials*`、`secret*`、`certs/`）：

| 路径 | 首次提交 | 远端包含 |
|---|---|---|
| `.env.example` | `bdf0c3892e84f9db18014ce6324713a6428618ee` | 本地全部 18 个 `origin/*` 引用均包含 |
| `certs/prod-ca-2021.crt` | `d2d5118ff357644248ccafdc8b39ea80a4016d4f` | 同上 |
| `certs/supabase-ca.pem` | `d2d5118ff357644248ccafdc8b39ea80a4016d4f` | 同上 |

未命中：`*.key`、`*.p12`、`*.pfx`、`*.jks`、`id_rsa`、`id_ed25519`、任何私钥块文件名。

当前索引中被跟踪的 `.env` 类文件只有 `.env.example`；其性质为模板，不属于凭据。

### 1.3 结论与边界

- **未发现疑似私钥**，因此未触发“立即停止”条件。
- 未命中不等于已证明无泄漏：历史**内容**级扫描、已删除对象（悬空提交）、以及远端未取回的分支不在本轮范围内。
- 结论范围标注为 `UNKNOWN（通过文件名与本地引用覆盖，未做全历史内容扫描，远端实时引用未读）`。

## 2. `outputs/` 与根目录整理（仅方案）

### 2.1 被跟踪的 `outputs/` 文件

| 路径 | 大小 | 私钥标记 | 邮箱样式 | JWT 样式 | 判定 |
|---|---|---|---|---|---|
| `outputs/chrome-network-probe-20261021/cloud-user-result.json` | 442 B | 0 | 0 | 0 | 一次性云探测转录，生成物 |
| `outputs/login-failure-diagnosis-20261021/cloud-transport-transcribed.json` | 678 B | 0 | 0 | 0 | 登录故障诊断转录，生成物 |
| `outputs/login-failure-diagnosis-20261021/credential-pair-sanitized.json` | 624 B | 0 | 0 | 0 | 已脱敏字段对照，生成物 |
| `outputs/other-feeds-cloud-probe-20261021/results-transcribed.json` | 1048 B | 0 | 0 | 0 | 信源云读取转录，生成物 |

四个文件均为 2026-10-21 诊断的一次性转录产物，无人工维护价值；文件名虽含 `credential-pair-sanitized`，扫描未发现邮箱、JWT 或私钥。（未打印正文。）

### 2.2 忽略规则与跟踪状态的实际差异

`.gitignore` 已包含 `/outputs/` 和 `*.pem`，但这些文件**已被跟踪**，忽略规则对它们不生效（`git check-ignore` 返回未忽略）。因此仅修改 `.gitignore` 不能达到清理目的。

同时注意：`*.pem` 会把 `certs/supabase-ca.pem` 也纳入忽略；若决定保留该公共 CA 证书，需要显式例外，否则后续协作者无法新增同类证书。

### 2.3 建议方案（未执行）

A. 生成物移出索引，保留本地副本：

```bash
git rm -r --cached outputs
printf '\n# one-off diagnostic transcripts, never committed\n/outputs/\n' >> .gitignore
```

B. 为公共 CA 增加例外（与 A 同时执行）：

```gitignore
*.pem
!certs/*.pem
```

C. 提交后由各协作者本地删除残留目录（不进入 Git 历史），**不做历史改写**。

D. 若希望保留可追溯性，把四个转录文件的人工摘要并入 `docs/verification/other-feeds-cloud-probe-20261021.md`，而不是保留原始 JSON。

### 2.4 根目录重复报告

| 文件 | 内容概要 | 建议位置 |
|---|---|---|
| `PROJECT_REPORT_CN.md` | 2026-10-02 技术报告，基线写作“700 项测试，695 通过，0 失败，5 跳过”，按能力总览分节 | `docs/archive/PROJECT_REPORT_CN-20261002.md` |
| `SIGNAL_MAP_PROJECT_REPORT.md` | 同日英文版，声明“只记录代码、测试或既有校准痕迹确认的行为” | `docs/archive/SIGNAL_MAP_PROJECT_REPORT-20261002.md` |

两份报告的测试数字已明显滞后（当前分支为 980 项），且与 `README` 的“实现与验收状态”重复。建议归档而非删除，并在归档首行标注“历史快照，数字不代表当前分支”。

### 2.5 `.agents` 与 `.openai`

| 目录 | 被跟踪文件数 | 内容概要 | 密钥检查 |
|---|---|---|---|
| `.agents/` | 38 | 8 个技能包（brainstorming、qodo-get-rules、qodo-pr-resolver、requesting-code-review、social-signal-research、systematic-debugging、test-driven-development、verification-before-completion、web-platform-source-capture、writing-plans）及其脚本 | 唯一命中为 `qodo-get-rules/SKILL.md:136` 的 `API_KEY=$...` 形式，属 shell 变量示例，非字面量凭据 |
| `.openai/` | 1 | `hosting.json`，仅含 `project_id` 与两个 `null` 字段 | 无密钥、无 token |

建议：两者都是工具链配置，不是产品公开面内容。若希望首页更干净，可迁至 `docs/tooling/` 或整体移出仓库；但工具链引用（`AGENTS.md`、技能发现路径）需要同步修改，属独立改动，本阶段不执行。

### 2.6 覆盖边界

未覆盖：远端未取回分支、Git 对象中已不可达的历史、`node_modules`、以及二进制文件内部内容。故本节结论标注为 `UNKNOWN（未完成全历史内容级扫描）`，**不能据此声称“仓库完全无密钥”**。

## 3. postgres 诊断入口加固（仅方案 + 失败测试）

### 3.1 现状

`backend/postgres-transport-probe.ts`：

```ts
export const handlePostgresTransportProbe = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await resolveAuthContext(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  ...
```

即：任意已登录普通账号都能触发一次数据库连接探测，且端点始终存在（未配置任何开关时也返回 401，暴露自身存在）。

对照 `backend/supabase-auth-transport-probe.ts`：已有 `未配置 → 404`、`不匹配 → 401`、常量时间比较的完整门。

### 3.2 两种方案对比

| 维度 | 方案 A：增加独立诊断 token（推荐） | 方案 B：移除路由与前端代理 |
|---|---|---|
| 改动面 | 新增共享 `backend/diagnostic-token.ts`；探针加门；保留路由 | 删除 `node-server.ts` 分支、`api-proxy.ts` 分类、前端路由文件与测试 |
| 生产影响 | 线上已配置 `SIGNAL_MAP_DIAGNOSTIC_TOKEN`（API 027 回读确认），行为不变 | 线上该端点变为 404，失去后续诊断能力 |
| 安全收益 | 默认关闭，普通账号无法触发数据库探测 | 攻击面直接消失，收益最大 |
| 可回滚性 | 单文件回滚即可 | 需还原多处删除，回滚成本高 |
| 后续诊断 | 保留可复用通道 | 下次故障需重新提交代码并部署 |

推荐 **方案 A**，理由：改动最小、与既有 supabase 探针语义一致、生产已具备令牌配置、保留诊断能力。若确认该端点已无用途，再单独执行方案 B。

方案 A 的语义建议：

1. 未配置 `SIGNAL_MAP_DIAGNOSTIC_TOKEN` → `404`（不暴露端点，与 supabase 探针一致）。
2. 配置了但请求头 `x-signal-map-diagnostic-token` 缺失或不匹配 → `401`，使用 `timingSafeEqual`。
3. 令牌通过后，**仍保留**既有会话校验 → 无会话返回 `401`。这是纵深防御：令牌泄露不足以单独触发数据库探测。
4. 非 `POST` → `405`，且在读取令牌前判定。

代价：运维执行探测时必须同时持有诊断令牌和一个已登录会话。若后续认为该代价过高，可在同一文件内单独去掉会话校验，不影响令牌门。

### 3.3 失败测试补丁

补丁文件：`docs/verification/phase0-postgres-probe-token.failing-test.patch`

- 该文件是**惰性补丁文本**，不在 `tests/` 下，测试运行器不会加载，因此不会让分支变红。
- 应用方式：`git apply docs/verification/phase0-postgres-probe-token.failing-test.patch`
- 应用后当前代码的预期结果见 3.4；实现方案 A 后应全部转绿。

### 3.4 预期结果（应用补丁、未实现）

| 用例 | 期望 | 当前实际 | 结果 |
|---|---|---|---|
| 未配置令牌，匿名 POST | `404` | `401` | **失败（红）** |
| 配置令牌，无令牌头 | `401` | `401` | 通过（锁定契约） |
| 配置令牌，错误令牌 | `401` | `401` | 通过（锁定契约） |
| 配置令牌，正确令牌但无会话 | `401` | `401` | 通过（锁定纵深防御） |
| GET | `405` | `405` | 通过 |

即：补丁给出 1 条真实红灯，其余 4 条为回归锁定。红灯只证明“默认关闭语义缺失”，不证明数据库行为。

## 4. README 审阅稿

见 `docs/verification/phase0-readme-review-20261026.md`（含中英文建议稿、PR 描述草稿、About/topics/许可建议）。

## 5. 本轮门禁执行记录

执行于 HEAD `7ea2d88`（本文件写入前，代码与测试未变）：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run quality` | 0 | 980 项测试：974 通过、6 条件跳过、0 失败；typecheck / lint / knip / deps:check 均通过 |
| `npm run build` | 0 | vinext build 完成 |
| `npm run api:build` | 0 | `dist-api/server.mjs` 1.5 MB |

条件跳过 6 项不计作通过，原因是数据库测试环境缺失。本阶段只新增 Markdown 与惰性补丁文本，不改变测试集合，故未在写入后重跑全量门禁；这一点在报告中列为未验证项。

## 6. 未完成 / UNKNOWN 汇总

| 项目 | 状态 |
|---|---|
| `e5e7439` 对象 | `UNKNOWN`（本地不可解析） |
| `CURRENT-BASELINE-20261026.md` | `UNKNOWN`（本地不存在） |
| 远端实时 HEAD | `UNKNOWN`（网络不可达，仅有本地引用缓存） |
| 历史内容级密钥扫描 | `UNKNOWN`（仅做文件名级 + 局部内容正则） |
| 远端未取回分支 | `UNKNOWN` |
| API 027 线上验收证据入仓 | 未做（证据文件仍在本地临时目录） |
