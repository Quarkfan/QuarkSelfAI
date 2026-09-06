# ADR 0094：能力安装前治理与五态分离

- 状态：Accepted for inactive implementation
- 日期：2026-09-06

## 决策

制品只有在 license、signature、SBOM、malware、maintenance 与 dependencies 六项离线证据全部通过，且报告 identity 与
Manifest 的 id/version/revision/digest 完全一致时，才允许生成安装计划。计划只引用 Manifest 声明的 lifecycle interface，
不携带云端任意 shell 命令，且目标固定为 `installed-inactive`。

安装、加载、授权、执行、effect 使用五个独立状态维度。安装完成也必须保持 unloaded、unauthorized、stopped 和 effects
disabled；后续状态迁移不能因“已安装”被隐式放行。

## 当前边界与回滚

当前只有类型、Schema、纯 planner 与 fixture，没有下载、文件系统写入、handler 执行、进程启动或运行挂载。回滚该提交即可。
