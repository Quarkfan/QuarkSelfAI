# ADR-0051：纯契约使用 static，不伪装运行态

状态：Accepted（2026-08-25）

## 问题

模块目录原先要求每个模块都使用 `active`、`inactive`、`shadow` 或 `compat`。纯 contract 没有进程、消费者、状态
owner 或启停行为，却被迫选择一个运行状态；同类契约因此出现一部分 active、一部分 inactive，控制台和接管判断
无法区分“类型与端口已经发布”和“实现已经取得运行所有权”。

## 决策

`ModuleRuntime` 增加 `static`。所有 `layer=contract` 模块必须使用 `runtime=static`，非 contract 模块不得使用。
`implementation` 仍表示契约本身是否完成；active/inactive/shadow/compat 只用于可执行模块。骨架 contract 仍须
`implementation=ready`，骨架的其他可执行模块仍须 `runtime=active`。static contract 不得声明
`runtimeDependsOn`；Cordis `declare module` 等纯类型绑定不会生成运行时依赖，实际 provider 由使用端和 composition
声明。

控制台将 static 展示为“静态契约”，不显示为原生宿主。迁移 target、effect provider 和健康判断只处理可执行
模块，不把 static contract 当成未激活 blocker。

## 后果

模块清单能准确回答两件不同的事：接口是否存在，以及哪个实现正在运行。新增 contract 不再需要伪造运行态；
新增 provider、adapter、workflow 或 surface 仍必须声明真实所有权状态。
