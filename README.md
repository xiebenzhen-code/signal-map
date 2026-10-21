# Signal Map

面向指定主题和公开来源的个人信息筛选工具：先检查来源与证据，再判断相关性、新鲜度和信息增量。

**阶段：受限试用（2026-10-21）。** 正式访问入口：[signal.benzhenlab.com](https://signal.benzhenlab.com/)。正式域名已发布 Sites 版本53，连接既有 API019；本次真实浏览器登录、回首页及刷新保留登录态通过。

![Signal Map 系统框架](docs/portfolio/signal-map-architecture.png)

## 能做什么

- 将自然语言问题转为有预算约束的检索计划，读取官方更新、RSS/Atom及其他已配置来源。
- 进行日期、任务相关性、去重、聚合与证据评估，区分已验证内容、待验证线索和证据不足。
- 展示实际来源覆盖与读取失败；后续未搜索的轮次不会抹掉先前成功或失败的记录。
- 提供账户、知识记录和反馈持久化接线；**自动记忆参与研究当前关闭**，不能承诺已完成跨次个性化闭环。

## 当前覆盖范围

17路已登记订阅源不等于17个完整行业，也不代表全部线上可用；每次按实体/主题最多选择3路订阅，另有既有通用检索路径。

| 领域 | 已登记来源或范围 | 当前边界 |
|---|---|---|
| 影视制作与创作软件 | Kdenlive、OBS、Krita | 主要是工具发布与更新，不覆盖整个影视产业；API019实读OBS10条、Kdenlive20条，属于读取/解析证据 |
| 电商与独立站 | Shopify、WooCommerce | Shopify有历史读取证据；WooCommerce近期因非公网地址预检被拒绝，尚未恢复 |
| 编程与开源 | Node.js、GitHub、Mozilla、阮一峰、InfoQ、开源中国 | 各来源验证程度不同；Chrome/FeedBurner在API019仍超时 |
| AI与国内科技 | OpenAI、IT之家及相关技术来源 | 可发现部分产品技术变化，不承诺完整行业覆盖 |
| 数字生活与游戏 | 少数派、机核 | 已登记不等于已完成所有线上场景验收 |
| 航天与天文 | NASA | 有历史云端读取证据，仍需按具体问题筛选 |
| AI＋教育等其他行业 | 通用检索与用户公开网页线索 | 尚无充分专门来源和行业验收，不列为正式支持承诺 |

来源目录：[feed-catalog.ts](source-registry/feed-catalog.ts)。可靠性由具体文章、日期及证据决定，不能仅依据发布平台或“官方”标签。

## 技术结构

Web：React / vinext；API：Node.js；认证：Supabase Auth；持久化：PostgreSQL。账户数据读取以用户及过滤范围约束；实际跨账号验收仍待完成。

主要接口：`POST /api/signals`、`POST /api/research/plan`、`/api/research/stream`、`/api/control/knowledge`、`POST /api/sources/check`。接口并非成熟公共SDK；第三方跨域认证、调用额度和版本契约需另行整理。`sources/check`当前为网页模式，不能替代RSS feed模式验收。

## 本地运行与检查

要求 Node.js >=22.13，依赖以package-lock.json为准。

```sh
npm ci
npm run dev
# 独立Node API，在另一个终端运行
npm run api:build
npm run api:serve
```

认证、数据库和可选模型需自行安全配置，参考项目公开环境变量模板；不要提交.env、Cookie、token或数据库连接串。

```sh
npm run quality
npm run build
npm run api:build
```

最新已记录门禁：902项测试，896通过、0失败、6项因缺少数据库环境跳过；前端/API构建通过。这是对应修复版本的历史验证，不等于所有行业或生产数据库端到端通过。

## 已知限制与交付状态

本次正式域名演示中，Kdenlive问题确实读取20条、聚合18个信号，但没有内容通过最终展示门槛；部分维护更新被标记主题不匹配。因此只证明读取与筛选链执行，**不将该场景记为答案质量通过**，相关性边界仍有改进空间。


- API019已有发布记录；Web013为上一轮Web版本。正式域名已更新为Sites版本53，源码与本轮生产修复对应，API后端仍为019。
- 临时共享入口曾出现内嵌浏览器登录失败；正式域名版本53本次浏览器登录及刷新成功，历史失败根因不据此倒推。
- 长期记忆自动参与关闭；退出重登、跨账号隔离的本轮生产验收尚未完成。
- 定时跟踪、主动提醒及社媒持续抓取不能作为当前已运行的生产承诺。网页捕捉skill是辅助线索工具。
- 来源成功读取不代表全部内容属于指定日期范围或能通过筛选；零结果不等于世界上没有信息。

## 作品集材料与证据

- [框架图SVG](docs/portfolio/signal-map-architecture.svg) / [PNG](docs/portfolio/signal-map-architecture.png)
- [正式交付记录](docs/verification/formal-portfolio-delivery-20261021.md)
- [API019发布与诊断](docs/verification/api-repair-release-20261021.md)
- [OBS/Kdenlive云端读取](docs/verification/other-feeds-cloud-probe-20261021.md)
- [正式域名实机演示视频](docs/portfolio/signal-map-demo.mp4)：一次真实研究，检索20条、聚合18个信号、展示0；保留空结果，不冒充问题已回答。等待过程以2倍速剪辑，详见[录制说明](docs/portfolio/DEMO.md)。

此仓库展示个人项目的工程实现与有边界的实测结果，不承诺全网实时覆盖或每次研究都有答案。
