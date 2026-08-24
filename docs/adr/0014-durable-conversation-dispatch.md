# ADR 0014: 飞书直办通过 Durable Effect 创建或续接 DSH 会话

- 状态：Accepted
- 日期：2026-08-24

## 背景

本人私聊要求需要直接交给模型理解和执行，而不是映射成枚举命令。原生 intake 已能持久化消息和工作流，但此前
缺少真正的会话 provider；把请求写入 action ledger 也不能自动获得 DSH parent session，容易形成“已入队但无人
执行”的假闭环。

## 决策

1. `assistant.conversation.dispatch.v1` 是消息协作功能的 effect contract，不属于 durable workflow 骨架；
2. DSH provider 接收原始自然语言、受限上下文和 workspace，创建用户可见的顶层 DSH 会话；调用方也可以提供
   exact `targetSessionId` 续接已有会话，禁止模糊选择；
3. 新会话 ID 由 durable effect ID 确定性生成。effect 重试会恢复同一 session，并通过请求标记确认是否已经提交，
   不得重复创建或重复发送；
4. 目标会话正在运行或属于其他 workspace 时 fail closed，由 durable effect 重试或回报，不进行并发混写；
5. 第一条消息带可读标题和八位唯一标识，使控制台会话列表可以区分相似请求；
6. 最终 assistant 输出作为 effect 结果返回原 intake workflow，再通过 owner notification effect 回传飞书。

## 安全与切换

上下文被明确标记为不可信业务数据；provider 不自行获得外部写授权。插件默认禁用，并在 compat runtime 下强制
禁用。只有 native 飞书入口、会话 provider 和结果通知在同一维护窗口转移 owner 后才允许启用。
