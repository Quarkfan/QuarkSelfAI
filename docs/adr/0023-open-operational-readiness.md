# ADR 0023：控制面使用开放 readiness gate，不把接管阶段固化进骨架

状态：accepted

## 背景

`runtime-status-contracts` 与控制台曾直接定义 `TakeoverReadinessReport`，包含 `takeoverReady`、
`nativeCutoverReady` 和 `nativeCutoverBlockers`。这些字段服务于 bridge 迁移，却进入了长期平台契约、健康 API
和 Web UI。迁移结束后，要么留下永久的历史术语，要么再次破坏控制台接口。

## 决策

1. 骨架只定义开放 `OperationalReadinessReport`：具名 gate id、`ready/blocked/unknown` 状态、items、blockers
   和简单 summary。它不理解接管、发布、凭证或任一业务能力。
2. `takeover-readiness` 迁移模块把历史 feature parity 适配为 `native-cutover` gate；原始 parity 类型只留在
   迁移模块和预检工具中。
3. 控制台 `/api/dashboard` 返回 `readiness`，健康接口返回该 gate 的 id/state/blockers；运行展示模式由
   runtime provider 提供，不再从迁移字段推断。
4. 将来服务器发布、凭证健康或其他检查可以提供新的 gate provider，而无需修改平台契约或控制台分支。

## 结果

当前 bundled Web UI 与 API 同步切换到通用 readiness 结构。该项目仍处于 0.x，未为旧的内部
`parity/takeoverReady` 响应保留永久别名；若出现外部 API 消费者，应在版本化 adapter 中兼容，而不是把迁移
字段重新加入骨架。
