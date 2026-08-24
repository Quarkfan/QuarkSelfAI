# ADR 0016: 卡片操作使用显式工作流相关性

状态：已接受（2026-08-24）

## 背景

飞书卡片按钮、下拉框和表单会在未来某个时间产生新的入站事件。仅携带 `approvalId`、业务 requestId，或根据
消息文本猜测目标，都无法证明操作属于哪个 durable workflow。进程重启、相同事项并行、卡片重试和旧卡片延迟
点击时，这会造成串单或把用户输入投递给已不相关的流程。

## 决策

- 每个交互控件必须携带由 QuarkSelfAI 生成的 opaque correlation，至少包含原 workflow instance ID 与生成卡片的
  effect ID；审批另带 approval ID，业务事件另带 event type 与显式 payload key。
- correlation 只做路由和完整性校验，不承载权限。回调仍必须重新验证操作者恰好是配置的 owner。
- 通用 adapter 不知道“联系人”“搜索词”等业务含义。创建卡片的 workflow 声明 event type 和 payload key，adapter
  只把值投递到该字段。
- 回投事件 ID 从飞书入站 deduplication key 确定性生成；durable workflow event journal 负责跨重启幂等。
- 审批卡片的补充输入只产生 `approval.response`，不会被推断成批准。只有明确按钮产生
  `approval.approved` 或 `approval.declined`。
- 无 owner 证明、无 correlation、无 payload mapping 或 approval ID 不匹配时一律失败关闭。

## 结果

交互 effect provider 可作为独立 feature adapter 激活和替换；卡片渲染、回调接入与具体业务状态机不再通过
字符串约定暗中耦合。重点消息审批在卡片送达后保持 `awaiting-approval`，直到精确回调到达。
