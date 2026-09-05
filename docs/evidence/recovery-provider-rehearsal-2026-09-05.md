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

- 2026-09-06 owner 已确认私钥手工保存到 Apple“密码”；助手未读取密码库内容，另一设备可读性尚未验证。
- 尚未从另一设备下载 iCloud 对象并完成同一回读校验。
- 2026-09-06 再次运行真实 `backup:cycle`：bundle ID
  `8f8df3f64f4eeb51722edaf4dd1a1efb24e792753e63fd2625a1429ab2e44395`，密文 3145902 bytes，SHA-256
  `c5b26834ecf7ae901ed63e9779b2435886d477cbce3090ba2ce973e02b8b4c22`；目标回读、真实解密与 SQLite integrity
  均通过。保留执行识别 2 份严格血缘对象，保留最新 1 份、删除同日旧对象 1 份、忽略 0 份。
- 已注册独立低优先级 LaunchAgent `com.quarkfan.quark-self-ai.recovery`，每日本地时间 03:15 运行 `backup:cycle`；
  plist 通过 `plutil`，权限为 `0600`，不含 `RunAtLoad`/`KeepAlive`、飞书消费者或秘密。注册后尚未到首次日历触发，
  `runs=0`；手工执行的同一代码路径已通过上述真实演练。
- 私钥检查只输出布尔结果：本机 `0600` 身份推导出的 recipient 与仓库公钥一致。仓库工作树、全部 Git revision、
  QuarkSelfAI `var` 日志及本机应用运行目录（排除预期私钥文件和 `.age` 密文）均未检出 age 私钥标记文本。
  owner 明确决定不轮换并继续使用当前身份；这不替代另一设备从 Apple“密码”取出并解密的验收。
- PostgreSQL 空库恢复与最终单写者接管未演练。
