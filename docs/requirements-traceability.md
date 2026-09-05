# 需求追踪矩阵

本文件把个人助手建设期间提出的需求映射到实现、验证和接管门禁，防止“测试很多”掩盖某条原始需求仍
未完成。机器可读接管状态仍以 `config/feature-parity.json` 为准；本表不得单独放行生产切换。

状态定义：`implemented` 表示代码和契约验证存在；`observing` 表示正在无写影子观察；`gated` 表示实现存在
但仍需受控运行证据或人工批准；`complete` 表示当前阶段已有足够证据。

| 原始能力要求 | 对应能力 | 当前证据 | 状态/剩余门禁 |
| --- | --- | --- | --- |
| 代码可在任意受信终端 clone，并通过账号登录和数据备份恢复同一助理能力 | recovery-readiness, account-bootstrap-readiness, deployment-packaging, durable-store | 项目章程、ADR 0090、机器 recovery/account manifest、数据/身份清单、age-only 打包、checksum/SQLite 校验、revision 一致的 fresh-clone restore-safe、脱敏账号审计；当前 GitHub/飞书/滴答在线只读及 Codex/Claude/DSH 本地状态通过 | implemented/gated：SQLite 本地核心和当前账号链路已验证；仍需 owner 提供异机目标、age 身份并允许安装工具，再完成真实加密上传回读、PostgreSQL 和另一终端完整演练 |
| QuarkSelfAI 独立于当前雇主工作，BlackLake 信息不进入产品主线；外部 DevOps 设计采纳后必须复制入库 | work-domain isolation, capability-evolution | ADR 0090、BlackLake 边界与现有耦合清单；采纳要求 provenance/许可/去业务化/本地资产 | gated：当前 BlackLake adapter 仍参与现网，须先建设独立 pack 并在维护窗口切换，不能直接删除 |
| 正式承担个人 CTO、CIO 与工作助理角色，并具有一定独立性和创造性 | collaboration-learning, capability-evolution, natural-language-policy | ADR 0088；根/仓库 AGENTS 与 CLAUDE 角色真源；目标经营、三重职责、决策优先级、精确 mandate 与硬边界 | complete：角色扩大主动判断与闭环责任，不旁路外联、生产、权限、人员预算合同和核心架构门禁 |
| 守护进程监听飞书，不依赖循环 sleep；崩溃后恢复 | lark-event-adapter, retry-and-alerting, daemon-deployment | 单一实时消费者；非实时来源默认 10 分钟持久工作流补偿；本地队列与远程搜索分离；launchd；租约/退避；跨进程隔离故障恢复演练 | complete（服务器部署仍为可选项） |
| 本人机器人私聊直接理解自然语言并执行，不要求命令枚举 | direct-owner-control | 契约测试；持久 controller/current session；最近六条有界上下文与 reply/root/thread 连贯性提示；控制会话排除于本人参与补偿；调研确认要求精确关联或单一事项完整短句 | complete |
| 创建、续接指定 Codex 会话；左侧可见；标题唯一；默认 gpt-5.6-sol medium | visible-codex-sessions | app-server 契约；桌面端 projectless 合成任务创建、列表可见、同 task 续接和归档 | complete |
| 任务完成后归档；自建会话归档七日后强制删除；失败退避 | session-janitor | 生命周期测试；现网 2/2 自动研究会话均 archived+deleted 且累计失败为 0 | complete |
| @我、他人私聊、特别关注联系人、飞书标记群/会话统一接入 | focus-intake | 明确 @ 实时事件；默认 10 分钟只读补偿扫描；联系人/私聊/Flag/Feed 特别关注结构化过滤；2 分钟重叠窗口；实时与补偿共享 messageId 幂等键 | complete |
| 任永强邀请本人入群时视为工作交接，读取上下文并持续关注该群 | focus-intake, context-and-external-guard | 成员加入事件精确 ID 过滤；群列表差分+系统消息兜底；首次基线不回溯；交接群独立低频扫描、幂等与上下文沉淀测试 | implemented：实时事件待在飞书应用后台启用；30 分钟兜底已配置，重启后生效 |
| 本人主动参与的工作沟通及相关表情回复应被持续跟进 | focus-intake, collaboration-learning | 本人消息低频检索；低信号仅建立三个工作日临时关注；实质消息进入统一语义链路；reaction created/deleted 双实时流、mget 上下文解析、30 分钟新增事件补偿和幂等测试 | implemented：重启后启用实时表情流和低频兜底；高影响动作仍需明确文字批准 |
| 读取附近上下文与最新会话尾部，避免迟到任务和已回复后再建任务 | focus-intake, context-and-external-guard | stale message 双窗口读取、settle window、低信号清理；现网 41/41 来源有上下文 | complete |
| 外部群不追问、不回复；无法确认群属性时 fail closed | context-and-external-guard | external/unknown group 阻断测试；实时只读查询“油脂客户沟通群”返回 `external=true` | complete |
| 必要追问标注 AI 分身；正式回复必须先由本人确认 | context-and-external-guard, approval-cards | 策略/审批测试；现网 10 个卡片回调无重复、3 个待确认动作跨重启保留；追问回复读取网络故障局部降级、保留待处理项并恢复清标，不再终止 compatibility host | complete |
| 可在 DSH 会话中自然语言创建临时插件，启动需明确批准且可回滚 | dsh-tool-cordis, dynamic-plugin-policy | Cordis 配置兼容校验；Host/Client 单次审批分流与删除门禁单测 | complete |
| 交互消息使用卡片、按钮和输入框；普通通知格式化 | approval-cards | Card 2.0 hierarchy、button/input/select/navigation 测试及现网卡片回调 | complete |
| 自动化待办只建真正任务；禁止 NOTE；标题一眼可见紧急/关键；标签、优先级、截止日合理 | dida-projection | task admission/presentation、NOTE/TEXT 删除补偿、实际 kind 核验测试 | gated：当前 schema 真实结果仍为 0/20 |
| 同一事项优先更新而非重复创建；仅物质变化通知；每次重写快速摘要 | dida-projection | marker/matter 搜索、created/updated/unchanged、material change、通知去重；工具失败语境化识别；BlackLake 固定总路由确定性补齐 | observing：真实创建/更新结构持续积累；2026-09-04 已修复业务 OAuth 被误判为 MCP 授权失败及固定路由漏回导致的无效重试，其他模型语义违约继续失败关闭 |
| 识别“需要本人批准”的事项并立即用交互卡片通知 | dida-projection, approval-cards | approval 类型、摘要、标签、通知一致性校验 | gated：受控真实样本 |
| 超期监控、完成任务定期清理、自动化跟进清单每工作日评估 | dida-monitors | 契约测试；三类 monitor 均有现网运行时间且当前健康 | complete |
| 跟进清单由助手跟踪和修改；联系他人前征求批准 | dida-monitors, approval-cards | 联系人解析、批准卡片、回复回写原任务测试 | gated：外联动作必须逐次批准 |
| 自然语言增加降噪策略，编译、样本模拟、确认后启用和回滚 | natural-language-policy | 受限 DSL、覆盖率/紧急保护、稳定 proposal；现网 Card 2.0 批准；隔离 SQLite 激活与回滚演练 | complete |
| 从长期协作中挖掘模式，每日自我回顾、自主决定是否调整并发送简报 | collaboration-learning, natural-language-policy | 每日一次脱敏质量简报；同日幂等；8 条/85% 安全弱信号自动 guidance 校准；20/8/75% 高影响策略门槛；@、特别关注、紧急、审批和调研保护；每周单一建议、精确 revision 批准测试 | complete：兼容现网与 DSH-native 使用同一安全边界，低风险提示可自行调整，高影响变化仍逐项批准 |
| 助手可主动聊天，通过少量高价值问题了解本人并持续沉淀 | proactive-owner-dialogue, collaboration-learning | Claude 主判断、Codex 兜底；单问题、价值阈值、48 小时最短冷却、72 小时回答窗口、工作时段、未答不追问；Card 2.0 自然输入；本人回答进入可纠正的 owner-stated insight | implemented：现网兼容链路先运行；切换 DSH-native 时随 collaboration-learning 一并迁移，行为变化仍受原确认门禁 |
| 每日记录本人真实工作，并可按任意时间范围生成总结 | work-journal, work-journal-agent-compiler | ADR 0089；北京时间次日闭账；飞书本人发言 + `@我` + 相关会话上下文三层完整分页；注意力/表情补充；日历/滴答/执行器/Jira/GitLab/本地 Git 多源合并；401/403/429 脱敏缺口分类；稳定日期幂等键；SQLite/PG 共用 signal store；总控只读区间查询；控制台最近 31 日视图 | implemented：从 2026-09-02 起逐日积累；当天、启用前历史和来源缺口在查询时有界只读补齐，不伪造完整覆盖；认证和权限缺口只报告、不自动修复凭证 |
| 本人指定群作为低打扰知识关注源，并把可复用问题链沉淀到助手知识库 | conversation-attention compatibility profile, assistant knowledge | 显式 `purpose=knowledge`；复用唯一消费者与 30 分钟恢复扫描；单群来源不自动建单/即时通知/回复；完整翻页后以当前需求、仓库、分支和运行证据复核 | implemented：全栈开发学习交流群已接入；首次 217 条/5 页完整读取并沉淀 release、feature 重建、i18n 与非代码交付四类线索；长期 profile 待原生 attention policy 迁移 |
| 可自主检索和组装开源能力，并持续看到真实成长和迭代 | capability-evolution | 每工作日独立 Codex 任务；三轨轮换与连续主题降权；有界战略探索/可逆实验/不激活原型；每轮保留内部进展或下一条成长跑道；左侧可见且标题唯一；禁止任务内再次查看自身自动化导致 prompt 重复渲染；控制台只读展示真实自动化、最近巡检和脱敏升级/候选账本；允许高影响技术变化或更多助理职责的精确 proposal | complete：高频探索不强迫制造功能或空报告，候选不能先执行，精确批准后不重复询问同一范围 |
| 从真实协作经验沉淀可验证、可回滚的 Skill | skill-evolution-compiler | ADR 0087；脱敏 Experience、可失效 Pattern、影子候选、任务指纹去重、Codex/Claude/DSH 分别评测、触发质量与零安全/审批违规门禁 | foundation complete：无副作用编译门禁和回归已建；真实模式提炼、持久化与 Skill 发布仍按价值另行演进 |
| BlackLake 问题先按参考项目和 skills 路由，再决定 start/confirm/skip | blacklake-routing | 三源动态哈希、skill/operation-chain 门禁；合成用例 route→ledger→approval→claim | complete |
| 自然语言询问项目或租户的 CS 时，从 Lakers 内部负责人字段给出参考 | root shared skill `blacklake-tenant-cs-lookup`, blacklake-routing | Archery 审计只读；按 orgId/工厂号/租户/客户/服务项目有界匹配；精确项优先；多候选不静默选人；空值不猜测；结果标注为申请环境时登记而非当前归属 | complete：Codex/Claude 共享 Skill 已接入，DSH 按根 AGENTS 读取；线上 schema 与有值/空值样本均已验证 |
| 智造湖小维作为慢速排查工具，调用前必须本人批准，结果回灌且不重复建任务 | xiaowei-channel | 授权/持久等待测试；现网 3 个请求完成且均关联回复 | complete |
| 周期总结“小维监控群”中有趣、有思考或独特的问题 | xiaowei-insight-digest | 内部群属性只读核验；问题链聚合去重、周五单次发送、空摘要静默、Claude→Codex→本地规则降级测试；控制台独立监控 | implemented：首次真实周报将在下一个周五 17:30 生成并留存聚合计数，不创建滴答任务、不在原群发言 |
| Claude Code 优先、Codex 兜底、同一 action 只能一个执行者 | executor-routing | 官方 providers、基础设施错误分类、串行 dispose、action lease；Claude start/ENOENT 后串行 handoff；真实 Codex task 固定回执 | complete；第三方 Claude 成本通道仍是可选未配置项 |
| Claude Code 与 Codex 共享 skills、Agent 约定、参考项目，不产生信息差 | blacklake-routing, executor-routing | 根 AGENTS/CLAUDE 同步约束、三源 router、DSH profile provider 配置 | implemented；持续运行同步校验 |
| 飞书 CLI 快速升级适配，不让业务规则依赖 CLI 参数 | lark-event-adapter | version/schema/capability discovery、未知字段保留、升级 banner 测试和升级手册 | complete |
| SQLite 与 PostgreSQL 可配置，默认 SQLite | durable-store | 统一存储契约、两套 migration、SQLite/PG 实现 | complete |
| 本地 Web 控制台可见，未来兼容服务器部署 | web-console, capability-evolution-observer, daemon-deployment, server-deployment | 本地 dashboard/LaunchAgent；能力进化只读状态、账本与降级测试；systemd/Compose/runtime lock 已建 | 本地 complete；服务器无 Codex 自动化时该页面显示未配置，发布前仍需补 Docker 实镜像 |
| 助手自有 UI 固化 Apple HIG 设计原则并保持统一风格 | web-console | Apple 官方 HIG 来源；设计标准与 ADR 0086；语义 token、末级交互基线、系统字体、44px 默认热区、焦点/减少动效/高对比/窄屏回归 | complete：控制台已接入，后续页面由协作契约与自动测试强制继承 |
| 个人电脑本地运行并访问授权文件是主形态 | local-first-execution | ADR 0003；默认 local/SQLite/loopback；workspace realpath 与 symlink 防护 | complete |
| 所有故障、恢复和需要协助的事项可通过飞书通知，时间显示为北京时间 | retry-and-alerting | 持久故障/恢复去重、本地时区格式、错误摘要脱敏；飞书自身不可用后跨重启合并补发演练 | complete |
| 测试任务不得污染真实待办，低价值消息如“ok”不得建任务 | focus-intake, dida-projection | synthetic artifact、whole-message acknowledgement、priority-zero admission 测试 | observing：影子样本继续核验 |

## 当前运行期证据债务与不变量

1. 影子窗口仍须自然结束并严格审计；提前接管不把窗口视为通过。
2. 当前滴答 schema 仍须收集至少 20 个真实 task projection；不得人工制造测试待办凑数。
3. 卡片长等待、断线恢复、Claude 到 Codex 串行 fallback 和会话生命周期完成受控演练。
4. 本次已取得常东旭明确批准，并在冻结旧 checkpoint 后生成内容寻址 handoff；accepted-risk 清单精确为
   `dida-projection,shadow-collaboration`。
5. 运行时必须保持单一飞书消息/卡片消费者；任何异常先停止新消费者，再恢复旧 bridge。
