import { NextRequest, NextResponse } from "next/server";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

/**
 * POST /api/stripe/webhook
 *
 * 接收 Stripe Webhook 事件，更新用户订阅/授权状态。
 *
 * 监听事件:
 *   - checkout.session.completed  → 支付成功
 *   - customer.subscription.updated → 订阅变更
 *   - customer.subscription.deleted → 订阅取消/过期
 */
export async function POST(request: NextRequest) {
  try {
    // ── 验证 Stripe 是否已配置 ──────────────────────────
    if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY === "YOUR_STRIPE_SECRET_KEY_HERE") {
      // 演示模式: log 并返回 200
      const body = await request.text().catch(() => "{}");
      console.log("[Stripe Webhook - Demo Mode] Received event (ignored):", body.slice(0, 200));
      return NextResponse.json({ received: true, mock: true });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
    });

    // ── 验证 webhook 签名 ──────────────────────────────
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature || !STRIPE_WEBHOOK_SECRET) {
      console.warn("[Stripe Webhook] Missing signature or webhook secret");
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("[Stripe Webhook] Signature verification failed:", err.message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // ── 处理事件 ────────────────────────────────────────
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        console.log("[Stripe Webhook] Checkout completed:", session.id);

        // 提取用户信息
        const customerEmail = session.customer_details?.email || "unknown";
        const metadata = session.metadata || {};
        const planType = metadata.plan_type || "subscription";
        const plan = metadata.plan || "monthly";

        // 在此处更新数据库/存储中的用户订阅状态
        // TODO: 接入真实数据库后，将以下信息写入用户记录
        const subscriptionStatus = {
          user_id: customerEmail,
          plan_type: planType,       // "subscription" | "license"
          plan,                       // "monthly" | "yearly" | "permanent"
          stripe_session_id: session.id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          timestamp: new Date().toISOString(),
        };

        console.log("[Stripe Webhook] Subscription activated:", JSON.stringify(subscriptionStatus));
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] Subscription updated:", subscription.id);
        // 处理订阅变更（升级/降级/续费）
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] Subscription deleted:", subscription.id);
        // 处理订阅取消/过期 → 降级为免费用户
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] Invoice paid:", invoice.id);
        // 续费成功，延长订阅有效期
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] Invoice payment failed:", invoice.id);
        // 扣款失败 → 通知用户更新支付方式
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[Stripe Webhook Error]", error);
    return NextResponse.json(
      { error: error.message || "Webhook 处理失败" },
      { status: 500 },
    );
  }
}
