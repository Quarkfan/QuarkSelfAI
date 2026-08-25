# ADR 0053：分离长期产品 profile 与兼容期 overlay

## 状态

Accepted

## 问题

原生产品入口虽然不导入兼容代码，却默认加载 `feishu-assistant`。包内 `cordis.patch.yml` 同时包含长期产品装配和
`ASSISTANT_RUNTIME=compat` 禁用条件，导致长期 feature 在运行时暗中依赖 migration asset；新建 profile 也会自动
继承兼容期语义。

## 决策

1. `cordis.patch.yml` 是 `native-product-profile` feature 的长期 bundle，只保留产品插件配置和逐能力激活门禁。
2. `compat/cordis.compat.patch.yml` 是 `assistant-profile-composition` migration 的 profile-owned overlay，无条件禁用
   所有尚未切换的 native plugin owner，不复制插件配置或激活规则。
3. 通用 profile 安装器只负责 `config/dsh-baseline.json` 版本基线、bundle 列表与指定 patch；兼容和原生入口分别
   贡献 profile 名及 overlay，长期版本真源不得放回 `compat/`。
4. 兼容入口保持 `feishu-assistant` 并使用 `DSH_PROFILE`，原生入口默认 `feishu-assistant-native` 且只接受
   `DSH_NATIVE_PROFILE`。两者使用不同目录，原生入口与安装器都拒绝隐式复用旧 profile。
5. 架构校验要求长期 bundle 不含 migration selector，overlay 精确等于所有 inactive feature plugin，且产品 manifest
   显式包含 `native-product-profile`。

## 结果

当前运行进程无需重启或改写 profile。维护窗口切换时先初始化原生 profile，再停止兼容 owner 并启动原生入口；
验证完成后直接删除兼容 overlay 和安装入口，不再需要把一个混合模块“转正”。
