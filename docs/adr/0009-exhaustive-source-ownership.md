# ADR-0009: 全量源码所有权与真实依赖校验

状态：Accepted（2026-08-24）

## 决策

`config/module-catalog.json` 必须为 `src` 下每个 TypeScript 文件、`packages/bridge-compat/src` 下每个现网
JavaScript 文件，以及 `scripts` 下每个 TypeScript/MJS 运维入口指定唯一 owner。`source` 表示模块入口，
`owns` 表示该模块拥有的精确源码文件；入口位于 `src` 时必须同时出现在自身 `owns` 中。

架构检查必须枚举真实源码并拒绝：

- 未归属或重复归属的文件；
- 已删除但仍留在清单中的路径；
- 未由自身拥有的模块入口；
- 源码存在跨模块相对 import，但 owner 未在 `dependsOn` 中声明，或 `dependsOn` 保留了已经不存在的 import；
- 由上述真实依赖形成的 skeleton -> feature/migration、feature -> migration 或循环依赖。

目录前缀和 glob 不作为 owner，以保证新增 helper 文件必须经过一次明确的架构判断。

## 原因

只登记代表入口会让同一文件冒充多个模块，也会让未登记 helper 绕过分类和依赖门禁。基于真实文件和 import 的
校验让“骨架、功能、迁移”成为可执行约束，而不是文档约定。

## 当前校正

- 通道事件契约从通用 action/executor 契约中拆出，两个模块不再共享同一入口。
- policy 数据契约、runtime status 契约与其实现分开，避免存储和内核运行时形成虚假的反向依赖。
- 存储工厂只依赖 storage config，控制台只依赖自身 console config，不再引用 migration runtime config。
- 稳定 application host 从 compat composition 中拆出；它只监管注入的组件，不知道具体通道或迁移模式。
- 进程 selector、compat composition 和 runtime config 如实归入 `bridge-compat-host`；通用 application
  composition 已独立归入骨架，并通过开放组件贡献接收迁移宿主，见 ADR 0022。

## 后果

新增源码必须同步更新模块目录。模块调整如果改变 import，必须同时更新 `dependsOn` 或拆除不合理耦合；
不产生源码 import 的注入与宿主关系按 ADR 0028 写入 `runtimeDependsOn`。
外部包与配置文件仍通过 `source` 登记。原生 `src/**/*.ts` 同时执行真实 import 双向核对；compatibility package
和 `scripts/*.{ts,mjs}` 只做逐文件 owner 覆盖。前者的内部耦合是待删除的迁移事实；后者是跨层读取、验证和迁移的
运维入口。二者都不能为了美化依赖图而反向污染稳定 feature 边界，但新增文件必须先明确归属，不能成为架构旁路。
