# ADR-0060: 部署入口必须显式且受限选择

状态：Accepted（2026-08-25）

## 背景

长期 native product host 已经独立于 compatibility composition，但 launchd、systemd 和容器仍硬编码
`dist/app.js`。运维文档要求维护窗口切换 `dist/product/app.js`，机器部署资产却无法表达或校验这一动作。

## 决策

1. 部署层只接受 `compatibility` 和 `native` 两个 application mode，并把它们分别映射到固定构建入口；禁止传入任意路径。
2. LaunchAgent 渲染器通过 `--application-mode` 选择入口，默认保持 `compatibility`，避免代码升级意外夺取消费者所有权。
3. 容器与 systemd 共用 `QUARK_APPLICATION_MODE` allowlist 和同一入口脚本；profile 名只允许安全字符。
4. `compatibility` 使用 `DSH_PROFILE` 与 compat overlay；`native` 使用隔离的 `DSH_NATIVE_PROFILE` 与空 profile overlay，
   长期产品 bundle 继续由包级 `cordis.patch.yml` 提供。
5. 镜像必须携带长期 bundle 和 compatibility overlay，不能依赖构建上下文之外的隐式文件。

## 后果

维护窗口的进程入口切换成为可审计配置变更，同时不会自动设置 activation gate、停止旧消费者或绕过 native host 的
配置/模块就绪检查。当前运行仍保持 compatibility；只有明确批准的维护窗口才能把部署 mode 改为 native。
