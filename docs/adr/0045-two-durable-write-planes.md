# ADR-0045：区分开放式 action 与已建模 workflow effect 两条写入面

状态：Accepted（2026-08-25）

## 问题

早期文档把“所有外部写入进入 durable action/approval”写成绝对规则，但现有滴答投影、飞书卡片、联系人外联、
策略启用和会话清理已经通过 workflow effect/outbox 实现。若强迫它们再套 action ledger，会出现双重队列、双重批准
和不清晰的结算责任；反过来，让开放式自然语言 executor 伪装成固定 effect 又会绕过 workspace 与会话边界。

## 决策

骨架提供两条互补的 durable 写入面：

1. **Action plane**：用于开放式自然语言执行、本地文件修改、代码调研/修复和无法预先枚举副作用的 executor。
   action 持有 workspace、审批、执行器路由、exact DSH session、租约和最终结果；
2. **Workflow effect plane**：用于已经定义版本化能力契约的业务副作用，例如任务幂等投影、发送批准卡、已批准
   外联、策略 revision 启用和会话生命周期操作。workflow 持有状态、correlation 和 effect outbox，adapter 只实现
   外部协议；
3. 高影响 effect 必须在 payload/state 中携带精确 owner approval 与不可变授权证据，adapter 写前再次核验；
4. 不得为了“统一”把固定业务 effect 包成 action，也不得把任意 executor 写操作塞进一个宽泛 effect；
5. 两条写入面都以数据库提交为真源，要求幂等、租约、失败重试、可审计状态和单 owner。

## 后果

action ledger 保持通用执行骨架，workflow runtime 保持通用流程骨架；具体滴答、飞书、BlackLake、小维和 session
能力仍是可替换 feature。未来新增想法先判断副作用是否能形成稳定契约，再选择写入面，不按外部产品名称选架构。
