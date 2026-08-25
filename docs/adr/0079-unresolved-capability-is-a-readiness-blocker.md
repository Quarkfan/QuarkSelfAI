# ADR-0079：未解析 capability 是显式 readiness blocker

状态：Accepted（2026-08-25）

## 问题

inactive/planned workflow 可以先声明尚未实现的 `requiresEffects`，以支持渐进开发。唯一运行图若只输出已有 provider
的边，会静默省略缺失 effect；控制台看不到缺口，readiness 也无法区分“没有运行依赖”和“依赖尚未实现”。

## 决策

- `ModuleRuntimeGraph` 除 edges 外输出 `unresolved` requirement；
- service requirement 理论上由目录校验立即拒绝，effect requirement 可在 planned/inactive 阶段保持 unresolved；
- 控制台将 unresolved capability 显示为“缺失”；
- 必需产品闭包中的 unresolved capability 以稳定 synthetic id 进入 runtime status 与 readiness blockers；
- readiness 摘要分别统计 required modules 与 unresolved capabilities，避免用缺口数错误扣减模块完成数。

## 结果

渐进开发仍被允许，但“声明了接口”和“实现已可用”不会混淆。任何缺少 adapter 的必需 workflow 都无法通过原生
接管门禁，且缺失的 module、kind 和 capability id 可直接从控制台与 preflight 证据核验。
