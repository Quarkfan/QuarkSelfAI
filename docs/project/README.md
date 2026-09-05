# QuarkSelfAI 正式立项入口

本目录是 QuarkSelfAI 作为独立个人助手产品的立项真源。它回答五个问题：项目为什么存在、主线边界是什么、
换一台机器需要恢复哪些数据、如何验证恢复成功，以及还需要常东旭提供哪些外部资源。

## 文档地图

1. [项目章程](charter.md)：愿景、范围、成功标准、阶段与治理。
2. [可移植与灾难恢复规范](portability-and-recovery.md)：从 clone 到恢复服务的目标流程和验收门禁。
3. [数据与身份清单](data-and-identity-inventory.md)：可恢复数据、账号、密钥、缓存与当前缺口。
4. [账号恢复与只读验收](account-bootstrap.md)：新终端登录顺序、脱敏审计与接管边界。
5. [BlackLake 工作边界](blacklake-boundary.md)：公司工作信息如何与个人助手主线隔离。
6. [资源申请单](resource-request.md)：实现异机恢复前需要 owner 提供或选择的资源。

机器可读真源是 [`config/recovery-manifest.json`](../../config/recovery-manifest.json)。执行
`npm run audit:recovery` 查看本机清单，执行 `npm run audit:recovery -- --strict` 作为恢复门禁。审计只查看
路径、文件类型和配置是否存在，不读取或输出凭证值。

恢复工具提供四段彼此分离的命令：`npm run backup:recovery` 只生成 age 加密包，`npm run backup:publish` 写入已配置
目标并完成目标回读、密文哈希、解密和 SQLite 校验，`npm run restore:stage` 只解密并核验，
`npm run restore:prepare-safe` 只允许把核验结果放进 revision 一致且没有 `var` 的新 clone。它们都不会覆盖现网状态、
启动消费者或启用任何外部写 effect；完整操作见[可移植与灾难恢复规范](portability-and-recovery.md)。

## 当前结论（2026-09-05）

- GitHub 远端与代码基线可用，代码层可以重新 clone。
- 当前 `main` 已在空目录完成冷 clone、`npm ci`、完整测试和两类恢复审计；空 clone 会如实保持未恢复状态。
- 本机已安装 `age 1.3.2`，公钥进入非秘密配置，私钥运行副本与 iCloud Drive 密文分离；首份真实恢复包已完成
  provider 挂载目录回读、解密和 SQLite 完整性校验。
- Apple“密码”中的私钥副本、另一设备实际下载回读、PostgreSQL 空库恢复和完整接管演练仍未完成，因此“任意终端
  恢复”尚未成立。
- 当前仓库仍包含 BlackLake 专用适配器和文档引用，属于待拆分的历史耦合；在不破坏现网单消费者和审批门禁前，
  先登记、再迁移，不能直接删除。
- 本阶段已完成立项、分类、清单、恢复门禁以及不触碰现网的备份/恢复核心，并完成首个 iCloud Drive provider
  密文回读。云端持久化证明、保留清理和运行切换仍在 Phase 2–4。
