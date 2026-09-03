# ADR 0089：多源事实驱动的每日工作账本

- 状态：Accepted
- 日期：2026-09-03

## 背景

常东旭需要助手持续记录每天实际完成和推进的工作，并能在任意时间按日报、周报、月报、季度、年度或自定义日期范围形成总结。飞书只是信息源之一；Jira、GitLab、本地 Git、日历、滴答和 Codex/Claude Code/DSH 执行记录都可能提供更可靠的交付证据。

把消息流水直接保存成日报会混淆“收到信息”和“完成工作”，产生重复、隐私扩散和不可复核结论。把新功能塞进 `bridge-compat` 又会扩大迁移层，使其无法按计划退出。

## 决策

1. 新增原生 `work-journal` feature。它通过共享 durable wake scheduler 在次日北京时间 05:00 后为前一自然日闭账，不新建独立轮询内核。
2. 每日记录使用 `assistant_signal` 的稳定 ID `work-journal:daily:<date>` 保存，SQLite 与 PostgreSQL 共用现有存储契约；同一日期不可被静默改写。
3. 工作账本只保存事项级事实：完成或推进、决定、交付、协作、阻塞、下一步、来源状态和可复核引用。完整消息、凭证、无关人员隐私和不必要的内部技术标识不进入账本。
4. Claude Code 负责首轮只读取证与编译；仅在基础设施失败时由 Codex 只读兜底。来源失败形成 `partial/unavailable` 缺口，不阻断其他来源闭账。Jira/GitLab 不依赖模型自行发现登录态：原生只读适配器复用 `ai/devops-virtual-employee` 的现有 session，只向固定 BlackLake 主机发送 Cookie，并只把有界 issue/event/MR 摘要交给编译器。
5. 现网仍由 compatibility provider 持有部分飞书和滴答事实时，迁移 composition 注入一个只读 evidence provider；工作账本的调度、幂等和持久化仍由原生 feature 拥有。迁移层退出时替换 evidence provider，不迁移账本真源。
6. 总控通过只读 `quark_work_journal_query` 查询任意日期范围。当天、启用前历史、缺失日期或来源不完整的日期由当前会话按相同来源边界做有界补齐并说明覆盖率，不伪造成已经闭账。
7. 控制台只读展示最近 31 条日记录和闭账故障，不提供修改历史或绕过来源权限的入口。

## 边界

- Jira、GitLab、飞书、日历和滴答只读取证不产生业务写入；BlackLake 来源必须先经过参考项目路由与新鲜度门禁。
- 生成总结本身不创建任务、不发送外部消息、不启动调研，也不形成生产、发布或配置授权。
- 工作账本是总结证据，不是绩效认定或人员评价真源。

## 回滚

设置 `WORK_JOURNAL_ENABLED=false` 并重启同一守护进程即可停止新闭账；已有不可变日记录继续可读。删除 surface 不影响账本和总控查询，替换 evidence provider 不改变日期键或存储结构。
