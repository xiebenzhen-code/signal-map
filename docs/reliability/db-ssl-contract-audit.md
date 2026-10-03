# 数据库 SSL 配置契约核对（只读，2026-10-01）

## 现状矩阵

| 场景 | 应用传入 ssl | DATABASE_URL 内 sslmode | pg 驱动最终 ssl | 契约判定 |
|---|---|---|---|---|
| TLS 开 + 无 CA 路径 | `{rejectUnauthorized:false}` | — | `{rejectUnauthorized:false}` | **现行行为明文记录为"加密但未验证"，但按本轮任务属违规（任务 1：明确报配置错误）** |
| TLS 开 + CA 路径不可读/无效 | — | — | 硬失败（`POSTGRES_CA_PATH 无法读取` / `INVALID_CA`） | 符合任务 2（现有测试已覆盖） |
| 应用 ssl 对象 vs URL `sslmode=disable` | `{rejectUnauthorized:true,ca}` | `disable` | **`false`（驱动静默覆盖，实测确认）** | 违反任务 3 |
| 应用 ssl=false vs URL `sslmode=require` | `false` | `require` | **`{}`（空对象，TLS 被静默重开）** | 违反任务 3 |
| 应用 ssl=false vs URL `sslmode=disable` | `false` | `disable` | `false` | 符合 |

## 驱动合并顺序（pg 8.23.0，实测）

`ConnectionParameters` 构造：`config = Object.assign({}, config, parse(config.connectionString))` —— **连接串参数覆盖应用传入的 ssl 对象**；仅当 `config.ssl === undefined` 时才读 `PGSSLMODE` 环境。`pg-connection-string` 将 `sslmode=require/verify-ca/verify-full` 解析为 `{}`（当前版本视同 verify-full，v9 将改为标准 libpq 语义），`sslmode=disable` 解析为 `false`。

## 现有代码与测试

- `backend/postgres.ts#resolveDriverSsl`：处理 env（PGSSLMODE/POSTGRES_SSL）、显式 config.ssl、CA 加载校验；**不检测 DATABASE_URL 内嵌 sslmode 与应用配置的冲突**；TLS+无 CA 时返回 `{rejectUnauthorized:false}`。
- `buildPoolOptions`：池使用同一 `resolveDriverSsl`；连接串原样传给驱动 → 冲突场景驱动静默覆盖。
- `backend/postgres-transport-probe.ts`：诊断探针 `clientConfig()` 同用 `readDatabaseConfig + resolveDriverSsl` —— 与应用池同一规则（任务 5 要求保持）。
- `tests/postgres-config.test.ts`：10 个用例，覆盖显式 ssl:false 优先、CA 硬失败、池透传；**未覆盖**：TLS+无 CA 必须报错（现测反而断言 `{rejectUnauthorized:false}` 为正确行为——需按本轮契约改写）、连接串冲突检测、驱动最终配置验证（禁止 connect）。

## 修改范围（按任务限定）

仅 `backend/postgres.ts`（resolveDriverSsl 冲突检测 + 无 CA 硬失败 + 解析 DATABASE_URL 参数做对照）与 `tests/postgres-config.test.ts`（新增 5 组反例）；探针不改（自动继承同一 resolveDriverSsl）。
