# ADR-0070：所有已跟踪 package export 都必须有模块 owner

状态：Accepted（2026-08-25）

## 问题

ADR 0058 建立了 Cordis plugin export 与稳定 `./platform` export 的反向源码所有权，但普通 contract export 和
未来 DSH Client 静态 export 不在统一遍历中。新增 `package.json#exports` key 因而可能绕过模块分类：它既不是骨架、
功能或迁移模块的显式入口，也没有可验证的维护责任。

早期文档还把“控制面”整体归为骨架。当前实现已经把通用状态/生命周期契约与具体 Web 控制台分离；后者使用
`surface` feature 才能被替换，而不迫使骨架承诺某套 UI。

## 决策

- 架构检查遍历 `package.json#exports` 中所有已经进入 Git 的目标；
- `dist/**` 目标反向映射到 `src/**`，直接静态目标映射到 catalog `assets`；runtime 与 types 必须由同一模块拥有；
- Cordis plugin export 还必须与 `plugin.packageExport` 的 owner 一致；
- `./package.json` 是唯一 metadata 特例，必须精确指向自身；
- 完全未跟踪的本地 Client/UI 实验不进入仓库所有权。runtime 或 types 任一目标进入 Git 后，两个目标都必须已跟踪
  且归属于同一个 `surface` feature，不能挂靠控制台或平台契约蒙混过关；
- 控制面中的稳定状态契约属于骨架，具体 Web/DSH Client 界面属于 surface feature。

## 结果

Package API 与模块目录形成完整闭环，非插件入口不能成为绕过分类和资产所有权的暗门。个人本地实验仍可迭代，
但在提交前必须完成模块化，避免将半成品无意纳入产品骨架。
