# 2026-09-05 加密恢复目标演练

## 范围与边界

- 安装并验证 Homebrew `age 1.3.2`。
- 生成独立 age/X25519 身份；Git 只记录公钥，私钥运行副本权限为 `0600`，且不位于 iCloud Drive。
- iCloud Drive 专用目录只保存 `.age` 密文与脱敏 receipt。
- 未停止或重启 QuarkSelfAI，未启动第二消费者，未修改 live 数据，未执行外部业务写入。

## 首次真实结果

- capture mode：`online-bounded`。
- bundle ID：`feb841d11001671e7210dd7437321af977d9945acb4cfb1d058a1cc9dc6cc8f2`。
- encrypted SHA-256：`8384a4caabae7effd09ecf6aa55477aa916149013218eec89f89d2532ae5cda4`。
- encrypted bytes：`3145726`。
- 写入目标后重新复制回受限临时目录，密文字节数和 SHA-256 一致；真实 age 私钥解密成功，bundle ID 一致，
  SQLite `PRAGMA integrity_check` 通过；临时明文随后清理。
- receipt 明确标记 `remotePersistence=not-proven-by-local-provider-readback`。本演练不把 File Provider 本地挂载回读
  冒充成 Apple 云端持久化或跨设备恢复证明。

## 演练发现并修复的问题

1. WAL journal mode 的一致性快照用 CLI `-readonly` 重新打开时可能因为无法创建 sidecar 而失败；改为 SQLite
   `immutable=1` URI 做只读 integrity 检查。
2. DSH profile 中存在可重建的 `node_modules` 和指向开发 checkout 的符号链接；恢复归档明确排除整个
   `node_modules`，避免携带供应链缓存和当前机器绝对路径。
3. CLI 创建恢复包现在从 `var/runtime.env` 读取恢复所需的受限 selector，避免交互 shell 缺少
   `COMPAT_CONFIG_PATH` 时漏掉兼容状态。

## 尚未通过的门禁

- 私钥尚未由 owner 手工保存到 Apple“密码”并在另一设备确认可读。
- 尚未从另一设备下载 iCloud 对象并完成同一回读校验。
- 14 日 + 8 周保留算法已通过测试，并对真实目录完成 dry-run：1 份有效、1 份保留、0 份删除、0 份忽略；周期调度
  尚未启用。PostgreSQL 空库恢复与最终单写者接管未演练。
