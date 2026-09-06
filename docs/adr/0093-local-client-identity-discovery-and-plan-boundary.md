# ADR 0093：客户端身份、执行器发现与签名计划边界

- 状态：Accepted for inactive implementation
- 日期：2026-09-06
- 决策者：常东旭（总 Goal 与连续实施授权）

## 决策

客户端只向云端或编排层暴露公开设备身份和脱敏 `ExecutorCapabilityReportV1`，不暴露私钥、可执行文件路径、命令输出、
本地目录或认证材料。执行器选择以版本化 protocol、capability requirement、allowlist 和 preference 为输入；选择只产生
声明式结果，不启动执行器。DSH 保底通过 Blueprint 的显式 allowed/preferred 顺序表达，不在内核写死具体产品名。

云端计划必须包装为 `SignedExecutionPlanV1`。客户端在任何执行前校验有效期、payload digest、envelope 内签名元数据和
受信 key verifier；计划 payload 不含签名元数据本身，避免自引用摘要。执行器继续消费 Phase 1 的同一 Execution Envelope。

## 当前实现边界

Phase 2A 只有 contract、闭合 JSON Schema、纯协商/校验函数、注入式离线 probe coordinator 和 disconnected inactive
snapshot。没有真实设备注册、密钥生成、CLI 探测、网络连接、installer、电脑控制、consumer/provider/effect 或 Cordis
composition 变化。真实 adapter 与客户端 daemon 必须在后续独立批次实现和验证。

## 回滚

本批无持久状态和运行挂载；回滚单个提交即可，不需要迁移数据或重启服务。
