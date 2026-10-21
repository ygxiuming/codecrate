# 贡献指南

感谢你愿意参与改进本项目。以下约定用于保持代码质量与协作效率。

## 开发环境

- Node.js ≥ 22
- npm ≥ 10
- 推荐 Linux / macOS；Windows 需使用 WSL2（better-sqlite3 原生模块）

```bash
npm install
ADMIN_PASSWORD='dev-password-123' npm run dev
```

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:5173`（Vite 代理 `/api` 与 `/icons`）
- 数据目录：`./data`

## 目录约定

- `server/src/adapters/`：数据源适配器；新增源时实现统一接口，不要直接耦合到路由。
- `server/src/routes/`：仅做参数校验、鉴权、审计与响应；业务逻辑放 `services/`。
- `server/src/net/safeFetch.ts`：所有出网请求必须经过它，禁止直接使用 `fetch`/`http.request`。
- `server/src/storage/`：所有文件路径必须经 `resolveWithin` 约束。
- `web/src/pages/`：页面；可复用组件放 `components/`。
- `web/src/content/docs/`：内置中文文档（Markdown）。

## 代码规范

- TypeScript strict 模式；前后端均需通过 `npm run typecheck`。
- 使用 `npm run lint`；不要引入新的 ESLint 错误。
- 数据库访问只使用 `better-sqlite3` 预编译语句 + 参数绑定，禁止拼接 SQL。
- 新增接口需要：参数校验（zod）、权限检查、审计日志（管理端写操作）。
- 日志不得包含密码、Cookie、Access Token 或完整请求体。
- 前端不引入不必要的重型依赖；保持内网离线可用（不得依赖外部 CDN/字体）。

## 测试

```bash
npm test
```

要求：

- 新增缓存/下载/解析逻辑时补充单元或集成测试。
- 不得在测试中访问真实外网；使用 `server/test/helpers/mockSource.ts` 的本地 mock。
- 涉及 SSRF 的测试必须显式传入允许列表，禁止放宽默认策略。

## 提交与 PR

- 提交信息建议使用 Conventional Commits：`feat: ...`、`fix: ...`、`docs: ...`、`test: ...`、`chore: ...`。
- 一个 PR 聚焦一个主题；附带变更说明、验证方式与截图（UI 变更）。
- PR 模板中的检查项需逐项确认。
- 不要提交 `data/`、`.env`、日志、真实二进制或任何密钥。

## 新增数据源适配器

1. 在 `server/src/adapters/` 实现接口（参考 `marketplaceOpenVsx.ts`）。
2. 在 `adapters/index.ts` 注册。
3. 在后台设置与文档中暴露可配置地址。
4. 补充 mock 源与集成测试。
5. 确认所有请求经过 `safeFetch`，并限制响应体大小。

## 许可证

提交即表示你同意以 [MIT](LICENSE) 许可贡献代码。
