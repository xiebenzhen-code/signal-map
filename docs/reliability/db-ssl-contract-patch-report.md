# 数据库 SSL 配置契约修补报告（2026-10-01，离线）

## 1. 红→绿证据（tests/db-ssl-contract.test.ts，12 用例）

| 用例 | 红（修补前） | 绿（修补后） |
|---|---|---|
| 1. TLS 开 + 无 CA 路径 → 明确配置错误 | ✖ 未抛错（返回 `{rejectUnauthorized:false}`） | ✔ 抛 `POSTGRES_CA_PATH 未配置`，文案不含"回退到跳过证书校验"暗示 |
| 1b. 池构造同样失败 | ✖ 未抛错 | ✔ 抛同错误 |
| 2a. CA 文件不可读硬失败 | ✔（既有行为保持） | ✔ |
| 2b. CA PEM 无效硬失败 | ✔（既有行为保持） | ✔ |
| 3a. 应用 TLS 对象 vs URL `sslmode=disable` | ✖ 未抛错（驱动最终 ssl=false，静默关闭 TLS——实测确认） | ✔ 抛 `SSL 配置冲突：… sslmode=disable` |
| 3b. 应用 ssl=false vs URL `sslmode=require` | ✖ 未抛错（驱动最终 `{}`，静默重开 TLS） | ✔ 抛 `SSL 配置冲突：… sslmode=require` |
| 3c. 冲突错误脱敏 | —（无此错误） | ✔ 不含 `postgres://`、不含凭证（alice/hunter2 夹具）、含 sslmode 描述 |
| 3d. 池选项继承冲突拒绝 | ✖ | ✔ |
| 4. 有效 TLS+CA → 驱动最终配置验证（构造 pg.Client，未 connect） | ✖（fixture PEM 无效） | ✔ `rejectUnauthorized=true` + CA 链在位（构造 Client 检查，未 connect） |
| 4b. 禁用 → 驱动恰为 ssl=false | ✔ | ✔ |
| 5. 诊断探针与应用池同规则 | ✖ | ✔ 同走 resolveDriverSsl |
| 离线确定性 | ✔ | ✔ |

既有 `tests/postgres-config.test.ts` 中两个按旧契约（TLS+无 CA 合法）编写的用例已按新契约改写；其余 6 用例兼容未动。合并后 20/20 绿。

## 2. 配置输入 → 应用配置 → 驱动最终配置对照（全部离线虚构串，未 connect）

| 输入 | 应用层结果（修补后） | 驱动最终 ssl（构造 Client 实测/推定） |
|---|---|---|
| URL `sslmode=disable` + 应用 TLS 对象 | **throws**（配置冲突，脱敏） | 修补前：`false`（静默关 TLS）；修补后：不可达（配置期拒绝） |
| URL `sslmode=require` + 应用 ssl=false | **throws**（配置冲突，脱敏） | 修补前：`{}`（静默开 TLS）；修补后：不可达 |
| TLS + 无 `POSTGRES_CA_PATH` | **throws**（配置错误） | 修补前：`{rejectUnauthorized:false}`；修补后：不可达 |
| TLS + 有效 CA 文件 | `{rejectUnauthorized:true, ca:<PEM 链>}` | 构造 Client 实测：对象、`rejectUnauthorized=true`、含 CA 链 |
| 应用 ssl=false、URL 无 sslmode | `false` | `false`（实测） |
| 应用 ssl=false、URL `sslmode=disable` | `false`（一致，不冲突） | `false`（实测） |
| 无显式配置 + env `POSTGRES_SSL=true` + 无 CA | **throws**（同 TLS+无 CA） | 修补前：`{rejectUnauthorized:false}`；修补后：不可达 |

驱动解析顺序依据（pg 8.23.0 实测）：`Object.assign({}, config, parse(connectionString))`——连接串参数覆盖应用 ssl 对象；`sslmode=require/verify-ca/verify-full → {}`、`disable → false`、字符串 `no-verify → {rejectUnauthorized:false}`。**修补后所有冲突在进入驱动前被拒绝，不再依赖驱动合并结果。**

## 3. 实际修改文件

| 文件 | 修改 |
|---|---|
| `backend/postgres.ts` | `resolveDriverSsl`：① TLS 启用但无 `POSTGRES_CA_PATH` → 抛配置错误（文案不含"回退"暗示）；② 新增 `sslmodeInConnectionString` + `rejectSslConflict`——检测 DATABASE_URL 内 `sslmode` 与显式应用配置的方向性冲突并抛脱敏错误（错误信息不含连接串与凭证）；CA 加载/校验逻辑未动 |
| `tests/db-ssl-contract.test.ts`（新增，12 用例） | 上表全部反例 + 驱动最终配置验证（构造 pg.Client，无 connect） |
| `tests/postgres-config.test.ts` | 2 个旧契约用例按新契约改写（其余 6 个保持） |
| `backend/postgres-transport-probe.ts` | **未修改**——`clientConfig()` 与应用池同走 `resolveDriverSsl`，规则自动一致（用例 5 验证） |
| `package.json` | npm test 列表注册 `tests/db-ssl-contract.test.ts` |

## 4. 门禁退出码

| 命令 | 结果 |
|---|---|
| 专项（db-ssl-contract + postgres-config + postgres-connection + postgres-repository + postgres-migration + backend-server + control-plane + auth-tenant-boundary） | **80/80 PASS（exit 0）** |
| `npm run quality` | typecheck **PASS**、lint **0 errors**（8 warnings 全为既有文件）、test **623/618 pass/0 fail/5 skip**、deps:check **PASS**；**knip 失败（exit 1，oxc-parser ArrayBuffer 内存分配错误，Node v24.20.0 环境性 OOM）——按任务指示记录后单跑 deps:check 通过，未反复重试** |
| `npm run api:build` | **PASS（exit 0）** |
| `npm run build` | **PASS（exit 0）** |

## 5. 尚未验证项（如实列出）

- **CA 信任链的真实信任**：仅验证 PEM 结构可解析并进入驱动配置；未验证该 CA 能在实际 TLS 握手中通过信任锚校验。
- **TLS 网络连接**：全程离线，未与任何真实数据库建立 TLS 握手（含 Supabase pooler）。
- **登录态读取**：未验证真实数据库上的认证查询与 Knowledge 读写。
- knip 的环境性内存失败使"未使用导出"静态扫描本轮未完成（deps:check 已单独通过）。

## 6. 边界声明

本轮为**离线配置契约修补**：未连接真实数据库、未抓取证书、未调用模型、未调整代理、未改环境文件、未重启服务、未 commit/push/打包。**不得将本报告理解为"数据库安全连接已恢复"**——连接恢复需在真实环境完成上述第 5 节未验证项后另行确认。
