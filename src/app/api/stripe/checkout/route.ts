import { NextRequest, NextResponse } from "next/server";
import { getCreditPack, resolvePack, type CreditPack } from "@/lib/credit-packs";
import { getLocalizedPaymentItem } from "@/lib/stripe-i18n";
import { isPlaceholderKey, resolvePaymentMethodTypes } from "@git008/commercial-engine/middleware/payment-keys";
import { describeStripeError } from "@git008/commercial-engine/middleware/payment-errors";

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
 * 密钥校验（isPlaceholderKey）与失败翻译（describeStripeError）由商业引擎统一提供。
 *
 * 真实模式要求 STRIPE_SECRET_KEY 与 NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 同时有效；
 * 任一缺失/占位时返回 mock 降级，前端可据此展示演示成功。
 */
export async function POST(request: NextRequest) {
  try {
    // ── 验证 Stripe 是否已配置 ──────────────────────────
    const secretValid = !isPlaceholderKey(STRIPE_SECRET_KEY);
    const publishableValid = !isPlaceholderKey(STRIPE_PUBLISHABLE_KEY);
    if (!secretValid || !publishableValid) {
      const body = await request.json().catch(() => ({}));
      const pack: CreditPack | undefined = body.pack_id
        ? getCreditPack(body.pack_id)
        : resolvePack(body.plan);
      if (!pack) {
        return NextResponse.json({ error: `未知积分包: ${body.pack_id}` }, { status: 400 });
      }
      const reason = !STRIPE_SECRET_KEY
        ? "missing_secret_key"
        : !secretValid
          ? "invalid_secret_key"
          : !STRIPE_PUBLISHABLE_KEY
            ? "missing_publishable_key"
            : "invalid_publishable_key";
      const detail = !STRIPE_SECRET_KEY
        ? "未配置 Stripe Secret Key（STRIPE_SECRET_KEY 为空）"
        : !secretValid
          ? "Stripe Secret Key 为占位值/无效（STRIPE_SECRET_KEY 未替换为 sk_live_*/sk_test_*）"
          : !STRIPE_PUBLISHABLE_KEY
            ? "未配置 Stripe Publishable Key（NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 为空）"
            : "Stripe Publishable Key 为占位值/无效（NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 未替换为 pk_live_*/pk_test_*）";
      return NextResponse.json({
        sessionId: `cs_mock_${Date.now()}`,
        url: `/billing/success?pack_id=${pack.id}&mock=true`,
        mock: true,
        reason,
        detail,
        pack_id: pack.id,
        credits: pack.credits,
        amount: pack.priceCny,
        currency: "CNY",
        amount_usd: pack.priceUsd,
        message:
          `演示模式：${detail}。设置真实密钥后自动启用 Stripe 托管支付页。`,
      });
    }

    const Stripe = (await import("stripe")).default;
    // 上方已校验 STRIPE_SECRET_KEY 非空且非占位，此处显式断言
    const stripe = new Stripe(STRIPE_SECRET_KEY as string, {
      apiVersion: "2026-06-24.dahlia",
    });

    const body = await request.json();
    const {
      pack_id,
      payment_method = "all",
      success_url,
      cancel_url,
      user_id,
      email,
      locale,
      current_lang,
    } = body;
    const pack: CreditPack | undefined = pack_id ? getCreditPack(pack_id) : resolvePack(body.plan);
    if (!pack) {
      return NextResponse.json({ error: `未知积分包: ${pack_id}` }, { status: 400 });
    }

    const origin =
      request.headers.get("origin") ||
      request.nextUrl.origin ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    // 基准定价：1 RMB = 1 Credit，Stripe 以 CNY 按人民币基准价结算（分位）
    const amountCents = Math.round(pack.priceCny * 100);

    // ── 商品名称/描述与前端语言联动（统一走商业引擎 stripe-i18n）──
    // 008 SOP-04 §4.4 红线禁令 / §5 质量闸门：严禁在路由内硬编码中文商品名/描述；
    // lang 命中 'en'（或任何非中文环境）时 name/description 100% 标准英文（零汉字）。
    const item = getLocalizedPaymentItem(pack.id, locale || current_lang || "en");

    // ── 确定支持的支付方式（商业引擎统一白名单） ──────────────
    // 支持: 国际信用卡 + 支付宝 + 微信支付
    const paymentMethodTypes: string[] = resolvePaymentMethodTypes(payment_method);

    // ── 构建 Checkout Session ──────────────────────────
    const sessionParams: any = {
      payment_method_types: paymentMethodTypes,
      // 强制全英文支付页：无论用户浏览器/地区语言如何，Stripe Checkout 一律展示英文
      locale: "en",
      mode: "payment",
      // Apple Pay / Google Pay 自动识别：
      // 当 payment_method_types 包含 "card" 且用户设备钱包支持时，
      // Stripe Checkout 会自动展示 Apple Pay / Google Pay 快捷支付按钮，
      // 无需额外 payment_method_types 项，显著降低手机端输入成本。
      payment_method_options: {
        card: {
          request_three_d_secure: "automatic",
        },
      },
      line_items: [
        {
          price_data: {
            currency: "cny",
            product_data: {
              name: item.name,
              description: item.description,
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
        amount_cny: String(pack.priceCny),
        currency: "CNY",
        amount_usd: String(pack.priceUsd),
        ...(user_id ? { user_id } : {}),
        ...(email ? { email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
      payment_intent_data: {
        metadata: {
          pack_id: pack.id,
          credits: String(pack.credits),
          amount_cny: String(pack.priceCny),
          currency: "CNY",
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
        const unsupported = /invalid|not activated|must activate|isn't activated|not enabled|cannot be used|not supported|does not support|no such payment method|requires\s*`?payment_method_options/i.test(msg);
        if (unsupported && !(methods.length === 1 && methods[0] === "card")) {
          const s = await stripe.checkout.sessions.create({ ...sessionParams, payment_method_types: FALLBACK_CARD_ONLY });
          return { session: s, fallback: true };
        }
        throw err;
      }
    };

    const { session, fallback } = await tryCreate(paymentMethodTypes);

    if (!session?.url) {
      throw new Error("Stripe Checkout Session 创建成功但未返回支付跳转 URL");
    }

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      pack_id: pack.id,
      credits: pack.credits,
      amount: pack.priceCny,
      currency: "CNY",
      amount_usd: pack.priceUsd,
      payment_methods: fallback ? FALLBACK_CARD_ONLY : paymentMethodTypes,
      fallback,
    });
  } catch (error: any) {
    const { error: friendly, detail, code } = describeStripeError(error);
    console.error("[Stripe Checkout Error]", {
      code,
      detail,
      stack: error?.stack || undefined,
    });
    return NextResponse.json(
      { error: friendly || "创建支付会话失败", detail, code },
      { status: 500 },
    );
  }
}
