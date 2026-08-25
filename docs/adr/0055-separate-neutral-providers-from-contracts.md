# ADR 0055：中立默认 Provider 与静态契约分离

## 状态

Accepted

## 问题

`module-catalog` 与 `runtime-status-contracts` 被标为 `contract/static`，文件中却同时实现了空目录、control-only
runtime/kernel 和未配置 readiness provider。调用方因此依赖“契约文件里的默认实现”，分类无法真实表达运行代码。

## 决策

1. contract 模块只保留类型、端口、事件和纯校验函数，不得声明 class provider。
2. 四个中立默认实现迁入 `neutral-default-providers` skeleton/kernel 模块。
3. 控制台与兼容 composition 显式依赖该 provider；稳定 platform contract surface 不重新导出这些默认实现。
4. `architecture:check` 扫描所有 contract-owned source，发现 class 声明即失败。

## 结果

未来替换控制面、catalog 或 readiness 默认实现时，不会修改静态契约模块；模块目录的 `static` 与 `active` 再次
分别代表纯契约和可执行 provider。
