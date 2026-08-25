# ADR 0056：稳定 Platform SDK 只导出契约

## 状态

Accepted

## 问题

`@quarkfan/quark-self-ai/platform` 面向未来仓库外插件，却通过 barrel 暴露了 `LifecycleSupervisor` 和
`WorkspacePolicy` 具体实现。插件若使用这些类，就会把进程编排和本地文件策略固化成公共 API。

## 决策

1. `./platform` 只导出领域、授权、存储端口、durable action/event/workflow ports、policy、运行状态和模块契约。
2. 允许导出契约文件中的纯校验函数；不导出生命周期、文件系统、数据库、默认 provider 或 Cordis Service 实现。
3. `platform-api` 归类为 `skeleton/contract/static`，依赖方向由现有 contract layer 规则强制。
4. 架构检查显式拒绝稳定入口重新导出 `workspace-policy` 或 `lifecycle`。

## 结果

未来插件只绑定可替换端口，骨架可以替换进程 host、本地权限实现和 runtime provider，而无需兼容外部插件对实现类
的调用。需要仓库内部实现能力的代码继续直接导入具体模块，不扩大公共 SDK。
