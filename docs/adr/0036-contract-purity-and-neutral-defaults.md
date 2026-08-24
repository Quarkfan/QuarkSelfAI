# ADR-0036：契约层保持无运行行为，骨架默认值保持中立

状态：Accepted（2026-08-25）

## 问题

仅限制 import 方向仍允许两类反向污染：有状态、有生命周期的实现可以被标成 `contract`；无功能 provider 时使用的
骨架默认值也可能携带 `migration` 等阶段性产品语义。两者都不会形成非法 import，却会让目录和控制台给出错误的
架构事实。

本次审计发现 durable action ledger 实现了 Cordis `Service` 和插件 `apply`，却被标为 contract；中立的
`ControlOnlyRuntime` 也把 `operationalMode` 固定为 migration。

## 决策

- contract 模块只承载类型、端口、事件、纯校验和稳定标识，不拥有 Cordis `Service` 或插件 `apply`；
- durable action ledger 归入 skeleton/kernel：它的能力是通用骨架，但本身是运行实现，不是契约；
- control-only provider 的 mode 与 operationalMode 都是 `control-only`，不推断当前处于迁移或任何产品阶段；
- `architecture:check` 读取 contract 所有源码并阻断 `extends Service` 和导出的插件 `apply`，同时核验中立运行态。

## 后果

“属于骨架”不再等于“属于 contract”。骨架内部仍按 contract、kernel、policy、provider 和 surface 区分职责；未来
新增空 provider 或控制面默认实现时，也不能借默认值向骨架灌入某次迁移或具体产品的状态。
