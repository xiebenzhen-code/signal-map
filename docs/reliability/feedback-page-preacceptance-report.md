# 反馈页面验收前修补报告

日期：2026-10-02。范围：状态提示、离线 UI 回归、判断语义只读核对。

## 实际修改

- `information/today-copy.ts`：增加 `todayContextNotice`。同一过滤器的旧运行与当前修订号不一致时提示认知或过滤条件已更新；没有本过滤器历史运行时提示首次研究。加载与错误状态优先，不显示这两种提示。
- `app/page.tsx`：将上述判断接到当前过滤器、修订号和历史运行，在“今日”标题后呈现状态说明。复用原重新过滤按钮，没有新增自动研究调用、effect 或 hook。
- `tests/feedback-page-state.test.ts`：新增 12 项回归，其中 6 项验证状态判断，6 项用受控保存状态渲染 EventDetail 的真实状态 JSX。使用现有 TypeScript 编译器和 React 服务端渲染，没有增加依赖。
- `package.json`：注册新增测试文件到全量门禁。
- 本报告记录执行结果。保留全部无关工作区修改。

## 判断语义只读发现（未修改）

1. `backend/feedback-records.ts` 将 `not_useful` 保存为 `JUDGEMENT / Not useful: ...`，将 `changed_view` 保存为 `JUDGEMENT / Changed after evidence: ...`。
2. `research/research-pipeline.ts` 用 `filterTerms(input.userJudgements)` 生成词项，按内容包含关系计算 `judgementMatches`，将长度传入新颖度评估，没有按反馈含义区分正负。
3. `research/novelty-attribution.ts` 对匹配数计算 `min(18, count * 6)`。纯函数探针在匹配数均为 1 时，两种文本均得到 `judgementPenalty=6 / noveltyScore=80`。这证明相同匹配数的扣分相同，不证明任意真实内容的匹配数必然相同。
4. `agent/runner.ts` 将所有持久化记录的 text 合并到 `knownInformation`；而 `agent/evaluation.ts` 的部分比较路径有 KNOWN_INFORMATION 类型守卫。不能笼统声称 JUDGEMENT 从未进入已知信息输入，也不能由文本合并直接断言某条判断已被当作事实。

最小后续方案（需单独确认，本轮不实施）：按类型分配持久化记录的消费路径；分别定义无用反馈与判断更新的作用，不把判断更新默认等同无用而扣分。用完整 runner 注入测试验证映射与最终结果。

## 红到绿与失败状态

- 初次命令使用默认测试进程隔离，因沙箱 spawn EPERM 失败，不能计为功能红。
- 改用项目既有 `--test-isolation=none` 后，12 项为 6 fail / 6 pass，退出码 1。6 个失败均因缺少上下文状态提示函数；现有保存状态 JSX 的 6 项已通过。
- 增加最小提示逻辑后，新文件 12/12 通过；连同反馈仓库、运行选择、今日文案与自动研究守卫共 35/35，退出码 0。
- 受控失败状态 DB_TIMEOUT、UNAUTHORIZED、HTTP_400 均渲染失败、本地草稿保留、未写入账号提示，不渲染保存成功。待保存、账号保存成功、无保存结果也分别验证。
- 上述是受控状态的真实 JSX 渲染验证，没有发起真实反馈保存，也没有在浏览器模拟 HTTP 故障，不替代按钮到数据库验收。

## 当前浏览器观察

在新建的临时验收标签中打开真实 `http://localhost:3000/`，等待恢复后观察到既有综合视频问题及其历史结果：“检索到 10 条，0 条通过筛选”。页面保留既有空结果说明，没有错误显示认知更新提示。

没有点击研究或反馈，没有修改用户过滤器与存储。当前会话未提供失效状态或反馈弹窗的可操作测试材料，未宣称这两种状态已完成浏览器截图验收。关闭本轮临时标签，不关闭用户标签。

## 门禁

| 命令 | 退出码 | 本次结果 |
|---|---|---|
| 新增专项（红） | 1 | 6 fail / 6 pass |
| 相关五文件（绿） | 0 | 35 pass / 0 fail |
| KNIP_DISABLE_RAW_TRANSFER=1 npm run quality | 0 | typecheck、lint、645 tests（640 pass / 0 fail / 5 skip）、knip、deps:check 通过 |
| npm run api:build | 0 | 后端构建通过 |
| npm run build（沙箱内首次） | 1 | Vite 配置加载时 spawn EPERM，伴随依赖解析错误；未到页面编译 |
| npm run build（获准沙箱外重跑） | 0 | Build complete，未改依赖或规则 |
| git diff --check | 0 | 无空白错误，存在既有行尾转换提示 |

lint 为 0 errors / 19 warnings，警告位于既有文件。5 个 DB 集成用例跳过，不补造真实数据库验收。本轮没有载入 `.env.local` 来执行测试，也没有主动连接真实数据库。

## 计数与边界

- 真实研究提交 0；模型调用 0；反馈 POST 0；主动数据库连接 0；migration 0；删除测试记录 0。
- 浏览器仅加载 localhost 页面，可能执行应用既有恢复及身份读取；没有测量其内部后台请求数，不能写成所有 HTTP 请求为 0。
- 未修改代理、TLS、判断评分、反馈语义、来源或数据库结构；未提交、推送、部署或更新 ZIP。

状态提示实现与离线 UI 验证通过，完整门禁通过。判断语义问题仅记录；真实按钮、新会话完整消费与长期成长验收未闭合。报告后停止。
