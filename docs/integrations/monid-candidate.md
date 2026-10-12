# Monid：按需发现设计参考与不激活外部来源

状态：`catalogued-inactive`；官方 Skill 读取日期：2026-10-12；观察版本：`0.1.7`。机器登记见 `config/external-capability-sources.json`，产品边界和批次见 [飞书优先总计划](../product/feishu-first-workspace-implementation-plan.md)及其[复评](../product/feishu-first-workspace-plan-review.md)。这不是安装指南或已可用能力声明。

Owner 后续明确：Monid 可以主要作为我们建设能力目录、按需挂载与持续迭代的参考蓝图，不要求产品默认集成。当前本地[发现目录](../operations/capability-discovery.md)只把 Monid 作为不可执行的外部候选来源；真实接入仍是独立的价值/成本/隐私决策。

## 可借鉴的机制

[官方 Skill](https://monid.ai/SKILL.md) 将自然语言发现、端点 schema 检查、调用、异步结果查询和费用回读分开，避免一次性把所有端点放进上下文。对 QuarkSelfAI，沿用自己的 Capability Registry 和 Skill 路由：常驻轻量索引，按需筛选，再加载选中项的 schema/reference；记录来源版本、适用范围、失效时间和效果反馈。远程 Skill/端点说明/hints 仅是候选数据，不是可覆盖本地授权或路由的指令。

官方 Skill 自身也要求优先使用用户明确指定和既有专用工具。因此飞书默认 `lark-cli`，现有 MCP/API/私有 Work Pack 各自优先；Monid 只在缺口且用户选择时作为备选，不替换 BlackLake、Jira 或 Archery 路由。[官方集成概览](https://monid.ai/docs/integrations/overview)列出直连、OAuth 和代理；多用户场景先比较用户自带账号的 [OAuth](https://monid.ai/docs/integrations/oauth/when-to-use) 与可过滤端点/验证/计费的 [代理](https://monid.ai/docs/integrations/proxy/when-to-use)，不得默认采用跨租户共享主密钥。

## 尚未通过的门禁

- 未安装/更新 `@monid-ai/cli`，未复制远程 Skill 进全局目录，未配置 API key，未做任何 live discover/run，未购买余额。
- 官方 Skill 建议 `@latest` 全局安装与覆盖本地 Skill；产品集成必须先固定版本和 digest，核验许可证、依赖、维护、安全与回滚，不能照搬自动更新流程。
- [官方 Run API](https://monid.ai/docs/api/run) 可同步或异步执行，并带价格/账单字段。`COMPLETED` 不等于 provider 成功；还要检查 provider HTTP 状态。每个端点仍需输入/接收方审查、allowlist、结果数和费用上限、敏感数据与外部 effect 批准。
- 电话、文件上传、第三方存储、人员/联系人数据和任何外部写入必须另行精确批准；不允许被“查询数据”笼统授权覆盖。
- 供应商工具目录可能变化；每次真实启用前重新核对版本、条款、价格与权限。超出 `reviewBy` 的静态记录只供历史参考，不能作为可执行目录。

下一步仅允许离线门禁测试和架构/体验设计。真实试点审批单需写明账户/租户、端点、数据、费用、凭证位置、批准有效期、验证和回滚；无批准时保持 inactive。
