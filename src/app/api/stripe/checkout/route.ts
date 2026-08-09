import { NextRequest, NextResponse } from "next/server";
import { getCreditPack, resolvePack, type CreditPack } from "@/lib/credit-packs";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * POST /api/stripe/checkout
 *
 * 创建 Stripe Checkout Session，重定向用户至 Stripe 支付页面。
 *
 * 请求体:
 * {
 *   pack_id: "pack_starter" | "pack_booster" | "pack_power",  // 积分包（旧 plan 参数自动回退体验包）
 *   payment_method?: "card" | "alipay" | "wechat_pay" | "all",  // 默认 "all"
 *   user_id?: string,       // 用户 ID（积分入账）
 *   email?: string,         // 用户邮箱
 *   success_url?: string,
 *   cancel_url?: string
 * }
 * 响应: { sessionId: string, url: string, pack_id, credits, amount, fallback? }
 *
 * 商业化模式：Credits Top-up（积分充值/按次付费）一次性付款，取消订阅。
 *
 * 真实模式要求 STRIPE_SECRET_KEY 与 NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 同时有效；
 * 任一缺失/占位时返回 mock 降级，前端可据此展示演示成功。
 */
export async function POST(request: NextRequest) {
  try {
    // ── 验证 Stripe 是否已配置 ──────────────────────────
    const secretValid =
      !!STRIPE_SECRET_KEY && STRIPE_SECRET_KEY !== "YOUR_STRIPE_SECRET_KEY_HERE";
    const publishableValid =
      !!STRIPE_PUBLISHABLE_KEY &&
      STRIPE_PUBLISHABLE_KEY !== "YOUR_STRIPE_PUBLISHABLE_KEY_HERE";
    if (!secretValid || !publishableValid) {
      const body = await request.json().catch(() => ({}));
      const pack: CreditPack | undefined = body.pack_id
        ? getCreditPack(body.pack_id)
        : resolvePack(body.plan);
      if (!pack) {
        return NextResponse.json({ error: `未知积分包: ${body.pack_id}` }, { status: 400 });
      }
      return NextResponse.json({
        sessionId: `cs_mock_${Date.now()}`,
        url: `/billing/success?pack_id=${pack.id}&mock=true`,
        mock: true,
        pack_id: pack.id,
        credits: pack.credits,
        amount: pack.priceUsd,
        message:
          "演示模式：未配置完整的 Stripe 密钥（STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY）。设置后启用真实支付。",
      });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
    });

    const body = await request.json();
    const { pack_id, payment_method = "all", success_url, cancel_url, user_id, email } = body;
    const pack: CreditPack | undefined = pack_id ? getCreditPack(pack_id) : resolvePack(body.plan);
    if (!pack) {
      return NextResponse.json({ error: `未知积分包: ${pack_id}` }, { status: 400 });
    }

    const origin = request.headers.get("origin") || "http://localhost:3000";
    const amountCents = Math.round(pack.priceUsd * 100);
    const productLabel = `${pack.credits} 积分包`;

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
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `CalorieAI ${productLabel}`,
              description: `一次性付款 · 按次付费 · ${pack.credits} 积分即时到账（无订阅）`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url:
        success_url ||
        `${origin}/billing/success?pack_id=${pack.id}&credits=${pack.credits}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/billing/cancel`,
      metadata: {
        pack_id: pack.id,
        credits: String(pack.credits),
        amount_usd: String(pack.priceUsd),
        ...(user_id ? { user_id } : {}),
        ...(email ? { email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
      payment_intent_data: {
        metadata: {
          pack_id: pack.id,
          credits: String(pack.credits),
          amount_usd: String(pack.priceUsd),
          ...(user_id ? { user_id } : {}),
          ...(email ? { email } : {}),
        },
      },
    };

    // ── 支付方式降级重试 ──────────────────────────────
    // 支付宝/微信支付未在 Stripe 账户激活，或 wechat_pay 不支持订阅模式时，
    // 自动降级为信用卡支付，避免前端拿到 500 原始英文报错。
    const FALLBACK_CARD_ONLY: string[] = ["card"];
    const tryCreate = async (methods: string[]): Promise<{ session: any; fallback: boolean }> => {
      try {
        const s = await stripe.checkout.sessions.create({ ...sessionParams, payment_method_types: methods });
        return { session: s, fallback: false };
      } catch (err: any) {
        const msg = err?.message || String(err);
        const unsupported = /invalid|not activated|cannot be used|not supported|does not support|no such payment method|requires\s*`?payment_method_options/i.test(msg);
        if (unsupported && !(methods.length === 1 && methods[0] === "card")) {
          const s = await stripe.checkout.sessions.create({ ...sessionParams, payment_method_types: FALLBACK_CARD_ONLY });
          return { session: s, fallback: true };
        }
        throw err;
      }
    };

    const { session, fallback } = await tryCreate(paymentMethodTypes);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      pack_id: pack.id,
      credits: pack.credits,
      amount: pack.priceUsd,
      payment_methods: fallback ? FALLBACK_CARD_ONLY : paymentMethodTypes,
      fallback,
    });
  } catch (error: any) {
    console.error("[Stripe Checkout Error]", error);
    return NextResponse.json(
      { error: error.message || "创建支付会话失败" },
      { status: 500 },
    );
  }
}
