# 登录失败分层诊断 — 2026-10-21

## 当前结论

测试账号凭据有效；API019和共享入口在本次对照时均能完成真实登录。内嵌浏览器仍显示 `Request failed: /api/auth/login`。故不是已证实的密码错误或认证服务整体不可达；已缩小为该浏览器请求路径/会话上下文与直连请求的差异。具体根因尚未证明，不能据此认定Cookie过期、冷启动、CORS、网关或浏览器沙箱中的任一项。

## 顺序与直接证据

1. 读取当前 app/control/page.tsx：readJson在HTTP非2xx且响应JSON缺error或解析失败时回退 `Request failed: <path>`。该文案丢失了HTTP状态和错误码，不能据其定位密码或数据库。
2. 无凭据参数校验对照：API直达与共享入口各POST空JSON一次，均400 / application/json / 缺少邮箱密码提示。仅证明路由可达，不触发真实账号登录。
3. 刷新控制台实例列表，确认当前Running实例为 `signal-map-api-preview-019-d5fc566b6-5s8mr`（创建时间12:52:17）；旧Webshell实例已更换。
4. 在该实例调用现有 runSupabaseAuthTransportProbe，不提交密码、不改代码。配置存在、DNS/HTTPS/TLS/主机名验证均PASS；/auth/v1/根路径404。404只证明该时刻认证传输可达，不代表密钥或用户有效。
5. 预热后浏览器受控复测一次，仍出现同一通用错误；浏览器工具无请求网络面板，dev error logs为空，无该失败请求HTTP状态、响应体和网关id。
6. 最后使用用户明确授权的同一测试凭据，在API直达及共享入口各登录一次。凭据只在进程内存，不写文件；Cookie/token不输出不保存。API：200 / application/json / 2812ms / user存在 / Set-Cookie存在。共享入口（带自身Origin）：200 / application/json / 1969ms / user存在 / Set-Cookie存在。结果仅保留布尔字段和脱敏状态。

## 能排除及不能排除

- 相同凭据的两条真实登录成功，因此“测试密码错误”不是当前浏览器失败的有效解释。
- 当前API及共享入口认证处理链能工作；不能称登录功能整体损坏。
- 浏览器受控复测发生在预热后仍失败，不能仅以第一次冷启动解释。
- 脚本成功不等于浏览器会话已登录；会话Cookie未转移或注入浏览器。浏览器仍未认证，第二阶段持久化与隔离验收没有通过。
- 尚缺浏览器失败请求的实际HTTP状态、content-type和网关关联id。没有这些证据，不能给出唯一网络/会话根因，更不应盲改密码、数据库、Origin或安全配置。

## 第一阶段缺口更新

同一次云端只读输出确认 automaticMemoryParticipates=false、databaseConfigured=true。只证明配置存在，不是数据库连接/持久化通过。自动记忆参与当前确实关闭；没有改变开关。

## 后续最小动作

拿到浏览器该失败请求的Network状态/响应类型及网关id后与成功路径比较；或在用户实际使用的独立浏览器确认可正常登录后续做第二阶段。若另行修补readJson，应保留脱敏HTTP状态、错误码和请求id，避免把不同故障吞成同一句话，但本轮不实施。

本轮只诊断，无代码/配置/部署/Git修改，无研究、测试知识写入、数据库测试或密码重置。网页登录表单密码已清空。API测试创建过授权测试账号的认证会话；返回Cookie/token未保存、未复用。费用UNKNOWN。

证据：outputs/login-failure-diagnosis-20261021/ 下空参数对照、credential-pair-sanitized.json及cloud-transport-transcribed.json。

## 14:26续接后的正式域名验证

正式域名signal.benzhenlab.com更新为Sites53后，本轮真实浏览器登录成功、直接回首页，刷新后仍保持登录态。该结果仅证明本次正式入口可登录；不倒推旧临时入口失败根因。没有继续第二阶段的知识写入、退出重登读回及第二账号隔离测试，原未执行项仍未执行；自动记忆参与开关未改变。
