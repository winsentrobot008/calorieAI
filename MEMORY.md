# 🧠 CalorieAI — 项目记忆文件

> 本文件记录项目关键上下文，供后续开发参考。

---

## 🏗️ 项目架构

| 项目 | 技术栈 |
|---|---|
| **框架** | Next.js 16 (App Router) |
| **样式** | Tailwind CSS v4 |
| **语言** | TypeScript |
| **支付** | Stripe (v22) |
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
| 💳 **Stripe 支付集成** | 完整的支付闭环 — Checkout Session + Webhook + 前端弹窗 |

### 💳 Stripe 支付架构

| 组件 | 路径 | 说明 |
|---|---|---|
| **Checkout API** | [`/api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 创建 Stripe Checkout Session，支持月付($9.99)/年付($79.99)/永久买断($199) |
| **Webhook API** | [`/api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听 `checkout.session.completed`、`subscription.updated/deleted`、`invoice.payment_*` 事件 |
| **前端订阅弹窗** | [`page.tsx (BillingModal)`](src/app/page.tsx#L423) | 方案选择 UI → 调用 Checkout API → 跳转 Stripe 支付页 |
| **支付成功页** | [`/billing/success`](src/app/billing/success/page.tsx) | 支付完成回调页，验证订阅状态 |
| **支付取消页** | [`/billing/cancel`](src/app/billing/cancel/page.tsx) | 用户取消支付后的引导页 |
| **环境变量** | [`.env.local`](.env.local) / [`.env.example`](.env.example) | `STRIPE_SECRET_KEY`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`STRIPE_WEBHOOK_SECRET` |

**演示降级**: 未配置真实 Stripe 密钥时，自动返回模拟成功响应，不影响开发调试。

## 📋 待办任务 (TODO)

- [x] **💳 完善 Stripe 支付收款流程** ✅
  - ✅ Checkout API 创建支付会话
  - ✅ Webhook 处理支付事件
  - ✅ 前端订阅弹窗对接 Stripe
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
