# 🧠 CalorieAI — 项目记忆

> 精简速览：技术栈、目录结构、开发规范 + **历史 Bug 自愈履历与关键决策记录**。

---

## 🚨 交付前自检协议（Agent 必须遵守）
- **禁止人工盲测**: 任何代码修改，在通知"修复完成"前，必须先在本机完成自动化验证。
- **静态路由检查**: `npm run test:routes`（`scripts/check-routes.mjs`）— 拦截 `/api/api`、拼接错误、404 路径。
- **构建验证**: `npm run build`（`prebuild` 已自动跑 test:routes）— 0 Error。
- **动态 API 冒烟**: `npm run test:api`（`scripts/smoke-api.mjs`）— 启动服务逐个请求所有 `/api` 路由，断言 0 404。
- **E2E 巡检 (质检部门)**: `../qa-inspector`（Playwright），`cd ../qa-inspector && node scripts/run-qa.mjs <url>`；失败产物 `screenshots/` + `reports/`。
- **完整门禁**: `npm test`（= test:routes + test:api）；提交前再跑 `npm run build`。
- **交付标准**: 只有亲自跑完上述流程、并在回复中附上「终端测试通过日志」后，才算完成任务。

## 技术栈
- 框架: Next.js 16 (App Router) + React 19 + TypeScript + Turbopack
- 样式与 UI: Tailwind CSS v4 + Lucide Icons
- 状态与 i18n: 自定义 `LocaleInit` + `hydrated` 状态延迟加载（防 React #418）；`localStorage > navigator.language > en`
- 支付: Stripe (信用卡/Apple Pay/Link/支付宝/微信) + PayPal (微额支付兜底)；**Credits Top-up 积分包一次性付款，无订阅**
- AI: DeepSeek 主调（`https://api.deepseek.com`，OpenAI 兼容 chat/completions，识图 + 文字）；识图失败且配置 `GEMINI_API_KEY` 时回退 Gemini Vision，不返回 Mock
- 积分: 服务端权威（识图 -1 / 广告 +10 / 积分包充值），`src/lib/db` DAL 记账
- 成本控制: 识图/文字分析先做 Redis 限频与积分预扣；文字单一标准食物先走 MD5 Redis/本地静态库，复杂多食物才调用模型；token 守卫对云端付费端点强制 `max_tokens: 1000` + `temperature: 0.2`（本地模型豁免）
- 上线测试期频控: 普通用户 24 小时内最多 3 次 AI 请求（User ID / 匿名 IP 派生 ID 判重，429 + 提示文案）；管理员（管理员邮箱派生 user_id / 有效 `x-admin-token` / `ADMIN_API_TOKEN`）不限次数
- 持久化 (DAL): Postgres → Vercel KV/Redis → 本地文件（os.tmpdir）三机制自动降级
- TTS: Edge-TTS (Azure Cognitive Services)
- 部署: Vercel (Git 自动部署) + Cloudflare Wildcard DNS（`*.app008ai.com`）

## 目录结构
- `src/app` — 页面 + API 路由
  - `api/` — 后端: `stripe/*`、`paypal/*`、`v1/{billing,meals,user,credits,stats,insight,admin,ads}`、`tts`
  - `billing/` — 支付成功/取消页
- `src/components` — 前端组件 (`theme-provider`、`locale-init`、`locale-switcher`)
- `src/lib` — 状态与工具：`db/` (DAL 抽象层 + adapters)、`i18n/` 多语言、`billing-store`、`credits-store`、`vision-log-store`、`analytics-store`、`auth`、`oauthDetect`
- `scripts/` — 配置检测 + E2E 测试
- `public/` — 静态资源
- `data/` — 运行时订阅数据 (gitignore)

## 规范
- **i18n**（`src/lib/i18n`，零依赖）: 优先级 `localStorage > navigator.language > en`；文案必须走 `t("key")`，抽离到 `zh.json`/`en.json`，禁止硬编码中文。
- **支付**: Stripe Checkout Session（一次性付款）+ Webhook `checkout.session.completed` → 按积分包发放积分并记账；PayPal capture 同理；未配密钥时自动降级为 mock 模拟支付。
- **环境变量**: 见 `.env.example`；`.env.local`、`*.backup` 不入库。
- **命令**: `npm run dev` / `build` / `lint` / `test:routes`。
- **构建产物不索引**: `node_modules`、`.next`、`dist`、`coverage` 等见 `.ignore` / `.gitignore`。

## 质量门禁（Commit/Push 前必过）
- `npm run test:routes`（`scripts/check-routes.mjs`）: 扫描所有 `/api` 请求路径，拦截 `/api/api` 双重前缀、`${API}/api` 拼接、`//`、以及无对应 route handler 的 404 路径。
- `npm run test:trial-limit`（`scripts/check-trial-limit.mjs`）: 以本地 DeepSeek 兼容桩启动 `next start`，断言普通用户 3 次/24h + 第 4 次 429 指定文案、管理员令牌与管理员 user_id 不受限、识图链路同受频控。需先 `npm run build`。
- `npm run test:token-guard`（`scripts/check-token-guard.mjs`）: 断言 DeepSeek 等云端付费端点强制 `max_tokens: 1000` + `temperature: 0.2`，本地端点完全豁免。
- `npm run build` 的 `prebuild` 已绑定 `test:routes`，构建前自动自检。
- `.githooks/pre-commit`、`pre-push`（`core.hooksPath=.githooks`）强制拦截失败提交。
- 提交流程: `npm run test:routes` → `npm run build` → 全绿再 commit/push。

---

# 📜 历史 Bug 自愈履历

| 日期 | Commit | 问题 | 根因 | 修复 |
|------|--------|------|------|------|
| 2026-08-01 | `3408c10` | **React #418 Hydration Error（生产线上拦截）** | 渲染期直接读取 `localStorage`（Header 登录按钮 `typeof window !== "undefined" ? localStorage.getItem("user_email")…`），SSR 渲染 `t("login_title")` 而客户端 Hydrate 渲染邮箱前缀 → DOM 文本不一致 | 采用 `mounted`/`hydrated` 双阶段渲染：首屏固定与 SSR 一致，`useEffect` 置位后再读 `localStorage`（[`src/app/page.tsx`](src/app/page.tsx)） |
| 2026-08-01 | `140e990` | 文档固化 | — | 新增 `PROJECT_SPEC.md`；`README.md` 关联模板文档 |
| 2026-08-01 | `c37a139` | 文档完善 | — | README 标注 100% Production Ready + 详细技术栈 + QA 质检；PROJECT_SPEC 重建（含 #418 根因与剥离指南） |
| 2026-08-01 | 本次 | 文档瘦身 | — | 合并 `TEMPLATE.md`（→PROJECT_SPEC 附录 B）、`AGENTS.md`/`CLAUDE.md`（→PROJECT_SPEC §9）；最终仅保留 3 大标准文档 |
| 2026-08-08 | 本次 | 文档全量重构 | — | README 重构：AI Vision SaaS 定位、Stripe/PayPal/积分变现、DAL 架构、部署与 QA 命令；PROJECT_SPEC/MEMORY 同步 DAL 与积分；`.env.example` 补 `NEXT_PUBLIC_APP_URL`/`REDIS_URL` |
| 2026-09-11 | 本次 | **AI 主调切 DeepSeek + 测试期频控上线** | DeepSeek 为纯文本模型，识图链路缺图片输入能力；测试期需限制普通用户成本 | 新增 `src/lib/trial-quota.ts`（Upstash ZSET + 进程内回退）与 `src/lib/admin-access.ts`（管理员识别）；`cost-control.ts` 新增 `reserveTrialDailyLimit`（普通用户 3 次/24h，管理员不限且跳过积分预扣）；两条 meal 路由切 DeepSeek 并加 429 拦截；识图保留可选 Gemini Vision 兜底；新增 `npm run test:trial-limit` 门禁（本地桩 E2E 全绿） |

> 关联 QA 资产（独立仓库 `../qa-inspector`，commit `78308e6`）：质量守卫豁免 `blob:`/`data:` 对象 URL 误报；新增 `tests/hydration-logged-in.spec.ts` 已登录用户 #418 专项验证。

---

# 🎯 关键决策记录

1. **Hydration 防御策略（决策定稿）**：i18n 初始固定默认语言 `en` + `<LocaleInit />` 挂载后 `applyResolvedLocale()`；所有「读客户端状态」UI 一律 `mounted/hydrated` 双阶段渲染。此为 CalorieAI 及所有套娃项目的强制规范。
2. **Master Template 定位**：CalorieAI 为 saas-factory-template（标准剥离指南见 [`PROJECT_SPEC.md`](PROJECT_SPEC.md) 附录 A/B）。
3. **边界隔离纪律**：代码/文档修改限定 `./calorieai`；Git 独立仓库提交；QA 在 `../qa-inspector` 调度。
4. **文档治理**：根目录标准化为 3 个 MD —— `README.md`（对外说明）、`PROJECT_SPEC.md`（生产规格+Agent 守则+套娃 SOP）、`MEMORY.md`（记忆+自愈履历+决策）。
5. **DAL 抽象层（决策定稿）**：订阅/积分/支付流水/识图日志/访问统计统一走 `src/lib/db` 的 `DbAdapter` 契约，Postgres → KV → 本地文件三机制自动降级；生产必须配置 Postgres 或 KV 以保证跨实例/跨设备数据永久保存。
6. **服务端权威授权（决策定稿）**：积分余额与 Pro 权限仅由服务端 API 记账/判定，前端只消费结果；识图 -1、广告 +10、充值/Pro 解锁均为服务端权威交易。
7. **AI 主调切换（2026-09-11，决策定稿）**：主调模型切回 DeepSeek（`DEEPSEEK_API_KEY` / `https://api.deepseek.com` / `deepseek-chat`），识图与文字统一走 OpenAI 兼容 chat/completions；token 守卫按域名识别 DeepSeek 云端付费并注入 `max_tokens: 1000` + `temperature: 0.2`。DeepSeek 官方文本模型不接受图片输入，故识图链路保留可选 Gemini Vision 兜底（配置 `GEMINI_API_KEY` 时自动启用），任何提供商失败/缺密钥均返回明确错误，**绝不回退到 Mock 数据**。
8. **Token & Cost Control（2026-08-23）**：Pre-LLM MD5 食物缓存 + 本地标准食物库；单一标准食物走轻量路径；复杂组合才进入模型；所有 meal API 在下游前执行 Redis 限频与服务端积分预扣，余额不足返回 402。
9. **上线测试期频控（2026-09-11）**：`src/lib/cost-control.ts` + `src/lib/trial-quota.ts` 对 meal API 增加每日额度——普通用户 24 小时滑动窗口最多 3 次（按服务端裁定的 user_id 判重；匿名请求回落 IP 派生 ID），超限 429 + `测试阶段普通用户每天限额 3 次，如需更多额度请联系管理员`；管理员（管理员邮箱派生 user_id / 有效 `x-admin-token` / `ADMIN_API_TOKEN`）不限次，并同时跳过积分预扣（返回真实余额），确保真正无限次调用。存储优先 Upstash/Vercel KV，未配置或 Redis 异常时回退进程内计数，AI 调用失败自动退次数。
