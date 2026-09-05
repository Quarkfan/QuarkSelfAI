# ADR 0092：云端控制、本地执行的能力与 Agent 编排平台

- 状态：Proposed / inactive
- 日期：2026-09-06
- 决策者：常东旭（目标）；实现边界待逐批批准

## 背景

现有 QuarkSelfAI 以单用户、本地优先助手和 DSH/Cordis 迁移为中心。ADR 0091 解决私有 Work Integration Pack 与产品主线之间的通用 host contract，但不足以承载多用户云控制面、每用户本地客户端、任意形态能力制品和可视化 Agent 编排。

## 决策

采用四层模型：Cloud Control Plane、Local Client Runtime、Capability SDK/Runtime、Agent Orchestration。能力统一包装为可寻址、可验证、可安装、可授权、可运行、可恢复的 Capability Artifact；Agent 统一包装为不可变、可发布的 Blueprint；所有执行器消费同一 Execution Envelope。

云端只编排声明式计划与脱敏状态，本地客户端持有设备凭证、工作区 grant、原始运行证据和 effect gateway。DSH 是本地保底执行器，不是云端绕过客户端的远程控制通道。私有 Work Integration Pack 仅实现公共 ports。

ADR 0091 的依赖方向、单 owner 和恢复约束继续有效，但其 host contract 将在获批后被 Capability SDK/Runtime 的更通用 contract 吸收。当前不修改 0091 的运行状态。

## 不变量

1. 主线不依赖私有包、BlackLake 或公司工作区即可构建和启动。
2. install、load、authorize、run、write effect 分离。
3. 同一作用域不得出现双 consumer、双 provider、双 scheduler 或双写。
4. 云端不获得用户本机秘密或无限制脚本执行权。
5. 客户端恢复后默认 consumer/effects 关闭。
6. Claude Code、Codex、DSH 的差异由 executor adapter 消化，不污染 Blueprint。

## 当前影响

仅增加 PRD、迁移/覆盖清单、审计和静态 POC。没有运行 composition、网络、凭证、provider、consumer、scheduler、effect、服务或数据变化。

## 后续批准点

公共 SDK、客户端身份与 plan signature、云 API/存储、多租户隔离、执行器发现、第三方制品安装、私有包接入、shadow/cutover 和旧来源删除分别作为独立批次批准。
