# 架构

骨架、功能和迁移代码的可执行分类见 [骨架与扩展体系](architecture-skeleton.md)；机器真源为
`config/module-catalog.json`，决策记录为 [ADR-0005](adr/0005-skeleton-and-feature-boundaries.md) 与
[ADR-0009](adr/0009-exhaustive-source-ownership.md) 与 [ADR-0010](adr/0010-effect-provider-readiness.md)。本文件描述
运行链路，不能用来把 compatibility host 误称为长期骨架。

## 分层

1. **DSH/Cordis 内核**：生命周期、插件装配、session/event、approval、job、持久化。
2. **Channel adapters**：飞书 CLI、滴答 CLI/MCP、日历等外部协议；只负责能力发现、传输和规范化。
3. **Assistant domain**：matter、action、approval、follow-up、deduplication、settlement；不依赖 CLI 参数。
4. **Policy plugins**：本人私聊直办、外部群禁言、正式回复审批、重点联系人、黑湖路由等规则。
5. **Executor providers**：Claude Code 优先，Codex 异常兜底，DSH native 可选；同一 action 只能有一个实际执行者。
6. **Projections**：滴答任务、飞书卡片、Codex 任务侧栏都是领域状态的投影，不是真源。
7. **Console surface**：3210 提供带登录门禁的运维控制面，3211 承载仅回环可达的 DSH 原生会话 UI；
   DSH 会话嵌入统一导航，但不会扩大到远程网络。

DSH 会话显式启用官方 `@deepseek-ai/dsh-tool-cordis`，因此模型可以先检查运行时，再在当前会话中定义、
启动、更新、停止和回滚临时 Cordis 插件。动态包仅存在于当前 DSH 进程内存中，重启即消失，不会暗中改写
仓库或 profile。QuarkSelfAI 的 `dynamic-plugin-policy` 补齐安全边界：纯 Host 包在 `cordis_run` 前进入 DSH
一次性 approval；带 Client 半的包沿用 DSH 原生代码审批，避免重复弹两次；`cordis_undefine` 必须批准，
`cordis_stop` 不阻塞，作为随时可用的紧急回滚路径。需要跨重启保留的能力仍必须转成仓库内普通插件，走构建、
测试和发布流程。

DSH/Cordis package 和生命周期能力属于骨架；装配本产品全部插件的 `cordis.patch.yml` 不属于内核。当前 profile
仍含 compatibility-aware 禁用表达式，因此作为 `assistant-profile-composition` 明确归入迁移层。架构检查要求它
声明每个本地插件模块，并在移除 compat 条件后才能重新归类为长期 product feature。

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

现网重点消息采用双速通道：`im.message.receive_v1` 连接只实时放行本人机器人私聊和群内明确
`@常东旭`；特别关注联系人、标记会话、飞书“特别关注”Feed 分组、本人主动参与及断线缺口由持久低频搜索补偿，
默认每 10 分钟运行并使用 2 分钟重叠窗口和统一消息幂等键去重。低频调度由 workflow `wakeAt` 驱动，不使用
`sleep`，读取候选重新进入同一 durable inbox。任永强邀请常东旭入群是一条独立的工作交接信号：配置完成时由
`im.chat.member.user.added_v1` 精确核验邀请人与被邀请人；无论实时事件是否可用，后台都用本人群列表差分和
系统入群消息双重确认兜底。首次启动只建立群列表基线，不追溯生成历史任务；确认后的群会登记为交接群，先
等待 10 分钟读取上下文，再优先更新已有接手事项，否则创建一条“查看背景并确认接手范围”的任务。后续群
消息继续低频关注，但只有责任、风险、截止时间或下一步实质变化才更新或通知。外部交接群允许只读监控和
本人待办，仍禁止任何自动追问或回复。

远程搜索与本地待处理队列分离，本地队列每 30 秒推进，不会为了重试任务而重复请求飞书。智造湖小维回复按
10 分钟检查，调用仍必须绑定本人对具体调研的批准。

本人机器人私聊在进入总控任务时保留最近六条有界历史及 `reply_to/root_id/thread_id`。模型必须优先采用
显式回复关系，再判断主题和时间连续性；含糊短句不能被推断为无关事项或高影响操作的批准。
机器人控制私聊会登记为独立控制会话，并从“本人主动参与”搜索补偿中排除。程序级审批拦截只接受卡片回复、
确认编号、事项标题，或仅有一项待确认时的完整确认短句；“健康检查一下”等普通指令不得因包含“查一下”而
被截获为调研批准。

本人在其他工作会话中的主动发言也是关注信号。系统通过 30 分钟低频搜索发现本人消息：低信息量的确认只把
所在会话加入三个工作日的临时关注，不单独建任务；包含责任、承诺、截止时间、风险或明确下一步的发言才进入
既有 MentionMonitor 语义链路。临时关注到期后自然退出，新的本人参与会延长窗口，因此不需要把群聊永久写入
静态关注名单。

表情回复由 `im.message.reaction.created_v1` 和 `im.message.reaction.deleted_v1` 两条独立实时流接入，并由同一
30 分钟扫描补偿新增事件。只有“本人给出的表情”或“他人对本人消息给出的表情”进入语义链路；第三方之间的
表情不产生事项。系统保存 emoji 类型、操作者、增删动作和目标消息上下文，但不使用固定 emoji 字典：模型结合
当前上下文、任务状态和逐步积累的脱敏同类处理统计判断其含义。表情撤回触发重新评估；任何高影响操作、正式
回复或外部写入都不能仅凭表情获得批准。

协作学习组件持续记录脱敏决策特征和 owner 反馈信号，不保存消息正文或任务标题。它每天最多评估一次，
只有累计至少 20 条样本、精确来源至少重复 8 次、可合并比例达到 75%，并且样本中没有明确 @、特别关注、
紧急、审批或调研事项时，才会生成一个精确到 chat/sender 的候选策略。候选仍需通过本地策略模拟；每周最多
提示一项，并通过带按钮和输入框的卡片取得 owner 对具体 revision 的批准。学习器不能直接发送外部回复、
修改任务、启动调研或自动激活静默/批量策略。

同类本人参与和表情信号的历史处理结果可以作为非约束性统计提示注入下一次判断，但当前消息和会话上下文始终
优先。样本不足时保持保守判断；统计只描述建单、更新、忽略、通知方式和责任归属，不沉淀正文，也不会自动
生成固定语义映射。这样规则能够随真实协作调整，同时不把偶然反馈固化为长期授权。

启用后的 attention 策略由本地控制面只读评估。`batch` 不会丢弃通知，而是写入持久汇总队列，默认最多等待
6 小时并合成一张卡片；发送失败按 10 分钟起步退避并保留原队列。`silent` 只抑制即时通知，滴答任务和内部
matter 仍照常创建或更新。策略评估不可用时 fail-open，保留原即时通知，避免控制面故障造成漏报。

## 状态原则

所有消息先进入追加式事件日志，随后聚合成 matter/action。重复消息、迟到消息和状态更新必须定位同一
matter：优先更新已有 action 或投影，只有语义上出现新的责任、截止时间或独立交付物时才新建。
外部写操作由 durable action ledger 记录审批、执行者、重试和 supersede 关系。

终态记录可按保留策略清理，但消息、卡片、重点消息等幂等检查点不得随历史记录删除，否则会重新投影已处理
消息。监控配置只允许登录后的控制台修改白名单字段，写入后由父守护优雅重启；交互卡片核心消费者不可停用。
