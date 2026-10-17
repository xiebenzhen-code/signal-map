# 封装前置条件确认报告（2026-10-01 第二次确认）

## 三项前置条件状态（用户答复 + 只读核对）

| # | 条件 | 用户答复 | 自动化侧证据 | 判定 |
|---|---|---|---|---|
| 1 | 官方 CA 文件 + 路径 | **"还未下载"** | `.env.local` POSTGRES_CA_PATH 仍指向仓库旧文件 `certs/supabase-ca.pem`；POSTGRES_SSL=false 未变 | **缺失** |
| 2 | 浏览器登录会话 | **"已登录"**（http://localhost:3000） | 浏览器工具仍被 TUN fake-IP 拦截（browser_private_target_denied），自动化无法直接读取用户浏览器会话；终端 `/api/auth/me` 无 Cookie 返回 `{"user":null}`——**按要求不以无 Cookie 终端请求判定浏览器登录状态** | **部分就绪**（用户侧已登录，但缺少会话传递方式，无法用于自动化验收） |
| 3 | knip 运行资源 | **"资源已就绪"**（授权 NODE_OPTIONS 方案） | 授权后重试：knip 仍以相同 oxc-parser ArrayBuffer 错误失败（exit 1）；deps:check 单跑通过（151 modules/324 deps） | **未解决**（资源非根因：堆上限 3072MB 下 oxc-parser 原生分配仍失败，需换 Node 版本或上游修复） |

## 分支判定：任一条件缺失 → 待办表 + 停止

条件 1 官方 CA 缺失 → **本轮不核验 CA、不更新 CA 路径、不启用 TLS、不启动数据库探针、不重跑整套门禁**（按任务"已确认的结果不重复检查、不改配置"）。

## 待办表

| 待办 | 由谁 | 完成标志 | 当前状态 |
|---|---|---|---|
| 下载 Supabase Dashboard 当前项目 Production CA（Database → Settings → Database → SSL Configuration）并告知本机路径 | **用户** | 用户回复 CA 文件完整路径；文件可被只读读取且 SHA256 指纹已记录 | 待办 |
| 会话传递方式：用户浏览器已登录，但自动化环境无法共享浏览器 Cookie。可选：a) 授权在用户浏览器内完成验收操作；b) 用户导出会话 Cookie 并告知；c) 明确豁免登录态验收 | **用户** | 用户明确选择其一 | 待办 |
| knip 内存问题的处理决定（临时/永久切换 Node 版本，或接受 knip 持续失败并单独跑 deps:check——本轮已单跑通过） | **用户** | 用户给出明确方案 | 待办（本轮已用授权的 NODE_OPTIONS 重试一次并记录失败） |

## 本轮实际配置/文件变化

**零。** 未修改 POSTGRES_SSL/POSTGRES_CA_PATH/代理/防火墙/任何业务代码；唯一动作是用户授权的 knip 重试（NODE_OPTIONS 运行时选项，已撤销）。

## 本轮门禁记录（仅与授权重试相关项）

| 命令 | 结果 | 退出码 |
|---|---|---|
| knip（用户授权 NODE_OPTIONS=3072MB 重试一次） | 失败（oxc-parser ArrayBuffer，同昨日） | 1 |
| deps:check（单跑，维持完整链路可见性） | PASS（151 modules / 324 deps 无违规） | 0 |
| 连接专项 / quality / api:build / build / git diff --check | **未执行**（条件 1 缺失，按分支规则不重跑） | 未执行 |

## 计数

| 类别 | 本轮次数 |
|---|---|
| CA 获取（Dashboard） | 0 |
| 数据库连接 | 0 |
| TLS 探针 | 0 |
| 模型调用 | **0** |
| 研究提交 | **0** |

## 当前服务与 SSL 状态

- 前端 :3000、后端 :8080 均运行中（本轮未重启）。
- SSL 实际状态：**POSTGRES_SSL=false（明文）**，POSTGRES_CA_PATH=certs/supabase-ca.pem（旧文件），连接串无 sslmode、无冲突。

## 结论

**暂不进入开发验证版封装。** 被阻塞的具体条件：**条件 1（官方 CA 未下载）** 为本轮硬阻塞；条件 3（knip 资源/方案）用户已授权重试但失败依旧，需用户给出处理决定；条件 2 用户侧已登录但缺少自动化可用的会话传递方式。三项待办完成后重跑既定验收即可推进。等待用户补齐条件，不自动重试。
