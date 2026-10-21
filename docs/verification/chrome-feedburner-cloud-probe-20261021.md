# Chrome FeedBurner 云端验证（chrome-feedburner-cloud-probe）— 2026-10-21

## 结论

**BLOCKED — 诊断未执行。** 本会话没有目标实例的容器执行通道，产品现有接口也不存在 feed 模式入口；按指令不寻找替代、不用本地读取冒充云端证据。已交付一条可在目标实例 Webshell **整体执行**的命令（下文），使用产品现有 `readCustomSource`（`format:"feed"`、既有 12 秒预算、生产解析器/DNS/全部地址安全检查）。

## 一、只读现场确认（2026-10-21 10:56 实时查询）

- `signal-map-api-preview` 承流版本：**DeployId 019**（BuildId 2609076235，RunId multi_tenant_1xJLzB2a8O9gkO，镜像 `…-019-20261021102332`，normal / FlowRatio 100 / HasTraffic true）。未预设，实时核定。
- 容器执行通道核查：
  - CloudBase 工具集（manageCloudRun/queryCloudRun）：只有部署/部署记录/日志检索，**无 exec/webshell**；
  - 产品现有接口：`/api/sources/check` 处理器仅传页面模式（`backend/custom-sources.ts` 中 `reader(url,{deadlineAt,lookup})`，无 format），**按指令不得用其冒充 feed 模式**；`format:"feed"` 读取当前只存在于研究管线内（本轮禁止提交研究）。
  - → 三条路都不通，判定无容器执行通道。

## 二、通道与参数核对（代码级，供命令可信）

- `readCustomSource(value,{format:"feed"})`（`source-enrichment/custom-source.ts`）：`FEED_READ_BUDGET_MS=12000`、`FEED_MIN_USEFUL_MS=2000`，生产 DNS/DoH 与地址安全检查全开；feed 分支校验 content-type（`FEED_CONTENT_TYPE_UNSUPPORTED`）、2MB 上限（`FEED_TOO_LARGE`）、非 200 → `FEED_HTTP_<code>`、私网 → `FEED_PRIVATE_ADDRESS`、超时 → `FEED_TIMEOUT`；成功返回 `readable` + `content`（XML 文本）。
- 产品 RSS 解析器：`parseRegisteredFeed(xml, feed)`（`research/registered-feeds.ts`），使用 `feed.url` 作相对链接基准、`feed.publisherHosts` 过滤条目主机。
- 命令已在**同代码本地**冒烟（无效地址走错误分支，验证 import 链与结果对象结构正常）；**冒烟结果不是云端证据**。

## 三、Webshell 整体执行命令（在目标实例容器内粘贴运行）

```bash
cd /app && node --experimental-strip-types --input-type=module -e "
import os from 'node:os';
const { readCustomSource } = await import('./source-enrichment/custom-source.ts');
const { parseRegisteredFeed } = await import('./research/registered-feeds.ts');
const TARGET = 'https://feeds.feedburner.com/GoogleChromeReleases';
const feed = { id:'chrome', name:'Chrome Releases', url:TARGET, publisherHosts:['feeds.feedburner.com','chromereleases.googleblog.com'], aliases:['chrome','chromium'], topics:[], official:true, cloudVerified:false };
const t0 = Date.now();
const r = await readCustomSource(TARGET, { format: 'feed' });
const out = { instance: process.env.SIGNAL_MAP_SERVER_INSTANCE_ID ?? null, hostname: os.hostname(), node: process.version, target: TARGET, status: r.status, reason: r.reason, requestCount: r.requestCount, elapsedMs: Date.now() - t0, bytes: r.content ? Buffer.byteLength(r.content) : 0, httpStatus: 'UNKNOWN(结果对象不暴露；reason 含 FEED_HTTP_<code> 时即状态码；readable 按代码路径即 200)' };
if (r.status === 'readable' && r.content) { try { const p = parseRegisteredFeed(r.content, feed); out.parse = { ok: true, rawCount: p.rawCount, entryCount: p.entries.length, top3: p.entries.slice(0,3).map(e => ({ title: e.title, link: e.url, publishedAt: e.publishedAt ?? 'UNKNOWN' })) }; } catch (e) { out.parse = { ok: false, error: String(e.message).slice(0,100) }; } } else { out.parse = { ok: false, note: 'no body to parse' }; }
console.log(JSON.stringify(out, null, 1));
"
```

说明：
- 只读一次；`readCustomSource` 不传 `deadlineAt` 时 feed 模式自带 12 秒预算；不传 lookup 用容器默认 DNS（与生产一致；`SOURCE_DOH_URL` 未在环境键集中）。
- `publisherHosts` 含 `feeds.feedburner.com` 与 `chromereleases.googleblog.com`（FeedBurner 条目链接两者皆可能），仅为解析同一响应服务，**不修改产品来源目录**。
- 输出不含凭据、环境变量值与完整正文（仅字节数与最多 3 条条目）。
- 若容器 node 版本过旧不识别 `--experimental-strip-types`（22.6 以下），属通道异常，请回传该报错原文，不要改用其他读取方式。

## 四、结果判定标准（供执行后回填）

| 命令输出 | 判定 |
|---|---|
| `status:"readable"` 且 `parse.ok:true`，entryCount>0 | HTTPS FeedBurner 直连入口**具备云端可用证据**；可另行提出最小地址替换方案（本轮不实施） |
| `reason:"FEED_PRIVATE_ADDRESS"` | 安全预检拒绝；保留保护，记录地址解析结果，不绕过 |
| `reason:"FEED_TIMEOUT"` 且 requestCount=1 | 读取超时（阶段仍不能细分为 DNS/连接/TLS/正文——requestCount=1 不等于 TCP/TLS 成功） |
| 其他 `FEED_*` / `FEED_HTTP_<code>` | 按码记录真实阶段 |

## 五、本轮状态

- 已完成：承流版本实时核定（019）；通道核查（不可用）；命令构造并同代码冒烟；本报告。
- 未执行：云端读取与解析（BLOCKED）。
- UNKNOWN：FeedBurner 在目标容器的全部读取/解析字段——以 Webshell 回传为准。
- 费用：UNKNOWN。完成即停。


## 六、用户回传的 API019 云端实测

证据来源：用户粘贴的 Webshell 输出，未由本助手重跑。实例 `signal-map-api-preview-019-d5fc566b6-smqls`，Node v22.23.3。HTTPS FeedBurner 目标返回 `failed / FEED_TIMEOUT`，requestCount=1，elapsedMs=12005，读取器交回 bytes=0，无正文可解析，HTTP状态 UNKNOWN。

该结果更新第五节的历史 BLOCKED 状态：现在已有用户提供的云端读取失败证据，解析仍未执行。requestCount=1不证明连接或TLS完成；bytes=0不证明网络未收到任何字节。不能归因为Google市场政策，也不能证明具体超时阶段。直接HTTPS入口未恢复，不替换地址，不重试Chrome，不延长预算或放宽安全保护。

结构化存档：`outputs/chrome-network-probe-20261021/cloud-user-result.json`。
