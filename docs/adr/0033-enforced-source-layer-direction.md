# ADR-0033：模块 layer 是可执行的源码依赖规则

状态：Accepted（2026-08-24）

## 问题

模块目录已经精确核对真实 import 和 `dependsOn`，但 `contract`、`kernel`、`workflow`、`adapter` 等 `layer` 仍只是
标签。只要 classification 相同，contract 仍可能反向 import workflow，kernel 也可能直接 import adapter；这种依赖
会通过原有检查，却让未来替换某块“肉”时连骨架一起改动。

## 决策

原生源码依赖采用以下允许矩阵；未列出的方向失败关闭：

| 发起层 | 允许依赖层 |
|---|---|
| contract | contract |
| kernel | contract, kernel |
| policy | contract, policy |
| provider | contract, kernel, policy, provider |
| adapter | contract, kernel, adapter |
| workflow | contract, kernel, policy, workflow |
| projection | contract, kernel, policy, projection |
| surface | contract, kernel, policy, surface |
| operations | 全部层 |

该矩阵只约束 `dependsOn` 对应的源码 import。插件装配、effect provider、宿主等 `runtimeDependsOn` 允许跨层，但仍受
skeleton/feature/migration 分类方向约束。

原 `platform-api` 是对外 barrel，导出 lifecycle 与 workspace policy 实现，不是纯 contract，因此纠正为 skeleton
`surface`。真正的 contract 仍保持只依赖 contract。

## 后果

workflow 只能通过 effect contract 请求 adapter，不能直接调用飞书或滴答实现；kernel 不能认识 UI、provider 或
业务 workflow；operations 保留跨层审计、迁移和装配能力。以后若需要新增依赖方向，必须先调整模块职责或通过 ADR
解释，不能只改清单来迎合一次 import。
