# 本地开发手册

## 要求

- macOS 或 Linux
- Node.js 22.19 及以上
- npm
- `lark-cli` 1.0.88 及以上
- 可选 PostgreSQL 14 及以上
- DSH checkout：工作区的 `github/deepseek-harness`（版本见 `compat/dsh-baseline.json`）

## 验证

```bash
npm install
npm run check
npm run compat:lark
```

`compat:lark` 只读取版本、EventKey 和 schema，不启动事件消费者。开发时不要在现网 bridge 仍运行时执行
`LarkCliService.start()`，因为 `card.action.trigger` 是单消费者能力。

## 数据库

复制 `.env.example` 的变量名到本地秘密管理方式中，设置真实 `DATABASE_URL`，再按
`docs/storage/postgresql.md` 初始化。测试不得依赖生产数据库。
