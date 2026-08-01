<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# CalorieAI — 启动速览

## 技术栈
Next.js 16 (App Router) + TypeScript + Tailwind v4；支付 Stripe + PayPal；部署 Vercel。

## 目录
- `src/app` — 页面与 API
- `src/components` — 前端组件
- `src/lib` — 状态与工具（含 `i18n/`）
- `scripts/` — 检测与测试
- `public/` — 静态资源

## 规范
- i18n（`src/lib/i18n`，零依赖）: `localStorage > navigator.language > en`；文案用 `t("key")`，字典 `zh.json`/`en.json`，禁止硬编码。
- 支付: 未配密钥走 mock 模拟；Webhook → billing-store → `data/subscriptions.json`。
- 命令: `npm run dev` / `build` / `lint` / `test:routes`。
- 质量门禁: commit/push 前运行 `npm run test:routes`（防 `/api/api` 与 404 路径）；`prebuild` 已绑定；`.githooks` 自动拦截。
- 模板: `calorieAI` 为标准模板；初始化新项目时复制通用架构（见 `TEMPLATE.md`），移除业务逻辑，保留支付 + i18n + 域名绑定脚本。

## 扫描豁免（禁止深度索引）
`node_modules`、`.next`、`out`、`dist`、`build`、`coverage`、`data`、`.git`（详见 `.ignore`）。
