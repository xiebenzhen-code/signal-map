# 可配置 DoH 来源解析报告（2026-10-03）

## 范围
仅来源抓取兼容：自选 DoH 解析器（`SOURCE_DOH_URL`，JSON DoH 端点，服务端专用），页面检查端点与研究管线共用同一解析规则。未配置时保持系统 DNS；配置后解析失败诚实报错，不静默回退。

## 一、实际文件修改
| 文件 | 修改 |
|---|---|
| `source-enrichment/doh-resolver.ts`（新增） | 共享 DoH 解析器：`createDoHLookup(url)`（3s 超时、JSON DoH、A/AAAA 提取）、`validateAnswers`（无结果/畸形/混合公私网整体拒绝）、`getSourceDoHResolver()`（读 `SOURCE_DOH_URL`，未配置时 configured=false 走系统 DNS）、`resolveSourceAddresses`（导出供校验） |
| `source-enrichment/custom-source.ts` | 读取路径接入共享解析器：`SOURCE_DOH_URL` 配置时每跳主机经 DoH 解析，未配置保持 `node:lookup`；重导出解析器；新增 re-export 行 |
| `backend/custom-sources.ts` | 页面检查端点消费同一 `getSourceDoHResolver`（条件 1.1 共用接线），lookup 注入 `readCustomSource` |
| `tests/doh-source-resolution.test.ts`（新增 7 用例） | 红→绿全覆盖（见第三节） |
| `package.json` | 注册新测试 |

未修改：来源选择、评分、证据门槛、`isPublicSourceAddress` 守卫本体、UI。

## 二、红→绿（TDD）
| 用例 | 红（修补前） | 绿（修补后） |
|---|---|---|
| 1. 检查与读取共用同一解析配置（注入） | —（注入路径已存在，作守卫） | ✔ |
| 2. `SOURCE_DOH_URL` 配置后读取经 DoH 解析 A 记录并钉定连接地址 | ✖ 无 `createDoHLookup`/无 SOURCE_DOH_URL 消费 | ✔ |
| 2b. 混合公网+私网应答**整体拒绝**（不部分挑选） | ✖ 无此校验 | ✔ `来源解析到非公开地址，已整体拒绝` |
| 2c. 无结果 / 畸形应答 / 超时诚实失败 | ✖ 无此校验 | ✔ 三种错误分别抛出（无结果/畸形/超时） |
| 3. 地址守卫在 DoH 下保持（私网拒、公网过） | ✔（既有） | ✔ |
| 4. 每次重定向重新解析 + 校验，原域名 Host/SNI 保持 | ✖ fixture 域名被 URL 守卫拒（.test TLD） | ✔ 两跳分别解析，Host 均为原跳域名 |
| 5. DoH 错误信息不泄露凭证/完整敏感 URL | ✔（既有脱敏文化） | ✔ |

红观察：修补前 4 失败（RED 2/2b/2c/4）；绿观察：7/7。

## 三、真实页面验证（经正常页面检查端点，非诊断 IP 注入）
| 场景 | 结果 |
|---|---|
| 真实原文检查（blog.adobe.com Premiere 26.5 发布文）**未配置 DoH**（系统 DNS=TUN fake-IP） | `blocked`——"来源解析到非公开地址"（198.18.x.x 被守卫正确拒绝） |
| 同一 URL **配置 DoH**（dns.google/resolve）后重试 | `readable`，requestCount=1，canonicalUrl 保持原 URL，title 正确提取（"Generate and create directly in your timeline…"） |
| 保存与刷新（第二次检查） | `readable`，title 一致（可重复、刷新稳定） |

这证明：DoH 配置解决了 TUN fake-IP 环境下真实来源无法解析的核心问题，且守卫在两种模式下均正确工作。

## 四、门禁
| 命令 | 退出码 | 数量 |
|---|---|---|
| 专项回归（doh + source-config + detail-selection + detail-enrichment + source-enrichment + wrapper-resolution） | **0** | 52/52 pass |
| `npm run quality` | **0** | **707 tests / 702 pass / 0 fail / 5 skipped**；lint 0 errors/27 warnings；knip **PASS（首次完整通过）**（详细见 knip-first-pass.md：环境内存恢复所致，与代码无关）；deps:check 163 modules/351 deps 无违规 |
| `npm run api:build` | **0** | — |
| `npm run build` | **0** | — |
| `git diff --check` | **0** | 仅 CRLF 提示 |

## 五、DoH 配置说明（服务端专用）
- 配置名：`SOURCE_DOH_URL`（如 `https://dns.google/resolve`）。仅服务端读取；普通用户不填写、不可见。
- **隐私提示（按任务要求注明）**：启用后，被抓取来源的**主机名会发送给所选 DoH 服务方**（如 dns.google）。
- 未配置：保持系统 DNS（含 TUN 行为）；配置后解析失败：诚实报错（无结果/畸形/超时/非公开整体拒绝），**不静默回退系统 DNS**。
- 地址守卫：公网校验、混合应答整体拒绝、重定向逐跳重新解析+校验、连接地址钉定、原域名 Host/SNI 与 TLS 证书校验保持——全部经测试锁定。

## 六、计数
| 类别 | 次数 |
|---|---|
| 真实页面检查（经检查端点） | 3（blocked×1 + readable×2） |
| 数据库连接 | 0 |
| 模型调用 | **0** |
| 真实研究提交 | **0**（完整研究验收另行授权） |

## 七、剩余项
- 真实研究预算为 0：完整研究验收另行授权（本报告不含）。
- lint 27 warnings（全既有文件，非本轮引入）留待后续清理。
