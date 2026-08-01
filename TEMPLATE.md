# 🏭 SaaS 工厂 — 标准模板抽离清单

> `calorieAI` 是本仓库的**标准模板**（Next.js 16 + TypeScript + Tailwind v4 + 轻量 i18n + Stripe/PayPal Billing + E2E 质量门禁）。
> 本文件定义"以 calorieAI 为模板初始化新项目 [X]"时应复制的**通用架构**与应**移除的业务逻辑**。

## 1. 通用模块（必须复制）

### 国际化（零依赖）
- `src/lib/i18n/` — `index.ts`（localStorage > navigator.language > en）+ `zh.json`/`en.json` 字典
- `src/components/locale-switcher.tsx` — 语言切换器
- 接入点: `src/app/layout.tsx` 的 `<html lang>` 由 i18n 模块客户端同步

### 收单 / 计费（Billing Store）
- `src/lib/billing-store.ts` — 订阅/买断状态持久化 → `data/subscriptions.json`
- `src/app/api/stripe/` — `checkout` + `webhook` 路由
- `src/app/api/paypal/` — `create-order` + `capture-order` 路由
- `src/app/api/v1/billing/` — `status` / `subscribe` / `license` / `ad-reward` 路由
- `src/app/billing/success/page.tsx` + `src/app/billing/cancel/page.tsx` — 支付结果页
- 未配密钥自动 mock 降级（前后端均内置）

### 基础设施 / 工具
- `src/components/theme-provider.tsx` — 明暗主题
- `scripts/check-routes.mjs` — 路由/API 路径质量门禁（防 `/api/api`）
- `scripts/bind-domain.mjs` — Cloudflare DNS + Vercel 域名绑定脚本
- `scripts/check-stripe-config.mjs`、`scripts/test-stripe-e2e.mjs` — 支付检测/E2E
- `.githooks/pre-commit` + `pre-push`、`.ignore`、`.gitignore` — 质量门禁与扫描豁免

## 2. 业务逻辑（新项目移除/替换）

| 模块 | 处理 |
|---|---|
| `src/app/page.tsx` 首页仪表盘 | 保留框架（Header/Tab/日志/弹窗结构），替换业务文案为 `t("key")`，移除 CalorieAI 专属 mock 数据（MOCK_FOODS/MOCK_STATS 等） |
| `src/app/api/v1/meals/`、`stats/`、`insight/`、`ads/`、`user/` | 按新项目业务裁剪；保留 `billing/` |
| `src/lib/auth.tsx`、`oauthDetect.ts` | 按需替换 |
| `public/` 静态资源 | 替换品牌资产 |
| 文案字典 | 新增项目业务 key 到 `zh.json`/`en.json` |

## 3. 初始化新项目步骤（一键套娃）

```bash
# 1) 复制通用架构（从模板仓库或本目录）
#    复制: src/lib/i18n src/components/locale-switcher.tsx src/lib/billing-store.ts \
#          src/app/api/{stripe,paypal} src/app/api/v1/billing src/app/billing \
#          src/components/theme-provider.tsx scripts/ .githooks/ .ignore .gitignore \
#          TEMPLATE.md MEMORY.md AGENTS.md

# 2) 重命名项目
#    package.json name; src/app/layout.tsx metadata; 字典 app_title

# 3) 启用质量门禁
git config core.hooksPath .githooks
npm run test:routes          # 路由检查
npm run build                # prebuild 自动跑 test:routes

# 4) 配置环境变量（复制 .env.example → .env.local 并填入密钥）

# 5) 绑定域名（Cloudflare + Vercel）
node scripts/bind-domain.mjs example.com --apply --project <new-project>
```

## 4. 质量门禁约定

- `npm run test:routes` → 扫描 src 内所有 `/api` 请求路径:
  - 拦截 `/api/api` 双重前缀、`${API}/api` 拼接、`//` 双斜杠
  - 校验字面量 `/api/...` 是否命中 `src/app/api<path>/route.ts`（防运行时 404）
- `npm run build` 的 `prebuild` 会自动执行 `test:routes`
- `.githooks/pre-commit` 与 `pre-push` 在 Commit/Push 前强制运行，失败即拦截
- 提交前: 先 `npm run test:routes` → `npm run build`，全绿再 commit/push
