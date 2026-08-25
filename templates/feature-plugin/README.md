# Feature plugin template

复制本目录时先替换 `feature-id`，然后同步完成三处物理声明：

1. 把 `module.fragment.json` 合并到 `config/module-catalog.json`，精确填写 `owns`、已提交运行文件对应的 `assets`、源码 import 对应的
   `dependsOn`、注入/宿主关系对应的 `runtimeDependsOn`、operations composition 选择关系对应的 `mounts`、
   `requiresEffects`、`providesEffects` 和 `plugin` 绑定；
2. 把 `cordis.fragment.yml` 合并到 profile，默认保持 disabled，并把占位环境变量换成该功能真实的所有权门禁；
3. 若插件需要作为包子路径加载，在 `package.json#exports` 增加自己的入口。不要把整个 `package.json` 当模板覆盖。

仓库内 feature 直接依赖 `workflow/contracts`、`events/contracts`、`execution/ledger-contract` 等窄 port；仓库外插件可从
`@quarkfan/quark-self-ai/platform` 获得同一组稳定类型。禁止为了调用 `register`/`enqueue` 而 import runtime Service
实现类；具体 provider 只进入 `runtimeDependsOn` 和 Cordis profile。

模板故意从 `implementation=planned,runtime=inactive` 开始：建好契约和主体代码后改为 `partial`；只有装配、幂等、
停止、权限、失败恢复和真实依赖证据齐全时才能改为 `ready`。创建目录或写出占位入口不等于实现完成。

约束：

- 插件入口只负责装配 Service，不在模块顶层启动消费者或定时器；
- 外部协议放 adapter，业务判断放 service/workflow；
- 一个模块只承担一种主要层次；contract、adapter、workflow 复杂时拆成多个 catalog module。layer 选择遵循：
  - `contract`：稳定数据/effect/port，只依赖 contract；
  - `kernel`：通用生命周期、队列或状态机，只依赖 contract/kernel；
  - `policy`：可解释规则与授权，只依赖 contract/policy；
  - `provider`：可替换能力实现；`adapter`：外部协议转换；
  - `workflow`：业务流程；`projection`：外部读模型；`surface`：人机/API 界面；
  - `operations`：部署、迁移与审计，不承载长期业务判断；
- 每个模块自己拥有窄配置；不得新增聚合 Web、存储、通道和执行器的全局 application config；
- catalog 及 descriptor 不接受未登记字段或未规范化、逃逸项目目录的 `source`；仅 compat feature 可声明 `hostedBy`，仅
  migration 可声明 `exitCriteria`；
- 只依赖 catalog 中声明的骨架或功能契约；
- 开放式自然语言执行、本地文件修改或任意 executor 写操作进入 durable action/approval；已建模的业务流程通过
  durable workflow effect/outbox 写外部系统，高影响 effect 仍必须消费精确 owner approval 与授权证据；
- 长期等待进入 durable workflow，事件源进入 durable inbox；不得新增业务 `sleep` 或私有 JSON 真源；
- 不得新增业务 `setInterval`；长生命周期 callback 必须在注册前捕获已声明的 injected port，禁止延迟
  `this.ctx.<service>`；
- `dispose` 后不得残留 timer、listener 或子进程；
- runtime 必须从 `inactive` 开始；真实回放、单 owner 证明和维护窗口完成后才能改为 `shadow/active`；
- `inactive` 插件必须在长期 profile 中使用独立 `QUARK_NATIVE_*` 激活门禁；兼容期 profile overlay 还会无条件
  禁用所有尚未切换的 native owner。切到 `shadow/active` 时必须同步更新模块目录、激活门禁和 overlay；
- 测试至少覆盖装配、幂等、停止、权限边界和 effect 失败恢复。

`npm run architecture:check` 会验证所有 `src/*.ts` 的唯一 owner、已跟踪运行资产的唯一 owner、真实 import 与
`dependsOn` 双向一致、layer 方向、
DSH/Cordis import 对应 `runtimeDependsOn`、effect provider 唯一性，
并双向核对 `plugin.profileId`、`package.json#exports` 与 Cordis profile；漏挂、错挂或无主本地插件都会失败；
未知字段和非法 migration/compat 组合也会失败关闭；
`test/feature-plugin-template.test.ts` 会额外阻止模板重新漂移到旧 schema。
