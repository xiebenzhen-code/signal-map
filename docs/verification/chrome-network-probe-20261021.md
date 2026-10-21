# Chrome 来源连接诊断 — 2026-10-21

本轮仅只读诊断，未修改产品、网络、安全策略、来源目录或部署，未提交研究。无可用 CloudBase/容器执行工具，因此未执行上海容器探测。

## 直接证据

1. 019 候选配置 Chrome URL 为 https://chromereleases.googleblog.com/feeds/posts/default。源码 requestCount++ 位于 await request 之前，故 req=1 不证明 TCP/TLS 完成，旧报告所谓“DNS/连接已过、正文超时”证据不足。
2. 沙箱初次 curl DNS 失败；获准使用宿主网络后，同一 URL 返回 HTTP302，1.431秒，跳转至 http://feeds.feedburner.com/GoogleChromeReleases。沙箱失败不能作为公网故障结论。
3. 单次读取该跳转目标的 HTTPS 版本 https://feeds.feedburner.com/GoogleChromeReleases，HTTP200，text/xml，1,069,159字节，1.557秒，无跳转。未保留正文、未做XML解析，不能据此宣称产品feed解析通过。
4. 宿主两次请求远端地址分别198.18.0.64和198.18.0.67，落在非公网范围。存在本机代理/合成DNS的可能，未查配置，不据此判断具体代理机制。curl对照不是产品安全读取器通过证据，更不能代表腾讯云上海直连。

## 结论与最小下一步

新增确定线索为 GoogleBlog 入口跳转 FeedBurner，并降为HTTP；这增加连接环节，但尚未证明它是上海超时根因。不能归因为“Google不支持中国市场”。HTTPS FeedBurner 是待云端核验的直接入口候选，不自动修改来源。

下一步只需在目标云环境用产品安全读取器format=feed、既有12秒预算，对HTTPS FeedBurner地址读取一次；拿到安全地址判定、状态、阶段/错误码及字节数。成功后再决定是否把Chrome来源URL改为此官方跳转目标的HTTPS版本；失败则记录来源暂不可用并保留其他来源，不反复提交完整研究。

原始本机诊断证据：outputs/chrome-network-probe-20261021/。浏览工具对原URL仅报不支持text/xml，不能当作云端证据。
