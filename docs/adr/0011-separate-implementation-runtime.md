# ADR 0011：实现成熟度与运行归属分离

## 状态

Accepted，替代 ADR 0010 中使用单一 `status` 表达 effect readiness 的部分。

## 问题

旧模块目录用 `native | compat | planned` 同时回答两个问题：代码是否已经实现，以及哪个运行时当前拥有生产
副作用。飞书和滴答 adapter 已有实现与测试，却只能标记为 `planned` 以避免宣称接管；因此控制台和门禁把
“尚未激活”错误显示成“尚未实现”，effect 覆盖率也长期显示为 `0/19`。

## 决策

模块目录 v2 使用两个正交字段：

- `implementation = planned | partial | ready`：只描述代码、契约与验证成熟度；
- `runtime = inactive | shadow | active | compat`：只描述当前运行和副作用所有权。

`active` 模块必须 `ready`；骨架模块必须同时 `ready + active`。active consumer 只能依赖 active effect provider。
effect 审计分别输出 implemented 和 active 覆盖率，并把“没有实现”和“实现了但未激活”列为不同门禁。

迁移期业务实现可以是 `ready + inactive`，旧实现保持 `ready + compat`。维护窗口只改变 runtime ownership，
不伪造 implementation maturity，也不因代码完成而自动获得生产副作用。
