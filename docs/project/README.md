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
7. [能力进化任务](capability-evolution-task.md)：新终端重建周期巡检时使用的去设备化任务正文。
8. [辅助能力连续性](assistant-capability-continuity.md)：协作契约、运行状态、本机输入和工作集成的真源边界。
9. [立项验收总表](foundation-acceptance.md)：统一呈现组织、SQLite 异机恢复、PostgreSQL 和单写者接管的独立门禁。

机器可读真源是 [`config/recovery-manifest.json`](../../config/recovery-manifest.json)。执行
`npm run audit:recovery` 查看本机清单，执行 `npm run audit:recovery -- --strict` 作为恢复门禁。审计只查看
路径、文件类型和配置是否存在，不读取或输出凭证值。

工作域隔离的机器真源是 [`config/work-domain-isolation.json`](../../config/work-domain-isolation.json)。执行
`npm run audit:work-domain-isolation -- --strict` 验证所有已跟踪的雇主专用引用仍与已复核基线一致；它只输出分类、
数量和摘要，不输出业务正文。该审计通过表示“现有耦合已完整登记且没有静默扩张”，不表示迁移已经完成。

能力进化调度蓝图位于 [`config/capability-evolution-automation.json`](../../config/capability-evolution-automation.json)。
`npm run audit:capability-evolution -- --strict` 验证仓库内蓝图、任务摘要、去设备路径和工作域隔离；增加 `--installed`
时只比较本机 Codex 自动化的脱敏字段与 prompt 摘要，不输出任务正文。新终端必须先创建为暂停状态，绑定该终端上的
当前项目并取得 owner 对单一调度切换的批准后再启用。

`npm run audit:assistant-continuity -- --strict` 验证 Codex/Claude 协作入口镜像、核心资料跟踪、持久能力到恢复 artifact
的映射及每类本机输入的处置。报告把尚未完成的私有工作包和个人能力筛选列为 `outstanding`，不会把清单一致误报为
组织完成。

恢复工具提供独立入口及一个安全编排入口：`npm run backup:recovery` 只生成 age 加密包，`npm run backup:publish` 写入已配置
目标并完成目标回读、密文哈希、解密和 SQLite 校验，`npm run backup:cycle` 在发布成功后执行严格血缘保留，
`npm run restore:bootstrap-safe` 在临时 staging 中完成解密、核验和 restore-safe 准备并自动清理明文；`npm run restore:stage` 只解密并核验，
`npm run restore:prepare-safe` 只准备 SQLite 安全实例，`npm run restore:prepare-postgres-safe` 只允许把精确批准的
PostgreSQL bundle 恢复到空库并准备安全实例。它们都不会覆盖现网状态、
启动消费者或启用任何外部写 effect；完整操作见[可移植与灾难恢复规范](portability-and-recovery.md)。

## 当前结论（2026-09-06）

- GitHub 远端与代码基线可用，代码层可以重新 clone。
- 当前 `main` 已在空目录完成冷 clone、`npm ci`、完整测试和恢复审计；最新加密包还通过了单入口解密、SQLite integrity、
  control-only 启动、健康回读与临时明文清理。空 clone 或未批准实例会如实保持未恢复/blocked 状态。
- 本机已安装 `age 1.3.2`，公钥进入非秘密配置，私钥运行副本与 iCloud Drive 密文分离；首份真实恢复包已完成
  provider 挂载目录回读、解密和 SQLite 完整性校验。
- 私钥已由 owner 确认保存到 Apple“密码”并决定继续使用当前身份；每日 03:15 的本机加密备份与保留调度已启用。
  PostgreSQL 空库恢复门禁已实现但尚无真实目标演练；另一设备实际取出私钥并下载恢复包的回读、真实 PostgreSQL 恢复和完整
  接管演练仍未完成，因此“任意终端恢复”尚未成立。
- 当前仓库仍包含 BlackLake 专用适配器和文档引用，属于待拆分的历史耦合；99 个命中路径已由机器清单完整登记、
  分类且严格审计无遗漏。在不破坏现网单消费者和审批门禁前，先迁移到私有 pack，再删除或脱敏主线资产。
- 本阶段已完成立项、分类、清单、恢复门禁、不触碰现网的备份/恢复核心、iCloud Drive provider 密文回读和每日
  保留调度。跨设备云端取回证明、PostgreSQL 恢复和运行切换仍在 Phase 2–4。
