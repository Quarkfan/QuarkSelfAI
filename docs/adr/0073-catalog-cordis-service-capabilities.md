# ADR-0073：目录显式登记 Cordis service capability

状态：Accepted（2026-08-25）

## 问题

模块目录已经能证明源码 import、运行宿主和 workflow effect，却不能证明 Cordis 插件实际注入了哪些 service、这些
service 由谁注册。模块可能被标记为 ready/active，但运行时才发现 provider 不存在、仍未激活或出现两个实现；反过来，
把 service 注入误写成 `dependsOn` 又会把依赖抽象错误地解释成 skeleton 对 feature 源码的反向依赖。

## 决策

- descriptor 增加 `requiresServices` 与 `providesServices`，缺省为空；
- 每个 service 必须恰有一个 provider，每个 requirement 必须可解析，active consumer 只能依赖 active provider；
- static contract 不得注入或注册运行时 service；
- 架构检查从模块拥有的 TypeScript 源码提取 `static inject`、模块级 `inject`、`super(ctx, service)` 与
  `ctx.provide(service, ...)`，要求与目录双向精确一致；
- 外部 DSH runtime 没有本仓库源码 owner，因此由目录声明其 `agents`、`subagents`、`llm`、`tools` 和
  `dynamicCordisRunner` 内置能力，并继续由 DSH compatibility check 验证版本与接口；
- service capability 不参与源码依赖方向和环检测。源码仍只能依赖稳定 contract，具体实现由产品 profile 装配。

## 结果

“代码存在”“插件挂载”和“所需运行能力可解析”成为三个可独立证明的事实。新增 provider、替换数据库或扩展 DSH
能力时，目录会在启动前暴露漏配、重复实现和 inactive provider，同时保持 skeleton 与 feature 的源码边界。
