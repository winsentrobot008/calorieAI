# CalorieAI — 基于 AI Vision 的卡路里识别与膳食管理 SaaS

> **CalorieAI** 是一款基于 AI Vision 的卡路里识别与膳食管理 SaaS：拍照即可识别食物、估算热量与三大营养素，并提供膳食趋势分析、语音合成播报、多渠道订阅付费与广告激励积分体系。
>
> **完成度**：🟢 100% 生产就绪 (Production Ready) — 已通过 Vercel 线上实盘巡检（`https://calorie-ai-seven.vercel.app`）

---

## 📋 目录

- [1. 产品概述与商业定位](#-1-产品概述与商业定位)
- [2. 商业变现基础设施](#-2-商业变现基础设施)
- [3. 数据库持久化架构 (DAL)](#-3-数据库持久化架构-dal)
- [4. 技术栈](#-4-技术栈)
- [5. 项目结构](#-5-项目结构)
- [6. 快速开始](#-6-快速开始)
- [7. 部署与环境变量配置指南](#-7-部署与环境变量配置指南)
- [8. API 概览](#-8-api-概览)
- [9. 开发、构建与质检命令](#-9-开发构建与质检命令)
- [10. 相关文档](#-10-相关文档)

---

## 🏷️ 1. 产品概述与商业定位

| 项 | 值 |
|----|----|
| **产品** | CalorieAI — AI 驱动的卡路里识别与膳食管理 SaaS |
| **核心能力** | AI 拍照识图（多模态视觉）→ 食物热量/蛋白/脂肪/碳水估算 → 膳食记录与趋势分析 |
| **生产地址** | `https://calorie-ai-seven.vercel.app` |
| **商业模型** | Freemium SaaS：免费用户每日 3 次识图 + 广告激励积分；Pro 订阅（月付/年付/永久买断）解锁无限识图与全部功能 |
| **变现渠道** | Stripe（信用卡/Apple Pay/Link/支付宝/微信支付）+ PayPal（微额支付兜底）双通道 |
| **授权体系** | 服务端权威积分 + Pro 权限，前端仅消费服务端 API 判定结果 |

### 核心用户旅程

```
拍照 / 上传食物图片
   ↓
A→B→C 视觉回退链识别 (Gemini → OpenRouter → DeepSeek)
   ↓
服务端鉴权: Pro? → 免费额度? → 积分余额?   （服务端权威）
   ↓
返回结构化食物记录 (food/grams/kcal/protein/fat/carbs)
   ↓
膳食趋势分析 + TTS 语音播报
```

---

## 💰 2. 商业变现基础设施

### 2.1 Stripe 真实支付全链路（主渠道）

Stripe Checkout 真实收款，支持：

- 💳 **国际信用卡 / 借记卡**（Visa / Mastercard / AMEX / JCB / UnionPay）
- 🍎 **Apple Pay**（Stripe Checkout 自动适配）
- 🔗 **Link**（Stripe 一键结账）
- 🔵🟢 **动态支付方式**：支付宝 (Alipay) / 微信支付 (WeChat Pay)

| 组件 | 路由 | 说明 |
|------|------|------|
| **创建 Checkout Session** | [`POST /api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 支持 `card` / `alipay` / `wechat_pay` 等支付方式 |
| **Webhook 回调** | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听支付/订阅事件并持久化 |

### 2.2 PayPal 商业通道（辅渠道 · 微额支付兜底）

已适配 **微额支付申请逻辑** 与 **兜底逻辑**：当 Stripe 不可用或用户选择 PayPal 时，以内联 PayPal 弹窗完成微额收款。

| 组件 | 路由 | 说明 |
|------|------|------|
| **创建订单** | [`POST /api/paypal/create-order`](src/app/api/paypal/create-order/route.ts) | 创建 PayPal 订单 |
| **捕获付款** | [`POST /api/paypal/capture-order`](src/app/api/paypal/capture-order/route.ts) | 捕获 PayPal 付款 |
| **手动激活** | [`POST /api/v1/billing/subscribe`](src/app/api/v1/billing/subscribe/route.ts) | PayPal 支付完成后激活订阅 |

### 2.3 服务端权威积分系统

积分交易与 **Pro 权限完全由服务端 API 掌控**，前端仅展示服务端返回结果，杜绝客户端篡改：

| 交易 | 规则 | 服务端入口 |
|------|------|-----------|
| 识图扣减 | **-1** 积分 / 次（免费额度用尽后） | [`POST /api/v1/user/credits`](src/app/api/v1/user/credits/route.ts) |
| 广告激励 | **+10** 积分 / 次广告观看 | [`POST /api/v1/billing/ad-reward`](src/app/api/v1/billing/ad-reward/route.ts) |
| 充值 / Pro 解锁 | 支付成功经 Webhook/回调自动记账 | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) + [`subscribe`](src/app/api/v1/billing/subscribe/route.ts) |
| 查询 | 返回 `credits` 与 `is_pro` | [`GET /api/v1/user/credits`](src/app/api/v1/user/credits/route.ts) |

核心记账函数（[`src/lib/db/index.ts`](src/lib/db/index.ts:136)）：

- `initCreditsIfMissing(userId, fallback=3)`：新用户初始化赠送 3 积分
- `addServerCredits(userId, delta)`：服务端增减积分（结果不低于 0），返回新余额

> 免费用户每日 3 次识图（`daily_free_uses: 3`），Pro 用户不受限；权限判定逻辑见 [`GET /api/v1/billing/status`](src/app/api/v1/billing/status/route.ts)。

---

## 🗄️ 3. 数据库持久化架构 (DAL)

### 3.1 DbAdapter 抽象层

统一数据库访问层位于 [`src/lib/db/`](src/lib/db/index.ts)，上层业务（订阅、支付、积分、识图日志、访问统计）**只依赖 `DbAdapter` 契约**，不感知底层存储实现。

[`src/lib/db/types.ts`](src/lib/db/types.ts:19) 定义统一接口，覆盖五类数据：

| 领域 | 方法 |
|------|------|
| **用户积分** | `getCredits` / `setCredits` |
| **Pro 订阅** | `getSubscription*` / `upsertSubscription` / `deactivateSubscription` / `getAllSubscriptions` |
| **支付流水** | `recordPayment` / `getPayments` |
| **识图日志** | `recordVisionLog` / `getVisionLogs` / `getAllVisionLogs` |
| **访问统计** | `recordVisit` / `getVisits` |

### 3.2 三套持久化机制（自动降级链）

[`src/lib/db/index.ts`](src/lib/db/index.ts:17) 的 `pickAdapter()` 按优先级自动选择：

```
1. POSTGRES_URL / DATABASE_URL      → Postgres 适配器（Vercel Postgres / Neon / Supabase）
2. KV_REST_API_URL + KV_REST_API_TOKEN → KV 适配器（Vercel KV / Upstash Redis）
3. 均未配置                         → 本地文件适配器（os.tmpdir 回退，仅本地/单实例调试）
```

| 适配器 | 实现 | 适用场景 |
|--------|------|---------|
| **Postgres** | [`src/lib/db/adapters/postgres.ts`](src/lib/db/adapters/postgres.ts) | 生产首选：强一致、可跨实例，`ON CONFLICT` upsert，建表自动初始化 |
| **KV / Redis** | [`src/lib/db/adapters/kv.ts`](src/lib/db/adapters/kv.ts) | 生产可选：Vercel KV / Upstash Redis，REST 协议，`calorieai:` key 前缀 |
| **本地文件** | [`src/lib/db/adapters/file.ts`](src/lib/db/adapters/file.ts) | 零配置降级：写入 `os.tmpdir()/calorieai-data` |

### 3.3 跨实例 / 跨设备数据永久保存

- **跨实例**：配置 Postgres 或 KV 后，所有 Vercel Lambda 实例读写同一存储，订阅、积分、流水**永久保存**且全局一致。
- **跨设备**：以 `user_id` 为唯一键，任意设备登录同一账号即读同一份数据（订阅、积分、历史记录）。

### 3.4 0-Token 运维机制

- 运维/监控数据（访问统计、识图日志、支付流水、模型调用延迟）**全部由自建 DAL 持久化**，不依赖付费第三方可观测服务，实现 **0 Token 成本运维**。
- 管理后台通过 [`/api/v1/admin/*`](src/app/api/v1/admin/overview/route.ts) 聚合输出：收入统计、识图健康度（错误率/延迟/按提供商聚合）、访问量、活跃订阅数。
- 本地未配置数据库时自动降级文件适配器，**开发阶段 0 云成本**。

---

## 🏗️ 4. 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | [Next.js 16](https://nextjs.org) (App Router) + Turbopack |
| **运行时** | React 19 + TypeScript |
| **样式与 UI** | Tailwind CSS v4 + Lucide Icons |
| **状态与 i18n** | 自定义 `LocaleInit` + `hydrated` 状态延迟加载（防 React #418） |
| **支付 (主)** | Stripe — 信用卡 / Apple Pay / Link / 支付宝 / 微信支付 |
| **支付 (辅)** | PayPal SDK (`@paypal/react-paypal-js`) — 微额支付兜底 |
| **AI 视觉** | A→B→C 回退链：Google Gemini Vision → OpenRouter → DeepSeek |
| **TTS 语音** | Edge-TTS (Azure Cognitive Services) |
| **持久化 (DAL)** | Postgres / Vercel KV (Redis) / 本地文件 三机制自动降级 |
| **部署与域名** | Vercel (Git 自动部署) + Cloudflare Wildcard DNS (`*.app008ai.com`) |

---

## 📁 5. 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── stripe/checkout+webhook      # Stripe 全链路
│   │   ├── paypal/create-order+capture  # PayPal 兜底通道
│   │   └── v1/
│   │       ├── meals/analyze-image      # A→B→C 视觉识别（服务端鉴权）
│   │       ├── meals/analyze-text       # 文字识餐
│   │       ├── user/credits             # 积分查询/增减（服务端权威）
│   │       ├── billing/{status,subscribe,license,ad-reward}  # 订阅+广告激励
│   │       ├── admin/{overview,revenue,users,logs,model-monitor}  # 0-Token 运维后台
│   │       ├── stats/ + insight/        # 趋势分析与建议
│   │       └── tts/                     # Edge-TTS 语音合成
│   ├── billing/                         # /billing/success + /billing/cancel
│   └── page.tsx                         # 主页面（记录/看板/设置/登录/Billing/Admin）
├── components/                          # theme-provider / locale-init / locale-switcher
└── lib/
    ├── db/                              # ⭐ DAL 抽象层（index/types + adapters/{file,kv,postgres}）
    ├── billing-store.ts                 # 订阅状态持久化
    ├── credits-store.ts                 # 积分本地文件回退实现
    ├── analytics-store.ts               # 访问统计
    ├── vision-log-store.ts              # 识图日志
    └── i18n/                            # 零依赖 i18n (zh/en)
scripts/
├── check-routes.mjs                     # 路由/API 路径静态校验
├── smoke-api.mjs                        # API 冒烟测试
├── check-stripe-config.mjs              # Stripe 配置检测
└── test-stripe-e2e.mjs                  # 支付全链路 E2E
```

---

## 🚀 6. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 .env.example）
cp .env.example .env.local
# 编辑 .env.local 填入真实密钥

# 3. 启动开发服务器
npm run dev
# → http://localhost:3000
```

> ⚠️ **敏感信息**：[`.env.local`](.env.example) 已通过 [`.gitignore`](.gitignore) 排除，严禁提交到版本控制。未配置真实密钥时应用以 **降级/演示模式** 运行（支付显示 Mock、识图返回明确错误、TTS 返回正弦波音频）。

---

## 🔐 7. 部署与环境变量配置指南

### 7.1 环境变量一览

| 变量 | 必填 | 用途 |
|------|------|------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe 前端公钥 (`pk_live_` / `pk_test_`) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe 服务端密钥 (`sk_live_` / `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | 生产✅ | Stripe Webhook 签名密钥 (`whsec_`) |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | 可选 | PayPal Client ID（辅渠道） |
| `PAYPAL_CLIENT_SECRET` | 可选 | PayPal 服务端密钥 |
| `PAYPAL_API_URL` | 可选 | PayPal API 地址（Sandbox/Live） |
| `GEMINI_API_KEY` | 推荐 | Gemini Vision 密钥（A 提供商） |
| `OPENROUTER_API_KEY` | 可选 | OpenRouter 密钥（B 提供商） |
| `DEEPSEEK_API_KEY` | 可选 | DeepSeek 密钥（C 提供商） |
| `KV_REST_API_URL` | 可选 | Vercel KV / Upstash Redis REST 地址 |
| `KV_REST_API_TOKEN` | 可选 | Vercel KV / Upstash Redis REST Token |
| `REDIS_URL` | 可选 | 标准 Redis 连接串（KV 备选） |
| `POSTGRES_URL` | 可选 | Postgres 连接串（Vercel Postgres / Neon / Supabase） |
| `NEXT_PUBLIC_APP_URL` | 可选 | 前端站点绝对地址（用于 Webhook/回调与链接生成） |
| `TTS_SUBSCRIPTION_KEY` | 可选 | Azure TTS 密钥 |
| `VITE_GOOGLE_CLIENT_ID` | 可选 | Google OAuth Client ID |

### 7.2 部署到 Vercel

1. 在 [Vercel](https://vercel.com) 中导入 GitHub 仓库 `winsentrobot008/calorieAI`（main 分支自动部署）
2. 在 **Vercel Dashboard → Settings → Environment Variables** 配置上表变量（生产环境勾选 **Production**）
3. 部署后，在 Stripe Dashboard 配置 Webhook → `https://你的域名/api/stripe/webhook`

### 7.3 Webhook 配置（Stripe）

在 [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) 创建 Endpoint：

- **URL**: `https://你的域名/api/stripe/webhook`
- **事件订阅**:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- 获取 `whsec_` 签名密钥配置到 `STRIPE_WEBHOOK_SECRET`

### 7.4 配置验证

```bash
# 1. 运行配置检测
node scripts/check-stripe-config.mjs

# 2. 运行支付全链路 E2E
node scripts/test-stripe-e2e.mjs
```

---

## 📡 8. API 概览

### 支付与订阅

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/stripe/checkout` | 创建 Stripe Checkout Session |
| `POST` | `/api/stripe/webhook` | Stripe Webhook 回调接收 |
| `POST` | `/api/paypal/create-order` | 创建 PayPal 订单 |
| `POST` | `/api/paypal/capture-order` | 捕获 PayPal 付款 |
| `GET` | `/api/v1/billing/status` | 查询订阅状态 / 免费额度 / Pro 权限 |
| `POST` | `/api/v1/billing/subscribe` | 激活订阅 |
| `POST` | `/api/v1/billing/license` | 永久买断激活 |
| `POST` | `/api/v1/billing/ad-reward` | 广告观看 +10 积分 |

### 识餐与积分

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/meals/analyze-image` | AI 图片食物识别（A→B→C 回退链） |
| `POST` | `/api/v1/meals/analyze-text` | AI 文字食物识别 |
| `GET/POST` | `/api/v1/user/credits` | 积分查询 / 服务端增减（识图 -1） |
| `GET/POST` | `/api/v1/user/login|register` | 用户登录 / 注册 |

### 0-Token 运维后台

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/admin/overview` | 核心指标总览 |
| `GET` | `/api/v1/admin/revenue` | 收入统计（订阅/买断/方案拆分） |
| `GET` | `/api/v1/admin/users` | 用户与订阅列表 |
| `GET` | `/api/v1/admin/logs` | 识图日志 |
| `GET` | `/api/v1/admin/model-monitor` | AI 模型健康度（错误率/延迟/提供商） |

---

## 🛠️ 9. 开发、构建与质检命令

```bash
# ── 开发 ──
npm run dev              # 启动开发服务器 (http://localhost:3000)

# ── 构建 ──
npm run test:routes      # 路由/API 路径静态校验
npm run build            # 生产构建（prebuild 自动跑 test:routes + TypeScript 校验）

# ── 单元 / 冒烟 ──
npm run test:api         # 动态 API 冒烟（启动服务逐个请求 /api 路由，断言 0 404）
npm test                 # = test:routes + test:api

# ── 官方 QA 回归（0 Token 成本 · 线上静默 E2E 巡检）──
# 用法: python scripts/qa_inspect.py --url <DEPLOYED_URL>
python scripts/qa_inspect.py --url https://calorie-ai-seven.vercel.app
# 退出码 0 = 全部通过（0 Console Error / 0 Network Error≥400）；报告写入 qa_delivery/reports/latest.md
```

> **QA 质检说明**：官方回归命令为 `python scripts/qa_inspect.py --url <DEPLOYED_URL>`，由 Playwright 无头巡检断言 **0 Console Error / 0 Uncaught Error (#418) / 0 4xx**，并生成截图与 `latest.md` 报告，全程 **0 Token 成本**。

---

## 📚 10. 相关文档

| 文档 | 说明 |
|------|------|
| [`PROJECT_SPEC.md`](PROJECT_SPEC.md) | **生产规格**：核心架构、SSR/Hydration 防护守则、Agent 行为守则、边界隔离、质量门禁 + 套娃 SOP |
| [`MEMORY.md`](MEMORY.md) | **项目记忆**：技术栈/目录/规范 + 历史 Bug 自愈履历与关键决策记录 |
| [`.env.example`](.env.example) | 环境变量配置参考（Stripe / PayPal / AI / DAL / OAuth） |
| [`scripts/check-stripe-config.mjs`](scripts/check-stripe-config.mjs) | Stripe 配置检测工具 |
| [`scripts/test-stripe-e2e.mjs`](scripts/test-stripe-e2e.mjs) | 支付全链路 E2E 测试 |
