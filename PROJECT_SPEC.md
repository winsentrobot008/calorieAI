# 📐 CalorieAI — 项目生产规格 (PROJECT_SPEC)

> **唯一生产规格文档**：本文件统一承载生产规格、Hydration 防护守则、Agent 行为守则与套娃 SOP（合并自 `AGENTS.md` / `CLAUDE.md` / `TEMPLATE.md`）。
>
> **完成度**：🟢 100% 生产就绪 (Production Ready) — 已通过 Vercel 线上实盘巡检（`https://calorie-ai-seven.vercel.app`）

---

## 📑 目录
- [1. 项目概览](#1-项目概览)
- [2. 核心架构](#2-核心架构)
- [3. SSR / Hydration 规范（React #418）](#3-ssr--hydration-规范react-418)
- [4. i18n 约定](#4-i18n-约定)
- [5. 支付 / Billing](#5-支付--billing)
- [6. 交付前 Agent 自检协议](#6-交付前-agent-自检协议)
- [7. 边界隔离规则](#7-边界隔离规则)
- [8. 质量门禁](#8-质量门禁)
- [9. Agent 行为守则](#9-agent-行为守则)
- [10. 相关文档](#10-相关文档)
- [附录 A：saas-factory-template 标准剥离指南](#附录-asaas-factory-template-标准剥离指南)
- [附录 B：套娃 SOP（初始化新项目）](#附录-b套娃-sop初始化新项目)
- [附录 C：扫描豁免清单](#附录-c扫描豁免清单)

---

## 1. 项目概览

| 项 | 值 |
|----|----|
| **产品** | CalorieAI — AI 智能卡路里助手 |
| **生产地址** | `https://calorie-ai-seven.vercel.app` |
| **域名体系** | Vercel 部署 + Cloudflare Wildcard DNS（`*.app008ai.com`） |
| **仓库** | `https://github.com/winsentrobot008/calorieAI`（`./calorieai` 独立 Git 仓库，分支 `main`） |
| **部署** | Vercel（Git 自动部署） |
| **框架** | Next.js 16.2.11 (App Router) + React 19 + TypeScript + Tailwind CSS v4 |
| **模板属性** | **Master Template**（saas-factory-template，见附录 A/B） |

## 2. 核心架构

```
src/
├── app/
│   ├── layout.tsx            # Root Layout: ThemeProvider + LocaleInit + <html suppressHydrationWarning>
│   ├── page.tsx              # 主页面 (记录/看板/设置 + 登录/Billing 弹窗 + Admin)
│   ├── billing/              # /billing/success + /billing/cancel 支付结果页
│   └── api/                  # stripe / paypal / v1/{meals,stats,insight,ads,user,billing,admin}
├── components/
│   ├── locale-init.tsx       # 挂载后应用首选语言（不参与首次 Hydrate）
│   ├── locale-switcher.tsx   # 语言切换器
│   └── theme-provider.tsx    # 明暗主题（挂载后读 localStorage）
└── lib/
    ├── db/                   # ⭐ DAL 抽象层: index.ts + types.ts + adapters/{file,kv,postgres}
    ├── i18n/                 # 零依赖 i18n: index.ts + zh.json + en.json
    ├── auth.tsx              # Auth 上下文（挂载后读 localStorage）
    ├── billing-store.ts      # 订阅状态持久化
    ├── credits-store.ts      # 积分本地文件回退实现
    ├── vision-log-store.ts   # 识图日志
    ├── analytics-store.ts    # 访问统计
    └── oauthDetect.ts        # OAuth 提供商检测
```

### 2.1 统一数据库访问层 (DAL)

[`src/lib/db/index.ts`](src/lib/db/index.ts:17) 的 `pickAdapter()` 按优先级自动选择存储：

```
1. POSTGRES_URL / DATABASE_URL           → Postgres（Vercel Postgres / Neon / Supabase）
2. KV_REST_API_URL + KV_REST_API_TOKEN   → Vercel KV / Upstash Redis
3. 均未配置                              → 本地文件（os.tmpdir 回退，仅本地/单实例调试）
```

- [`types.ts`](src/lib/db/types.ts:19) 定义 `DbAdapter` 契约：覆盖积分、订阅、支付流水、识图日志、访问统计五类数据。
- 三套适配器实现：Postgres（`ON CONFLICT` upsert，建表自动初始化）/ KV（`calorieai:` key 前缀）/ 文件（`os.tmpdir()/calorieai-data`）。
- 跨实例/跨设备数据永久保存：配置 Postgres 或 KV 后，所有 Lambda 实例读写同一存储。
- **0-Token 运维**：访问统计、识图日志、支付流水、模型健康度全部自建 DAL 持久化，不依赖付费第三方可观测服务。

## 3. SSR / Hydration 规范（React #418）

### 3.1 根因（已修复，commit `3408c10`）
> 生产环境 Vercel 控制台曾拦截 `Uncaught Error: Minified React error #418`。
> **根因**：渲染期直接读取客户端 `localStorage`，导致 **SSR 预渲染文本 ≠ 客户端首次 Hydrate 时的 DOM 文本**。

- 触发点（[`src/app/page.tsx`](src/app/page.tsx)）：
  - Header 登录按钮原先为 `typeof window !== "undefined" ? localStorage.getItem("user_email")… : t("login_title")`：
    - SSR 阶段 `window` 未定义 → 渲染 `t("login_title")`；
    - 客户端首次 Hydrate 时 `window` 已存在且 `localStorage` 含 `user_email`（已登录用户）→ 渲染邮箱前缀；
    - 两端文本不一致 → React 在挂载阶段抛出 #418。
  - `LoginModal` 退出登录块同理存在 `typeof window !== "undefined" && localStorage.getItem(...)`。

### 3.2 修复方案（双阶段渲染）
- Header 按钮改为 `mounted ? localStorage.getItem("user_email")?.split("@")[0] || t("login_title") : t("login_title")`；
- `LoginModal` 改为 `hydrated && localStorage.getItem(...)`；
- 首次渲染固定与 SSR 一致，`useEffect` 置位后（挂载完成）才读取客户端状态。

### 3.3 防御铁律（新增 UI 必须遵守）
1. **首次渲染必须与 SSR 输出 100% 一致**；`localStorage` / `navigator` / `sessionStorage` 读取**只能**发生在 `useEffect` / 事件回调中。
2. **语言初始化**：i18n 初始固定为默认 `en`（与 SSR 一致）；`<LocaleInit />` 挂载后调用 `applyResolvedLocale()`（localStorage > navigator > en），见 [`src/lib/i18n/index.ts`](src/lib/i18n/index.ts:67)。
3. `<html>` 已声明 `suppressHydrationWarning`（[`src/app/layout.tsx`](src/app/layout.tsx:30)），用于 `lang` 等属性在挂载后的合法变更。
4. 新增「读客户端状态」UI 一律采用 **mounted / hydrated 双阶段渲染**：
   ```tsx
   const [mounted, setMounted] = useState(false);
   useEffect(() => { setMounted(true); }, []);
   // 渲染: mounted ? <客户端值> : <SSR 默认值>
   ```
5. 提交前必须 `npm run build`（含 TypeScript 校验），并跑 QA 专项验证。

## 4. i18n 约定

- 解析优先级：`localStorage (calorieai_locale)` > `navigator.language` > 默认 `en`。
- 支持语言：`zh` / `en`；`navigator.language` 以 `zh` / `en` 前缀匹配，其余回退 `en`。
- 所有展示文案走 `t("key")` / `useT()`，禁止硬编码业务文案。
- 新增语言 key 需同时维护 `src/lib/i18n/zh.json` 与 `en.json`。

## 5. 支付 / Billing

| 渠道 | 说明 |
|------|------|
| Stripe（主） | `/api/stripe/checkout` + `/api/stripe/webhook`；信用卡/Apple Pay/Link/支付宝/微信支付 |
| PayPal（辅） | `/api/paypal/create-order` + `/api/paypal/capture-order`；微额支付申请逻辑与兜底逻辑 |
| 订阅状态 | `/api/v1/billing/status` / `subscribe` / `license` / `ad-reward`；持久化经 DAL 写入（Postgres/KV/文件） |
| 积分系统 | 服务端权威：`GET/POST /api/v1/user/credits`；识图 **-1**、广告 **+10**、充值/Pro 解锁；`initCreditsIfMissing`（新用户赠送 3）+ `addServerCredits`（不低于 0） |
| 降级 | 未配置真实密钥时前后端自动进入 **mock 演示模式** |

## 6. 交付前 Agent 自检协议

生产变更必须按此顺序执行并全绿：

```bash
# 0) 边界隔离：所有修改限定在 ./calorieai 内；Git 独立 commit/push
# 1) 静态检查 + 构建（prebuild 自动跑 test:routes）
npm run test:routes
npm run build

# 2) 独立仓库提交并推送（触发 Vercel 自动部署）
git add <files> && git commit -m "<desc>" && git push origin main

# 3) 等待部署完成，确认线上 200
curl -s -o nul -w "%{http_code}" https://calorie-ai-seven.vercel.app

# 4) 调起质检部门（../qa-inspector）对线上 URL 无头巡检
cd ../qa-inspector
QA_INTERACT=1 node scripts/run-qa.mjs https://calorie-ai-seven.vercel.app
# 断言: 0 Console Error / 0 Uncaught Error (#418) / 0 404 / 0 4xx

# 5) 已登录用户场景专项（复现 #418 触发路径）
TARGET_URL=https://calorie-ai-seven.vercel.app npx playwright test tests/hydration-logged-in.spec.ts
```

**全绿判定**：QA 巡检 `1 passed` 且无 `❌ 质检未通过` 输出，方视为交付完成。

## 7. 边界隔离规则（AGI 工厂生产纪律）

1. **上下文定位**：工作区根为 `git008/projects/`；CalorieAI 代码/文档一律写入 `./calorieai/`。
2. **Git 隔离**：提交在 `./calorieai` 独立仓库内执行（`git -C calorieai …`），不得影响其他子文件夹。
3. **质检调度**：QA 巡检在 `./qa-inspector` 目录执行（协议识别已豁免 `blob:`/`data:` 等合法对象 URL）。

## 8. 质量门禁

| 门禁 | 位置 | 作用 |
|------|------|------|
| 路由/API 路径检查 | `scripts/check-routes.mjs` | 拦截 `/api/api`、双斜杠、字面量路径无对应 route（防 404） |
| pre-commit / pre-push | `.githooks/` | Commit/Push 前强制跑质量门，失败拦截 |
| 构建 | `next build`（prebuild） | TypeScript + 静态页面生成校验 |
| 动态 API 冒烟 | `scripts/smoke-api.mjs`（`npm run test:api`） | 启动服务逐个请求所有 `/api` 路由，断言 0 404 |
| E2E 巡检 | `../qa-inspector` | console / pageerror / 4xx / 404 / requestfailed 全量拦截 |

## 9. Agent 行为守则

> 合并自原 `AGENTS.md` / `CLAUDE.md`（`CLAUDE.md` 仅引用 `AGENTS.md`）。

### 9.1 框架感知
- 本仓库为 **Next.js 16 (App Router)**，存在版本破坏性变更 — 编写代码前先查阅 `node_modules/next/dist/docs/` 相关指南，注意弃用提示。

### 9.2 开发规范
- **i18n**：文案一律走 `t("key")`，字典 `src/lib/i18n/{zh,en}.json`，禁止硬编码。
- **支付**：未配密钥走 mock 模拟；Webhook → `billing-store` → `data/subscriptions.json`。
- **命令**：`npm run dev` / `build` / `lint` / `test:routes` / `test:api`。
- **环境变量**：见 `.env.example`；`.env.local`、`*.backup` 不入库。

### 9.3 交付纪律
- **禁止人工盲测**：任何修改在通知"修复完成"前，必须先在本机完成自动化验证。
- **完整门禁**：`npm run test:routes` → `npm run build` →（服务类变更）`npm run test:api`，全绿再 commit/push。
- **质检调度**：新项目部署后 `cd ../qa-inspector && node scripts/run-qa.mjs <url>` 一键巡检。
- **交付标准**：只有亲自跑完上述流程、并在回复附「终端测试通过日志」后，才算完成任务；禁止未自检直接宣告完成。

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| [`README.md`](README.md) | 项目对外说明：技术栈、快速启动、QA 质检指令 |
| [`MEMORY.md`](MEMORY.md) | 项目记忆：技术栈/目录/规范 + 历史 Bug 自愈履历与关键决策 |

---

# 附录 A：saas-factory-template — 标准剥离指南

> CalorieAI 作为 **Master Template**，向新项目 [X] 剥离时遵循以下标准步骤与边界。

### A.1 必须复制（通用架构）
- `src/lib/i18n/`（`index.ts` + `zh.json` + `en.json`）+ `src/components/locale-init.tsx` + `locale-switcher.tsx`
- `src/components/theme-provider.tsx`
- Billing：`src/lib/billing-store.ts` + `src/app/api/{stripe,paypal}` + `src/app/api/v1/billing/` + `src/app/billing/`
- 基建：`scripts/check-routes.mjs`、`scripts/bind-domain.mjs`、`.githooks/`、`.env.example`、`vercel.json`

### A.2 必须改写（业务剥离）
- `src/app/page.tsx`：保留 Header/Tab/日志/弹窗框架，业务文案全部 `t("key")` 化，删除 CalorieAI 专属 MOCK 数据
- `src/app/api/v1/{meals,stats,insight,ads,user}`：按新业务裁剪；保留 `billing/`
- `src/lib/auth.tsx` / `oauthDetect.ts`：按需替换
- `zh.json` / `en.json`：新增业务 key
- `public/`：替换品牌资产

### A.3 Hydration 规范继承
新项目必须继承 §3 的 Hydration 铁律：任何 `localStorage` / `navigator` / `sessionStorage` 读取仅允许发生在 `useEffect` / 事件回调中；首屏渲染必须与 SSR 输出一致；新增「读客户端状态」的 UI 一律采用 `mounted` / `hydrated` 双阶段渲染模式。

### A.4 剥离验收（全绿门槛）
```bash
npm run test:routes && npm run build
# 本地 E2E
cd ../qa-inspector && QA_INTERACT=1 node scripts/run-qa.mjs http://localhost:3000
# 上线后生产巡检
QA_INTERACT=1 node scripts/run-qa.mjs https://<new-project>.vercel.app
```

### A.5 完成度锚点
- 完成度以第 6 节「交付前 Agent 自检协议」全绿为 **100% 生产就绪** 标准；达成后可声明 `Production Ready`。

---

# 附录 B：套娃 SOP（初始化新项目）

> 合并自原 `TEMPLATE.md`。用于「以 calorieAI 为模板初始化新项目 [X]」。

### B.1 一键套娃步骤

```bash
# 1) 复制通用架构（从本仓库）
#    复制: src/lib/i18n src/components/locale-init.tsx src/components/locale-switcher.tsx \
#          src/lib/billing-store.ts src/app/api/{stripe,paypal} src/app/api/v1/billing src/app/billing \
#          src/components/theme-provider.tsx scripts/ .githooks/ .ignore .gitignore \
#          PROJECT_SPEC.md MEMORY.md AGENTS.md(→并入本文件)

# 2) 重命名项目
#    package.json name; src/app/layout.tsx metadata; 字典 app_title

# 3) 启用质量门禁
git config core.hooksPath .githooks
npm run test:routes          # 路由检查
npm run build                # prebuild 自动跑 test:routes

# 4) 配置环境变量（复制 .env.example → .env.local 并填入密钥）

# 5) 绑定域名（Cloudflare + Vercel）
node scripts/bind-domain.mjs example.com --apply --project <new-project>

# 6) 部署后自动巡检（质检部门 ../qa-inspector）
cd ../qa-inspector && node scripts/run-qa.mjs https://<new-project>.vercel.app
```

### B.2 通用模块（必须复制）
- **国际化**：`src/lib/i18n/` + `locale-switcher.tsx`；接入点 `src/app/layout.tsx` 的 `<html lang>` 由 i18n 客户端同步。
- **收单/计费**：`billing-store.ts` + `stripe/` + `paypal/` + `v1/billing/` + `billing/` 结果页；未配密钥自动 mock 降级。
- **基础设施**：`theme-provider.tsx`、`check-routes.mjs`、`bind-domain.mjs`、`check-stripe-config.mjs`、`.githooks/`、`.ignore`、`.gitignore`。

### B.3 业务逻辑（新项目移除/替换）
| 模块 | 处理 |
|------|------|
| `src/app/page.tsx` 首页 | 保留框架，替换业务文案为 `t("key")`，移除 MOCK 数据 |
| `src/app/api/v1/{meals,stats,insight,ads,user}` | 按业务裁剪；保留 `billing/` |
| `src/lib/auth.tsx`、`oauthDetect.ts` | 按需替换 |
| `public/` 静态资源 | 替换品牌资产 |
| 文案字典 | 新增业务 key 到 `zh.json`/`en.json` |

### B.4 质量门禁约定
- `npm run test:routes`：拦截 `/api/api` 双重前缀、`${API}/api` 拼接、`//` 双斜杠、无对应 route 的 404 路径。
- `npm run build` 的 `prebuild` 自动执行 `test:routes`。
- `.githooks/pre-commit` 与 `pre-push` 强制运行，失败即拦截。
- 提交前：`npm run test:routes` → `npm run build` → `npm run test:api`，全绿再 commit/push。
- **E2E 巡检（质检部门）**：`cd ../qa-inspector && node scripts/run-qa.mjs <url>`；失败产物 `screenshots/` + `reports/`。

---

# 附录 C：扫描豁免清单

禁止深度索引：`node_modules`、`.next`、`out`、`dist`、`build`、`coverage`、`data`、`.git`、`.env.local*`（详见 `.ignore` / `.gitignore`）。
