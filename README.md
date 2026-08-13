# CalorieAI — SaaS Starter Matrix Template（SaaS 套娃矩阵标准模版）

> **定位**：本仓库是 **SaaS Starter Matrix Template（SaaS 套娃矩阵标准模版）**——一个可 **10 分钟快速克隆**出同构 AI SaaS 应用（PetAI、PlantAI、FitAI…）的生产级 Next.js 模板；**CalorieAI（AI 卡路里识别）** 是本模版的**参考实现**。
>
> **完成度**：🟢 100% 生产就绪 — 已通过 Vercel 线上实盘巡检（`https://calorie-ai-seven.vercel.app`）
>
> **核心规范**：**代码层面零 Key** — 所有敏感密钥统一由 `process.env.*` 读取，源码中禁止任何硬编码。

| 模版特性 | 说明 |
|----------|------|
| ⚡ 10 分钟克隆 | 复制目录 → 全局重命名 → 配 `.env.local` → 导入 Vercel 一键构建上线 |
| 🔐 代码层面零 Key | 26 个密钥/配置项全部经 `process.env.*` 注入，源码零硬编码（含审计命令） |
| 🧬 套娃矩阵 | 同一套 AI/Pay/DAL/Admin 骨架克隆出 PetAI / PlantAI / FitAI 等矩阵产品 |
| 💳 双支付流水线 | Stripe（主）+ PayPal（兜底）全链路，统一测试价 $1.00 |
| 🗄️ 独立 DAL | Postgres / Vercel KV / 本地文件三适配器自动降级，跨实例一致 |
| 🛰️ Central Gateway Ready | 内置网关 SDK 与环境门控接入，可无缝对接中央 API 代理网关集中管 Key |

---

## 📋 目录

- [1. 模版定位与标准化规范](#-1-模版定位与标准化规范)
- [2. 一键克隆与部署 SOP（10 分钟）](#-2-一键克隆与部署-sop10-分钟)
- [3. 参考实现：CalorieAI 产品与商业定位](#-3-参考实现calorieai-产品与商业定位)
- [4. 商业变现基础设施](#-4-商业变现基础设施)
- [5. 数据库持久化架构 (DAL)](#-5-数据库持久化架构-dal)
- [6. 技术栈](#-6-技术栈)
- [7. 项目结构](#-7-项目结构)
- [8. 快速开始](#-8-快速开始)
- [9. 部署与环境变量配置指南](#-9-部署与环境变量配置指南)
- [10. API 概览](#-10-api-概览)
- [11. 开发、构建与质检命令](#-11-开发构建与质检命令)
- [12. 架构演进：Central Gateway 路线图](#-12-架构演进central-gateway-路线图)
- [13. 相关文档](#-13-相关文档)

---

## 🧩 1. 模版定位与标准化规范

### 1.1 适用场景

- 需要快速产出**同构 AI SaaS 矩阵**（拍照识别 / 内容分析 / 积分充值变现）的产品线；
- 新应用（如 PetAI、PlantAI）只需**换 Prompt、换品牌、换 UI 文案**，支付、积分、DAL、Admin、质检全部复用；
- 同一套代码保持“**零 Key 安全 + 服务端权威 + 可移植部署**”三项硬规范。

### 1.2 三项标准化规范

| 规范 | 要求 | 落地方式 |
|------|------|---------|
| **代码层面零 Key** | 敏感密钥（Stripe/PayPal、Gemini/OpenRouter/DeepSeek、KV/Postgres）一律 `process.env.*` 读取，禁止硬编码 | 全部路由/适配器经 `process.env.X` 注入；`.env.example` 为唯一变量清单 |
| **服务端权威** | 积分、Pro 权限、支付流水由服务端 DAL 判定，前端只消费 API 结果 | `POST /api/v1/user/credits`、`billing/status`、`recordPayment` 统一收口 |
| **可移植部署** | 克隆后导入 Vercel 即可 1 分钟构建上线 | `vercel.json` 显式声明 framework / build / install；`next build` 内置路由门禁 |

### 1.3 零 Key 审计命令（提交前必跑）

```bash
# 应无任何匹配（exit 1 = 通过），本仓库已通过审计
rg -n "sk_live_|sk_test_|pk_live_|pk_test_|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{16,}" src scripts next.config.ts vercel.json

# 列出当前代码读取的全部环境变量（共 26 个，见 §9.1）
rg -o "process\.env\.[A-Z_]+" src | sort -u
```

> ⚠️ `.env.local` 已通过 `.gitignore` 排除，严禁提交到版本控制。

---

## 🚀 2. 一键克隆与部署 SOP（10 分钟）

| # | 步骤 | 命令 / 说明 |
|---|------|------------|
| 1 | 复制模版 | `cp -r products/calorieai products/petai`（或 Clone 仓库后改目录名） |
| 2 | 全局重命名 | 将 `calorieai → petai`、`CalorieAI → PetAI`、`app_id=calorieai → petai`（路由、i18n、品牌文案按需调整） |
| 3 | 配置密钥 | `cp .env.example .env.local` 填入最小必填集：`GEMINI_API_KEY` + Stripe 双 Key；推荐加 `POSTGRES_URL`（见 §9.1） |
| 4 | 本地门禁 | `npm install && npm run build`（prebuild 自动跑 `test:routes` + TypeScript） |
| 5 | 一键上线 | Vercel → New Project → Import Git Repo；`vercel.json` 已声明 `framework: "nextjs"`，导入后 **Deploy 即可 1 分钟构建上线**；在 Dashboard 配置 Environment Variables |
| 6 | 支付 Webhook | Stripe Dashboard 配置 Webhook → `https://你的域名/api/stripe/webhook`（事件清单见 §9.3） |
| 7 | （可选）接中央网关 | 配置 `GATEWAY_BASE_URL + GATEWAY_APP_KEY`，识图/积分自动经中央网关（见 §12） |

---

### 2.2 1-Step App Clone 标准 SOP（10 秒挂载全套积分与收银台）

克隆后只需网关注册 + 两项环境变量，即获得全套跨端积分与统一收银台（**One-Time Checkout，无订阅**）：

1. **网关注册**：在 `GATEWAY_APP_TOKENS` 追加一行 `"petai":"tok_petai_xxx"`（约 10 秒）；
2. **客户端配置**：`.env.local` 写入 `GATEWAY_BASE_URL` + `GATEWAY_APP_TOKEN` 两项；
3. **自动挂载**：`gateway-client.ts` SDK 即接管跨端积分（`credits`）、统一收银（`billing/checkout`）与统一识图（`ai/vision`）；
4. **集中改价**：后续积分包/价格调整只在网关改一处，50+ 套娃应用秒级同步，无需逐仓发版。

---

## 🏷️ 3. 参考实现：CalorieAI 产品与商业定位

| 项 | 值 |
|----|----|
| **产品** | CalorieAI — AI 驱动的卡路里识别与膳食管理 SaaS（本模版的参考实现） |
| **核心能力** | AI 拍照识图（多模态视觉）→ 食物热量/蛋白/脂肪/碳水估算 → 膳食记录与趋势分析 |
| **生产地址** | `https://calorie-ai-seven.vercel.app` |
| **商业模型** | 三支柱变现（均一次性/非自动续费）：**💰 Credits Top-up 积分充值（按次付费）+ 🎬 看广告领积分（Free Tier）+ 🃏 终身买断卡（Lifetime Access）**；彻底弃用按月/按年订阅（Subscription Traps） |
| **变现渠道** | Stripe（信用卡/Apple Pay/Link/支付宝/微信支付）+ PayPal（微额支付兜底）双通道 |
| **授权体系** | 服务端权威积分（+ 终身买断卡一次性授权），前端仅消费服务端 API 判定结果 |

### 核心用户旅程

```
拍照 / 上传食物图片
   ↓
A→B→C 视觉回退链识别 (Gemini → OpenRouter → DeepSeek)
   ↓
服务端鉴权: 免费额度? → 积分余额?   （服务端权威 · 1 积分/次）
   ↓
返回结构化食物记录 (food/grams/kcal/protein/fat/carbs)
   ↓
膳食趋势分析 + TTS 语音播报
```

---

## 💰 4. 商业变现基础设施

### 4.1 Stripe 真实支付全链路（主渠道）

Stripe Checkout 真实收款，支持：

- 💳 **国际信用卡 / 借记卡**（Visa / Mastercard / AMEX / JCB / UnionPay）
- 🍎 **Apple Pay**（Stripe Checkout 自动适配）
- 🔗 **Link**（Stripe 一键结账）
- 🔵🟢 **动态支付方式**：支付宝 (Alipay) / 微信支付 (WeChat Pay)

| 组件 | 路由 | 说明 |
|------|------|------|
| **创建 Checkout Session** | [`POST /api/stripe/checkout`](src/app/api/stripe/checkout/route.ts) | 双 Key 校验（`STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`），缺 Key 友好降级 Mock |
| **Webhook 回调** | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) | 监听 `checkout.session.completed` 一次性付款，按积分包发放积分并记账 |

### 4.2 PayPal 商业通道（辅渠道 · 微额支付兜底）

当 Stripe 不可用或用户选择 PayPal 时，以内联 PayPal 弹窗完成微额收款。

| 组件 | 路由 | 说明 |
|------|------|------|
| **创建订单** | [`POST /api/paypal/create-order`](src/app/api/paypal/create-order/route.ts) | 按积分包创建 PayPal 订单（10/50/120 积分） |
| **捕获付款** | [`POST /api/paypal/capture-order`](src/app/api/paypal/capture-order/route.ts) | 捕获成功后服务端直接发放积分包并记录流水 |

### 4.3 服务端权威积分系统

积分交易完全由 **服务端 API 权威记账**，前端仅展示服务端返回结果，杜绝客户端篡改：

| 交易 | 规则 | 服务端入口 |
|------|------|-----------|
| 识图扣减 | **-1** 积分 / 次 | [`POST /api/v1/user/credits`](src/app/api/v1/user/credits/route.ts) |
| 广告激励 | **+10** 积分 / 次广告观看 | [`POST /api/v1/billing/ad-reward`](src/app/api/v1/billing/ad-reward/route.ts) |
| 积分包充值 | 一次性付款按包到账（10/50/120 积分） | [`POST /api/stripe/webhook`](src/app/api/stripe/webhook/route.ts) + [`capture-order`](src/app/api/paypal/capture-order/route.ts) |
| 查询 | 返回 `credits` 与 `is_pro` | [`GET /api/v1/user/credits`](src/app/api/v1/user/credits/route.ts) |

核心记账函数（[`src/lib/db/index.ts`](src/lib/db/index.ts:136)）：

- `initCreditsIfMissing(userId, fallback=3)`：新用户初始化赠送 3 积分
- `addServerCredits(userId, delta)`：服务端增减积分（结果不低于 0），返回新余额

> 免费用户每日 3 次识图（`daily_free_uses: 3`）；积分余额充足即可连续识图（**1 积分/次**），可购买积分包或看广告获取积分；终身买断卡用户不受限。权限判定见 [`GET /api/v1/billing/status`](src/app/api/v1/billing/status/route.ts)。

---

## 🗄️ 5. 数据库持久化架构 (DAL)

### 5.1 DbAdapter 抽象层

统一数据库访问层位于 [`src/lib/db/`](src/lib/db/index.ts)，上层业务（订阅、支付、积分、识图日志、访问统计）**只依赖 `DbAdapter` 契约**，不感知底层存储实现。

[`src/lib/db/types.ts`](src/lib/db/types.ts:19) 定义统一接口，覆盖五类数据：

| 领域 | 方法 |
|------|------|
| **用户积分** | `getCredits` / `setCredits` |
| **授权记录** | `getSubscription*` / `upsertSubscription` / `deactivateSubscription` / `getAllSubscriptions`（终身买断卡 / 旧订阅兼容） |
| **支付流水** | `recordPayment` / `getPayments` |
| **识图日志** | `recordVisionLog` / `getVisionLogs` / `getAllVisionLogs` |
| **访问统计** | `recordVisit` / `getVisits` |

### 5.2 三套持久化机制（自动降级链）

[`src/lib/db/index.ts`](src/lib/db/index.ts:17) 的 `pickAdapter()` 按优先级自动选择：

```
1. POSTGRES_URL / DATABASE_URL        → Postgres 适配器（Vercel Postgres / Neon / Supabase）
2. KV_REST_API_URL + KV_REST_API_TOKEN → KV 适配器（Vercel KV / Upstash Redis）
3. 均未配置                           → 本地文件适配器（os.tmpdir 回退，仅本地/单实例调试）
```

| 适配器 | 实现 | 适用场景 |
|--------|------|---------|
| **Postgres** | [`src/lib/db/adapters/postgres.ts`](src/lib/db/adapters/postgres.ts) | 生产首选：强一致、可跨实例，`ON CONFLICT` upsert，建表自动初始化 |
| **KV / Redis** | [`src/lib/db/adapters/kv.ts`](src/lib/db/adapters/kv.ts) | 生产可选：Vercel KV / Upstash Redis，REST 协议，`calorieai:` key 前缀 |
| **本地文件** | [`src/lib/db/adapters/file.ts`](src/lib/db/adapters/file.ts) | 零配置降级：写入 `os.tmpdir()/calorieai-data` |

### 5.3 跨实例 / 跨设备数据永久保存

- **跨实例**：配置 Postgres 或 KV 后，所有 Vercel Lambda 实例读写同一存储，订阅、积分、流水**永久保存**且全局一致。
- **跨设备**：以 `user_id` 为唯一键，任意设备登录同一账号即读同一份数据。

### 5.4 0-Token 运维机制

- 运维/监控数据（访问统计、识图日志、支付流水、模型调用延迟）**全部由自建 DAL 持久化**，不依赖付费第三方可观测服务，实现 **0 Token 成本运维**。
- 管理后台通过 [`/api/v1/admin/*`](src/app/api/v1/admin/overview/route.ts) 聚合输出：收入统计、识图健康度、访问量、授权/流水统计（`x-admin-token` 鉴权）。

---

## 🏗️ 6. 技术栈

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
| **中央网关** | [`projects/central-gateway`](../../projects/central-gateway/README.md) SDK 接入示例（`src/lib/gateway-client.ts`） |
| **部署与域名** | Vercel (Git 自动部署) + Cloudflare Wildcard DNS (`*.app008ai.com`) |

---

## 📁 7. 项目结构

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
│   │       ├── billing/{status,subscribe,license,ad-reward}  # 积分/授权+广告激励（subscribe/license 已停用 410）
│   │       ├── admin/{overview,revenue,users,logs,model-monitor}  # 0-Token 运维后台
│   │       ├── stats/ + insight/        # 趋势分析与建议
│   │       └── tts/                     # Edge-TTS 语音合成
│   ├── billing/                         # /billing/success + /billing/cancel
│   └── page.tsx                         # 主页面（记录/看板/设置/登录/Billing/Admin）
├── components/                          # theme-provider / locale-init / locale-switcher
└── lib/
    ├── db/                              # ⭐ DAL 抽象层（index/types + adapters/{file,kv,postgres}）
    ├── gateway-client.ts                # ⭐ Central Gateway SDK（vision/checkout/credits）
    ├── billing-store.ts                 # 支付流水/授权（终身买断卡、旧订阅兼容）持久化
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

## ⚡ 8. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 .env.example 完整清单，§9.1）
cp .env.example .env.local
# 编辑 .env.local 填入真实密钥

# 3. 启动开发服务器
npm run dev
# → http://localhost:3000
```

> ⚠️ **敏感信息**：`.env.local` 已通过 [`.gitignore`](.gitignore) 排除，严禁提交到版本控制。未配置真实密钥时应用以 **降级/演示模式** 运行（支付显示 Mock、识图返回明确错误、TTS 返回正弦波音频）。

---

## 🔐 9. 部署与环境变量配置指南

### 9.1 完整变量清单（标准化）

| # | 变量 | 必填 | 用途 |
|---|------|:---:|------|
| 1 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe 前端公钥 (`pk_live_` / `pk_test_`) |
| 2 | `STRIPE_SECRET_KEY` | ✅ | Stripe 服务端密钥 (`sk_live_` / `sk_test_`) |
| 3 | `STRIPE_WEBHOOK_SECRET` | 生产✅ | Stripe Webhook 签名密钥 (`whsec_`) |
| 4 | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | 可选 | PayPal Client ID（辅渠道） |
| 5 | `PAYPAL_CLIENT_SECRET` | 可选 | PayPal 服务端密钥 |
| 6 | `PAYPAL_API_URL` | 可选 | PayPal API 地址（Sandbox/Live） |
| 7 | `GEMINI_API_KEY` | 推荐 | Gemini Vision 密钥（A 提供商） |
| 8 | `GEMINI_MODEL` | 可选 | Gemini 模型（默认 `gemini-2.0-flash`） |
| 9 | `OPENROUTER_API_KEY` | 可选 | OpenRouter 密钥（B 提供商） |
| 10 | `OPENROUTER_MODEL` | 可选 | OpenRouter 模型（默认 `openai/gpt-4o-mini`） |
| 11 | `DEEPSEEK_API_KEY` | 可选 | DeepSeek 密钥（C 提供商） |
| 12 | `DEEPSEEK_MODEL` | 可选 | DeepSeek 模型（默认 `deepseek-chat`） |
| 13 | `POSTGRES_URL` / `DATABASE_URL` | 推荐 | Postgres 连接串（Vercel Postgres / Neon / Supabase） |
| 14 | `POSTGRES_SSL` | 可选 | Postgres SSL 开关（默认开启） |
| 15 | `KV_REST_API_URL` / `VERCEL_KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | 可选 | KV REST 地址 |
| 16 | `KV_REST_API_TOKEN` / `VERCEL_KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | 可选 | KV REST Token |
| 17 | `REDIS_URL` | 可选 | 标准 Redis 连接串（预留直连适配） |
| 18 | `GATEWAY_BASE_URL` / `GATEWAY_APP_KEY` | 可选 | Central Gateway 接入（服务端：识图/积分经统一网关） |
| 19 | `NEXT_PUBLIC_GATEWAY_BASE_URL` / `NEXT_PUBLIC_GATEWAY_APP_KEY` | 可选 | 同上（前端直调网关时） |
| 20 | `NEXT_PUBLIC_APP_URL` | 可选 | 前端站点绝对地址（Webhook/回调与链接生成） |
| 21 | `TTS_SUBSCRIPTION_KEY` | 可选 | Azure Edge-TTS 密钥 |
| 22 | `VITE_GOOGLE_CLIENT_ID` | 可选 | Google OAuth Client ID |

> 最小必填集：**#1/#2（Stripe 双 Key）+ #7（AI）**；生产强烈建议加 **#13（Postgres）** 与 **#3（Webhook Secret）**。

### 9.2 一键部署到 Vercel（1 分钟）

[`vercel.json`](vercel.json) 已显式声明：

```json
{ "framework": "nextjs", "buildCommand": "npm run build", "installCommand": "npm install" }
```

因此克隆后只需：

1. Vercel → **New Project → Import Git Repository**；
2. 在 **Settings → Environment Variables** 粘贴 §9.1 清单变量（生产勾选 Production）；
3. 点击 **Deploy** — 自动执行 `npm install → npm run build`（内置路由门禁 + TypeScript 校验），约 1 分钟构建上线。

### 9.3 Webhook 配置（Stripe）

在 [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) 创建 Endpoint：

- **URL**: `https://你的域名/api/stripe/webhook`
- **事件订阅**: `checkout.session.completed`（一次性付款模式；旧订阅事件已停用）
- 将 `whsec_` 签名密钥配置到 `STRIPE_WEBHOOK_SECRET`

### 9.4 配置验证

```bash
node scripts/check-stripe-config.mjs   # Stripe 配置检测
node scripts/test-stripe-e2e.mjs       # 支付全链路 E2E
```

---

## 📡 10. API 概览

### 支付与积分充值（Credits Top-up）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/stripe/checkout` | 创建 Stripe Checkout Session（双 Key 校验 + 友好降级） |
| `POST` | `/api/stripe/webhook` | Stripe Webhook 回调接收 |
| `POST` | `/api/paypal/create-order` | 创建 PayPal 订单 |
| `POST` | `/api/paypal/capture-order` | 捕获 PayPal 付款（成功后按积分包发放积分） |
| `GET` | `/api/v1/billing/status` | 查询免费额度 / Pro 权限（旧订阅记录兼容） |
| `POST` | `/api/v1/billing/subscribe` | 已停用（410）——Credits Top-up 不再激活订阅 |
| `POST` | `/api/v1/billing/ad-reward` | 广告观看 +10 积分 |

### 识餐与积分

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/meals/analyze-image` | AI 图片食物识别（A→B→C 回退链，WAF 限频 + 反爬） |
| `POST` | `/api/v1/meals/analyze-text` | AI 文字食物识别 |
| `GET/POST` | `/api/v1/user/credits` | 积分查询 / 服务端增减（识图 -1、广告 +10、积分包充值） |

### 运维后台（需管理员令牌）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/admin/overview` | 核心指标总览（收入/访问/识别/错误率；`x-admin-token` 鉴权） |
| `GET` | `/api/v1/admin/revenue` | 收入统计（方案拆分 + 本机流水合并；`x-admin-token` 鉴权） |
| `GET` | `/api/v1/admin/traffic` | 访问量与最近 IP（`x-admin-token` 鉴权） |
| `GET` | `/api/v1/admin/users` | 用户列表（`x-admin-token` 鉴权） |
| `GET` | `/api/v1/admin/logs` | 识图运行日志（`x-admin-token` 鉴权） |
| `GET` | `/api/v1/admin/model-monitor` | AI 模型健康度（`x-admin-token` 鉴权） |

---

## 🛠️ 11. 开发、构建与质检命令

```bash
# ── 开发 ──
npm run dev              # 启动开发服务器 (http://localhost:3000)

# ── 构建（零 Key 审计 + 路由门禁 + TypeScript）──
npm run test:routes      # 路由/API 路径静态校验
npm run build            # 生产构建（prebuild 自动跑 test:routes + TypeScript 校验）

# ── 单元 / 冒烟 ──
npm run test:api         # 动态 API 冒烟 + 语义探针（analyze-text 随机输入 ×2 + analyze-image ×1，反 Mock 断言）
npm test                 # = test:routes + test:api（含语义探针）

# ── 语义级 QA 规范（禁止仅断言 200 OK）──
#  · AI 分析路由必须随机输入并断言「动态变更或模型标记」；
#  · 命中固定 Mock（白米饭/鸡胸肉/西兰花）直接 FAIL 挂起；
#  · QA_SEMANTIC=0 可临时跳过（仅本地调试，禁止用于交付）。

# ── 官方 QA 回归（0 Token 成本 · 线上静默 E2E 巡检）──
python scripts/qa_inspect.py --url https://calorie-ai-seven.vercel.app
# 退出码 0 = 全部通过（0 Console Error / 0 Network Error≥400）；报告写入 qa_delivery/reports/latest.md
```

> **QA 质检说明**：官方回归命令为 `python scripts/qa_inspect.py --url <DEPLOYED_URL>`，由 Playwright 无头巡检断言 **0 Console Error / 0 Uncaught Error (#418) / 0 4xx**，全程 **0 Token 成本**。

### 11.1 CEO 可视化深度巡检（demo:visual · slowMo=1200ms）

```bash
# 桌面端（默认线上生产 URL）：全 UI A-D 分支 + 光标轨迹特效 + TEMP 真实图片集识图
npm run demo:visual

# 移动端 iPhone 14 模拟
python scripts/ceo_visual_demo.py --mode mobile

# 快节奏短视频模式（slowMo=150ms · 自动录屏导出 TEMP/calorieai_demo_fast.mp4）
python scripts/ceo_visual_demo.py --fast

# YouTube Shorts 英文宣推（locale en-US 全英文 UI · Edge-TTS 美音解说 4 段 · 导出 TEMP/calorieai_yt_promo_en.mp4）
python scripts/ceo_visual_demo.py --promo-en

# 本地联调
python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100
```

巡检覆盖：步骤 A 语言与导航（中文/EN + 三页面）、步骤 B 餐次全覆盖（早餐/午餐/晚餐/加餐）、
步骤 C 文字与识图（逐字输入 + 积分 -1 记录；TEMP 图片「图片已优化 (XXKB)」Toast + 数量/约重 + 整盘总热量）、
步骤 D 商业化（看广告 +10、Stripe 3 套定价卡片与 Checkout 跳转）。
规范详见 [`git008/docs/AI_FACTORY_SPEC.md`](../../docs/AI_FACTORY_SPEC.md)（SOP-01 轨迹光标巡检 / SOP-02 数量清点总账 / SOP-03 500KB 压缩防爆）。

---

## 🛰️ 12. 架构演进：Central Gateway 路线图

### 12.1 现状（已就绪）

本模版已完成“单应用自给自足”阶段，全部基础设施已在仓库内：

| 能力 | 现状 |
|------|------|
| **独立 DAL** | Postgres / KV / 文件三适配器自动降级，订阅/积分/流水/日志统一持久化 |
| **支付流水线** | Stripe Checkout + Webhook、PayPal Create/Capture 全链路，$1.00 测试价 + `recordPayment` 去重入账 |
| **服务端权威积分** | `/api/v1/user/credits` 统一读写，跨设备一致 |
| **WAF 反爬** | analyze-image 单 IP 限频 + Bot UA 拦截 |

### 12.2 下一步：对接 Central Gateway（密钥集中化管理）

仓库已内置 [`projects/central-gateway`](../../projects/central-gateway/README.md)（Hono + Node 轻量网关），用于**多项目密钥集中托管与统一端点**：

| 统一端点 | 说明 |
|----------|------|
| `POST /api/v1/ai/vision` | 按 `app_id` 切换 Prompt（calorieai / petai / plantai…），A→B→C 回退 |
| `POST /api/v1/billing/checkout` | 统一 Stripe / PayPal 支付发起，透传 `app_id` |
| `GET/POST /api/v1/credits` | 跨端统一积分 / Pro 状态 |

安全层：**App-Key / Bearer 鉴权 + CORS 白名单 + 滑动窗口限频**；上游密钥只存在于网关，套娃前端零 Key。

本项目已内置 [SDK 接入示例](src/lib/gateway-client.ts) 与 `GATEWAY_BASE_URL / GATEWAY_APP_KEY` 环境门控：配置后识图与积分**优先经中央网关**，网关不可用时**自动回退直连**，旧业务零影响。

### 12.3 演进阶段

| 阶段 | 内容 | 状态 |
|------|------|:---:|
| **Phase 1** | 单应用 DAL + 双支付 + 服务端权威积分（本仓库） | ✅ 已就绪 |
| **Phase 2** | 对接 Central Gateway：密钥集中、统一 vision/checkout/credits 端点 | 🚧 已具备 SDK 与环境门控，配置 `GATEWAY_*` 即可启用 |
| **Phase 3** | 多项目矩阵：PetAI / PlantAI 克隆后共享网关、积分与运维看板 | 📋 路线图 |

---

## 📚 13. 相关文档

| 文档 | 说明 |
|------|------|
| [`PROJECT_SPEC.md`](PROJECT_SPEC.md) | **生产规格**：核心架构、SSR/Hydration 防护守则、Agent 行为守则、质量门禁 + 套娃 SOP |
| [`MEMORY.md`](MEMORY.md) | **项目记忆**：技术栈/目录/规范 + 历史 Bug 自愈履历与关键决策记录 |
| [`.env.example`](.env.example) | 环境变量配置参考（含 §9.1 全量清单） |
| [`vercel.json`](vercel.json) | 一键部署配置（framework/build/install 显式声明） |
| [`../../projects/central-gateway/README.md`](../../projects/central-gateway/README.md) | **SaaS Central Gateway**：统一 AI/支付/积分网关与密钥集中托管 |
| [`scripts/check-stripe-config.mjs`](scripts/check-stripe-config.mjs) | Stripe 配置检测工具 |
| [`scripts/test-stripe-e2e.mjs`](scripts/test-stripe-e2e.mjs) | 支付全链路 E2E 测试 |
| [`../../docs/AI_FACTORY_SPEC.md`](../../docs/AI_FACTORY_SPEC.md) | **AI 工厂 SOP 说明书**：slowMo=1200ms 轨迹光标巡检 / Vision 数量清点总账 / Canvas 500KB 压缩防爆 |

---

## 📜 14. 版本记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026.08 | **v3.5** | CEO 可视化巡检全面升级：显式 smooth_move 轨迹（mouse.move 分段插值）+ human_click 拟人化点击；TEMP 真实图片集绑定并硬校验「数量 + 约重」（小笼包 (9 颗 / 约 270g)）与整盘总热量；积分 -1 轮询记录；逐模式结果报告；沉淀工厂 SOP 至 `git008/docs/AI_FACTORY_SPEC.md`（桌面/移动双端全绿） |
| 2026.08 | **v3.4** | 引入【语义级 QA 反 Mock 门禁】（smoke-api/qa_ui 动态语义探针：随机输入 + Provider 标记 + Mock 签名 FAIL 阻断）与【10 分钟套娃克隆引擎】（app-config.ts 集中控制 App-ID/Prompt/配色；配套 git008 `clone_app.mjs` + `TEMPLATE_APP.md`） |
| 2026.08 | v3.3 | 文字输入分析真实化：analyze-text 网关优先 + A/B/C 直连回退，返回 records/items/totalKcal/PFC 汇总 |
| 2026.08 | v3.2 | Credits Top-up 一次性付款（弃订阅）+ 管理后台鉴权隐身 + qa:ui 脚本 |
| 2026.08 | v3.1 | 交叉对抗 QA：Stripe 支付方式降级修复、TTS 调试 UI 下线 |
| 2026.08 | v3.0 | SaaS 矩阵架构：Central Gateway + 套娃应用矩阵 + 1-Step Clone |
