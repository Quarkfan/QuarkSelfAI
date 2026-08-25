# ADR-0076：capability 边同样遵守骨架与迁移边界

状态：Accepted（2026-08-25）

## 问题

`dependsOn`、`runtimeDependsOn` 和 `mounts` 已禁止长期模块依赖 migration，但新增的 service/effect provider 边没有
应用同一限制。临时迁移实现可以通过一个看似稳定的 capability 被 skeleton 或 feature 反向消费。与此同时，若
skeleton 自己声明具体 workflow effect，产品行为也会重新进入骨架。

## 决策

- skeleton 不得 require 或 provide workflow effect；骨架只拥有 durable effect/outbox 机制；
- skeleton/feature required service 的唯一 provider 不得是 migration；
- skeleton/feature required effect 的唯一 provider 不得是 migration；
- migration 可以消费长期 capability，以完成回放、审计和搬迁。

## 结果

源码、运行宿主、service 与 effect 四种关系都无法让长期代码反向依赖临时迁移层；产品行为也不能借 effect id
重新进入 skeleton。删除 migration provider 时不会留下隐藏的长期消费者。
