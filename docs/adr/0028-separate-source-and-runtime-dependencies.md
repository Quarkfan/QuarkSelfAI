# ADR 0028：源码依赖与运行时装配依赖分离

状态：Accepted（2026-08-24）

## 问题

模块目录 v2 的 `dependsOn` 同时记录相对 import、Cordis/DSH runtime、服务注入、compat 宿主和业务调用关系。
架构检查只能发现“有 import 却没声明”，不能发现已经不存在的声明；同一条边也无法判断删除 import 后是否仍有
运行关系。目录因此不是精确的依赖真源。

## 决策

模块目录 v3 把依赖拆成两类：

- `dependsOn`：模块源码真实存在的跨 owner 相对 import；架构检查按当前文件反向计算，并要求集合双向一致；
- `runtimeDependsOn`：没有对应相对 import 的 Cordis/DSH、服务注入、外部 package 或 compatibility 宿主关系。

两类依赖都必须引用已登记模块，都遵守 skeleton 不依赖 feature/migration、feature 不依赖 migration 的方向，
并共同参与循环检查。源码 import DSH/Cordis 的模块必须显式声明 `runtimeDependsOn=dsh-runtime`。长期外部动作
仍使用 `requiresEffects/providesEffects`，不能用 runtime dependency 取代 effect 契约。

目录 schema 失败关闭：目录或模块的未知字段、未规范化或逃逸项目目录的 `source`、非 compat 模块的 `hostedBy`、非 migration 模块的
`exitCriteria`，以及 migration/skeleton 使用 `runtime=compat` 都是配置错误。这样拼写错误或所有权混淆不会被
静默忽略。

兼容功能的源码位于独立 JavaScript package，当前不纳入 `src` owner 扫描，因此其历史关系全部记录为
`runtimeDependsOn`；迁移完成后随 compatibility module 一起删除。

## 后果

- 新增、删除或移动 import 时，过少和过多的声明都会立即失败。
- 新增模块字段必须先升级 parser、类型、检查和模板，不能靠 JSON 中的临时字段形成隐性约定。
- 模块图可以分别回答编译耦合和装配耦合，未来替换 channel、executor 或 storage 时不再靠猜测。
- feature 模板从一开始区分两类依赖；插件作者不能用概念性 `dependsOn` 掩盖不准确的源码边界。
