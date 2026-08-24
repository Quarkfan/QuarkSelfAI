# ADR-0035：迁移模块退出必须由机器计划覆盖

状态：Accepted（2026-08-25）

## 问题

迁移计划 v2 能证明 11 个 `runtime=compat` 功能恰好落入六个切换单元，却不能证明五个 migration 模块最终会被
删除或转正。功能切换完成后，compat host、旧状态工具、临时 readiness adapter 和接管证据脚本仍可能永久留在主干，
形成第二套事实来源。

## 决策

1. `config/native-migration-plan.json` 升级为 v3，新增 `exitUnits`。
2. 每个 migration 模块必须恰好属于一个退出单元；每个退出单元声明：
   - `disposition`：删除或转正为 feature；
   - `afterCutoverUnits`：必须先完成的功能切换；
   - `afterExitUnits`：迁移脚手架之间的退出顺序；
   - `verification`、`rollback` 和是否需要维护窗口。
3. 架构检查拒绝未知字段、未知依赖、环、重复/遗漏模块、非 migration 退出目标和无验证/回滚说明。
4. 当前退出拓扑为：native profile 转正 → compat host 删除 → readiness/legacy-state 退出 → takeover evidence 最后删除。
   legacy state 仍要满足回滚保留期，不能因源码已切换就提前销毁。

## 后果

“切换成功”与“迁移层退出完成”成为两个可审计阶段。只要五个退出单元未全部完成，架构目标就不能宣称完成；
最终主干不允许保留仅为本次接管存在的 runtime、状态读链路或证据适配器。
