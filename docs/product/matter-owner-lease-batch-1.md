# 跨设备 Matter owner：第一批持久 fenced lease 计划

状态：未挂载原语与离线验证完成；2026-10-12。依据 ADR 0186 的多设备修订。本批不依赖飞书订阅选择，不改变 DSH/Cordis 或现有个人实例。

## 目标与不变量

在 Cloud Control Plane 增加**未挂载**的 `(tenant,user,matter namespace)` 唯一 owner 租约。调用只接受已认证且仍 active 的 device session ID，不让请求体自报 tenant/user/device。租约写入使用 SQLite `BEGIN IMMEDIATE`；初次占有 epoch=1，同设备可在有效 session 下续租；其他设备即使旧租约到期也不能直接从空本地库接管。跨设备转移要求旧租约已释放或到期、预期 epoch 一致、目标 device session 有效，以及可信恢复/owner 授权验证器确认精确源设备、目标设备、快照摘要与批准范围；成功后 epoch 单调增加并留下脱敏转移回执。

每次 Matter effect 写入前，未来 Client 必须在线复核当前 session、scope、owner device、epoch 与租约期限；不可达时失败关闭。**云端写前检查与本地 SQLite 提交不原子**：本批的租约只是必要的控制面协调原语，不是独立成立的跨设备 fencing 证明。后续 Client 必须在同一 Matter 本地事务记录 epoch，写后确认该 epoch 仍被控制面接受；任何旧 epoch 本地结果要隔离并停止继续投影，不能成为另一份 canonical Matter。主设备更换还须先完成加密状态恢复与旧 owner 失效验证。本批**不把验证器接入 Client、不开 API、无默认 allow、无 live effect**，也不修改云端“默认不收业务正文”的边界。

## 实施范围

1. 新增独立的 control-plane SQLite 迁移（不改已有 migration 字节），一行当前 owner 与 append-only 转移回执，均只含 ID、时间、epoch、摘要。
2. 新增未挂载 provider：首占、同设备续租、当前性验证、显式释放、经注入 verifier 的 fenced 转移。过期、失效、跨 tenant/user、旧 epoch、双设备竞争全部失败关闭。
3. 注册唯一 module/catalog 与迁移处置；不加入现有 cloud composition、HTTP route 或 Client 发行包。
4. 用两条独立数据库连接模拟控制面竞争；测试无恢复证据拒绝、旧 epoch 拒绝、重启回读、旧 session supersede、迁移幂等及回执不含 Matter 正文。不得把该测试命名为端到端单写证明。

## 后续门槛

正式恢复验证器须核验加密快照的 manifest/完整性、目标设备身份与 owner 的精确批准；不得让测试 stub 进入产品组合。Client 带 epoch 的本地事务、写后确认/旧 epoch 隔离、失联降级、lease 心跳/停机、真实飞书订阅与 Matter 备份/恢复另批计划及授权。`crossDeviceMatterFenceVerified` 与 `matterRecoveryVerified` 保持 false。

## 本批验证记录

独立 provider、迁移、目录归属及两连接离线测试已落盘。覆盖单 owner、到期不能直接异设备占有、拒绝未验证转移、epoch 递增与旧 owner 拒绝、异步验证期间竞争复核、失效 session 和重启回读。`npm run check` 通过：架构检查 154 个模块，主测试 604 项中 591 通过/13 跳过，兼容包 199 项通过。跳过项含沙箱不允许的 loopback 测试。此记录仅证明离线原语，**不证明**真实恢复/授权或 Client 写路径的端到端 fencing。
