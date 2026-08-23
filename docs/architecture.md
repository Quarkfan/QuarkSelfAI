# 架构

## 分层

1. **DSH/Cordis 内核**：生命周期、插件装配、session/event、approval、job、持久化。
2. **Channel adapters**：飞书 CLI、滴答 CLI/MCP、日历等外部协议；只负责能力发现、传输和规范化。
3. **Assistant domain**：matter、action、approval、follow-up、deduplication、settlement；不依赖 CLI 参数。
4. **Policy plugins**：本人私聊直办、外部群禁言、正式回复审批、重点联系人、黑湖路由等规则。
5. **Executor providers**：Claude Code 优先，Codex 异常兜底，DSH native 可选；同一 action 只能有一个实际执行者。
6. **Projections**：滴答任务、飞书卡片、Codex 任务侧栏都是领域状态的投影，不是真源。
7. **Console surface**：3210 提供带登录门禁的运维控制面，3211 承载仅回环可达的 DSH 原生会话 UI；
   DSH 会话嵌入统一导航，但不会扩大到远程网络。

DSH Loader 从包根的 named `apply(ctx, config)` 装配 `LarkCliService`。包根不提供 default export，避免
Loader 将 namespace 折叠后丢失插件元数据。该入口只注册 capability，不自动调用 `start()`；现网消费者
是否启动仍由独立运行时门禁决定。

BlackLake 专属能力使用独立的 `@quarkfan/quark-self-ai/blacklake` 插件行，避免污染通用助手内核。仅当
`BLACKLAKE_WORKSPACE_ROOT` 存在时启用。`blacklakeReferences` 每次从知识库、虚拟员工和 common harness
三源真源读取当前入口、索引和 skill frontmatter，返回内容哈希并验证建议 skill 真实存在；QuarkSelfAI
不复制三源业务规则。多步链路候选必须同时包含 `virtual-employee-operation-chain`。

`blacklakeReferences.planResearch` 把路由结论接入 durable action ledger。`skip` 不创建 action；`confirm`
创建带精确 approval 的只读 action，批准前同样不可 claim；`start` 仅允许生产、安全或客户阻塞风险，且
目标清晰、确有本地证据缺口、预期有直接收益。参考读取与 executor 执行因此共享同一审批和审计边界。

`quarkExecutors` 是 DSH subagent seam 上的顺序路由层。Claude Code 与 Codex 分别注册只读和写入 Provider：
只读实例使用 `dontAsk`/`never`，只有携带 durable owner approval 的写请求才进入 `acceptEdits`/`approve-for-me`。
默认先调用隔离命名的官方 Claude Code Provider；
只有启动、网络、传输、额度等基础设施故障才在前一 run 完全 dispose 后调用 Codex，schema/业务拒绝等确定性
错误不重复执行。DSH native `spawn` 仅在明确选择时使用。相同 actionId 的并发调用被拒绝，本地 workspace
必须等于父 DSH session 的 cwd 且落在白名单内；workspace/external write 必须带 durable owner approval。
该内存互斥只是进程内最后一道防线，正式执行仍必须先由 action ledger 原子 claim。

`quarkActionLedger` 是 DSH 原生持久执行服务。SQLite 和 PostgreSQL 使用同一契约保存完整执行请求、精确
approval 绑定、租约 owner/期限、attempt、结果和下次可执行时间。写任务没有 durable approval 时无法入队，
未批准时无法 claim；显式附带 approval 的只读调研也遵循同一门禁，不能因 `read-only` 提前执行。崩溃后
只有租约过期的新 worker 能接管，旧 worker 不能提交结果。基础设施错误按指数
退避重试，确定性边界错误直接失败，防止用第二个模型重复执行同一业务动作。

## 本地优先运行边界

本节的约束由 [ADR 0003](adr/0003-local-first-personal-assistant.md) 固化。服务器部署是本地个人助手的
扩展能力，不是核心运行模型的替代品。

个人助手的默认形态是用户机器上的单实例守护进程：SQLite 保存状态，Web 控制台只绑定回环地址，
Claude Code、Codex 与 DSH native executor 在本机受控工作区内运行。`ASSISTANT_WORKSPACE_ROOTS` 是执行
Provider 的统一文件边界；已有路径先解析真实路径，新建路径先解析真实父目录，因此 `..` 和指向白名单
外部的符号链接都不能绕过检查。控制台只显示执行模式和白名单数量，不暴露本地绝对路径，也不提供通用
文件读取 API。

本地文件不是待同步到服务端的附件，而是本机 executor 在当前任务工作区内直接使用的能力。飞书消息只携带
意图、审批和结果摘要；除非常东旭针对具体文件明确批准上传，否则不得把文件正文、目录清单或绝对路径投影
到飞书、滴答、远端数据库或服务器。默认白名单是启动目录，推荐个人电脑显式配置多个最小工作区，而不是
配置整个用户主目录。

服务器和容器只是可选部署形态。`ASSISTANT_EXECUTION_MODE=remote` 明确关闭本地工作区，且不能启动仍需
本地文件访问的 compatibility provider。未来新增 executor 或文件工具必须依赖同一个 workspace policy，
不得各自实现更宽松的路径判断。

Claude Code 默认可继续使用本机原生登录。若以后提供第三方 Anthropic-compatible 通道，则密钥只通过
`ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 注入，地址和模型通过 Claude Code 支持的普通环境变量配置；
DSH profile 只保存环境变量表达式，`--dump-config` 不得出现密钥值。未配置第三方凭据时不能宣称已使用低价
第三方模型。

## 策略层

用户的自然语言偏好会编译为受限、版本化的策略 DSL。模型只参与候选生成；确定性验证、历史样本模拟、紧急消息保护、审批和运行时匹配都在本地代码完成。策略不能包含任意代码或工具调用。详见 `docs/policies.md`。

## 飞书 CLI 快速适配

业务插件只消费 `NormalizedChannelEvent` 和稳定的 `LarkCliService`，不拼接 CLI 参数。适配器启动时：

1. 探测 CLI 版本；
2. 调用 `event list --json` 获取实际能力；
3. 对必需 EventKey 调用 `event schema ... --json`；
4. 校验身份、权限和 schema，并生成 fingerprint；
5. 缺少必需能力时 fail-closed；新增字段完整保留在 `raw`；
6. 契约变更只修改 adapter/normalizer，不波及路由、审批和任务逻辑。

后续把 `lark-cli api` 的 endpoint discovery 也收敛到该 provider，按 endpoint capability 生成 typed binding。

现网重点消息采用单消费者、双速通道：同一 `im.message.receive_v1` 连接只实时放行本人机器人私聊和群内
明确 `@常东旭`；特别关注联系人、标记会话、其他人私聊以及断线缺口由 30 分钟低频搜索补偿，使用 10 分钟
重叠窗口和消息幂等检查点去重。远程搜索与本地待处理队列分离，本地队列每 30 秒推进，不会为了重试任务而
重复请求飞书。智造湖小维回复按 10 分钟检查，调用仍必须绑定本人对具体调研的批准。

本人机器人私聊在进入总控任务时保留最近六条有界历史及 `reply_to/root_id/thread_id`。模型必须优先采用
显式回复关系，再判断主题和时间连续性；含糊短句不能被推断为无关事项或高影响操作的批准。

协作学习组件持续记录脱敏决策特征和 owner 反馈信号，不保存消息正文或任务标题。它每天最多评估一次，
只有累计至少 20 条样本、精确来源至少重复 8 次、可合并比例达到 75%，并且样本中没有明确 @、特别关注、
紧急、审批或调研事项时，才会生成一个精确到 chat/sender 的候选策略。候选仍需通过本地策略模拟；每周最多
提示一项，并通过带按钮和输入框的卡片取得 owner 对具体 revision 的批准。学习器不能直接发送外部回复、
修改任务、启动调研或自动激活静默/批量策略。

启用后的 attention 策略由本地控制面只读评估。`batch` 不会丢弃通知，而是写入持久汇总队列，默认最多等待
6 小时并合成一张卡片；发送失败按 10 分钟起步退避并保留原队列。`silent` 只抑制即时通知，滴答任务和内部
matter 仍照常创建或更新。策略评估不可用时 fail-open，保留原即时通知，避免控制面故障造成漏报。

## 状态原则

所有消息先进入追加式事件日志，随后聚合成 matter/action。重复消息、迟到消息和状态更新必须定位同一
matter：优先更新已有 action 或投影，只有语义上出现新的责任、截止时间或独立交付物时才新建。
外部写操作由 durable action ledger 记录审批、执行者、重试和 supersede 关系。

终态记录可按保留策略清理，但消息、卡片、重点消息等幂等检查点不得随历史记录删除，否则会重新投影已处理
消息。监控配置只允许登录后的控制台修改白名单字段，写入后由父守护优雅重启；交互卡片核心消费者不可停用。
