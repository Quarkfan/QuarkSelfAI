# ADR-0043：长生命周期组件在构造期固定 Cordis 注入端口

状态：Accepted（2026-08-25）

## 问题

Cordis 的依赖访问校验绑定插件执行作用域。模块入口虽然声明了 `inject`，但入口内部再次 `ctx.plugin(ServiceClass)`
时，class 若没有自己的 `static inject`，构造期访问就会失败；即使构造成功，原生 timer、durable effect、agent 或
stream 回调离开作用域后再读取 `this.ctx.<service>`，也会得到 `cannot get property without inject`。

此前 conversation、reasoning、followup、intake、session lifecycle、Xiaowei、BlackLake routing、action ledger 和
executor router 分别存在其中一种隐患。它们在代码层被标为 ready，但切到真实后台执行时可能失败。

## 决策

- 每个 Cordis `Service` class 必须自行声明构造期实际读取的全部 injected ports，不能依赖外层模块入口的声明；
- 构造期把 `state`、`workflows`、`events`、`agents`、`llm`、`ledger`、`subagents` 等解析成稳定引用；
- 长生命周期回调只持有这些引用或更窄的结构化 port，不保存 Context 用来延迟查找业务 provider；
- `Context` 仅可用于 Cordis 自带的事件发布和日志等 host 能力；
- 架构检查拒绝延迟 `this.ctx.<injected-service>`，并校验 Service class 的构造期访问均包含在 `static inject` 中。

## 后果

后台执行不再依赖隐式 async context，class 直接装载与模块组合装载具有相同依赖语义。新增 provider 可以替换实现，
但一次 component 生命周期内引用稳定；需要热切换时应通过重载 fiber 完成，而不是让业务回调动态穿透容器。
