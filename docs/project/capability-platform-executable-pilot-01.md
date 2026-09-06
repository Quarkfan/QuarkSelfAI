# Capability Platform executable pilot 01

状态：等待 owner 对精确 revision 和动作范围批准。

机器真源：`config/capability-platform-executable-pilot-authorization-request.json`

## 目的

基于 Phase 5E revision `13e1be477288e8a5f7e5ed1d9e37b33b8c49c1a9`，把已经完成的纯离线 preflight 推进为第一个真实但无副作用的
纵向证据：独立 loopback test control plane、已安装执行器的固定只读版本探测、签名 plan 的网络往返、单 device lease 和本地
checkpoint。该批不发送模型 prompt，也不执行 Agent。

## 为什么此处必须停在授权前

即使只运行 `--version`，也已从注入式 fixture 跨到执行本机第三方程序；启动 listener 也跨到真实服务边界。总 Goal 明确要求这两类
动作绑定 revision、文件范围、允许动作、排除项、验证和回滚后取得精确批准。Phase 5E 已在持续开发授权内完成命令 allowlist、输出
丢弃分类和永不 armed 的选择器；该授权单现已移除这些完成项，只保留真实 host adapter 和 listener。

## 后续顺序

本批通过后，下一批才申请在无 workspace、无 effect、预算封顶条件下各运行一次真实 executor fixture，并比较 Claude Code、Codex、DSH
的规范化输入与脱敏结果。真实能力安装、浏览器 runtime、私有 pack、持久云服务和 owner 切换继续分别审批。
