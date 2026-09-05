# Capability Platform Phase 0 完成性审计

审计日期：2026-09-06

审计基线：`c746e70c1fdbf54a3617816e5ad887e8e679ebe2`

结论：机器与静态设计门禁可闭合；真实视觉门禁未闭合，因此 Phase 1A 仍未获放行。

## 需求到证据

| 目标要求 | 权威证据 | 当前判断 |
| --- | --- | --- |
| 多用户云控制、本地客户端执行 | PRD 第 1–6 节、ADR 0092 | 设计已定义，尚未实现 |
| 广义 Capability Artifact | PRD 4.1、覆盖项 CAP-01–07 | identity、来源、生命周期、接口、放置、权限、供应链、恢复均已进入设计 |
| Agent Blueprint 与可视化编排 | PRD 4.2、覆盖项 AGT-01–06、POC Agent Studio | 设计和静态交互已覆盖，尚未实现编译器 |
| Claude Code/Codex/DSH 统一执行 | PRD 4.3/9、覆盖项 EXE-01–03 | discovery、routing、context parity 已进入控制面设计 |
| Cloud Control Plane | PRD 5–7、CMD/CAP/AGT/RUN/TEN/GOV 覆盖项 | 设计覆盖，尚无云服务 |
| Local Client Runtime | PRD 5–6、DEV/EXE/DAT/REC 覆盖项 | 设计覆盖，尚无客户端实现 |
| 安装/加载/授权/运行/写入分离 | PRD 2/4/10、CAP-02/CAP-07/APR-02 | 明确且 POC 可见 |
| 多租户强隔离 | PRD 10–11、TEN-01–03 | 身份、存储、队列、缓存、密钥和策略已进入控制面 |
| 本地敏感数据不上传 | PRD 3/10、DAT-01–03 | 本地证据、secret reference、分类与 retention 已进入设计 |
| 第三方供应链治理 | PRD 10、CAP-04/CAP-06 | revision/digest/license/SBOM/风险/候选决策已覆盖 |
| 单 consumer/provider/scheduler/writer | PRD 2/10、OBS-02 | fail-closed、lease、handoff/rehearsal 已进入设计 |
| 现有能力无遗漏迁移 | `config/capability-platform-migration.json` | 当前 module catalog 99/99 exactly-once |
| 私有工作包不成为核心依赖 | ADR 0092、INT-01、既有私有包审计 | 当前仍 inactive；目标依赖方向明确 |
| 控制台控制/监测/管理完整 | `config/capability-platform-console-coverage.json` | 50/50 需求均有 control/monitor/manage 和唯一 POC anchor |
| 工具、包、浏览器、私有集成、交互应用 | CAP/INT/EXP 覆盖项和 POC | 五类及其统一治理已进入设计 |
| 测试、replay、shadow、发布、回滚 | TST-01、AGT-04、REC-01–03 | 独立状态与控制面已覆盖 |
| 保护用户未提交改动 | Git status 与提交白名单 | `package.json`、品牌 client 和 `.DS_Store` 未进入提交 |

## 控制台覆盖口径

覆盖率以目标需求为分母，而不是以已有页面为分母。50 项要求跨 15 个业务域；每项必须有非空 `control`、`monitor`、
`manage`、目标 screen 和唯一 `data-coverage` POC anchor。`scripts/audit-capability-platform-design.ts` 同时验证当前 99 个模块
exactly-once、危险运行开关为 false、PRD 核心抽象和 POC 可见计数。

50/50 只证明需求到静态控制面的设计闭合，不证明云 API、客户端、数据隔离或运行链路已经实现。

## 未闭合证据

当前 Codex 应用内浏览器安全策略拒绝本地 `file://` POC，并禁止通过其他浏览器或临时 HTTP 服务规避。因此未取得：

- 桌面宽度下的真实渲染截图与交互回读；
- 窄屏导航、表格、弹窗和固定覆盖徽标的真实渲染证据；
- 键盘焦点顺序、reduced-motion、forced-colors 的浏览器级复核。

在 owner 本机打开 `docs/prototypes/capability-platform-console/index.html` 并确认方向前，Phase 0 状态保持
`machine-complete / visual-awaiting-owner`，不得称控制台 POC 已完全验收。

## Phase 1A 放行条件

1. owner 明确确认 POC 信息架构、关键流程和视觉方向；
2. owner 按 `config/capability-platform-phase-1a-proposal.json` 精确批准公共 contract/SDK 边界；
3. 开始时重新核验 HEAD、用户未提交改动和提案文件范围；
4. 任一范围扩大或需要修改受保护 `package.json` 时重新批准。
