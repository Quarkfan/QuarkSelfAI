# Feature plugin template

复制本目录时先替换 `feature-id`，然后同步完成三处声明：

1. 把 `module.fragment.json` 合并到 `config/module-catalog.json`，精确填写 `owns`、`dependsOn`、
   `requiresEffects` 和 `providesEffects`；
2. 把 `cordis.fragment.yml` 合并到 profile，默认保持 disabled，并把占位环境变量换成该功能真实的所有权门禁；
3. 若插件需要作为包子路径加载，在 `package.json#exports` 增加自己的入口。不要把整个 `package.json` 当模板覆盖。

约束：

- 插件入口只负责装配 Service，不在模块顶层启动消费者或定时器；
- 外部协议放 adapter，业务判断放 service/workflow；
- 一个模块只承担一种主要层次；contract、adapter、workflow 复杂时拆成多个 catalog module；
- 只依赖 catalog 中声明的骨架或功能契约；
- 外部写入进入 durable action/approval；
- 长期等待进入 durable workflow，事件源进入 durable inbox；不得新增业务 `sleep` 或私有 JSON 真源；
- `dispose` 后不得残留 timer、listener 或子进程；
- runtime 必须从 `inactive` 开始；真实回放、单 owner 证明和维护窗口完成后才能改为 `shadow/active`；
- 测试至少覆盖装配、幂等、停止、权限边界和 effect 失败恢复。

`npm run architecture:check` 会验证所有 `src/*.ts` 的唯一 owner、真实 import 依赖和 effect provider 唯一性；
`test/feature-plugin-template.test.ts` 会额外阻止模板重新漂移到旧 schema。
