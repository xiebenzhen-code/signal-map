# 只读预检记录（2026-10-01）

## 运行时与版本
| 项 | 值 | 项目要求 | 判定 |
|---|---|---|---|
| HEAD | cc65d6e + 121 个工作区改动 | — | — |
| Node | v24.20.0 | >=22.13.0 | 满足 |
| npm | 11.19.0 | — | — |

## 进程归属（区分真实后端/fixture）
| 端口 | PID | 命令行 | 性质 |
|---|---|---|---|
| 3000 | 29096 | vinext dev（工作区源码） | 真实前端 dev |
| 8080 | 33756 | node --env-file=.env.local --experimental-strip-types backend/node-server.ts | 真实后端（源码模式，非 fixture） |

/health 返回 ok + instanceId:null —— 仅证明进程存活（SIGNAL_MAP_GUEST_SECRET 未设置），**不作为研究功能恢复证明**。

## SSL 配置来源（脱敏）
| 配置 | 值/状态 |
|---|---|
| DATABASE_URL | 存在；host=aws-0-us-west-2.pooler.supabase.com；user=postgres.rwkpsnogskefoaqvdqrc；**无 sslmode 参数** |
| POSTGRES_SSL | `false`（**当前关闭 TLS**） |
| PGSSLMODE | 未设置 |
| POSTGRES_CA_PATH | certs/supabase-ca.pem（文件存在） |
| **SSL 参数冲突** | 无（连接串无 sslmode；POSTGRES_SSL=false 与之不冲突——但意味着当前以明文运行） |
| Supabase Auth host | rwkpsnogskefoaqvdqrc.supabase.co |

## 代理与环境
| 项 | 值 |
|---|---|
| 系统代理 | ProxyEnable=0（系统级关闭），ProxyServer 残留 127.0.0.1:7890（未启用） |
| 代理客户端进程 | 未检测到 clash/v2ray/sing-box 等进程名 |
| DNS 实际形态 | **TUN/fake-IP**：supabase.com→198.18.0.19、pooler host→198.18.0.21（198.18.0.0/15） |
| TCP 可达性 | pooler:5432 经 TUN 隧道 26ms 可达 |
| 浏览器工具限制 | 同 fake-IP 原因拒绝一切目标（前几轮已证） |
| 内存 | 物理 14.2GB 总 / 空闲 2.33GB；虚拟 38.7GB 总 / 空闲 4.94GB（knip OOM 风险仍在） |

## 关键结论
1. **代理是 TUN 模式且实际在路由流量**（无可见客户端进程名 → 可能为驱动级/服务化客户端，用户侧管理），但 5432 经它可达——上一轮 fetch 工具被拦是 **fetch_content 工具自身 SSRF 策略**，非网络不可达。数据库 TLS 验收可经现有 TUN 路径尝试，无需改代理。
2. **当前 POSTGRES_SSL=false**：启用 TLS 需改 `POSTGRES_SSL=true`（第 4.4 条授权范围内：可信 CA 就绪后允许仅修改 POSTGRES_SSL/POSTGRES_CA_PATH）。
3. CA 核验（第二步）需 Supabase Dashboard 登录——**不在本自动化能力内**，需用户操作或明确豁免；在此之前不启用 TLS 做数据库验收，先完成独立门禁。
