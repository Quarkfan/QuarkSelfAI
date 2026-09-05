# 账号恢复与只读验收

本手册只负责让新终端恢复必要身份并证明读取链路可用。登录、token 注入和只读验证不等于允许启动消费者、发送消息、
创建任务或接管旧实例。账号机器清单见 `config/account-bootstrap.json`。

## 1. 恢复顺序

1. 配置 GitHub SSH 身份，clone `git@github.com:Quarkfan/QuarkSelfAI.git` 并 checkout 恢复包记录的 revision。
2. 执行 `npm ci`，不要从旧机器复制 `node_modules`、下载插件或模型缓存。
3. 运行 `codex login --device-auth` 与 `claude auth login`。优先使用各自官方登录，不复制完整用户配置目录。
4. 运行 `lark-cli auth login` 恢复本人 user identity；bot app secret 只从密码管理器/secret store 注入，再用
   `lark-cli auth status --json --verify` 验证 user 与 bot。
5. 运行 `dida auth login`，或者从批准的 secret store 注入 token。不要把 token 放进命令参数、Git 或聊天。
6. 按 secret store 约定注入 `QUARK_INFERENCE_BASE_URL` 与 `QUARK_INFERENCE_API_KEY`。DSH 程序本身使用仓库锁定的
   `deploy/dsh-runtime`，不要求系统全局安装一个不受控版本。

任何一步需要浏览器或设备确认时由 owner 在当前终端完成；恢复脚本不代替本人授权，也不从备份中自动写回用户目录。

## 2. 审计命令

本地检查不会访问 GitHub/飞书/滴答网络：

```bash
npm run audit:accounts
```

正式恢复验收使用只读联网检查：

```bash
npm run audit:accounts -- --online --strict
```

联网模式仅执行：GitHub 远端 HEAD 读取、飞书 user/bot token verify、滴答清单列表读取；Codex/Claude 使用官方本地
login status，DSH inference 只检查端点和 secret 是否已配置，不发送模型请求或消耗推理额度。

报告只允许包含账号类别、`ready/configured/unverified/reauth-required/unavailable`、固定原因码和登录提示。CLI 原始
stdout/stderr、用户名、openId、scope、邮箱、token 片段和上游错误正文不得进入报告或恢复账本。

## 3. 与 restore-safe 的关系

- `restore:stage` 解密账号配置时只放在受限 staging。
- 推荐的 `restore:bootstrap-safe` 会在准备完成或失败后自动删除其临时 staging，避免新终端遗留明文恢复材料。
- `restore:prepare-safe` 将旧账号材料放入新 clone 的 `var/recovery-input`，不会复制到 `~/.lark-cli`、
  `~/.config/dida-cli`、`~/.codex` 或 `~/.claude`。
- owner 完成重新登录或逐项审核导入后，再运行联网严格审计。
- 审计通过后仍保持 `ASSISTANT_RUNTIME=control-only`、`ASSISTANT_KERNEL=off` 与 `TAKEOVER_CONFIRMED=false`。
- 只有旧实例停止且本次单写者接管获得明确批准，才能进入正式运行配置生成与切换。

## 4. 失败处理

- `reauth-required`：只对该账号重新登录或重新注入秘密，不扩大 scope。
- `unavailable`：先确认 CLI/锁定运行时是否已安装；联网超时不应被解释成授权撤销。
- `unverified`：运行时没有请求联网验证，不代表登录失败。
- 401/403/429 或连接错误只保留固定分类，不记录响应正文；不得自动刷新凭证或切换身份。
