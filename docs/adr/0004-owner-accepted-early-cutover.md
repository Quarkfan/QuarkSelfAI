# ADR 0004：显式接受已知未完成项的提前接管

状态：Accepted（2026-08-23）

## 背景

常东旭明确要求立即切换，并接受运行中继续迭代；同时要求架构完整、可扩展，不能通过篡改 feature parity、
隐藏风险或跳过状态交接来放行。

## 决策

正式预检支持一种受控的 accepted-risk cutover：

1. `TAKEOVER_CONFIRMED=true` 表示 owner 针对本次切换明确批准；
2. `TAKEOVER_ACCEPTED_INCOMPLETE` 必须逐项列出机器清单中当前所有 required+partial/missing ID；
3. 遗漏任一当前未完成项、填写未知 ID、状态/CLI/凭证预检失败，均 fail closed；
4. feature parity 的真实状态保持不变，Web 控制台和审计继续显示 partial；
5. 该机制不允许通配符，也不允许为未来新增的 incomplete 自动继承批准；
6. 切换仍必须执行最终 checkpoint、单消费者交接、健康检查和先停新再恢复旧的回滚顺序。

本次明确接受的运行期证据缺口是 `dida-projection` 与 `shadow-collaboration`。接受证据缺口不等于取消
功能边界：NOTE 防护、幂等、外部群禁言、正式回复审批、动作租约和单执行器约束继续强制生效。
