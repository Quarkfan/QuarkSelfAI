# 需求追踪矩阵

本文件把个人助手建设期间提出的需求映射到实现、验证和接管门禁，防止“测试很多”掩盖某条原始需求仍
未完成。机器可读接管状态仍以 `config/feature-parity.json` 为准；本表不得单独放行生产切换。

状态定义：`implemented` 表示代码和契约验证存在；`observing` 表示正在无写影子观察；`gated` 表示实现存在
但仍需受控运行证据或人工批准；`complete` 表示当前阶段已有足够证据。

| 原始能力要求 | 对应能力 | 当前证据 | 状态/剩余门禁 |
| --- | --- | --- | --- |
| 守护进程监听飞书，不依赖循环 sleep；崩溃后恢复 | lark-event-adapter, retry-and-alerting, daemon-deployment | event capability discovery；受监管 compat/DSH 子进程；launchd/systemd/Compose；租约与退避测试 | gated：正式断线/恢复维护演练 |
| 本人机器人私聊直接理解自然语言并执行，不要求命令枚举 | direct-owner-control | bridge 总控原样请求、持久重试和 Claude fallback 契约测试 | gated：脱敏现网回放 |
| 创建、续接指定 Codex 会话；左侧可见；标题唯一；默认 gpt-5.6-sol medium | visible-codex-sessions | app-server create/resume/title/model 测试；真实 Codex 合成握手 | gated：桌面端受控演练 |
| 任务完成后归档；自建会话归档七日后强制删除；失败退避 | session-janitor | 完成态归档、已归档对账、`--force` 删除、手工取消归档保护测试 | gated：复制状态演练 |
| @我、他人私聊、特别关注联系人、飞书标记群/会话统一接入 | focus-intake | MentionMonitor 契约；现网无写样本覆盖 @我 8、私聊 31、特别关注 3、标记会话 1 | complete |
| 读取附近上下文与最新会话尾部，避免迟到任务和已回复后再建任务 | focus-intake, context-and-external-guard | stale message 双窗口读取、settle window、低信号清理；现网 41/41 来源有上下文 | complete |
| 外部群不追问、不回复；无法确认群属性时 fail closed | context-and-external-guard | external/unknown group 阻断测试；实时只读查询“油脂客户沟通群”返回 `external=true` | complete |
| 必要追问标注 AI 分身；正式回复必须先由本人确认 | context-and-external-guard, approval-cards | 追问/正式回复策略、Card 2.0 回调去重和 durable approval | gated：受控卡片长等待/重启演练 |
| 交互消息使用卡片、按钮和输入框；普通通知格式化 | approval-cards | Card 2.0 hierarchy、button/input/select/navigation 测试 | gated：本人飞书受控演练 |
| 自动化待办只建真正任务；禁止 NOTE；标题一眼可见紧急/关键；标签、优先级、截止日合理 | dida-projection | task admission/presentation、NOTE/TEXT 删除补偿、实际 kind 核验测试 | gated：当前 schema 真实结果仍为 0/20 |
| 同一事项优先更新而非重复创建；仅物质变化通知；每次重写快速摘要 | dida-projection | marker/matter 搜索、created/updated/unchanged、material change、通知去重测试 | observing：23 次真实创建/更新结构通过，结果文件样本不足 |
| 识别“需要本人批准”的事项并立即用交互卡片通知 | dida-projection, approval-cards | approval 类型、摘要、标签、通知一致性校验 | gated：受控真实样本 |
| 超期监控、完成任务定期清理、自动化跟进清单每工作日评估 | dida-monitors | 本地日期时区、去重提醒、清理范围、工作日 slot 和每日一次测试 | gated：复制状态回放 |
| 跟进清单由助手跟踪和修改；联系他人前征求批准 | dida-monitors, approval-cards | 联系人解析、批准卡片、回复回写原任务测试 | gated：外联动作必须逐次批准 |
| 自然语言增加降噪策略，编译、样本模拟、确认后启用和回滚 | natural-language-policy | 受限 DSL、覆盖率/紧急保护、稳定 proposal、Card revision 激活测试 | gated：本人现网卡片演练 |
| BlackLake 问题先按参考项目和 skills 路由，再决定 start/confirm/skip | blacklake-routing | 三源动态哈希、skill 存在性、operation-chain 门禁；compat 路由测试 | gated：DSH action 端到端演练 |
| 智造湖小维作为慢速排查工具，调用前必须本人批准，结果回灌且不重复建任务 | xiaowei-channel | 授权、持久等待、回复关联和普通 intake 排除测试 | gated：现网受控演练 |
| Claude Code 优先、Codex 兜底、同一 action 只能一个执行者 | executor-routing | 官方 providers、基础设施错误分类、串行 dispose、action lease/互斥测试；双方真实合成握手 | gated：完整 fallback 演练；第三方 Claude 成本通道未配置 |
| Claude Code 与 Codex 共享 skills、Agent 约定、参考项目，不产生信息差 | blacklake-routing, executor-routing | 根 AGENTS/CLAUDE 同步约束、三源 router、DSH profile provider 配置 | implemented；持续运行同步校验 |
| 飞书 CLI 快速升级适配，不让业务规则依赖 CLI 参数 | lark-event-adapter | version/schema/capability discovery、未知字段保留、升级 banner 测试和升级手册 | complete |
| SQLite 与 PostgreSQL 可配置，默认 SQLite | durable-store | 统一存储契约、两套 migration、SQLite/PG 实现 | complete |
| 本地 Web 控制台可见，未来兼容服务器部署 | web-console, daemon-deployment | loopback dashboard、token 门禁、health；systemd/Compose 和锁定 DSH runtime | gated：Docker daemon 修复后补 Linux 实镜像验证 |
| 个人电脑本地运行并访问授权文件是主形态 | local-first-execution | ADR 0003；默认 local/SQLite/loopback；workspace realpath 与 symlink 防护 | complete |
| 所有故障、恢复和需要协助的事项可通过飞书通知，时间显示为北京时间 | retry-and-alerting | 持久故障/恢复去重、本地时区格式、错误摘要脱敏测试 | gated：正式断线恢复演练 |
| 测试任务不得污染真实待办，低价值消息如“ok”不得建任务 | focus-intake, dida-projection | synthetic artifact、whole-message acknowledgement、priority-zero admission 测试 | observing：影子样本继续核验 |

## 当前不能绕过的接管条件

1. 影子窗口必须自然结束且严格审计通过。
2. 当前滴答 schema 至少 20 个真实 task projection 全部通过；不得人工制造测试待办凑数。
3. 卡片长等待、断线恢复、Claude 到 Codex 串行 fallback 和会话生命周期完成受控演练。
4. 获取常东旭针对本次切换的明确批准，并在冻结旧 checkpoint 后重新生成 handoff。
5. 切换时保持单一飞书消息/卡片消费者；任何异常先停止新消费者，再恢复旧 bridge。
