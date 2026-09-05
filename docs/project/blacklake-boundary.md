# BlackLake 工作边界与外部参考治理

## 决策

QuarkSelfAI 是常东旭个人拥有的通用助手产品。黑湖科技相关的消息、客户、租户、人员、Jira、GitLab、数据库、
业务 Skill 和内部代码只是当前工作的一个可卸载领域，不是产品身份、主线数据模型或恢复前置条件。

## 主线禁止项

主线不得新增：

- 公司内部地址、凭证、租户/客户/工厂数据、人员映射和真实消息正文；
- 对 `/Users/edy/BlackLakeWork`、内部 Jira/GitLab/Lakers 或三个参考项目的硬编码启动依赖；
- 以 BlackLake 业务名命名的核心 contract、kernel、storage 或通用 workflow；
- “外部参考项目永远存在”的设计假设。

## 允许形态

BlackLake 能力应迁移为独立、私有、可卸载的 work integration pack：

- 通过稳定的消息、任务、日历、知识、数据库只读和审批 ports 接入；
- 在 pack 自身保存公司专用路由、Skill、schema、提示和权限要求；
- 未安装、未授权或离线时只产生明确 capability unavailable，不影响核心启动；
- pack 的数据使用独立 namespace、保留策略和备份选择，默认不进入通用恢复包。

## 当前耦合与处置

当前仓库仍跟踪 `src/blacklake/*`、BlackLake compatibility context、相关测试、package export、module catalog mount、
需求矩阵和操作文档引用。它们已经参与现网路由，直接删除会破坏已有运行链路和 DSH profile，因此本阶段标记为
“待迁移耦合”，不伪装成已经隔离。

机器盘点由 `config/work-domain-isolation.json` 与 `npm run audit:work-domain-isolation -- --strict` 负责。基线不保存
命中的业务正文，只保存受控 marker、路径数量、路径摘要、命中行摘要和处置类别。当前 99 个已跟踪文本路径被完整
分成五类：36 个治理/历史文档、39 个运行集成、2 个集成合同、6 个迁移运维入口和 16 个回归证据；未分类为 0。
任何路径增删或既有命中行变化都会关闭严格门禁，必须先复核并更新盘点，防止新耦合悄悄进入主线。

这 99 个路径不是 99 个独立业务能力，也不表示全部都要复制到私有 pack：运行适配器和运维入口迁往 pack；协议先
去业务化；测试与历史材料在等价回放及保留期后脱敏或移除。`AGENTS.md`、ADR 0090 和本文件在迁移期间保留为治理
证据，最终只留下通用的 work-domain 隔离规则。

后续迁移顺序：

1. 建立通用 `work-domain` port 与独立 pack 版本/安装协议。
2. 复制现有 BlackLake 适配实现到私有 pack，去除核心反向依赖。
3. 用脱敏合约回放验证 pack 与当前行为等价。
4. 在维护窗口切换单一 provider，确认主线无 BlackLake 路径也可 build/start/recover。
5. 经过保留期后再删除主线旧适配器和历史兼容入口。

阶段 2 的精确设计见 `docs/project/work-integration-host-contract.md` 与 ADR 0091。这里的“消息、任务、日历、知识、只读数据与
审批 ports”不表示新建六套基础设施：消息消费、durable workflow/effect、审批、executor 和 workspace policy 仍由核心
唯一拥有；pack 只通过通用 contract 注册被动实现。设备 overlay、安装与激活必须分离，基础 profile 不得命名私有 pack。
当前机器提案仍是 `awaiting-owner-approval`，所有激活位为 false。

该迁移会改变当前 DSH/Cordis composition 和运行依赖，必须作为独立架构变更取得精确批准，不能在数据整理阶段暗中完成。

## DevOps 设计参考

能力进化可以周期性只读参考 BlackLake DevOps 项目或其他外部开源/内部资料，但采用必须满足：

1. 记录来源 revision、原始许可证/内部授权、采纳动机和替代方案。
2. 将必要设计说明、接口、测试或实现复制到 QuarkSelfAI/独立 pack；运行时不得继续读取参考项目。
3. 去除公司名称、内部路径、凭证、客户数据和不必要的业务术语。
4. 验证本地与服务器形态、DSH/Cordis 边界、单写者、审批和回滚。
5. 后续更新是新的显式采纳，不通过动态链接或定时同步悄悄改变生产行为。

周期性“参考”只产生候选；安装依赖、激活插件、扩大权限或改变核心边界仍执行既有批准门禁。
