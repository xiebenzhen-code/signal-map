# 正式入口 403 受限排查 — 2026-10-23 20:23

## 结论速览

| 项目 | 结果 |
|---|---|
| 正常浏览器入口 | **可用**：Chrome 155（普通 UA、有头窗口、独立临时配置）打开 `https://signal.benzhenlab.com/` → HTTP **200**，标题「Signal Map — 个人行业信息过滤器」，研究输入框与「开始研究」「检查链接」正常渲染；`cf-ray: a4f0b5fecc21cc7e-SJC` |
| 命令行请求 | **被拦**：`POST /api/signals`（node fetch，无浏览器指纹）→ HTTP 403 + Cloudflare「Attention Required!」阻断页，Ray ID `a4f08f03acf83385`，1226ms |
| 403 原因 | **推断（未确认）**：Cloudflare 边缘按规则拦截该非浏览器请求；具体规则/规则集无法在无 Cloudflare 权限下确认 |
| 是否需要配置调整 | 本轮不需要，且未修改任何 Cloudflare 配置 |
| 研究复验前置条件 | 见第五节 |

## 一、正常浏览器检查（真实 Chrome，仅一次）

- 时间：2026-10-23 20:23（+08）；URL：`https://signal.benzhenlab.com/`
- 方式：本机 Chrome 155.0.8059.85 **有头窗口** + 独立临时配置目录；无任何登录态，未读取或导出 Cookie/令牌，未修改资料，未点击「开始研究」。
- 结果：HTTP **200**、`text/html`、`server: cloudflare`、`cf-ray: a4f0b5fecc21cc7e-SJC`；页面完整渲染，无错误提示。
- 表单可用性：输入框、三个示例问题、「更多筛选」、「开始研究」均在可见 DOM 中；未提交任何请求。
- 账户确认：页面提示「登录后可保存长期记忆；未登录只保存在当前浏览器」，未登录即可使用表单。本轮**未执行登录/账户确认**（不输入凭据、不读取会话），故「账户确认能否完成」**未验证**。
- 证据：`outputs/rsshub-403-diag-20261023/browser-check.png`、`browser-check.json`（含响应状态、cf-ray、DOM 事实）。

## 二、403 的性质与证据

已确认（直接证据）：

- 上次失败请求为 `POST https://signal.benzhenlab.com/api/signals`，返回 **403** `text/html`，响应体是 Cloudflare 通用拦截页（「Sorry, you have been blocked」），Ray ID `a4f08f03acf83385`，客户端出口 IP `106.45.124.218`（页面自带），耗时 1226ms。
- 同一时刻 `GET /api/signals`（curl，无认证）同样 403 HTML；而同一浏览器向同域首页得到 200 —— 域名、证书、源站均正常。
- 403 页面标注站点名为 **chatgpt.site**（「You are unable to access chatgpt.site」），说明 `signal.benzhenlab.com` 由 **chatgpt.site** 这个 Cloudflare zone 代理（自定义主机名）。这是定位规则时要选的 zone。

推断（未经 Cloudflare 安全事件证实）：

- 阻断发生在 Cloudflare 边缘，动作为 **block** 而非交互式 challenge（页面没有「Just a moment…」等待页或验证框，直接 403）。
- 被拦请求特征：非浏览器客户端（node fetch，无浏览器 UA/指纹、无同站 Cookie），JSON POST，路径 `/api/signals`。因此更可能是「机器人/客户端指纹」类规则或对该路径方法生效的 WAF 规则，而不是源站返回 403。
- 页面通用说明提到「提交了特定词句、SQL 命令或畸形数据」，这是 Cloudflare 通用拦截模板的固定文案，**不能**据此认定命中了 SQLi/XSS 规则。

未知（需要 Cloudflare 权限）：

- 具体命中的规则/规则集（Managed Rules、自定义 WAF、Bot Fight Mode、Rate Limiting）；
- 匹配条件与动作；
- 是否同时被 IP 信誉/威胁评分命中。

## 三、Cloudflare 侧查询条件（无权限时交付）

- 入口：Cloudflare Dashboard → zone **chatgpt.site** → Security → Events（Security Events / Firewall Events）。
- 过滤：Ray ID = `a4f08f03acf83385`；时间窗 2026-10-23 11:56:25–11:56:27 UTC（19:56:25–19:56:27 +08）；Host = `signal.benzhenlab.com`；Path = `/api/signals`；Method = `POST`；Client IP = `106.45.124.218`。
- 需要导出：Rule ID / Rule name / Action / Source 分类。不需要把密码或 API Token 交给本会话。

## 四、配置边界

本轮仅调查：未改 Cloudflare 配置、未关闭 WAF/机器人防护/限速、未设整站放行、未伪装客户端、未绕过挑战、未加代理、未换域名。

若确需调整，建议的最小范围（**待另行授权**）：仅对 `/api/signals` 的 POST 建立例外或改为 managed challenge，不整站放行；风险是该端点目前无需认证即可提交并消耗研究预算，放行后可能被脚本滥用；恢复方式是删除该例外规则即回到现状。

## 五、下一次研究复验的前置条件

1. 由 Cloudflare 侧按第三节条件确认规则，并在授权后做最小调整；或
2. 改在浏览器页面内以正常交互提交（页面可用）——但那是页面展示验收，不是接口验收，且同样消耗一次真实研究；或
3. 仍用脚本接口时，需先确认拦截来自客户端指纹还是 payload 规则，否则重复提交仍可能被拦。

任何路径下：FEED_TIMEOUT 根因仍 UNKNOWN；复验只回答「两路来源是否被执行、计数与 complete 文案」，不宣称超时已修复。

## 六、本轮计数

研究请求 **0 次**（未点击「开始研究」，未提交脚本请求）；部署 **0 次**；配置修改 **0 次**；本会话发起模型调用 **0 次**。Codex 额度：读不到 → **UNKNOWN**（不引用过期读数）。
