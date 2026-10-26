# 阶段 1：账户重查引起的页面跳动修复

日期：2026-10-26（香港时间）。本轮仅本地修补、测试与提交；不部署、不提交线上研究、不读取凭据。

## 1. 修改与提交

基线：`p2n/stability-and-diagnosis@1a0bd12ab631c41326fdbf52fdf3fc799c21e04a`。
隔离修复分支：`codex/session-focus-fix-20261026`；本报告与修补同一提交，可单独回滚。本地开发分支仅在确认无新漂移后快进到该提交，不覆盖无关文件；未推送远端。

修改范围：

- `app/components/local-account-boundary.tsx:15`：请求串行化；新一轮检查使旧响应失效，检查在途时至多排队一次重新检查；卸载后不更新状态。
- `app/components/local-account-boundary.tsx:25`：同一账号保留原 user 对象引用，避免首页依赖 currentUser 的知识库、关注列表重复加载。模式由现有 LocalAccount 类型限定为 authenticated，匿名为 null。
- `app/components/local-account-boundary.tsx:35`：同一微任务调度批次的生命周期事件合并；普通 pageshow 不再重复初始校验，BFCache 恢复仍检查。保留 focus 与 visibilitychange，不因本轮修补漏掉并排可见窗口的账号切换。
- `app/components/local-account-boundary.tsx:56`：checking 使用 visibility:hidden 保留页面占位高度，并加 inert/aria-hidden 隔离交互与辅助技术；提示层固定定位，不挤压文档流。失败仍清除用户并移除旧内容，不能回退到匿名资料。
- `tests/local-account-boundary.test.ts`：保留初始失败、过期响应与隔离断言，扩充为 10 项行为测试；覆盖布局保持、事件合并、同账号引用、仅 focus 的 A→B 切换和卸载清理。
- `package.json:22`：补登记上一轮遗漏的 `session-logout.test.ts`，使 7 项退出测试进入 npm test。117 个测试文件与脚本一一对应，无遗漏/缺失。

未修改鉴权后端、Cookie/Supabase 配置、数据库、研究入口、过滤规则、安全读取器、依赖或生产配置。

## 2. 验证结果

先红后绿：原实现对 9 项边界测试有 5 项失败；直接去掉 focus 的初稿被独立审查指出跨窗口账号错配风险，已废弃。恢复 focus 后追加布局回归，红灯 10 项中 4 项失败；最终边界测试 10/10 通过。首次完整 quality 曾因新增测试的 assert 深度相等将数组收窄为 never[] 而在类型检查失败；已改为长度断言，不改业务逻辑、不删用例。所有中间日志保留，最终结果单独记录。

真实 Edge 浏览器使用真实 React 组件与本机假账户接口，只验证 UI 状态与滚动机制，不能冒充生产登录验收：

| 情况 | 原实现 | 修补后 |
|---|---:|---:|
| 校验前滚动位置 | 900px | 900px |
| 校验时滚动位置 | 0px | 900px |
| 校验时页面高度 | 720px（原 3900px） | 3900px |
| 同一同步焦点事件组请求数 | 3 | 1 |
| 同账号输入/子树挂载 | 保留输入，但滚动位置丢失 | 输入与挂载、滚动位置均保留 |

本机浏览器还验证 A→B 切换、确认匿名、503 失败后移除旧内容；测试期间没有访问正式站、登录端点或研究端点。浏览器请求合并结论限于同一调度批次，不能说不同时间的所有 focus 都只发一次请求。

Node v24.21.0，最终固定内容门禁（19:50–19:54，香港时间）：

| 检查 | 结果 |
|---|---|
| npm run quality | exit 0；1005 tests / 999 pass / 0 fail / 6 skipped；lint 0 errors / 29 warnings |
| npm run build | exit 0，Build complete |
| npm run api:build | exit 0 |
| 测试登记 | 117/117，unlisted=0 / missing=0 |
| git diff --check | exit 0 |

6 项跳过为 DATABASE_URL 条件控制的数据库集成用例，不算通过。中间一轮在继续审查期间运行的结果单独命名为 intermediate，最终门禁重新完整运行，未沿用该轮作为最终证明。无删除/跳过新增测试，无改门禁或环境保护。

证据目录：`F:/ai signal map/signal-map/outputs/session-focus-fix-20261026/`。核心文件为 `layout-red.log`、`layout-green.log`、`browser-results.json`、`quality.log`、`build.log`、`api-build.log` 及各自退出码 JSON。独立源码复审未发现剩余阻断问题；随后对固定最终内容完整复跑门禁。

## 3. 未验证项

- 正式域名当前 Web 的提交身份，以及线上是否已含此补丁。
- 真实测试账号登录→退出→刷新→重登，以及真实 Supabase 故障、Cookie 分片清除行为。
- 数据库条件跳过项。
- 使用真实研究输入的页面效果与过滤质量；本轮线上研究 0 次。

## 4. 风险与边界

账户重查仍会短暂遮蔽私有内容并显示检查提示，本轮消除的是页面高度塌陷、滚回顶部和同账号重载，不承诺取消所有检查画面。焦点校验保留以防另一可见窗口切换账号；不能用保持旧画面来规避账户隔离。串行检查期间如账号又变化，会等待旧检查结束后做一次新检查，未增加自动失败重试。

现有后端将部分鉴权异常映射成 user:null 的 D2 问题未在本轮修复，不宣称登录链路所有问题已消除。

## 5. 回滚方式

对本报告所在的单一修复提交执行 git revert；只恢复这 4 个文件，不撤销前面的退出入口修补。未部署，所以无需生产回退。

## 6. 下一步

交付本地修复提交后停止。后续若发布，只需把该固定提交的 Web 前端纳入单独发布与人工登录/焦点/滚动验收；不为本补丁重发 API 或重配数据库。未推 master、未推远端、未创建 PR、未执行阶段 2。
