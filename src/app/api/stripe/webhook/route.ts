import { NextRequest, NextResponse } from "next/server";
import { db, addServerCredits } from "@/lib/db";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

/**
 * POST /api/stripe/webhook
 *
 * 接收 Stripe Webhook 事件，为 Credits Top-up（积分充值/按次付费）记账。
 *
 * 监听事件:
 *   - checkout.session.completed  → 一次性付款成功，按 metadata 发放积分包并记录流水
 *   - customer.subscription.* / invoice.* → 旧订阅事件，仅记录日志忽略（已取消订阅模式）
 */
export async function POST(request: NextRequest) {
  try {
    if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY === "YOUR_STRIPE_SECRET_KEY_HERE") {
      const body = await request.text().catch(() => "{}");
      console.log("[Stripe Webhook - Demo Mode] Received event (ignored):", body.slice(0, 200));
      return NextResponse.json({ received: true, mock: true });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
    });

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

    switch (event.type) {
      // ═══════════════════════════════════════════════════
      //  checkout.session.completed
      //  一次性付款成功 → 按 metadata 发放积分包并记录流水
      // ═══════════════════════════════════════════════════
      case "checkout.session.completed": {
        const session = event.data.object as any;
        console.log("[Stripe Webhook] Checkout completed:", session.id);

        // 获取用户标识（优先 metadata.user_id，其次 customer_email）
        const userId = session.metadata?.user_id || session.customer_details?.email || `stripe_${session.customer}`;
        const email = session.metadata?.email || session.customer_details?.email || "";
        const packId = session.metadata?.pack_id || "";
        const credits = Number(session.metadata?.credits || 0);
        const amountUsd = Number(session.metadata?.amount_usd || 1.0);

        if (!packId || !Number.isFinite(credits) || credits <= 0) {
          console.warn("[Stripe Webhook] 非积分包会话，跳过入账:", session.id);
          break;
        }

        // 服务端权威发放积分（幂等：recordPayment 按 session.id 去重，二次事件不重复入账）
        const next = await addServerCredits(userId, credits);
        await db.recordPayment({
          orderId: session.id,
          provider: "stripe",
          plan: packId,
          amount: amountUsd,
          email,
        });

        console.log(`[Stripe Webhook] ✅ 积分包到账: userId=${userId}, pack=${packId}, +${credits} → ${next}`);
        break;
      }

      // ═══════════════════════════════════════════════════
      //  旧订阅事件（已取消订阅套路，Credits Top-up 一次性付费模式）
      //  仅记录日志忽略，不再激活/续费/停用任何订阅权限
      // ═══════════════════════════════════════════════════
      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] 旧订阅事件已忽略（Credits Top-up 模式）: subscription.updated", subscription.id);
        break;
      }

      // ═══════════════════════════════════════════════════
      //  customer.subscription.deleted（旧订阅事件，忽略）
      // ═══════════════════════════════════════════════════
      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] 旧订阅事件已忽略（Credits Top-up 模式）: subscription.deleted", subscription.id);
        break;
      }

      // ═══════════════════════════════════════════════════
      //  invoice.payment_succeeded（旧订阅事件，忽略）
      // ═══════════════════════════════════════════════════
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] 旧订阅事件已忽略（Credits Top-up 模式）: invoice.payment_succeeded", invoice.id);
        break;
      }

      // ═══════════════════════════════════════════════════
      //  invoice.payment_failed（旧订阅事件，忽略）
      // ═══════════════════════════════════════════════════
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] 旧订阅事件已忽略（Credits Top-up 模式）: invoice.payment_failed", invoice.id);
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
