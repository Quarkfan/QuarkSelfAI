# ADR-0031：控制台是可插拔 surface feature

状态：Accepted（2026-08-24）

## 问题

`application-composition` 曾直接创建 Web server，并把 `control-console` 登记为 skeleton。这样即使未来改用桌面端、
纯飞书交互或远端控制面，内核仍必须携带 HTTP、静态资源、登录认证和策略编辑界面；“可观察、可托管”的骨架能力
与某一种人机界面混成了同一层。

## 决策

1. `control-console` 改为 active feature，拥有 `src/web/server.ts`、配置解析和 lifecycle component adapter。
2. application skeleton 只创建 store lifecycle 与 DSH kernel，并开放 `AssistantComponentFactory`；factory 只能得到
   通用 `KernelStatusProvider`，不能让骨架反向认识 Web。
3. 当前 compat composition 继续贡献控制台、readiness 和 runtime provider，因此环境变量、端口、认证、页面行为和
   现网进程入口保持不变。
4. execution workspace 与 Web 配置分别归 `workspace-boundary` 和 `control-console`；kernel config 才属于 application
   skeleton。

## 后果

控制台可以被替换、停用或迁到服务器，而不修改 assistant kernel；未来桌面 surface、API surface 或内置 harness
界面都能用相同的组件扩展点接入。迁移期 composition 被删除时，新的 product composition 必须显式选择要启用的
surface feature，不得让骨架默认携带某个 UI。
