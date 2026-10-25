# RSSHub 发布候选（部署前材料）

本目录与所在 Git 提交一起固定 Signal Map 接入代码、RSSHub 镜像和部署步骤。
RSSHub 负责通过已登记路由采集公开信息并转换为 RSS；本候选仅开放 36氪快讯。
极客公园继续使用官方 RSS 直连。第三方镜像不复制进本仓库。

## 当前状态

基线 master 为 8be8574，接入代码为 2503273。完整 SHA、镜像 digest、配置约束见 release-candidate.json。
候选身份是包含本目录的 Git commit；下载时使用该提交的 git archive，不能混用旧主工作区。
API 024 是此前报告的在架版本，本轮未实时核对。候选尚未完成部署与线上验收。

新实例 lhins-lbffbux2（124.220.183.159）已由用户截图确认安装 Docker。
上次固定镜像下载仍未确认完成；不要重复启动已有下载任务。
域名和证书尚未指定，因此 nginx 文件是待填域名的配置模板，不能直接启用。

## 1. 固定镜像到位后在服务器启动

先检查现有任务与镜像，无镜像时停止，不用 latest 替代。下载卡住时可从能访问 GHCR 的机器
传输同一 linux/amd64 镜像的 docker save 文件，服务器 docker load 后仍须校验 RepoDigests；
不要把归档文件的 SHA256 当成镜像 digest。

```bash
pgrep -af '[d]ocker pull' || true
docker image inspect ghcr.io/diygod/rsshub@sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff --format '{{json .RepoDigests}}'
bash deploy/rsshub/start-local.sh
```

start-local.sh 不拉取镜像、不覆盖同名容器；仅绑定回环 1200，限制 0.25 CPU / 512MiB，
日志轮转 3×10MiB。它只证明容器已创建，不证明来源可用。
启动稳定后只执行一次：

```bash
bash deploy/rsshub/verify-local.sh
```

此脚本只请求本机 36氪路由一次，12 秒截止，无重试，校验 RSS、非空标题/日期及 36kr.com 原文链接。
标准 XML 解析通过属于 RSSHub 本机就绪证据，不能替代 Signal Map 生产读取器与解析器验收。

## 2. 准备 HTTPS 网关（域名和证书齐备后）

管理员确认所用子域名 DNS 指向本实例，并将有效证书安装到模板指定路径。
本轮不代选域名、不改 DNS、不申请证书。上海实例的域名访问要求需实际核查。
网关使用宿主机 nginx；仅云防火墙 443/TCP 需要新增入口，保留 SSH，1200 不开放。
不要整体替换现有 nginx 配置或防火墙。

在服务器生成密钥；不把密钥写入 URL、聊天、Git、日志或公开证据。
以下操作遇到已有密钥即停止，不做隐式轮换：

```bash
sudo bash <<'MAKE_RELAY_KEY'
set -euo pipefail
test ! -e /etc/nginx/rsshub-access.key
test ! -e /etc/nginx/rsshub-secret.map
umask 077
openssl rand -hex 32 > /etc/nginx/rsshub-access.key
task_key=$(cat /etc/nginx/rsshub-access.key)
printf '"%s" 1;\n' "$task_key" > /etc/nginx/rsshub-secret.map
unset task_key
MAKE_RELAY_KEY
```

将 nginx.conf.template 中唯一的 RELAY_DOMAIN 替换为已确认域名，放入 nginx 的 http include 目录。
该模板仅暴露一个精确路径，丢弃外来 query，固定 limit=5；鉴权成功后剥离 X-Relay-Key。
使用正确指令 client_max_body_size；历史设计稿中的 proxy_max_body_size 不是有效 nginx 指令。

启用前必须 nginx -t 成功，随后才 reload。验证无头/错误头为 401、未知路径为 404，
正确头取得有效 RSS；检查日志无 key、证书验证正常、公网 1200 不可达。
网关成功前不配置生产 API。不要用 curl -k、禁用地址保护或延长读取预算通过验收。

## 3. 接入生产前后的验收

通过受保护的配置界面把裸 HTTPS origin 写入 RSSHUB_BASE_URL，
把服务器同一密钥写入 RSSHUB_ACCESS_KEY；保留其他配置。
在目标 API 容器内使用现有 readCustomSource(format=feed) 和 parseRegisteredFeed，
分别读取 36氪 relay、极客公园官方 RSS 各一次。保留模块哈希、细分错误码、请求计数、
条目计数、原始链接/日期；不输出正文或密钥。两路通过后才申请受控发布。

发布前重新确认实际承流版本与回退目标；新 DeployId 由平台分配，不预设为 025。
发布后一次页面研究，区分来源读取、过滤、正式结果、观察层与页面状态。
失败停止并留证，不自动重复研究。生产网络稳定性不能由本地成功推导。

## 4. 回退与证据

网关异常：禁用本次独立 site 并 nginx -t 后 reload，保留其他站点。
容器异常：docker stop signal-map-rsshub（不删镜像/数据）。
API 回退按发布前实际记录执行；停用 relay 配置会回 not_configured，不能称来源已恢复。

上线后另补报告提交，记录候选完整 SHA、实际 image ID/RepoDigest、网关验证、
API 部署身份与回退目标、一次研究结果。当前目录明确不包含这些尚未取得的成功证据。
