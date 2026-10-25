# RSSHub 发布候选收口

本计划执行用户已批准的“收齐代码、部署模板和脚本，先提交发布候选”。
执行范围为本地整理、门禁、Git 分支交付与干净导出；服务器操作属于后续阶段。

## 版本关系

- Signal Map 基线：远端 master 8be8574，包含接入代码 2503273。
- RSSHub：固定外部镜像 digest，具体值见 deploy/rsshub/release-candidate.json。
- 候选提交统一追踪接入代码、部署配置、验证脚本与版本清单。
- 部署后另补实际运行身份与验收记录；候选不等于已上线版本。

## 文件与责任

- deploy/rsshub/start-local.sh：仅在固定镜像已存在、无同名容器且端口空闲时创建回环容器。
- deploy/rsshub/verify-local.sh：一次本机请求，校验 36氪 RSS 和原始链接/日期。
- deploy/rsshub/nginx.conf.template：固定精确路由、443 TLS、请求头鉴权与剥离。
- deploy/rsshub/release-candidate.json：代码基线、镜像、目标机器和未完成条件。
- deploy/rsshub/README.md：镜像就绪、启动、网关、生产验收与回退步骤。
- source-registry/feed-catalog.ts：仅更正请求头传输和来源证据的注释。

## 执行清单

- [x] 保留主工作区漂移，从 master 创建隔离候选分支。
- [x] 实时查询远端 master，确认与本地基线一致。
- [x] 整理模板、脚本、版本清单和说明。
- [x] Bash 语法检查，检查 Git 内容差分与行尾。
- [x] 用与锁文件版本一致的依赖运行 quality、build、api:build。
- [ ] 提交并推送独立候选分支，回读完整 SHA。
- [ ] 从候选提交 git archive 干净导出，生成逐文件 SHA256 与归档身份记录。

## 后续阶段入口

镜像下载尚未确认完成；中继域名、证书与云防火墙仍待核实。
生产容器双路实读和一次浏览器研究尚未执行。本阶段不补写成功结论。
