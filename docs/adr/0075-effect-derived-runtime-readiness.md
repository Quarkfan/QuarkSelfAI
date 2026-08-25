# ADR-0075：readiness 从 workflow effect 推导 adapter

状态：Accepted（2026-08-25）

## 问题

workflow 已通过 `requiresEffects` 声明外部能力，adapter 也通过 `providesEffects` 声明唯一实现，但原生 readiness 主要
依赖 `product-composition.json` 恰好显式列出双方。新增 workflow 若漏列 adapter，模块目录仍知道完整能力关系，
readiness 却可能看不到未激活 provider。

## 决策

- 从每个产品 root 递归展开 required effect 的唯一 provider，与 service provider、`runtimeDependsOn`、`mounts`
  共同形成运行依赖闭包；
- 跨模块 effect provider 边参与运行依赖环检测；
- 同一模块可以用纯处理器自供内部 effect，这种关系不形成自环；
- effect 关系只由 `requiresEffects`/`providesEffects` 表达，不要求 workflow 写死 adapter 模块名。

## 结果

产品清单负责选择能力，模块目录负责解析实现。adapter 未激活时，即使它不是产品清单顶层模块，runtime status 与
preflight readiness 也会将其列为 blocker；替换 adapter 不需要修改每个 workflow。
