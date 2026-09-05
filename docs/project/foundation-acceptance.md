# 立项验收总表

`config/foundation-acceptance.json` 与 `npm run audit:foundation` 把分散的代码、数据、账号、能力进化和工作隔离证据汇总为
四个互不替代的阶段：

1. `information-organization`：代码与恢复清单、协作真源、能力进化蓝图、私有工作远端和实际工作集成隔离。
2. `portable-sqlite-recovery`：真实 cold clone、当前终端账号只读检查和另一设备恢复演练。
3. `postgres-compatibility`：可丢弃空库上的真实 PostgreSQL dump/restore。
4. `single-writer-takeover`：旧实例停止、唯一消费者启动和外部 effect 逐项验证。

默认审计不会联网，账号门禁显示 `unverified`：

```bash
npm run audit:foundation
```

取得联网只读条件后可以增加账号验证：

```bash
npm run audit:foundation -- --online
```

`--strict` 只在四个阶段全部通过时退出 0，因此当前阶段预期失败；它用于最终验收，不用于把已知资源缺口伪装成构建故障。
报告只输出 gate、固定原因码和证据是否存在，不输出凭证、账号标识、业务正文或本机绝对路径。
