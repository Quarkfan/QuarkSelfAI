# Feature plugin template

复制本目录时先替换 `feature-id`，并在 `config/module-catalog.json` 登记模块。

约束：

- 插件入口只负责装配 Service，不在模块顶层启动消费者或定时器；
- 外部协议放 adapter，业务判断放 service/workflow；
- 只依赖 catalog 中声明的骨架或功能契约；
- 外部写入进入 durable action/approval；
- `dispose` 后不得残留 timer、listener 或子进程；
- 测试至少覆盖装配、幂等、停止和权限边界。
