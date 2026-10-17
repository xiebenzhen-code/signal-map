# 自选来源 DoH 运行验收记录（2026-10-04）

本节验收目标：在被 TUN fake-IP 阻塞的网络环境下，用**正常启动方式**让自选来源抓取经由
`SOURCE_DOH_URL` 真实解析，并**经正常页面路径**确认“检查 → 保存 → 刷新保留”，不提交研究。

## 一、材料确认（Adobe 原文）
- 完整 URL：
  `https://blog.adobe.com/en/publish/2026/09/08/generate-create-directly-in-your-timeline-with-new-ai-powered-innovations-in-premiere-after-effects`
- 页面标题：`Generate and create directly in your timeline with new AI-powered innovations in Premiere and After Effects`
- 发布日期：2026-09-08（页面 Path 与元数据一致）
- 正文摘要：Generative Media Tool（在时间轴内生成视频/音效，模型可选 Firefly/Veo/Kling/Runway/Luma）、
  Separate Crosstalk（拆分重叠双声道）、Dynamic Auto Ducking（自动闪避）。
- 与上一轮材料的核对：标题前缀、日期（09-08）、三特征逐一吻合 → **确为同一篇**。
- ⚠️ 校正：上一轮把该文记作“Premiere Pro 26.5”，实际为 **Premiere + After Effects 双产品公告**，
  全文无“26.5”字样；我方“26.5”标注有误，已按页面更正。

## 二、配置持久性
- 配置文件：`.env.local`（gitignored，见 `.gitignore` 第 30–31 行），为后端正常启动时加载的本地配置。
- 键：`SOURCE_DOH_URL=https://dns.google/resolve`
- 启动命令（后端正常启动方式）真实指定加载该文件：
  `node --env-file=.env.local --experimental-strip-types backend/node-server.ts`
- 该命令为当前运行后端进程的实际命令行（已核对），非随进程退出的临时变量。

## 三、运行激活
- 重启前：页面检查同一 URL → `blocked`（来源解析到非公开地址，requestCount=0）——DoH 未生效，系统 DNS 返回 TUN fake-IP。
- 重启步骤：确认 8080 监听进程为本项目后端（脚本 `backend/node-server.ts`，vendored node），
  停旧进程后以**同一命令**从项目根目录重启（新 PID 35928），未改系统 DNS / 代理 / 地址守卫 / TLS 校验。
- 重启后：页面检查 → `readable`（requestCount=1）。
- 共 2 次真实页面检查（重启前 blocked + 重启后 readable）。

## 四、正常页面检查（无 IP 注入 / fixture）
经 `POST /api/sources/check`（即页面“检查链接”的后端路径），非诊断 IP 注入：
- 当前来源框含两行：
  1. `https://example.com/update` → `页面未能读取`（既有测试源，非本轮目标）
  2. Adobe 原文 URL → `正文可读取；仍需按相关性、时间和证据进行筛选。`（readable）
- 附：页面诚实提示 Adobe 文“未识别到发布日期，暂不能确认是否属于所选时间范围”。
  正文发布日期已由本记录第一节确认（2026-09-08）。

## 五、来源保存与刷新
- 页面点击“保存来源”→ 状态提示“来源已保存到当前浏览器的这个过滤器，下次研究时使用。”
- `tab.reload()` 刷新后重新展开“更多筛选”→ 来源框仍含 Adobe 完整 URL（保留确认通过）。
- 未点击“开始研究”。

## 六、计数
- 产品模型调用：**0**
- 真实研究提交：**0**
- 检查端点请求：3（重启前 curl×1 blocked、重启后 curl×1 readable、页面“检查链接”×1）
- 定位原文的检索代理（Explore，仅 Web 搜索/核查，非产品研究模型）：1（23 次工具调用）

## 七、修改文件 / 恢复方式
- 本轮无源码修改。新增日志：`backend-run23.log`；新增本验收记录。
- `.env.local` 中 `SOURCE_DOH_URL` 为既有键（DoH 轮次启用，gitignored）。
- 恢复方式：删除/清空 `.env.local` 中 `SOURCE_DOH_URL` 并重启后端即可回到系统 DNS 行为；
  停止后端以 `Stop-Process -Id <PID>` 或结束终端任务。

## 八、边界
- 本记录为“自选来源检查 + 保存 + 刷新保留”的页面级真实链路验收；
- **不构成**完整研究与信息呈现的验收；“readable”与“保存成功”不代表研究链路通过。
- 未 commit/push/deploy/打包；未改系统 DNS/代理/数据库/证据门槛；未删测试数据/覆盖无关改动。