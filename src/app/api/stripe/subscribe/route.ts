import { NextRequest, NextResponse } from "next/server";
import { getLocalizedPaymentItem } from "@/lib/stripe-i18n";

/**
 * POST /api/stripe/subscribe
 *
 * Cal AI 式 Pro 订阅 Paywall：
 *  - 免费扫描次数（2 次）用完后，第 3 次拍照创建 $9.99/月 Stripe Checkout 订阅；
 *  - 强制 locale=en 全英文支付页；payment_method_types 含 card，
 *    支持 Apple Pay / Google Pay 自动识别；3DS 自动校验。
 *
 * 请求体: { user_id?, email?, success_url?, cancel_url? }
 * 响应: { sessionId, url, amount: 9.99, interval: "month", mock? }
 */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const PRO_PRICE_USD = 9.99;

function keysValid(): boolean {
  const secret = STRIPE_SECRET_KEY || "";
  const pub = STRIPE_PUBLISHABLE_KEY || "";
  return (
    !!secret &&
    secret !== "YOUR_STRIPE_SECRET_KEY_HERE" &&
    !!pub &&
    pub !== "YOUR_STRIPE_PUBLISHABLE_KEY_HERE"
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!keysValid()) {
      const detail = !STRIPE_SECRET_KEY
        ? "未配置 Stripe Secret Key（STRIPE_SECRET_KEY）"
        : !STRIPE_PUBLISHABLE_KEY
          ? "未配置 Stripe Publishable Key（NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY）"
          : "Stripe 密钥为占位值/无效";
      return NextResponse.json({
        sessionId: `cs_mock_sub_${Date.now()}`,
        url: "/billing/cancel",
        mock: true,
        amount: PRO_PRICE_USD,
        interval: "month",
        message: `演示模式：${detail}。配置真实密钥后启用 $${PRO_PRICE_USD}/月 订阅。`,
      });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY as string, {
      apiVersion: "2026-06-24.dahlia",
    });

    const body = await request.json().catch(() => ({}));
    const { user_id, email, success_url, cancel_url } = body;
    // Pro 订阅 Paywall 强制全英文（Stripe locale=en）：商品名/描述恒定英文（008 SOP-04 §4.4/§5），
    // 统一走 stripe-i18n，杜绝「英文支付页 + 中文商品名」的中英混杂盲点。
    const item = getLocalizedPaymentItem("pro_monthly", "en");
    const origin =
      request.headers.get("origin") ||
      request.nextUrl.origin ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      locale: "en",
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          request_three_d_secure: "automatic",
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: item.name,
              description: item.description,
            },
            unit_amount: Math.round(PRO_PRICE_USD * 100),
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url:
        success_url || `${origin}/billing/success?plan=pro_monthly&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/billing/cancel`,
      metadata: {
        plan: "pro_monthly",
        amount_usd: String(PRO_PRICE_USD),
        ...(user_id ? { user_id } : {}),
        ...(email ? { email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
      subscription_data: {
        metadata: {
          plan: "pro_monthly",
          amount_usd: String(PRO_PRICE_USD),
          ...(user_id ? { user_id } : {}),
          ...(email ? { email } : {}),
        },
      },
    });

    if (!session?.url) {
      throw new Error("Stripe 订阅会话创建成功但未返回支付跳转 URL");
    }

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      amount: PRO_PRICE_USD,
      interval: "month",
      plan: "pro_monthly",
    });
  } catch (error: any) {
    console.error("[Stripe Subscribe Error]", {
      code: error?.code || "",
      message: error?.message || String(error),
    });
    return NextResponse.json(
      { error: error?.message || "创建订阅会话失败" },
      { status: 500 }
    );
  }
}
