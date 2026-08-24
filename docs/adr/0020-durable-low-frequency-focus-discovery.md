# ADR 0020：重点关注发现使用持久低频工作流

状态：已接受（2026-08-24）

## 背景

飞书实时事件适合本人机器人私聊、明确 @、卡片回调、成员变更和表情事件，但不能完整表达用户侧的消息标记、
Feed“特别关注”分组，也不能可靠补偿断线窗口。此前 native intake 声明了 `discoveryIntervalMs` 和
`feishu.discover-focus-signals.v1`，却没有工作流发出 effect、没有 provider 实现它；配置看似可用，实际上不会运行。

## 决策

重点关注发现拆成两个独立部分：

1. `focus-discovery.v1` 是持久单例 workflow。最短间隔固定为 10 分钟，使用两分钟重叠窗口；调度点、上次成功窗口和
   连续失败次数都保存到 workflow state，不使用 `sleep`，进程重启后继续。
2. `feishu.discover-focus-signals.v1` 是只读 adapter effect。它只读取显式配置的联系人/会话、本人主动参与消息、他人
   私聊、断线期间的 @补偿、当前 Flag 会话及指定 Feed 分组中的会话；搜索始终带至少一种结构化过滤条件、时间窗、
   分页上限和完整性检查，不扫描全部消息。
3. Adapter 不判断是否建任务，也不调用飞书或滴答写接口。它把候选规范化为 `quark.focus.discovered.v1` 事件并写入
   与实时事件相同的 durable inbox；消息 ID 是跨实时/搜索通道共享的幂等键。上下文、外部群门禁、语义判断、任务
   更新与通知继续复用 message intake 链路。
4. Flag 和 Feed 分页只要仍显示 `has_more=true` 就整轮失败并持久重试，不能把不完整列表当成权威关注清单。Effect
   只返回聚合计数，不把消息正文写入日志。

## 结果

实时通道保持低延迟，非 @ 重点信息允许至少 10 分钟延迟；新增关注来源只需扩展 discovery adapter，不复制任务判断
逻辑。Compatibility runtime 仍是现网唯一 owner，native workflow 与 adapter 必须在同一维护窗口启用，避免重复搜索。
