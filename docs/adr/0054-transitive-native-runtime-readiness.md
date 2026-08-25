# ADR 0054：原生 readiness 验证运行依赖闭包

## 状态

Accepted

## 问题

产品 manifest 适合声明用户可理解的顶层能力，但一个顶层插件还依赖 DSH 内的 durable workflow、event、action
ledger、executor router 等运行服务。只检查 manifest 模块会产生假健康：顶层模块 active，而它注入的 provider
已经 inactive。

## 决策

1. 产品 manifest 继续只声明顶层产品能力，不复制骨架模块列表。
2. runtime status 与 startup readiness 从必需能力和已选择的 storage provider 出发，递归展开模块目录的
   `runtimeDependsOn`。
3. 闭包中的模块必须 `implementation=ready` 且 `runtime=active/static`；缺失或 inactive 都阻断原生启动。
4. 控制台以 `platform-runtime-dependencies` 单独展示闭包状态，使产品能力与支撑运行时都可见。
5. `dependsOn` 仍只表示源码/契约关系，不参与运行闭包，避免 SQLite 选择时错误要求 PostgreSQL active。

## 结果

新增 harness、provider 或 durable runtime 时，只需在模块目录声明准确的 `runtimeDependsOn`，原生 readiness 会
自动纳入；不需要修改产品入口中的硬编码清单。
