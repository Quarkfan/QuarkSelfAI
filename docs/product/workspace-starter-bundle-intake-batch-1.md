# Workspace Starter bundle 跨语言只读接收：第一批计划

日期：2026-10-12。状态：待复评；沿总计划 C 阶段推进，不修改现网 composition。

`agent-workspace-kit` 本地 Git `cbec01c02949602c612b36202da904e6ad6508b1` 已生成 developer/product 两种规范 JSON bundle，并验证空目录安装。QuarkSelfAI 不得运行时读取相邻源码路径或复制模板正文；本批只在现有 `capability-platform-governance` policy 模块增加一个纯字节校验器，作为未来 Client 受控 bundle intake 的契约基线。

实现：输入最多 2 MiB bundle 字节和必填的预期 `sourceRevision`、`artifactDigest`；严格复核规范 JSON、schema、Feishu 必选/`lark-cli`、inactive/no-effect、profile、逐文件路径白名单、排序/重复/大小/base64/SHA-256、整体摘要、`workspace.json` 契约。输出只含 ID、版本、profile、revision、digest、文件数量和不可执行状态，不返回正文、路径清单或本机路径。不允许由远端描述或包内声明自行确定预期身份；该预期须由将来受信发布/签名计划提供。

先用合成 fixture 单测篡改、越界、权限状态和 pin 不符；再用 Python 实际生成的两个 bundle 做一次跨语言只读验证。更新模块所有权、手册和总计划；完整检查及提交后架构复查。不得把此批报告为 Client 安装、用户/租户授权或签名发布完成。
