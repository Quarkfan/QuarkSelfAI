# ADR-0074：readiness 从 service capability 推导 provider

状态：Accepted（2026-08-25）

## 问题

引入 `requiresServices`/`providesServices` 后，部分功能仍同时声明
`runtimeDependsOn=durable-workflow-runtime`。另一些同样注入 `quarkWorkflows` 的功能没有该声明，造成两套表达方式。
如果 service 更换 provider，目录、readiness 和插件注入可能分别指向不同实现。

## 决策

- Cordis service 运行关系只由 `requiresServices` 与唯一 `providesServices` provider 表达；
- readiness 从产品 root 递归展开 `runtimeDependsOn`、`mounts`，并自动加入每个 required service 的 provider；
- service provider 边参与运行依赖环检测；
- `runtimeDependsOn` 只保留 DSH、外部 package、兼容宿主等独立存在的运行关系；外部 runtime 可以同时提供内置
  service，但仓库内具体 service provider 不得被消费者重复写死；
- 删除原先针对 `quarkWorkflows`、`quarkEvents`、`quarkActionLedger` 的特判和重复 provider 声明。

## 结果

功能只依赖 capability，替换 provider 不需要逐一修改消费者。原生 readiness 仍能递归发现 durable runtime 和状态
provider 的未激活状态，但其依据是实际 service 图，而不是容易漂移的手工模块名。
