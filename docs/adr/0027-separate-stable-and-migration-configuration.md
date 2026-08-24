# ADR 0027：稳定应用配置与迁移选择器分离

状态：Accepted（2026-08-24）

## 问题

应用 composition 已不再 import compatibility runtime，但通用的 Web、DSH、工作区和 control-plane 配置仍与
`ASSISTANT_RUNTIME=compat`、`COMPAT_CONFIG_PATH`、接管确认及一个飞书 profile 默认值共处
`src/config/runtime.ts`。该文件整体归迁移层所有，意味着删除 compat 时会连稳定进程配置一起删除，骨架并不
真正自足。

## 决策

1. `src/bootstrap/config.ts` 归 application skeleton，只解析 Web、control-plane、local/remote workspace 和
   DSH kernel 的稳定配置；它不认识 channel、数据库实现或 migration selector。
2. 稳定配置只提供通用 `assistant` profile 默认值，并允许外层 composition 注入 profile 默认值。当前迁移
   composition 显式贡献 `feishu-assistant`，保持现网行为而不把飞书写进骨架。
3. `src/storage/config.ts` 归 durable-state provider，独立选择 SQLite 或 PostgreSQL。application skeleton 继续
   只接收已经构造的 `AssistantStore`。
4. `src/config/runtime.ts` 保持 migration ownership，只组合上述两份配置并执行 compat config path、takeover、
   local execution、kernel 和 control-plane 门禁。
5. 控制台和 application composition 的测试只使用 `AssistantApplicationConfig`，不得依赖迁移期
   `RuntimeConfig`。

## 后果

- 删除 compatibility host 时，稳定配置和应用 host 原地保留，只需由新的 product composition 选择 feature。
- 数据库和业务 profile 仍可替换，骨架不会通过环境变量名重新获得具体系统知识。
- 当前进程入口和 compat selector 仍是迁移代码；本 ADR 不切换消费者、不重启进程，也不改变现网状态文件。
