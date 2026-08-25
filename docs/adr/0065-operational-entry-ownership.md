# ADR-0065: 运维入口必须由 operations 模块拥有

状态：Accepted（2026-08-25）

## 背景

脚本依赖已进入精确校验，但 `blacklake-reference-routing` workflow 仍直接拥有集成审计脚本。因为 script 与业务源码
属于同一 owner，依赖图无法呈现“运维检查调用业务插件”的真实方向，workflow 也同时承担了运行能力和仓库审计职责。

## 决策

1. 所有 `scripts/*.{ts,mjs}` 必须由 `layer=operations` 模块唯一拥有；架构检查自动阻断其他 layer 接管脚本。
2. 新增 `blacklake-reference-audit` operations feature，拥有 `scripts/check-blacklake-references.ts`，源码依赖
   `blacklake-reference-routing`，运行依赖 DSH。
3. `blacklake-reference-routing` 只保留业务服务与插件入口，不因审计工具获得 operations 权限。
4. CLI 审计、演练、部署、迁移工具均按相同规则建模；即使脚本只 import 同一业务模块，也必须拆分 owner。

## 后果

workflow、adapter、policy 等业务层不再通过拥有脚本获得隐式跨层能力。运维能力可以独立删除、替换和执行，业务插件的
源码依赖保持向内；模块目录同时呈现业务运行关系与审计调用关系。
