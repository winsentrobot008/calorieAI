# 🧠 CalorieAI — 项目记忆

> 精简速览：只保留技术栈、目录结构、开发规范。

## 🚨 交付前自检协议（Agent 必须遵守）
- **禁止人工盲测**: 任何代码修改，在通知"修复完成"前，必须先在本机完成自动化验证。
- **静态路由检查**: `npm run test:routes`（`scripts/check-routes.mjs`）— 拦截 `/api/api`、拼接错误、404 路径。
- **构建验证**: `npm run build`（`prebuild` 已自动跑 test:routes）— 0 Error。
- **动态 API 冒烟**: `npm run test:api`（`scripts/smoke-api.mjs`）— 启动服务逐个请求所有 `/api` 路由，断言 0 404。
- **E2E 巡检 (质检部门)**: `../qa-inspector`（Playwright），`cd ../qa-inspector && node scripts/run-qa.mjs <url>`；`npm run test:e2e` 已内置本项目入口；失败产物 `screenshots/` + `reports/`。
- **完整门禁**: `npm test`（= test:routes + test:api）；提交前再跑 `npm run build`。
- **交付标准**: 只有亲自跑完上述流程、并在回复中附上「终端测试通过日志」后，才算完成任务。

## 技术栈
- 框架: Next.js 16 (App Router) + Turbopack
- 语言: TypeScript
- 样式: Tailwind CSS v4
- 支付: Stripe (信用卡/支付宝/微信) + PayPal (`@paypal/react-paypal-js`)
- AI: Google Gemini Flash / OpenAI GPT-4o Vision
- TTS: Edge-TTS (Azure Cognitive Services)
- 部署: Vercel (Git 自动部署，Live Stripe)

## 目录结构
- `src/app` — 页面 + API 路由
  - `api/` — 后端: `stripe/*`、`paypal/*`、`v1/{billing,meals,user,stats,insight,admin,ads}`、`tts`
  - `billing/` — 支付成功/取消页
- `src/components` — 前端组件 (`theme-provider`、`locale-switcher`)
- `src/lib` — 状态与工具 (`i18n/` 多语言、`billing-store`、`auth`、`oauthDetect`)
- `scripts/` — 配置检测 + E2E 测试
- `public/` — 静态资源
- `data/` — 运行时订阅数据 (gitignore)

## 规范
- **i18n**（`src/lib/i18n`，零依赖）: 优先级 `localStorage > navigator.language > en`；文案必须走 `t("key")`，抽离到 `zh.json`/`en.json`，禁止硬编码中文。
- **支付**: Stripe Checkout Session + Webhook → `billing-store` → `data/subscriptions.json`；PayPal 走 capture → `subscribe` API；未配密钥时自动降级为 mock 模拟支付。
- **环境变量**: 见 `.env.example`；`.env.local`、`*.backup` 不入库。
- **命令**: `npm run dev` / `build` / `lint` / `test:routes`。
- **构建产物不索引**: `node_modules`、`.next`、`dist`、`coverage` 等见 `.ignore` / `.gitignore`。

## 质量门禁（Commit/Push 前必过）
- `npm run test:routes`（`scripts/check-routes.mjs`）: 扫描所有 `/api` 请求路径，拦截 `/api/api` 双重前缀、`${API}/api` 拼接、`//`、以及无对应 route handler 的 404 路径。
- `npm run build` 的 `prebuild` 已绑定 `test:routes`，构建前自动自检。
- `.githooks/pre-commit`、`pre-push`（`core.hooksPath=.githooks`）强制拦截失败提交。
- 提交流程: `npm run test:routes` → `npm run build` → 全绿再 commit/push。

## 模板约定
- `calorieAI` 为标准模板（Next.js + i18n + Stripe/PayPal Billing Store + E2E）。
- 当用户要求「以 calorieAI 为模板初始化新项目 [X]」时：直接复制通用架构代码，**移除 calorieAI 业务逻辑**，**保留支付与国际化模块**。
- 模板抽离清单见 `TEMPLATE.md`；新项目绑定域名用 `scripts/bind-domain.mjs`（Cloudflare DNS + Vercel）。
