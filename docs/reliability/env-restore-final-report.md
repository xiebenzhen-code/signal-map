# 环境恢复与有界验收最终报告（2026-10-01）

## 最终结论：**B. 暂不交付**

---

## 一、只读预检（详见 env-restore-preflight.md）

- HEAD `cc65d6e` + 121 个工作区改动；Node v24.20.0（满足 engines >=22.13.0）、npm 11.19.0。
- 进程归属：3000=vinext dev（真实前端）；8080=`node --env-file=.env.local --experimental-strip-types backend/node-server.ts`（**真实后端，源码模式，非 fixture**）。/health ok + instanceId:null 仅证进程存活。
- SSL 配置：DATABASE_URL 存在（host=aws-0-us-west-2.pooler.supabase.com，**无 sslmode 参数**，无冲突）；`POSTGRES_SSL=false`（**当前明文**）；`POSTGRES_CA_PATH=certs/supabase-ca.pem`（文件存在）。
- 内存：物理 14.2GB/空闲 2.3-2.5GB；虚拟空闲 4.5-5.2GB。
- 代理：**TUN/fake-IP 模式**（pooler 解析到 198.18.0.21），但 5432 经隧道 26ms 可达；系统代理 ProxyEnable=0；未检测到代理客户端进程名；**未修改任何代理配置**（按 3.2，未获明确授权）。

## 二、CA 核验：未完成（需用户操作）

- 本地 `certs/supabase-ca.pem`：2 证书链自洽（Intermediate←Root，issuer/subject 匹配），有效期至 2033/2031，均 isCA=true。SHA256：Intermediate `30:3B:0A:59:…:55:EA`；Root `80:70:25:AD:…:CA:FA`。
- **权威来源（Supabase Dashboard SSL Configuration）需登录**；自动化浏览器工具被 TUN fake-IP 拦截、无凭据（按规不索取）。已向用户三选一询问（Dashboard 核验/豁免/跳过），**未获回应**（user-unresponsive-record.md）。
- 按 2.4：停止依赖该证书的验收（**不启用 TLS 做数据库验收**）；按 2.5 继续独立门禁。

## 三、环境恢复：按保守路径执行（未改代理）

- **未修改代理**（未获授权）；**未关闭全局代理/防火墙/用户应用；未批量结束 Node 进程**。
- **未启用 TLS**（POSTGRES_SSL 保持 false）——启用需可信 CA 就绪（未满足）；也**未回退任何配置**（现状即 false）。
- **未重启后端**：当前 8080 进程已是源码模式本轮代码（含 SSL 契约修补），配置未变无重启必要；前端正常未动。
- 修改过的环境配置名称：**无**（零修改；预检/验收均以只读+临时 instrument 完成，临时脚本已删除）。

## 四、有界数据库验收（3 次串行，明文基线）

| # | connect | query | transport | 证书校验 | 结果 |
|---|---|---|---|---|---|
| 1 | 1026ms | 262ms | plaintext | 关闭 | SELECT 1 成功 |
| 2 | 972ms | 259ms | plaintext | 关闭 | SELECT 1 成功 |
| 3 | 1082ms | 638ms | plaintext | 关闭 | SELECT 1 成功 |

- 路径：应用真实 `buildPoolOptions(readDatabaseConfig())`（含 SSL 契约修补），max=1、connect 8s/query 5s 上限，用后释放；无失败、无隐匿。
- **TLS 验收：未通过/未执行**（plaintext + 无证书校验；CA 权威核验未完成）。这不是"连接失败"，是"验收条件未满足"。
- 3/3 成功**不计入 TLS 验收**，仅证明现有明文路径与应用配置逻辑工作正常。

## 五、登录态只读验收：未执行成功（阻塞于凭据）

- /api/auth/me → 200 `{"user":null}`（无既有会话）。
- /api/control/knowledge → **401**；/api/control/follows → **401**（auth 层拒绝，未触达数据库——**不计为数据库验证**）。
- 阻塞原因：无既有登录会话；环境无测试账号（TEST_ACCOUNT_A/B 均 false）；任务禁止创建账号。

## 六、门禁

| 命令 | 结果 | 退出码 |
|---|---|---|
| 连接配置专项（db-ssl-contract 12 + postgres-config 8） | 20/20 PASS | 0 |
| `npm run quality`（第 1 次） | typecheck PASS / lint 0 errors（19 warnings 全既有）/ test **623/618 pass/0 fail/5 skip** / **knip 失败** / deps:check 未达 | -1（knip OOM） |
| `npm run knip`（单独复跑） | 失败：oxc-parser `ArrayBuffer` 内存分配错误（Node 24.20 环境性） | 1 |
| `npm run quality`（第 2 次，环境变化：NODE_OPTIONS=--max-old-space-size=3072） | 同上：test 通过，**knip 仍失败（同错误）** | -1 |
| `npm run deps:check`（单跑） | 151 modules / 324 dependencies，无违规 | 0 |
| `npm run api:build` | PASS | 0 |
| `npm run build` | PASS | 0 |
| `git diff --check` | PASS（无 whitespace 错误；仅 CRLF 提示） | 0 |

**完整 quality：未通过**（knip 内存错误持续，两次尝试含明确环境变化均复现；未放宽规则、未排除文件、未改依赖）。数量汇总：测试 623（618 通过 / 5 跳过 / 0 失败）；lint 0 errors / 19 warnings（全既有文件）。

## 七、外部访问计数

| 类别 | 次数 |
|---|---|
| CA 获取（Dashboard） | 0 |
| 数据库连接 | 3（全部明文成功） |
| 其他探针 | DNS 3、TCP 1、HTTP health/auth 3、control API 2 |
| 模型调用 | **0** |
| 真实研究提交 | **0** |

## 八、当前实际状态

- 前端：vinext dev :3000 正常（本轮未重启）。
- 后端：:8080 源码模式本轮代码（含 SSL 契约修补），本轮未重启（无配置变更）。
- SSL 实际状态：**POSTGRES_SSL=false，明文连接，证书校验关闭**（未做任何变更——TLS 启用被 CA 核验前置条件阻塞）。

## 九、遗留阻塞（不引用旧结果补齐）

1. **CA 权威核验**：需用户在 Supabase Dashboard 完成并与本地指纹比对（或明确豁免）。
2. **数据库 TLS 验收**：依赖 1；启用后按第四步重跑（≥2 次独立建连、其中一次来自重启后的真实后端）。
3. **登录态读取**：需有效登录会话或测试账号凭据（创建账号被本轮禁止）。
4. **knip 内存错误**：oxc-parser 在 Node 24.20 上分配失败；需 Node 版本/内存环境调整（升级运行时须用户决定）或上游修复；quality 完整通过被此阻塞。
5. SSL 契约修补本身已通过专项与全量测试，但**其在真实 TLS 握手中的行为仍未验证**（属第 5 节未验证项）。

## 十、结论

**B. 暂不交付。** 未通过条件：CA 权威核验未完成（需用户 Dashboard 操作）→ 数据库 TLS 验收未执行（当前明文）→ 登录态读取 401（无凭据）→ 完整 quality 被 knip 内存错误阻塞。所需外部操作：① 用户完成 CA 指纹比对或明确豁免；② 提供测试账号凭据或既有登录会话；③ 决定 knip 环境处理方式（如允许切换 Node 版本）。本报告不引用任何历史结果补齐本轮证据；等待单独指令。
