# 飞书优先工作空间首用与安全验收

状态：实施中；本手册区分当前可做的只读准备与尚未完成的新用户完整验收。总计划见 [飞书优先实施计划](../product/feishu-first-workspace-implementation-plan.md)，最终完成度以 `config/capability-platform-completion.json` 的审计为准。

## 适用人群与边界

适用于以飞书为工作中心的开发人员和产品人员。`lark-cli` 是默认飞书接入层，不是可随意替换的浏览器模拟。Web Agent Studio 是附加控制面。滴答清单不要求安装；当前常东旭实例里的滴答投影仍是既有运行链的一部分，不能因新用户安装流程而停用或迁移。

首用分成五个彼此独立的状态：客户端已安装、飞书身份已配置、所需 scope 已授权、唯一消费者已获接管权、外部写 effect 已授权。前一状态不蕴含后一状态。未到第五步时，UI 应明确显示只读、inactive 或缺失能力，不得声称已接管工作。

## 当前可执行的只读预检

在用户设备上、已安装 `lark-cli` 的前提下，先查 CLI 版本与帮助，再只读核对身份：

```bash
lark-cli --version
lark-cli auth status --json --verify
lark-cli whoami
```

不要在公开日志中回显 token、app secret、device code 或完整上游错误正文。脚本解析 JSON 时以 `ok === true` 或进程退出码 0 判断成功，不以旧式 `code === 0` 判断。访问用户自己的飞书资源要显式选择 `--as user`；bot 只代表应用，不能因为 bot 查询用户日历返回空成功就判定用户没有日程。身份、scope、`console_url` 与授权补救应按当前 `lark-shared` 契约复核。

如果 user scope 缺失，只提出最小 scope 授权方案，不自动执行登录；bot scope 缺失应请用户在开发者后台处理，不把 `auth login` 当成 bot 授权。授权 URL 出现时按 CLI 规则同时展示二维码，完成后重新只读回查。首次配置应用和凭证属于独立受控步骤，不在本手册中假设已完成。

## 新用户无滴答验收（待实现）

准备一个全新隔离的测试用户和设备，不安装或配置 Dida。验收必须同时证明：

1. QuarkSelfAI Cloud 和 Client 可安装、恢复并处于 effects-off；tenant/user/device 精确隔离。
2. `lark-cli` user/bot 身份、所需 scope 与飞书只读消息/日历能力有真实回读；缺权限有明确降级而非空成功。
3. 开发者或产品人员 starter 能在本地找到对应任务入口和知识真源；工作区文件不会上传云端。
4. 内部 matter/action 可记录和交接任务；没有 `DIDA_*` 配置也不会阻断飞书核心或客户端启动。
5. 飞书事件只有一个 owner；卡片、消息发送和任何外部写入保持关闭，直到精确审批与写后核验另行放行。

当前 `config/product-composition.json` 仍将 Dida 投影列为 required，且要求 Dida 配置。`dida-optional-new-user` 完成度门禁故意保持 incomplete；本节是待完成验收，不是已通过的安装指南。

原生 profile 现在不再为 `QUARK_OWNER_WORKSPACE` 回退到维护者的个人目录；新用户必须明确配置和授权自己的工作区。但消息摄取的 task 分支仍需要投影授权与 Dida 提供的 effect。即使某些只读路径能运行，也不能据此声称无 Dida 的任务闭环已完成；下一批先建设内部 matter/action 投影及隔离回放，再修改产品组合。

Client 已有[本地 Matter 存储原语](internal-matter-projection.md)，但尚未接入消息摄取的 effect handler，也没有跨设备单写证明；因此本节的真实无 Dida 验收仍未通过。

## 开发/产品工作区的使用边界

开发人员从 Issue/规格、代码仓、测试和当前运行证据建立链路；产品人员从用户问题、研究样本、决策与结果指标建立链路。两种角色共享同一个授权、来源、新鲜度、交接和经验晋级体系，不复制两套运行时。现有 `agent-workspace-kit` 仅为 inactive starter 候选；在整合进 QuarkSelfAI Client/Capability 生命周期前，不把它当作正式安装器。

## 完成前不要做的事

- 不为了演示去创建测试飞书消息、任务或真实日程。
- 不从本手册自动配置凭证、注册消费者、激活 effects 或重启现网服务。
- 不把当前个人实例的 Dida 数据迁移、删除或当成新用户默认资源。
- 不把 Cloud effects-off、客户端 inactive 安装、静态 UI 或单元测试各自单独当成“开箱即用”证明。
