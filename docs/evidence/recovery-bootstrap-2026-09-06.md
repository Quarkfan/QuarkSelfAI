# Restore-safe 单入口真实演练（2026-09-06）

## 范围

本演练验证同一台 macOS 上从 GitHub 冷 clone、iCloud filesystem provider 加密对象和独立 age identity 恢复
QuarkSelfAI 的 control-only 形态。它不验证另一设备的云端同步、密码库取回或正式单写者切换。

## 固定输入

- Git revision：`2eba32bf5ac62116bdfcb52955f43d793f05c1e0`
- Bundle ID：`212d253a27b5c8b3e66ff88defae5dd2eb41e36481709a7a4667505f4ef6618e`
- Capture mode：`online-bounded`
- 加密对象大小：3,146,798 bytes
- 加密对象 SHA-256：`345c48a7ce690d8d4a0594ea0ce22c4876059d4f4ba175810aeaffba5cbf44e9`

凭证、identity 内容、控制令牌、账号标识和恢复数据正文均未进入本记录。

## 结果

1. 从 GitHub 远端 clone，HEAD 与 bundle revision 一致，`npm ci` 无漏洞报告，`npm run build` 通过。
2. `restore:bootstrap-safe` 完成 provider 对象读取、age 解密、manifest/hash 校验、SQLite integrity 和 fresh-clone 准备。
3. 生成状态为 `ASSISTANT_RUNTIME=control-only`、`ASSISTANT_KERNEL=off`、`TAKEOVER_CONFIRMED=false`、
   `WORK_JOURNAL_ENABLED=false`、`WEB_HOST=127.0.0.1`；SQLite `PRAGMA integrity_check` 返回 `ok`，两个控制令牌均为
   新生成且未输出。
4. 实际启动后 `/api/health` 返回 `ok=true`、`storage=sqlite`、`operationalMode=control-only`、worker stopped、kernel
   stopped。readiness 保持 blocked，因为 provider、consumer 和外部 effects 均未激活，这是 restore-safe 的预期结果。
5. 进程收到 SIGINT 后停止；工具自有 staging 残留为 0，本次临时 clone 已删除。

## 仍未证明

- 另一设备从 Apple“密码”取得 identity 并从 iCloud 下载同一对象；
- PostgreSQL 真实空库的 dump/restore；
- 旧实例停止后的唯一消费者接管与逐项外部 effect 验证。
