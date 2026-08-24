# ADR 0022：应用骨架采用开放组件组合，compat 只是迁移贡献项

状态：accepted

## 背景

原 `src/bootstrap/application.ts` 同时创建存储、DSH 内核、控制台和 `CompatRuntime`，还直接读取 takeover
parity。文件名和模块职责声称它是 application skeleton，依赖方向却是骨架主动认识迁移宿主。新增 native
consumer、远端 worker 或其他 harness 时都必须继续修改这个入口，compat 也无法在退出时整块拔除。

控制台还通过 `runtime.mode === 'compat'` 判断健康与展示状态，使通用 surface 枚举具体 provider。

## 决策

1. `application-composition` 只装配稳定基础设施：durable store、受监管 DSH kernel、控制台和生命周期 host。
2. 功能或迁移宿主通过 `AssistantApplicationExtensions` 提供运行状态、readiness 和 `ManagedComponent[]`；骨架
   不导入、实例化或分支判断它们。
3. 当前 `compat-composition` 是唯一允许导入 `CompatRuntime` 的迁移 composition root。进程入口调用它，但
   核心 application composition 与 native feature 均不知道 compat 的存在。
4. `RuntimeSnapshot.mode` 是开放 provider id。是否参与健康判定和面向用户的 operational mode 也由 provider
   声明，控制台不再枚举 `compat`、native 或未来 runtime 名称。
5. module catalog 和 architecture check 强制上述依赖方向；compat 被移除时只删除迁移 composition 和组件，
   不修改应用骨架。

## 结果

原生 application composition 已建立，但当前进程入口仍使用迁移 composition 来承载已接管的 compatibility
consumer。这是运行所有权事实，不再是架构耦合。待各 native workflow 完成影子验证后，可以用新的 native
composition 替换 `src/app.ts` 的单一 selector，再整体删除 compat contribution。
