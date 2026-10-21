# 长期记忆交付：第一阶段现场核对 — 2026-10-21

## 范围与状态

按用户最新指令只完成第一阶段并停止。仅核对代码、既有证据、线上通道与缺口；未保存/读取用户知识、未执行数据库连接测试、未提交研究、未修改代码/开关/配置、未部署或Git提交。

## 代码现场

修复工作区 C:/Users/25186/AppData/Local/Temp/smfix/mem-worktree，HEAD 9b9ce989f473fcf3865f7b9179c06abb5b04cc43，受跟踪文件无未提交差分。生产代码与 dac6056 一致。线上最后一次直接控制台核对为 API019 / 100% / 实例 signal-map-api-preview-019-d5fc566b6-smqls；本次未重新读取承流表，不将旧instanceId标签作为版本证据。

## 已核对接线

- agent/memory-isolation.ts：memoryParticipates 默认false；内部options.memoryParticipation可显式覆盖，否则依赖 SIGNAL_MAP_MEMORY_ISOLATION=participate。未读取或展示环境变量明文。
- agent/runner.ts：先按主体、任务选择存量知识，再由开关决定 effectiveKnowledge；参与时用于规划及后续上下文；隔离时自动知识、持久化判断/跟踪项不自动加入。显式用户输入仍保留。
- 写入及账号页读回未被此开关关闭。不能把“页面能看到知识”当作“知识已经影响研究”的证据。
- research/research-service.ts 的 executeResearch→runAgent 未传 memoryParticipation；backend/research 常规路径没有单账号的公开参与参数。测试可以直接调用runAgent显式启用，不能据此称产品页面已经支持按账号灰度。
- backend/handlers.ts：认证持久化仓库按 databaseConfigured() 选择Postgres；production无数据库配置会拒绝认证持久化，不将内存替代品当成生产持久化。databaseConfigured本身仅检查配置存在，不验证数据库可连。

## 继承证据及其边界

- 最新完整门禁902测试/896通过/6跳过；6项Postgres集成测试因DATABASE_URL未配置跳过。这是本地环境限制，不证明云端数据库未配置或不可用；本阶段不重复全量测试。
- 既有 memory-isolation 与 memory-selection-acceptance 测试覆盖隔离和显式参与，属于确定性测试，不能证明生产跨会话行为。
- bounded-release-closeout-20261020.md 记录用户登录、保存后刷新读回，只证明当时同浏览器持久化；跨账号/跨设备与重新登录读回仍缺独立生产证据。

## 云端只读核对尝试

尝试在已打开019 Webshell输出hostname、memoryParticipates()布尔值、数据库配置是否存在布尔值，不输出凭据，不连接数据库。终端实际显示 command terminated with exit code 137 / Exit，未出现 MEMORY_STAGE1 结果，本次命令未获得执行证据。因此线上自动记忆实际状态、数据库配置存在性均 UNKNOWN，不能将默认值当线上实测。退出137不据此推断产品OOM或应用故障；实例生命周期原因未核查。

## 进入第二阶段之前的最小条件（本轮不执行）

1. 可用实例中确认上述只读布尔状态，区分配置存在和连接成功。
2. 明确专用测试账号及测试范围，不使用真实用户知识作夹具。
3. 若继续验证“实际参与”，需选择受控内部测试调用显式memoryParticipation:true（仅技术验收，不能冒充用户页面体验），或先设计服务器控制的单测试账号启用路径。禁止开放任意客户端参数或直接开启全局开关。
4. 持久化/选择前置通过后再进入最多两次完整研究。本阶段研究提交0。

第一阶段清点完成，未完成的线上核验如实保留UNKNOWN；按用户要求到此停止。


## 后续只读补证（登录诊断阶段）

在新运行实例API019 / 5s8mr中直接执行只读输出，确认 automaticMemoryParticipates=false、databaseConfigured=true。补齐前述实际开关与配置存在性的UNKNOWN；未连接数据库，不能当作数据库持久化通过。见login-failure-diagnosis-20261021.md。
