# 前置条件核对结果（2026-10-01，封装前最终验收）

## 三项必须条件逐项核对

| # | 条件 | 状态 | 证据 |
|---|---|---|---|
| 1 | **用户从 Dashboard 下载的官方 CA 文件 + 本地路径** | **不满足** | `certs/` 仅有 `supabase-ca.pem`（mtime 2026-10-01T09:14Z，即昨日本轮工作产物，非用户今日新放置）；Desktop/Documents/Downloads 近 5 天无 CA 类新文件（桌面仅有 9-30 的 audit 报告，非证书）；.env.local 的 POSTGRES_CA_PATH 仍指向仓库内旧文件；未见用户提供的官方副本路径 |
| 2 | **用户已在本地产品页面完成登录（有效会话）** | **不满足** | `/api/auth/me` → 200 `{"user":null}`（无会话）；无既有 Cookie |
| 3 | **足够系统资源运行 knip** | **不满足** | 空闲物理 2.61GB / 虚拟 5.09GB；knip（oxc-parser ArrayBuffer 分配）在昨日两次尝试（含 NODE_OPTIONS=3072MB）均 OOM——当前资源水平低于该需求 |

## 环境其余部分（正常）
- HEAD cc65d6e + 126 改动；Node v24.20.0 / npm 11.19.0 满足 engines。
- 服务：:3000 vinext dev、:8080 源码后端均在运行（上一轮启动）。
- 连接串无 sslmode 参数；POSTGRES_SSL=false；POSTGRES_CA_PATH=certs/supabase-ca.pem（指向旧文件）。

## 结论
三项前置条件**全部缺失**。按任务第一条"缺少条件时：明确告诉用户需要完成的具体操作"处理——**本轮不启动 TLS 探针、不反复请求受保护接口、不重跑注定失败的 knip**。

## 需要用户完成的具体操作
1. **官方 CA**：登录 https://supabase.com/dashboard → 项目 `rwkpsnogskefoaqvdqrc` → Database → Settings → Database → SSL Configuration → 下载 Production CA 证书 → 保存到本机任意路径（例如 `C:\Users\<你>\Downloads\prod-ca.pem`）→ 把该路径告知本轮验收（或直接放入 `F:\ai signal map\signal-map\certs\` 并重命名/覆盖告知）。
2. **登录会话**：在本机浏览器打开 http://localhost:3000 完成登录（或提供既有会话说明）——注意：若登录在用户自己的浏览器完成，还需告知如何将该会话用于验收（例如导出 Cookie），因为自动化环境无法共享浏览器会话。
3. **knip 资源**：关闭其他占内存应用以腾出 ≥4GB 空闲内存，或告知允许的替代方案（如授权临时切换 Node 版本）。

## 本轮已执行的独立检查（不依赖上述条件）
- 连接配置专项测试将在门禁阶段运行（上轮 20/20 绿，本轮重跑确认）。
- 服务健康、配置状态、代理/DNS 形态均只读确认（见上文）。
