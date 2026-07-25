# 🧠 CalorieAI — 项目记忆文件

> 本文件记录项目关键上下文，供后续开发参考。

---

## 🏗️ 项目架构

| 项目 | 技术栈 |
|---|---|
| **框架** | Next.js 16 (App Router) + Turbopack |
| **样式** | Tailwind CSS v4 |
| **语言** | TypeScript |
| **支付 (主)** | Stripe — 信用卡 / 支付宝 / 微信支付 |
| **支付 (辅)** | PayPal SDK (`@paypal/react-paypal-js`) |
| **AI 视觉** | Google Gemini Flash / OpenAI GPT-4o Vision |
| **TTS 语音** | Edge-TTS (Azure Cognitive Services) |
| **部署** | Vercel |

## 🚀 部署信息

- **GitHub 仓库**: [`winsentrobot008/calorieAI`](https://github.com/winsentrobot008/calorieAI)
- **托管平台**: Vercel
- **绑定方式**: Git 自动部署
- **Stripe 模式**: Live 生产环境

## ✅ 已实现核心功能

| 功能 | 说明 |
|---|---|
| 🌗 **明暗主题切换** | 通过 [`ThemeProvider`](src/components/theme-provider.tsx) 实现 |
| 🎤 **Edge-TTS 语音接口** | [`/api/tts`](src/app/api/tts/route.ts) 端点，含 Fallback Wave 逻辑 |
| 📊 **营养看板与趋势图表** | 卡路里环形图、营养明细、7 日趋势、AI 饮食建议 |
| 💳 **多渠道支付网格** | Stripe (信用卡/支付宝/微信支付) + PayPal |
| 📦 **订阅状态持久化** | Webhook → [`billing-store`](src/lib/billing-store.ts) → `data/subscriptions.json` |

### 💳 多渠道支付架构

| 组件 | 路径 | 说明 |
|---|---|---|
| **Stripe Checkout API** | [`POST /api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 创建 Checkout Session，支持 card/alipay/wechat_pay |
| **Stripe Webhook API** | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听支付事件并持久化订阅 |
| **PayPal 创建订单** | [`POST /api/paypal/create-order`](src/app/api/paypal/create-order/route.ts) | 创建 PayPal 订单 |
| **PayPal 捕获订单** | [`POST /api/paypal/capture-order`](src/app/api/paypal/capture-order/route.ts) | 捕获 PayPal 付款 |
| **订阅状态查询** | [`GET /api/v1/billing/status`](src/app/api/v1/billing/status/route.ts) | 返回 is_premium / is_permanent / 到期时间 |
| **订阅激活** | [`POST /api/v1/billing/subscribe`](src/app/api/v1/billing/subscribe/route.ts) | PayPal 完成后手动激活 |
| **前端订阅弹窗** | [`page.tsx (BillingModal)`](src/app/page.tsx) | 2×2 支付方式网格选择 UI |
| **支付成功页** | [`/billing/success`](src/app/billing/success/page.tsx) | 支付完成回调页 |
| **支付取消页** | [`/billing/cancel`](src/app/billing/cancel/page.tsx) | 用户取消支付后的引导页 |
| **订阅持久化** | [`src/lib/billing-store.ts`](src/lib/billing-store.ts) | JSON 文件存储，支持 CRUD 操作 |

#### 支付流程

```
用户选择方案 (月付 $9.99 / 年付 $79.99 / 永久 $199)
       ↓
   选择支付方式
       ├── 💳 信用卡 (Stripe)   → Stripe Checkout 页面 → webhook → billing-store
       ├── 🔵 支付宝 (Stripe)   → Stripe Checkout 页面 → webhook → billing-store
       ├── 🟢 微信支付 (Stripe) → Stripe Checkout 页面 → webhook → billing-store
       └── 🅿️ PayPal           → 内联 PayPalButtons → capture → subscribe API → billing-store
```

#### Webhook 事件处理

| 事件 | 行为 |
|------|------|
| `checkout.session.completed` | 创建/激活订阅，计算到期时间 (月/年/2099) |
| `invoice.payment_succeeded` | 续费成功，延长有效期 |
| `customer.subscription.updated` | 同步订阅变更 (方案/状态) |
| `customer.subscription.deleted` | 停用订阅 (is_active = false) |
| `invoice.payment_failed` | 记录告警日志 |

#### 环境变量 (Live 生产环境)

| 变量 | 状态 | 值 |
|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ 已配置 | `sk_live_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ 已配置 | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | ✅ 已配置 | `whsec_...` |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | ⬜ 待配置 | - |
| `PAYPAL_CLIENT_SECRET` | ⬜ 待配置 | - |

**演示降级**: 未配置真实密钥时，自动显示模拟支付按钮，不影响开发调试。

## 🛠️ 开发工具

| 工具 | 路径 | 说明 |
|------|------|------|
| 配置检测 | [`scripts/check-stripe-config.mjs`](scripts/check-stripe-config.mjs) | 环境变量 + 代码配置全检测 |
| E2E 测试 | [`scripts/test-stripe-e2e.mjs`](scripts/test-stripe-e2e.mjs) | 13 个全链路测试场景 |

## 📋 待办任务 (TODO)

- [x] **💳 多渠道支付 (Stripe + PayPal)** ✅
  - ✅ Stripe: 信用卡 / 支付宝 / 微信支付 (Checkout Session)
  - ✅ PayPal: Create Order + Capture Order API
  - ✅ Webhook 事件监听 + billing-store 持久化
  - ✅ 前端 BillingModal: 2×2 支付网格 UI
  - ✅ 支付成功/取消页面
  - ✅ E2E 自动化测试 (13/13)
- [ ] **👁️ 调试视觉识图 (Vision API) 端到端真实调用**
  - 验证 [`meals/analyze-image`](src/app/api/v1/meals/analyze-image/route.ts) 的真实 Vision API 调用链路
  - 确认图片上传 → 模型分析 → 结果返回的完整端到端流程
  - 处理超时、限流与错误降级
- [ ] **🔐 校验 Admin 后端控制面板与权限闭环**
  - 检查 [`admin/`](src/app/api/v1/admin/) 各路由的鉴权中间件
  - 验证管理员登录 → 权限校验 → 接口响应的闭环流程
  - 确认 Revenue / Users / Config / Logs 等面板数据的准确性

---

*最后更新: 2026-07-25*
