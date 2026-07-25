# 🧠 CalorieAI — 项目记忆文件

> 本文件记录项目关键上下文，供后续开发参考。

---

## 🏗️ 项目架构

| 项目 | 技术栈 |
|---|---|
| **框架** | Next.js 16 (App Router) |
| **样式** | Tailwind CSS v4 |
| **语言** | TypeScript |
| **支付 (主)** | Stripe — 信用卡 / Apple Pay / Google Pay |
| **支付 (辅)** | PayPal SDK (`@paypal/react-paypal-js`) |
| **部署** | Vercel |

## 🚀 部署信息

- **GitHub 仓库**: [`winsentrobot008/calorieAI`](https://github.com/winsentrobot008/calorieAI)
- **托管平台**: Vercel
- **绑定方式**: Git 自动部署

## ✅ 已实现核心功能

| 功能 | 说明 |
|---|---|
| 🌗 **明暗主题切换** | 通过 [`ThemeProvider`](src/components/theme-provider.tsx) 实现亮色/暗色模式切换 |
| 🎤 **Edge-TTS 语音接口** | [`/api/tts`](src/app/api/tts/route.ts) 端点，含 Fallback Wave 逻辑 |
| 📊 **营养看板与历史记录** | 前端组件，展示营养数据与历史饮食记录 |
| 💳 **双渠道支付 (Stripe + PayPal)** | 用户可选信用卡或 PayPal 支付 |

### 💳 双渠道支付架构

| 组件 | 路径 | 说明 |
|---|---|---|
| **Stripe Checkout API** | [`/api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 创建 Stripe Checkout Session (主渠道) |
| **Stripe Webhook API** | [`/api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听 Stripe 支付事件 |
| **PayPal Create Order API** | [`/api/paypal/create-order`](src/app/api/paypal/create-order/route.ts) | 创建 PayPal 订单 (辅渠道) |
| **PayPal Capture Order API** | [`/api/paypal/capture-order`](src/app/api/paypal/capture-order/route.ts) | 捕获 PayPal 付款 |
| **前端订阅弹窗** | [`page.tsx (BillingModal)`](src/app/page.tsx#L423) | 方案选择 → 支付方式选择 (Stripe 主 / PayPal 辅) |
| **支付成功页** | [`/billing/success`](src/app/billing/success/page.tsx) | 支付完成回调页 |
| **支付取消页** | [`/billing/cancel`](src/app/billing/cancel/page.tsx) | 用户取消支付后的引导页 |

#### 支付流程

```
用户选择方案 (月付 $9.99 / 年付 $79.99 / 永久 $199)
       ↓
   选择支付方式
       ├── 💳 Stripe (主) → 跳转 Stripe Checkout 页面 → 支付 → 跳回
       └── 🅿️ PayPal (辅) → 内联 PayPalButtons 弹窗 → 支付 → 完成
```

#### 环境变量

| 变量 | 用途 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe 服务端密钥 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe 前端公钥 |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 签名密钥 |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | PayPal Client ID (前端) |
| `PAYPAL_CLIENT_SECRET` | PayPal 服务端密钥 |
| `PAYPAL_API_URL` | PayPal API 地址 (sandbox/live) |

**演示降级**: 未配置真实密钥时，自动显示模拟支付按钮，不影响开发调试。

## 📋 待办任务 (TODO)

- [x] **💳 双渠道支付 (Stripe + PayPal)** ✅
  - ✅ Stripe: Checkout Session API + Webhook
  - ✅ PayPal: Create Order + Capture Order API
  - ✅ 前端 BillingModal: 方案选择 → 支付方式选择 UI
  - ✅ 支付成功/取消页面
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
