# RSSHub HTTPS 网关设计（P2-H STEP 3，仅设计未上线，2026-10-24）

配套实现：master 请求头鉴权补丁（X-Relay-Key 同源附带、跨域跳转拒绝、URL 永不带 key）。
本文件是 Lighthouse `lhins-pfzwcoao` 上线前的网关基线；未启动任何容器、未改防火墙、未申请证书。

## 拓扑
```
Signal Map API 025 ──HTTPS 443──> nginx 网关(宿主机) ──HTTP──> RSSHub 容器(仅绑 127.0.0.1:1200)
   携带 X-Relay-Key 头                校验/剥离/限流/限体
```

## nginx 基线（443，仅两条精确路由）
```nginx
limit_req_zone $binary_remote_addr zone=rsshub:10m rate=2r/s;

server {
  listen 443 ssl http2;
  server_name <relay-domain>;                     # 待用户确定域名
  ssl_certificate     /etc/ssl/rsshub/fullchain.pem;   # 证书待申请（本轮不办）
  ssl_certificate_key /etc/ssl/rsshub/privkey.pem;

  # 默认拒绝一切未登记路径
  location / { return 404; }

  location = /36kr/newsflashes { include /etc/nginx/rsshub-relay.conf; }
  location = /geekpark/304      { include /etc/nginx/rsshub-relay.conf; }
}
```
`/etc/nginx/rsshub-relay.conf`：
```nginx
if ($http_x_relay_key != "<RSSHUB_ACCESS_KEY 同值>") { return 401; }   # 缺失/错误一律 401
limit_req zone=rsshub burst=4 nodelay;                                  # 限流
proxy_pass http://127.0.0.1:1200;                                       # 仅回环后端
proxy_http_version 1.1;
proxy_set_header X-Relay-Key "";                                        # 转发前剥离鉴权头
proxy_set_header Host $host;
proxy_connect_timeout 3s; proxy_read_timeout 12s;                       # 对齐读取预算
proxy_max_body_size 1k;                                                 # 入向体限制
proxy_buffering on;                                                     # 响应整包回落（读端自限 2MB）
```
- **查询参数透传**：仅放行 `limit`（`if ($arg_limit !~ ^[0-9]{1,2}$) { return 400; }` 可加严；RSSHub 路由内部固定 limit=5，可进一步 `proxy_pass ...?limit=5` 覆盖丢弃来参）。
- **日志脱敏**：nginx 默认 access_log 不记录请求头；`log_format` 显式不含 `$http_x_relay_key`；错误页/日志禁含入参头。
- **响应体限制**：`limit_rate 256k;` 可选叠加；读端自身 2MB 上限保留。

## 容器与网络
- `docker run -d --name signal-map-rsshub --restart unless-stopped --network bridge \
  -p 127.0.0.1:1200:1200 --cpus 0.25 --memory 512m \
  -e NODE_ENV=production -e CACHE_TYPE=memory -e CACHE_EXPIRE=3600 \
  -e REQUEST_RETRY=0 -e REQUEST_TIMEOUT=10000 -e NO_LOGFILES=true \
  ghcr.io/diygod/rsshub@sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff`
- **不设 RSSHub 内置 ACCESS_KEY**（网关层鉴权）→ 后端仅暴露于回环：`-p 127.0.0.1:1200:1200` + 防火墙 1200 不开（当前即未开）→ **只有网关可达后端**（证明方式：`ss -tlnp | grep 1200` 仅 127.0.0.1；`curl http://<公网IP>:1200/` 超时）。
- 自动恢复：`--restart unless-stopped` + `docker update --restart unless-stopped` 生效核验；健康检查建议 `healthcheck curl -fsS http://127.0.0.1:1200/`。

## 待办（上线时）
1. 域名与证书（用户定）；2. 防火墙加 443（需授权）；3. GHCR 拉取连通性实测（SSH 恢复后）；4. API 025 env：`RSSHUB_BASE_URL=https://<域名>` + `RSSHUB_ACCESS_KEY`。
回滚：API env 清空即回 not_configured；网关下线=停 nginx site；容器回滚=固定 digest 重跑。
