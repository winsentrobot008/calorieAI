# CalorieAI — 智能卡路里助手

> AI 驱动的饮食记录与营养分析工具，支持多模态食物识别、智能趋势分析，以及 **Stripe（信用卡/支付宝/微信支付）+ PayPal** 多渠道支付订阅。

---

## 📋 目录

- [技术栈](#-技术栈)
- [支付架构](#-支付架构)
- [项目结构](#-项目结构)
- [快速开始](#-快速开始)
- [环境变量](#-环境变量)
- [API 概览](#-api-概览)
- [部署指引](#-部署指引)
- [相关文档](#-相关文档)

---

## 🏗️ 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | [Next.js 16](https://nextjs.org) (App Router) + Turbopack |
| **语言** | TypeScript |
| **样式** | Tailwind CSS v4 |
| **支付 (主)** | Stripe — 信用卡 / 支付宝 / 微信支付 |
| **支付 (辅)** | PayPal SDK (`@paypal/react-paypal-js`) |
| **AI 视觉** | Google Gemini Flash / OpenAI GPT-4o Vision |
| **TTS 语音** | Edge-TTS (Azure Cognitive Services) |
| **部署** | Vercel (Git 自动部署) |

---

## 💳 支付架构

### 多渠道支付网格

```
用户选择方案 (月付 $9.99 / 年付 $79.99 / 永久 $199)
       ↓
   选择支付方式
       ├── 💳 信用卡 (Stripe)     → Stripe Checkout 页面
       ├── 🔵 支付宝 (Stripe)     → Stripe Checkout 页面
       ├── 🟢 微信支付 (Stripe)   → Stripe Checkout 页面
       └── 🅿️ PayPal             → 内联 PayPal 弹窗
       ↓
   Webhook / API 回调
       ↓
   billing-store 持久化订阅 → data/subscriptions.json
```

### 组件映射

| 组件 | 路由 | 说明 |
|------|------|------|
| **Stripe Checkout API** | [`POST /api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 创建 Checkout Session，支持 `card` / `alipay` / `wechat_pay` |
| **Stripe Webhook API** | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听支付事件，持久化订阅状态 |
| **PayPal 创建订单** | [`POST /api/paypal/create-order`](src/app/api/paypal/create-order/route.ts) | 创建 PayPal 订单 |
| **PayPal 捕获订单** | [`POST /api/paypal/capture-order`](src/app/api/paypal/capture-order/route.ts) | 捕获 PayPal 付款 |
| **订阅状态查询** | [`GET /api/v1/billing/status`](src/app/api/v1/billing/status/route.ts) | 查询用户订阅状态 |
| **订阅激活** | [`POST /api/v1/billing/subscribe`](src/app/api/v1/billing/subscribe/route.ts) | PayPal 支付完成后手动激活 |
| **前端订阅弹窗** | [`src/app/page.tsx (BillingModal)`](src/app/page.tsx) | 方案选择 → 支付方式选择 UI |
| **支付成功页** | [`/billing/success`](src/app/billing/success/page.tsx) | 支付完成回调 |
| **支付取消页** | [`/billing/cancel`](src/app/billing/cancel/page.tsx) | 取消支付后引导 |

### 订阅状态持久化

Webhook 接收 Stripe 事件后，通过 [`billing-store`](src/lib/billing-store.ts) 写入 [`data/subscriptions.json`](data/subscriptions.json)：

| 事件 | 行为 |
|------|------|
| `checkout.session.completed` | 创建/激活订阅，设置到期时间 |
| `invoice.payment_succeeded` | 续费成功，延长有效期 |
| `customer.subscription.updated` | 同步订阅变更 |
| `customer.subscription.deleted` | 停用订阅 |
| `invoice.payment_failed` | 记录失败日志 |

**演示降级**: 未配置真实密钥时，自动显示模拟支付按钮，不影响本地开发调试。

---

## 📁 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── stripe/
│   │   │   ├── checkout/route.ts    # Stripe Checkout Session
│   │   │   └── webhook/route.ts     # Stripe Webhook 处理器
│   │   ├── paypal/
│   │   │   ├── create-order/route.ts
│   │   │   └── capture-order/route.ts
│   │   └── v1/
│   │       ├── billing/              # 订阅状态 & 管理
│   │       ├── meals/               # AI 食物识别
│   │       └── ...
│   ├── billing/                      # 支付结果页面
│   └── page.tsx                     # 主页面 (含 BillingModal)
├── components/
│   └── theme-provider.tsx           # 主题切换
└── lib/
    ├── billing-store.ts             # 订阅持久化存储
    ├── auth.tsx                     # 认证上下文
    └── i18n/                        # 国际化
scripts/
├── check-stripe-config.mjs          # Stripe 配置检测工具
└── test-stripe-e2e.mjs             # 支付全链路 E2E 测试
```

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入真实密钥

# 3. 启动开发服务器
npm run dev
# → http://localhost:3000
```

---

## 🔐 环境变量

| 变量 | 必填 | 用途 |
|------|------|------|
| `STRIPE_SECRET_KEY` | ✅ | Stripe 服务端密钥 (`sk_live_` / `sk_test_`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe 前端公钥 (`pk_live_` / `pk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe Webhook 签名密钥 (`whsec_`) |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | 可选 | PayPal Client ID |
| `PAYPAL_CLIENT_SECRET` | 可选 | PayPal 服务端密钥 |
| `PAYPAL_API_URL` | 可选 | PayPal API 地址 |
| `GEMINI_API_KEY` | 可选 | Google Gemini API 密钥 |
| `TTS_SUBSCRIPTION_KEY` | 可选 | Azure TTS 密钥 |
| `VITE_GOOGLE_CLIENT_ID` | 可选 | Google OAuth Client ID |

> ⚠️ **敏感信息**：`.env.local` 已通过 [`.gitignore`](.gitignore) 排除，严禁提交到版本控制。请参考 [`.env.example`](.env.example) 了解完整配置说明。

---

## 📡 API 概览

### 支付相关

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/stripe/checkout` | 创建 Stripe Checkout Session |
| `POST` | `/api/stripe/webhook` | Stripe Webhook 回调接收 |
| `POST` | `/api/paypal/create-order` | 创建 PayPal 订单 |
| `POST` | `/api/paypal/capture-order` | 捕获 PayPal 付款 |
| `GET` | `/api/v1/billing/status` | 查询订阅状态 |
| `POST` | `/api/v1/billing/subscribe` | 激活订阅 |

### 其他 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/meals/analyze-image` | AI 图片食物识别 |
| `POST` | `/api/v1/meals/analyze-text` | AI 文字食物识别 |
| `POST` | `/api/tts` | Edge-TTS 语音合成 |
| `POST` | `/api/v1/user/login` | 用户登录 |
| `POST` | `/api/v1/user/register` | 用户注册 |

---

## 🌐 部署指引

### 部署到 Vercel

1. 在 [Vercel](https://vercel.com) 中导入 GitHub 仓库
2. 在 Vercel Dashboard 中配置所有环境变量
3. 部署后，在 Stripe Dashboard 配置 Webhook → `https://你的域名/api/stripe/webhook`

### Webhook 配置

在 [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) 创建 Endpoint：

- **URL**: `https://你的域名/api/stripe/webhook`
- **事件订阅**:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- 获取 `whsec_` 签名密钥配置到 `STRIPE_WEBHOOK_SECRET`

### 配置验证

```bash
# 1. 运行配置检测
node scripts/check-stripe-config.mjs

# 2. 运行 E2E 全链路测试
node scripts/test-stripe-e2e.mjs
```

---

## 📖 相关文档

| 文档 | 说明 |
|------|------|
| [`AGENTS.md`](AGENTS.md) | Agent 开发指令与规范 |
| [`MEMORY.md`](MEMORY.md) | 项目记忆与上下文 |
| [`.env.example`](.env.example) | 环境变量配置参考 |
| [`scripts/check-stripe-config.mjs`](scripts/check-stripe-config.mjs) | Stripe 配置检测工具 |
| [`scripts/test-stripe-e2e.mjs`](scripts/test-stripe-e2e.mjs) | 支付全链路 E2E 测试 |
