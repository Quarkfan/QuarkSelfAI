# ADR 0026：原生切换门禁只约束显式迁移目标

状态：Accepted（2026-08-24）

## 问题

旧门禁把目录中每个 `runtime=inactive|shadow|compat` 的 feature 都视为 compatibility host 的退出阻塞项。
这会让可选 PostgreSQL provider、纯契约模块、后台 action worker，以及未来新增但尚未启用的插件阻塞当前飞书、
滴答和会话链路迁移。结果是插件体系越可扩展，现有迁移越不可能完成。

## 决策

`config/native-migration-plan.json` v2 中，每个迁移单元同时声明：

- `modules`：当前由 compatibility runtime 拥有的源模块；
- `targetModules`：本单元切换后必须取得运行所有权的原生模块。

`nativeCutoverReady` 只检查全部源模块、目标模块，以及目标模块通过 `requiresEffects` 声明的 effect provider。
它们必须存在、实现 ready 且运行 active。目录中没有被任何迁移单元引用的模块不参与这次门禁。

架构检查验证目标模块存在、属于 feature、不是 compat owner，并继续要求所有 compat feature 恰好属于一个源单元。
新增能力只有在确实属于当前 compatibility 迁移边界时，才应加入对应单元的 `targetModules`。

## 后果

- 可选数据库、实验插件和后续能力可以保持 inactive，而不阻塞无关的兼容层退出。

ADR 0035 已把该文件升级为 v3；原有 cutover target 语义不变，并新增对所有 migration 模块的退出单元覆盖。
- 漏列真实替代模块会弱化门禁，因此迁移计划变更必须通过架构检查、评审和对应 workflow/effect 测试。
- 模块 active 仍受全局依赖与 effect 唯一 provider 校验约束；本 ADR 不允许绕过运行时安全规则。
