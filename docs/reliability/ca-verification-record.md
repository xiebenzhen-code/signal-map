# CA 核验记录（第二步）

## 本地 CA（certs/supabase-ca.pem，离线解析）
| # | Subject | 有效期 | SHA256 指纹 | isCA |
|---|---|---|---|---|
| 1 | C=US, ST=Delware, L=New Castle, O=Supabase Inc, **CN=Supabase Intermediate 2021 CA** | 2023-10-24 → 2033-10-21 | `30:3B:0A:59:BB:C8:D7:7E:96:7F:BE:D2:0B:3F:E6:8E:C5:D7:D3:91:C3:08:1E:CE:99:36:EF:CE:EF:0A:55:EA` | true |
| 2 | 同 org，**CN=Supabase Root 2021 CA**（自签根） | 2021-04-28 → 2031-04-26 | `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` | true |

链自洽：Intermediate 由 Root 签发（issuer/subject 匹配），两条均在有效期内、CA 位为真。

## 权威来源核验状态：**未完成 — 需要用户操作**

原因：
1. Supabase Dashboard（数据库 → Settings → Database → SSL Configuration）要求**已登录的浏览器会话**；本自动化环境的浏览器工具被 TUN fake-IP DNS 拦截（所有域名判为 private target），且无 Dashboard 凭据——**不索取密码/令牌/连接串明文**。
2. 公开文档页无该项目的逐项目 CA（404/无对应资源）。

**需用户完成的操作（二选一）：**
- A. 登录 https://supabase.com/dashboard → 项目 rwkpsnogskefoaqvdqrc → Database → Settings → Database → SSL Configuration → 下载/查看 Production CA，将其 SHA256 指纹与本文件上表比对（应匹配 Intermediate/Root 之一或 Dashboard 标注的当前链）。
- B. 明确豁免声明："以仓库内 certs/supabase-ca.pem 为准"（记录为用户决定，非权威核验）。

## 握手提取证书 / CT 查询
- 握手提取的证书、自签名链自洽、CT 日志查询：**按任务规定均不能替代权威来源核验**——不作为 CA 核验通过的依据。
- 本地链自洽性已确认（issuer/subject 匹配、有效期、CA 位），仅此而已。

## 对后续步骤的影响
- 在用户完成核验（A）或给出豁免（B）之前，**不启用 TLS 做数据库验收**（第四步依赖可信 CA）。
- **可继续的独立工作**：连接配置专项测试、quality/api:build/build/git diff --check 门禁、登录态读取走现有配置路径的验证（明文路径下仍可验证认证与读取链路，但**不计为数据库 TLS 验证**）。
