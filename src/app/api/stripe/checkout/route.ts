import { NextRequest, NextResponse } from "next/server";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

/**
 * POST /api/stripe/checkout
 *
 * 创建 Stripe Checkout Session，重定向用户至 Stripe 支付页面。
 *
 * 请求体:
 * {
 *   plan: "monthly" | "yearly" | "permanent",
 *   payment_method?: "card" | "alipay" | "wechat_pay" | "all",  // 默认 "all"
 *   user_id?: string,       // 用户 ID (关联订阅)
 *   email?: string,         // 用户邮箱 (关联订阅)
 *   success_url?: string,
 *   cancel_url?: string
 * }
 * 响应: { sessionId: string, url: string }
 */
export async function POST(request: NextRequest) {
  try {
    // ── 验证 Stripe 是否已配置 ──────────────────────────
    if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY === "YOUR_STRIPE_SECRET_KEY_HERE") {
      const body = await request.json().catch(() => ({}));
      const { plan = "monthly" } = body;
      return NextResponse.json({
        sessionId: `cs_mock_${Date.now()}`,
        url: `/billing/success?plan=${plan}&mock=true`,
        mock: true,
        message: "演示模式：未配置真实 Stripe 密钥。设置 STRIPE_SECRET_KEY 启用真实支付。",
      });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
    });

    const body = await request.json();
    const { plan, payment_method = "all", success_url, cancel_url, user_id, email } = body;

    const origin = request.headers.get("origin") || "http://localhost:3000";

    const priceMap: Record<string, { price: number; label: string; description: string; metadata: Record<string, string> }> = {
      monthly: {
        price: 100,
        label: "月付 Pro",
        description: "CalorieAI Pro 月付订阅 ($1 测试价) — 无限次 AI 食物识别",
        metadata: { plan_type: "subscription", interval: "month", plan: "monthly" },
      },
      yearly: {
        price: 100,
        label: "年付 Pro",
        description: "CalorieAI Pro 年付订阅 ($1 测试价) — 无限次 AI 食物识别",
        metadata: { plan_type: "subscription", interval: "year", plan: "yearly" },
      },
      permanent: {
        price: 100,
        label: "永久买断",
        description: "CalorieAI 永久授权 ($1 测试价) — 终身 Pro 功能",
        metadata: { plan_type: "license", interval: "lifetime", plan: "permanent" },
      },
    };

    const config = priceMap[plan];
    if (!config) {
      return NextResponse.json({ error: `未知方案: ${plan}` }, { status: 400 });
    }

    // ── 确定支持的支付方式 ──────────────────────────────
    // 支持: 国际信用卡 + 支付宝 + 微信支付
    const paymentMethodTypes: string[] =
      payment_method === "all"
        ? ["card", "alipay", "wechat_pay"]
        : payment_method === "card"
          ? ["card"]
          : payment_method === "alipay"
            ? ["alipay"]
            : payment_method === "wechat_pay"
              ? ["wechat_pay"]
              : ["card", "alipay", "wechat_pay"];

    // ── 构建 Checkout Session ──────────────────────────
    const sessionParams: any = {
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `CalorieAI ${config.label}`,
              description: config.description,
            },
            unit_amount: config.price,
            ...(plan === "monthly" || plan === "yearly"
              ? { recurring: { interval: plan === "monthly" ? "month" as const : "year" as const } }
              : {}),
          },
          quantity: 1,
        },
      ],
      mode: plan === "permanent" ? "payment" : "subscription",
      success_url: success_url || `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/billing/cancel`,
      metadata: {
        ...config.metadata,
        ...(user_id ? { user_id } : {}),
        ...(email ? { email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
    };

    // ── 支付宝/微信支付使用 payment_intent_data 设置描述 ──
    if (plan === "permanent") {
      sessionParams.payment_intent_data = {
        metadata: {
          ...config.metadata,
          ...(user_id ? { user_id } : {}),
          ...(email ? { email } : {}),
        },
      };
    } else {
      sessionParams.subscription_data = {
        metadata: {
          ...config.metadata,
          ...(user_id ? { user_id } : {}),
          ...(email ? { email } : {}),
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      payment_methods: paymentMethodTypes,
    });
  } catch (error: any) {
    console.error("[Stripe Checkout Error]", error);
    return NextResponse.json(
      { error: error.message || "创建支付会话失败" },
      { status: 500 },
    );
  }
}
