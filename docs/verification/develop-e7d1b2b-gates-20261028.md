# develop e7d1b2b 门禁证据

日期：2026-10-28（Asia/Hong_Kong）。基线：`e7d1b2bff40fb6f961685963782909c03338cc9d`。

该提交只更新 README；下述命令在提交前相同产品文件内容上执行。Node.js `v24.21.0`。依赖复用本机已有 node_modules 链接，未联网安装。

| 命令 | 退出码 |
|---|---|
| `npm run quality` | 0 |
| `npm run build` | 0 |
| `npm run api:build` | 0 |

quality：1035 项，1029 通过，0 失败，6 项跳过。6 项均由缺少 `DATABASE_URL` 门控，不计作通过。数字不是覆盖率或线上效果。

原始日志位于执行机器的 `develop-consolidation-evidence-20261028/`（仓库外，不随克隆分发）。以下哈希可用于核对维护者保存的原文件：

| 文件 | SHA-256 |
|---|---|
| `quality.log` | `c3fe332e90b568549170572c237999d28819c5533924a138baa4cb20bb1c8434` |
| `build.log` | `a1dccdeb5d199f5694e07a023398083f8afe928da8cc2361841680f89f738cd5` |
| `api-build.log` | `86fbe2e1fcc5646d9f3d1f7547bbd365fdf40845d645203dfe912acb831321a4` |
| `exits.json` | `4a851cfc1f41af385b37a23861fffa36f96aac6824387955715ec303cad8a2ab` |

## 本次 README 更新复跑

2026-10-28，使用 `npm ci` 安装的独立依赖（不再链接旧发布工作区），Node.js `v24.21.0`。`quality`、`build`、`api:build` 均退出 0；1035 项，1029 通过，0 失败，6 项数据库条件跳过；lint 0 error / 29 warnings。未修改 package-lock.json。

日志保存在执行机器的 `develop-readme-update-20261028/`（仓库外）：

| 文件 | SHA-256 |
|---|---|
| `npm-ci.log` | `7f209a90221581f1d9fd34a4088bfc192261ae8dc0a3459d81f78d4a837867e3` |
| `quality.log` | `4504583bc48995aecf9418857bfdd1a63600368a50e314be356363ab45893bbc` |
| `build.log` | `95ea885b96319857e2fdc513ad6fc1335745e8bb2cd6fa77871ac8d008766c94` |
| `api-build.log` | `7f9285f1e30967ccac4d5204687791e17bb9a31841e2a598d4e6aa686fc66fa8` |
| `exits.json` | `fa696c698f93eec238117caeb83113a67208883957610f9379738f519f910928` |
