# ADR 0029：DSH 内核与产品 Profile 分离归类

状态：Accepted（2026-08-24）

## 问题

模块目录曾把 `dsh-runtime` 这个 skeleton 的 source 指向 `cordis.patch.yml`。但该文件实际选择并配置飞书、
滴答、BlackLake、Claude/Codex、全部 native workflow，以及 `ASSISTANT_RUNTIME=compat` 的迁移期禁用条件。
这等于把整套产品装配伪装成内核，绕过了 skeleton 不能包含业务身份的边界。

## 决策

1. `dsh-runtime` 只代表真实 DSH package 与 Cordis 生命周期，source 指向安装的 DSH package metadata。
2. `cordis.patch.yml` 由独立 `assistant-profile-composition` 模块拥有。它负责选择具体插件，是产品装配而非内核。
3. 当前 profile 仍含 compat 条件，因此该模块归 migration 并有明确退出条件；条件移除后，架构检查要求它改为
   feature，而不是继续留在迁移层。
4. Profile composition 通过 `runtimeDependsOn` 声明 DSH runtime 和每个已绑定的本地插件模块。架构检查从
   profile、package exports 和 module catalog 三方反向核验，漏挂或漏声明都会失败。
5. Claude Code 与 Codex provider 指向各自 package，不再以业务 profile 作为自身 source；router 与 provider
   的选择关系由 profile composition 拥有，骨架 router 不反向依赖任何具体 provider。

## 后果

- DSH skeleton 可以独立存在，不再因产品新增一个插件而改变身份。
- 未来可以有本地个人助手、服务器或其他 channel 的不同 product profile，共用同一骨架。
- 当前 profile 仍是迁移资产；只有完成 native 所有权切换并去掉 compat guards 后，才算长期“骨架上的肉”。
