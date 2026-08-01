# 📐 CalorieAI — 项目生产规格 (PROJECT_SPEC)

> **文档定位**：CalorieAI（`calorie-ai-seven.vercel.app`）的生产环境技术规格与交付自检规范。
> 本文件固化 SSR/Hydration 规范、质量门禁与 Agent 交付协议，供所有后续迭代与巡检参照。

---

## 1. 项目概览

| 项 | 值 |
|----|----|
| **产品** | CalorieAI — AI 智能卡路里助手 |
| **生产地址** | `https://calorie-ai-seven.vercel.app` |
| **仓库** | `https://github.com/winsentrobot008/calorieAI`（`./calorieai` 独立 Git 仓库，分支 `main`） |
| **部署** | Vercel（Git 自动部署） |
| **框架** | Next.js 16.2.11 (App Router) + TypeScript + Tailwind CSS v4 |
| **模板属性** | 本仓库同时作为 SaaS 工厂**标准模板**（见 [`TEMPLATE.md`](TEMPLATE.md)） |

## 2. 核心架构

```
src/
├── app/
│   ├── layout.tsx            # Root Layout: ThemeProvider + LocaleInit + suppressHydrationWarning
│   ├── page.tsx              # 主页面 (记录/看板/设置/TTS + 登录/Billing 弹窗 + Admin)
│   ├── billing/              # /billing/success + /billing/cancel 支付结果页
│   └── api/                  # stripe / paypal / v1/{meals,stats,insight,ads,user,billing,admin}
├── components/
│   ├── locale-init.tsx       # 挂载后应用首选语言 (不参与首次 Hydrate)
│   ├── locale-switcher.tsx   # 语言切换器
│   └── theme-provider.tsx    # 明暗主题 (挂载后读 localStorage)
└── lib/
    ├── i18n/                 # 零依赖 i18n: index.ts + zh.json + en.json
    ├── auth.tsx              # Auth 上下文 (挂载后读 localStorage)
    ├── billing-store.ts      # 订阅持久化
    └── oauthDetect.ts        # OAuth 提供商检测
```

## 3. 🛡️ SSR / Hydration 规范（React #418 防护）

> 生产线上曾拦截 `Uncaught Error: Minified React error #418`（SSR 预渲染文本 ≠ 客户端首次 Hydrate DOM 文本）。
> 根因与规范如下，**任何新增 UI 必须遵守**：

### 3.1 根因（已修复，commit `3408c10`）
- **渲染期直接读取 `localStorage`** 导致 SSR 与客户端首次渲染结果不一致。
- 修复点（[`src/app/page.tsx`](src/app/page.tsx)）：
  - Header 登录按钮：由 `typeof window !== "undefined" ? localStorage.getItem("user_email")…` 改为 `mounted ? … : t("login_title")`，首次渲染固定与 SSR 一致，挂载后（`useEffect` 置 `mounted`）再读。
  - `LoginModal` 的退出登录块：由 `typeof window !== "undefined" && localStorage.getItem(...)` 改为 `hydrated && …`。

### 3.2 铁律（Hydration 规范）
1. **首次渲染必须与 SSR 输出完全一致**；任何 `localStorage` / `navigator` / `sessionStorage` 读取**只能**发生在 `useEffect` / 事件回调中。
2. **语言初始化**：i18n 模块初始固定为默认语言 `en`（与 SSR 一致）；`<LocaleInit />` 在客户端挂载后调用 `applyResolvedLocale()` 再切换到真实语言（localStorage > navigator > en），见 [`src/lib/i18n/index.ts`](src/lib/i18n/index.ts:67)。
3. `<html>` 已声明 `suppressHydrationWarning`（[`src/app/layout.tsx`](src/app/layout.tsx:30)），用于 `lang` 等属性在挂载后的合法变更。
4. 新增「读客户端状态」的 UI 一律采用 **mounted/hydrated 双阶段渲染**模式：
   ```tsx
   const [mounted, setMounted] = useState(false);
   useEffect(() => { setMounted(true); }, []);
   // 渲染时: mounted ? <客户端值> : <SSR 默认值>
   ```
5. 提交前必须跑 `npm run build`（含 TypeScript 校验）。

## 4. i18n 约定

- 解析优先级：`localStorage (calorieai_locale)` > `navigator.language` > 默认 `en`。
- 支持语言：`zh` / `en`；`navigator.language` 以 `zh` / `en` 前缀匹配，其余回退 `en`。
- 所有展示文案必须走 `t("key")` / `useT()`，禁止硬编码业务文案。
- 新增语言 key 需同时维护 `src/lib/i18n/zh.json` 与 `en.json`。

## 5. 支付 / Billing

| 渠道 | 说明 |
|------|------|
| Stripe（主） | `/api/stripe/checkout` + `/api/stripe/webhook`；信用卡/支付宝/微信支付 |
| PayPal（辅） | `/api/paypal/create-order` + `/api/paypal/capture-order` |
| 订阅状态 | `/api/v1/billing/status` / `subscribe` / `license` / `ad-reward`；持久化 `data/subscriptions.json` |
| 降级 | 未配置真实密钥时前后端自动进入 **mock 演示模式** |

## 6. ✅ 交付前 Agent 自检协议

生产变更（如 Hydration 修复）必须按此顺序执行：

```bash
# 0) 边界隔离：所有修改限定在 ./calorieai 内；Git 独立 commit/push，不得混入其他子文件夹
# 1) 静态检查 + 构建（prebuild 自动跑 test:routes）
npm run test:routes
npm run build

# 2) 在 ./calorieai 独立仓库内提交并推送（触发 Vercel 自动部署）
git add <files>
git commit -m "<描述>"
git push origin main

# 3) 等待 Vercel 部署完成（约 2–4 分钟），确认线上 200
curl -s -o nul -w "%{http_code}" https://calorie-ai-seven.vercel.app

# 4) 调起质检部门（../qa-inspector）对线上 URL 无头巡检
cd ../qa-inspector
QA_INTERACT=1 node scripts/run-qa.mjs https://calorie-ai-seven.vercel.app
# 断言: 0 Console Error / 0 Uncaught Error (#418) / 0 404 / 0 4xx

# 5) 已登录用户场景专项（复现 #418 触发路径，localStorage 预置 user_email）
TARGET_URL=https://calorie-ai-seven.vercel.app npx playwright test tests/hydration-logged-in.spec.ts
```

**全绿判定**：QA 巡检 `1 passed` 且无 `❌ 质检未通过` 输出，方视为交付完成。

## 7. 🛡️ 边界隔离规则（AGI 工厂生产纪律）

1. **上下文定位**：工作区根为 `git008/projects/`；CalorieAI 的代码与文档（含 `PROJECT_SPEC.md`/`README.md`）一律写入 `./calorieai/`。
2. **Git 隔离**：提交在 `./calorieai` 独立仓库内执行（`git -C calorieai …`），不得影响其他子文件夹。
3. **质检调度**：QA 巡检在 `./qa-inspector` 目录执行（质量守卫 `tests/qa-network.ts`；协议识别已豁免 `blob:`/`data:` 等合法对象 URL，避免误报）。

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
| [`README.md`](README.md) | 项目使用手册（安装/环境变量/API/部署） |
| [`TEMPLATE.md`](TEMPLATE.md) | 以 CalorieAI 为模板初始化新项目的复制/裁剪清单 |
| [`AGENTS.md`](AGENTS.md) | Agent 开发指令与边界 |
| [`MEMORY.md`](MEMORY.md) | 项目记忆与上下文 |
| [`CLAUDE.md`](CLAUDE.md) | Claude 协作指引 |
