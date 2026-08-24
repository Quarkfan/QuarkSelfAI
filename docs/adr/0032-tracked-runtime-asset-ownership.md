# ADR-0032：已跟踪运行资产必须具有唯一模块所有权

状态：Accepted（2026-08-24）

## 问题

源码已经按模块逐文件归属，但 SQL migration、Web 静态资源、部署入口、Cordis profile、兼容 schema 和插件模板
同样会改变运行行为。它们此前只依赖目录习惯：新增一个 SQL、页面脚本或容器入口不需要回答属于 skeleton、feature
还是 migration，也不会触发架构门禁。

## 决策

1. 模块目录增加 `assets`，表示模块负责维护的精确非源码运行资产；同一资产只能有一个 owner。
2. `architecture:check` 通过 `git ls-files` 枚举约定范围内的已提交资产，拒绝未归属、重复归属、已删除或未跟踪却
   被目录声明的路径。未提交的个人工作区文件不参与门禁，避免架构检查接管在途修改。
3. 当前纳管范围包括 `config`、`compat`、`migrations`、`web`、`deploy`、feature template、compat schema，以及
   根目录的 Cordis、容器、Compose 和环境示例文件。
4. 资产所有权表示维护责任，不等于源码 import。原生 TypeScript 的 `dependsOn` 仍由真实 import 双向校验；跨模块
   读取配置若形成稳定接口，应通过显式 contract 或 runtime dependency 表达，不能复制资产。
5. 原 `local-launchd-deployment` 更名为 `deployment-packaging`：同一 feature 同时维护本地 LaunchAgent、服务器
   systemd、容器与 Compose 入口，避免把服务器部署错误归入仅限 macOS 的概念。

## 后果

未来新增页面、数据库 migration、部署文件或 schema 时必须先选择模块；删除 migration 模块时，其兼容 profile、
基线和 schema 会作为同一退出清单被机器发现。README、ADR、测试和仓库构建元数据仍按各自机制维护，不冒充运行资产。
