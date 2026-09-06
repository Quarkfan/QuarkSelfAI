# ADR 0096：Agent Blueprint 的确定性编译

- 状态：Accepted for inactive implementation
- 日期：2026-09-06

## 决策

Blueprint 发布内容使用排除自身 digest 字段后的 canonical digest。编译必须把每个 capability reference 唯一解析到匹配
id、version range 和 artifact digest 的 Manifest，确认 graph node 引用由该能力提供的 interface，并执行拓扑检查。缺失、
歧义、接口不匹配、环或 workspace grant 缺口都失败关闭。

编译输出一个供所有执行器共享的 Execution Envelope，再由注入的 Ed25519 signer 签名。inactive 编译器只接受 `test.*`
tenant、无 external effect 的 Blueprint，不自行派发任务或接触签名私钥。

## 当前边界与回滚

当前只有纯编译器、fixture signer 和离线验证，没有网络、数据库、设备连接、任务派发或运行挂载。回滚提交即可。
