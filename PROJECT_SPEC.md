# 📐 CalorieAI — 项目生产规格 (PROJECT_SPEC)

> **文档定位**：CalorieAI（`calorie-ai-seven.vercel.app`）的生产环境技术规格、SSR/Hydration 规范与交付自检协议。
> 本文件同时定义 CalorieAI 作为 **saas-factory-template（Master Template）** 的标准剥离指南。
>
> **完成度**：🟢 100% 生产就绪 (Production Ready) — 已通过 Vercel 线上实盘巡检。

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
| **模板属性** | **Master Template**（详见 §10 saas-factory-template 标准剥离指南） |

## 2. 核心架构

```
src/
├── app/
│   ├── layout.tsx            # Root Layout: ThemeProvider + LocaleInit + <html suppressHydrationWarning>
│   ├── page.tsx              # 主页面 (记录/看板/设置/TTS + 登录/Billing 弹窗 + Admin)
│   ├── billing/              # /billing/success + /billing/cancel 支付结果页
│   └── api/                  # stripe / paypal / v1/{meals,stats,insight,ads,user,billing,admin}
├── components/
│   ├── locale-init.tsx       # 挂载后应用首选语言（不参与首次 Hydrate）
│   ├── locale-switcher.tsx   # 语言切换器
│   └── theme-provider.tsx    # 明暗主题（挂载后读 localStorage）
└── lib/
    ├── i18n/                 # 零依赖 i18n: index.ts + zh.json + en.json
    ├── auth.tsx              # Auth 上下文（挂载后读 localStorage）
    ├── billing-store.ts      # 订阅持久化
    └── oauthDetect.ts        # OAuth 提供商检测
```

## 3. 🛡️ SSR / Hydration 规范（React #418 根因与防御）

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
| Stripe（主） | `/api/stripe/checkout` + `/api/stripe/webhook`；信用卡/支付宝/微信支付 |
| PayPal（辅） | `/api/paypal/create-order` + `/api/paypal/capture-order` |
| 订阅状态 | `/api/v1/billing/status` / `subscribe` / `license` / `ad-reward`；持久化 `data/subscriptions.json` |
| 降级 | 未配置真实密钥时前后端自动进入 **mock 演示模式** |

## 6. ✅ 交付前 Agent 自检协议

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

## 7. 🛡️ 边界隔离规则（AGI 工厂生产纪律）

1. **上下文定位**：工作区根为 `git008/projects/`；CalorieAI 代码/文档一律写入 `./calorieai/`。
2. **Git 隔离**：提交在 `./calorieai` 独立仓库内执行（`git -C calorieai …`），不得影响其他子文件夹。
3. **质检调度**：QA 巡检在 `./qa-inspector` 目录执行（协议识别已豁免 `blob:`/`data:` 等合法对象 URL）。

## 8. 质量门禁

| 门禁 | 位置 | 作用 |
|------|------|------|
| 路由/API 路径检查 | `scripts/check-routes.mjs` | 拦截 `/api/api`、双斜杠、字面量路径无对应 route（防 404） |
| pre-commit / pre-push | `.githooks/` | Commit/Push 前强制跑质量门，失败拦截 |
| 构建 | `next build`（prebuild） | TypeScript + 静态页面生成校验 |
| E2E 巡检 | `../qa-inspector` | console / pageerror / 4xx / 404 / requestfailed 全量拦截 |

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [`README.md`](README.md) | 项目使用手册（安装/环境变量/API/部署/QA 质检） |
| [`TEMPLATE.md`](TEMPLATE.md) | 以 CalorieAI 为模板初始化新项目的复制/裁剪清单 |
| [`AGENTS.md`](AGENTS.md) | Agent 开发指令与边界 |
| [`MEMORY.md`](MEMORY.md) | 项目记忆与上下文 |
| [`CLAUDE.md`](CLAUDE.md) | Claude 协作指引 |

---

## 10. saas-factory-template — 标准剥离指南

> CalorieAI 作为 **Master Template**，向新项目 [X] 剥离时遵循以下标准步骤与边界。

### 10.1 必须复制（通用架构）
- `src/lib/i18n/`（`index.ts` + `zh.json` + `en.json`）+ `src/components/locale-init.tsx` + `locale-switcher.tsx`
- `src/components/theme-provider.tsx`
- Billing：`src/lib/billing-store.ts` + `src/app/api/{stripe,paypal}` + `src/app/api/v1/billing/` + `src/app/billing/`
- 基建：`scripts/check-routes.mjs`、`scripts/bind-domain.mjs`、`.githooks/`、`.env.example`、`vercel.json`

### 10.2 必须改写（业务剥离）
- `src/app/page.tsx`：保留 Header/Tab/日志/弹窗框架，业务文案全部 `t("key")` 化，删除 CalorieAI 专属 MOCK 数据
- `src/app/api/v1/{meals,stats,insight,ads,user}`：按新业务裁剪；保留 `billing/`
- `src/lib/auth.tsx` / `oauthDetect.ts`：按需替换
- `zh.json` / `en.json`：新增业务 key
- `public/`：替换品牌资产

### 10.3 Hydration 规范继承
新项目必须继承 §3 的 Hydration 铁律：任何 `localStorage` / `navigator` / `sessionStorage` 读取仅允许发生在 `useEffect` / 事件回调中；首屏渲染必须与 SSR 输出一致；新增「读客户端状态」的 UI 一律采用 `mounted` / `hydrated` 双阶段渲染模式。

### 10.4 剥离验收（全绿门槛）
```bash
npm run test:routes && npm run build
# 本地 E2E
cd ../qa-inspector && QA_INTERACT=1 node scripts/run-qa.mjs http://localhost:3000
# 上线后生产巡检
QA_INTERACT=1 node scripts/run-qa.mjs https://<new-project>.vercel.app
```

### 10.5 完成度锚点
- 完成度以第 6 节「交付前 Agent 自检协议」全绿为 **100% 生产就绪** 标准；达成后可声明 `Production Ready`。
