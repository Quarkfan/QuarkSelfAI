# 工作集成首批迁移预检证据

日期：2026-09-06

## 输入与方法

- 私有工作包基线 revision：`c83a58fc068548a9ef11b7035d9aa03de7e7b8a3`。
- 来源主线 revision：`2c56c2f59c1566fa7024a4db453bcfdaddbfcc6c`。
- 从 99 项内容寻址账本选择 21 项 `candidate-copy-private`，逐项通过固定 revision 读取内容并复核 SHA-256。
- 扫描结果只保存计数，不保存命中正文；检查 age/PEM 私钥、API key、赋值型 secret、Bearer 字面量、含凭证数据库 URL，
  同时记录本机路径、内部主机、稳定飞书 ID、IP、客户导出和生产日志等工作保密提示。

## 结果

- 批次 digest：`6c2a8904b82c109a5c2d8f999ee2ddad315415605b21c0000041db327b95bff5`。
- 14 项：未命中高风险秘密模式，可在精确批准后按固定 SHA-256 原样复制到私有 pack。
- 6 项：回归证据，不原样复制；批准后重建为脱敏 contract replay。
- 1 项：测试文件存在 2 处赋值型凭证形态字面量，排除待人工改造，不进入本次复制。
- 5 项存在工作保密提示；它们只说明仍属于私有工作域，不自动构成秘密，也不允许进入产品主线。
- owner 批准 0、内容复制 0、运行激活 0；provider、consumer、external write 状态未改变。

## 验证

- 私有工作包 revision `c44c14269c512279889ad78d90d2a9329b60838a` 保存生成器、批次清单和严格审计。
- `npm run plan:migration-batch -- --check` 可从固定来源完整重建相同 digest。
- `npm run check` 校验批次与 99 项来源账本逐项对应、计数与处置一致，且仓库自身秘密模式命中为 0。
