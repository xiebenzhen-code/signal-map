# 0b-5 README 输入件：来源数量证据与 PR 描述草稿（2026-10-26）

**状态：部分交付。** README 正文重写尚未执行，原因是任务书指定的「README_SYNC 标注 N4 working tree 版本」底稿不存在，
已按要求向用户索取。本文只交付不依赖该底稿的部分。

## 1. 底稿缺失的证据

| 检查 | 结果 |
|---|---|
| 当前 worktree `README.md` 首行 | `<!-- README_SYNC: source=eb6666d5a46c1cf42647840a7601c211e2c7e12e; updated=2026-10-22 -->` |
| `README_EN.md` 首行 | 同上 |
| 其他 worktree（`F:/ai signal map/signal-map`、`smfix/mem-worktree`） | 前者无 README 文件；后者同样是 `source=eb6666d` |
| `git log --all -- README.md` 中出现的不同 `README_SYNC` 标注 | 只有 `source=eb6666d...`（首次出现于 `7268bf8`） |
| 任一历史 README 版本含 `N4` 字样 | 无 |

结论：仓库历史上不存在 N4 working tree 版 README。按任务书要求，此处向用户索取，不自行以旧版本冒充底稿。

## 2. 来源数量：脚本统计（替代 README 现有数字）

统计方式：临时脚本直接 `import` `source-registry/feed-catalog.ts`，读取 `registeredFeeds` 与 `rsshubRelayFeeds()`，
不依赖 README 或文档中的既有说法。

执行命令（Node 24）：

```bash
node --experimental-strip-types /c/Users/25186/AppData/Local/Temp/count-feeds.ts
```

输出：

```json
{
  "staticFeeds": 18,
  "staticOfficial": 10,
  "staticUnofficial": 8,
  "staticCloudVerified": 4,
  "relayFeeds": 1,
  "relayReason": null,
  "totalFeeds": 19,
  "publisherNames": 54
}
```

| 指标 | README 现写 | 脚本实测 | 差异 |
|---|---|---|---|
| 登记订阅源 | 17 路 | **19 路**（18 静态 + 1 RSSHub 中继 `36kr-flashes`） | +2 |
| 其中官方发布方 | 11 路 | **10 路** | −1 |
| `cloudVerified: true` 的静态源 | 7 路（README 称有云端读取证据） | **4 路**（`nasa`、`ithome`、`sspai`、`geekpark-news`） | README 的「7 路」是把历史探测记录与目录标记混算，需改写表述 |

源 id 清单（18 静态）：`shopify`、`nodejs`、`nasa`、`github`、`mozilla`、`openai`、`ithome`、`sspai`、`gcores`、
`ruanyifeng`、`kdenlive`、`obs`、`krita`、`woocommerce`、`chrome`、`infoq`、`oschina`、`geekpark-news`；
外加中继 `36kr-flashes`。

**注意**：`cloudVerified` 只表示传输层读取成功，不表示内容可信，也不表示持续可达。README 必须保持这一区分。

## 3. README 必改项清单（待底稿确认后执行）

1. 首屏保留演示视频链接与架构图、徽章；删除「Star 收藏」两处（首屏与文末）。
2. 演示视频加时效说明：录制于 2026-10-21，对应 Sites53 + API019，不能证明 API 027 的效果。
3. 来源数字改为「19 路，其中 10 路官方发布方」，并给出 `source-registry/feed-catalog.ts` 作为证据路径。
4. 「7 路具有历史云端读取成功证据」改为引用具体文档，或改为「4 路标记 `cloudVerified`」，不得混用两种口径。
5. 删除「克隆需要仓库访问权限」一句（仓库已公开）。
6. 本地运行命令：分支改为远端实际存在的 `p2n/stability-and-diagnosis`，补 bash 版本，保留 PowerShell。
7. 所有「不能证明 / 尚未 / 不承诺」集中到「已知局限」小节。
8. 每个数字旁标注证据文件路径（测试数、来源数、版本号）。
9. 版本口径：仅引用仓库内可核验的 Sites53 + API019；API 027 证据未入仓前，不引用其演示与数字。

## 4. PR 描述草稿（覆盖 0b 全部提交）

```markdown
## 改了什么

- 基线：新增 `docs/verification/CURRENT-BASELINE-20261026.md`，记录 HEAD、API 027 源码 `cf16408`、门禁退出码与 UNKNOWN 清单；
  声明 `e5e7439` 不可解析，以该文件为准。
- 诊断入口：postgres 与 supabase 探针共用 `backend/diagnostic-token.ts` 的常量时间令牌比较；
  未配置令牌返回 404（默认关闭）、缺失或错误令牌返回 401、postgres 探针在令牌通过后仍需有效会话；
  探针改为可注入 `resolveAuth` / `runProbe` 的工厂，测试用桩验证门序，不连真实数据库。
- 仓库卫生：停止跟踪 4 个一次性诊断转录（`outputs/`）；`.gitignore` 增加 `!certs/*.pem`；
  两份 2026-10-02 报告移入 `docs/archive/` 并标注「历史快照」。
- 文档：来源数量由脚本从 `feed-catalog.ts` 统计（19 路 / 10 官方），修正 README 待改项并给出 PR 描述。

## 证据

| 项 | 证据 |
|---|---|
| 红灯 | `1efd19f`：新增 6 条测试，28 项中 6 失败（能力缺失），22 通过 |
| 绿灯 | `e4caa59`：同一文件 28 项全过 |
| 门禁 | `0ed7a6a`：quality 0（986 项：980 通过 / 6 跳过 / 0 失败；lint 30 warnings、0 errors）、build 0、api:build 0 |
| 忽略规则 | `b4cbb03`：`certs/*.pem` 可新增，其他 `*.pem` 仍被忽略（已用临时文件验证后删除） |
| 来源统计 | 本文第 2 节的脚本输出 |

## 风险

- 诊断端点的默认关闭语义会改变匿名探测的现有响应（401 → 404）；线上已配置令牌，但**该实现尚未部署**，部署需单独授权。
- `outputs/` 仅停止跟踪，历史提交中仍存在；未改写历史。
- 远端实时 HEAD 未能读取，基线依据本地远端引用缓存。
- README 正文尚未重写：N4 底稿不存在，等待用户提供。

## 不包含

不部署、不发起线上研究、不调用付费模型、不改数据库结构、不放宽任何门槛、不推 master、不改仓库设置、不选许可证。
```

## 5. 待用户提供

`README_SYNC` 标注 N4 working tree 版本的 `README.md` / `README_EN.md`（文件路径或提交号）。
若确认不存在，请指定以下之一：以当前 `source=eb6666d` 为底稿重写，或本轮跳过 README 正文。
