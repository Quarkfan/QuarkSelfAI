# ADR-0050：功能依赖稳定运行时端口，而非具体 Service

状态：Accepted（2026-08-25）

## 问题

workflow、event 和 action ledger 原先把可供功能使用的接口声明在具体 runtime Service 文件中。功能即使只调用
`register`、`wake` 或 `enqueue`，也必须 import 实现类。这让源码依赖把稳定能力契约与 Cordis provider 混为一谈，
替换内核实现会扩散到所有业务功能，也无法仅凭模块目录区分“编译需要什么”和“运行时由谁提供”。

## 决策

1. 为 durable workflow、durable event 和 durable action ledger 分别提供窄 port contract；contract 可以包含 Cordis
   Context 的类型增强，但不实现 Service、插件或业务行为；
2. 具体 runtime Service 实现对应 port，并继续由 composition/profile 注册；
3. feature 源码的 `dependsOn` 指向 contract 模块，实际注入 provider 写入 `runtimeDependsOn`；
4. 仓库内 feature 从窄 contract 文件导入，仓库外插件从 `@quarkfan/quark-self-ai/platform` 导入稳定扩展面；
5. 架构检查拒绝 feature 直接 import 具体 durable runtime，并拒绝使用注入端口却不声明 provider；
6. runtime 文件暂时 re-export contract 类型以保持内部兼容，但不作为新功能的扩展入口。

## 后果

新增功能可以在不依赖调度器、事件消费者或 ledger 实现细节的情况下编译和测试，运行时装配仍保持可审计。未来替换
provider 时只需满足 port 并调整 composition，不应修改业务 workflow。增加新的骨架能力时，应先建立最小 port，
再分别登记 contract 与 provider，而不是把具体 Service 当作 SDK。
