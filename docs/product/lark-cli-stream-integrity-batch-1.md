# 飞书 CLI 事件流完整性：第一批生命周期加固计划

状态：本地适配器加固与离线检查完成；2026-10-12。属于[飞书优先实施计划](feishu-first-workspace-implementation-plan.md)的接入层批次，不启用新 consumer，不切换现有个人实例。专属应用与共享应用两种部署形态均继续默认使用 `lark-cli`。

## 证据与问题

本地 `lark-event` 规则及 `lark-cli event consume --help` 确认：每个 EventKey 一个进程，本机多个进程共用 bus；stderr 的精确 ready marker 是启动凭证，非零退出代表失败；`--quiet` 会隐藏丢弃告警；有服务端订阅清理的 EventKey 不能使用 `SIGKILL`。这只能说明单机 CLI 进程行为，不证明跨设备/应用的唯一订阅。

当前 `src/lark/stream.ts` 的 stdout `line` handler 异步调用 `onEvent` 却不等待，下一事件可越过尚未完成的 journal 写入；回调异常转成 child `error` 而无稳定观察者；ready 后的 stderr 与 exit 未持续关联到 service 健康；停止超时使用 `SIGKILL`。当前实现不得被解释为 durable 接收证明。

## 本批实施

1. 保持 `lark-cli event consume <EventKey> --as <identity>` 不变；不改认证、订阅、配置或现有运行进程。把本地 stream 生命周期改成精确 ready 解析、持续 stderr/exit 观察、按流串行等待 `onEvent`，处理期间暂停 stdout 读取以形成背压。
2. 回调失败、JSON/normalize 失败、非预期退出或启动超时要进入可观察的失败状态并停止继续分发；不把失败事件标记为已安全入库。保留脱敏故障类别，不持久化或回显原始飞书正文/凭证。
3. 停机先关闭 stdin、再给 SIGTERM；超时只报明确故障并保持进程引用，不用 `SIGKILL` 绕过 CLI 的订阅清理。失败后不能静默启动第二个同 EventKey 消费者。
4. 通过隔离 fake CLI 子进程测试 ready、顺序/背压、回调失败、异常退出、正常停止与卡住停机；检查与现有 DSH 服务的接入兼容性。测试不触发真实飞书事件、不运行 live consumer。

## 明确不在本批

本批不建立全局订阅 owner、跨进程/设备 lease、事件服务端 ack/replay 保证，也不证明无滴答首用。若 CLI 本身在 stdout 交付后即确认上游事件，回调失败仍可能丢失；必须另评估 checkpoint/补偿读取和实际 CLI 语义。`subscriptionIdentityVerified`、`consumerOwnerVerified`、`liveColdStartVerified` 保持 false。

## 回滚与验收

改动仅在本地 Git，无 push 或部署；回滚单位为 stream/service 源码与测试，现有运行实例不受影响。全部合成测试和 `npm run check` 通过后仍仅认定“本地适配器生命周期加固”，不得称为端到端消息不丢。

## 本批实现观察

stream 现在要求精确 ready 行，按 EventKey 串行等待 journal 回调并暂停 stdout 读取；启动后持续跟踪 stderr/close，失败只记录脱敏类别，不记录原始事件或回调异常正文；停止等待子进程关闭与在途回调完成，超时保留“不确定 owner”状态，不使用 `SIGKILL`。service 对每条 stream 保留健康/失败摘要，部分启动或停止失败时不清空尚未确认结束的进程登记。合成 fake CLI 测试覆盖这些边界；仍须用真实 CLI/订阅证据验证上游投递与补偿机制。

`npm run check` 已通过（TypeScript 构建、154 模块架构检查、主仓与兼容包测试；与飞书流相关的 5 条合成测试通过）。主仓仍有沙箱不允许 loopback 的既有跳过项。本批没有启动 CLI `event consume` 或更改现行运行进程。
