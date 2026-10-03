# 数据库有界验收记录（2026-10-01，明文基线）

## 结论先行
**当前配置（POSTGRES_SSL=false）下 3/3 串行连接成功**（经应用真实 `buildPoolOptions` 配置路径，经 TUN 隧道），但 **transport=plaintext、证书校验未启用**——按任务第四步标准（"核实实际连接已加密、证书校验开启且通过"），**数据库 TLS 验收：未通过/未执行**（CA 权威核验因需 Dashboard 登录未完成，用户未响应询问）。

## 3 次尝试记录（串行，每次 connect≤8s / query≤5s，用后释放）
| # | sslOption | connect 耗时 | query 耗时 | transport | 证书校验 | 结果 |
|---|---|---|---|---|---|---|
| 1 | false | 1026ms | 262ms | **plaintext** | 关闭 | SELECT 1 成功 |
| 2 | false | 972ms | 259ms | **plaintext** | 关闭 | SELECT 1 成功 |
| 3 | false | 1082ms | 638ms | **plaintext** | 关闭 | SELECT 1 成功 |

无失败尝试；无隐匿。执行路径：应用真实 `buildPoolOptions(readDatabaseConfig())` + `resolveDriverSsl`（SSL 契约修补后代码），连接池 max=1、`connectionTimeoutMillis=8000`、`query_timeout=5000`，结束后 `pool.end()` 释放。

## 为什么不启用 TLS 重试
任务第 2.3 条：握手中提取的证书、自签名链自洽或 CT 查询**不能替代权威来源核验**；权威来源（Supabase Dashboard）需登录，自动化环境不可达；已向用户询问核验方式（三选一），**未获回应**。按 2.4：缺少 Dashboard 登录 → 停止依赖该证书的验收。因此不做 `POSTGRES_SSL=true` 切换（盲切 TLS 至少会因 unverified-CA 路径被本轮 SSL 契约修补硬拒；盲切无 CA 校验路径违反本轮契约且无意义），也**不自动退回或关闭任何配置**（当前 false 即现状，无回退动作）。

## 登录态只读验收
| 接口 | 结果 | 判定 |
|---|---|---|
| /api/auth/me | 200 `{"user":null}` | 无既有登录会话 |
| /api/control/knowledge | **401** | 认证未通过——**不计为数据库验证** |
| /api/control/follows | **401** | 同上 |

无法取得登录态的原因：本自动化环境无既有登录 Cookie；环境无测试账号凭据（TEST_ACCOUNT_A/B 均 false）；任务禁止创建账号。**登录态只读验收：未执行成功（阻塞于凭据）**。401 响应由 workerd/前端层返回，未触及数据库路径。

## 计数
- CA 获取（Dashboard）：0 次（未获得登录）
- 数据库连接：3 次（全部成功、全部明文）
- 其他探针：DNS×3、TCP×1、health×2、auth/me×1、control API×2
- 模型调用：**0**；真实研究提交：**0**
