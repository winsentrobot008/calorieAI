import { NextRequest, NextResponse } from "next/server";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

/**
 * POST /api/stripe/webhook
 *
 * 接收 Stripe Webhook 事件，更新用户订阅/授权状态。
 * 使用 billing-store 持久化订阅信息。
 *
 * 监听事件:
 *   - checkout.session.completed  → 支付成功，激活订阅
 *   - invoice.payment_succeeded   → 续费成功，延长有效期
 *   - customer.subscription.updated → 订阅方案变更
 *   - customer.subscription.deleted → 订阅取消/过期
 *   - invoice.payment_failed      → 续费失败
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

    // ── 延迟导入 billing-store (避免启动时文件系统错误) ──
    const {
      upsertSubscription,
      deactivateSubscription,
      getSubscriptionByStripeCustomerId,
      getSubscriptionByStripeSubscriptionId,
      recordPayment,
    } = await import("@/lib/billing-store");

    switch (event.type) {
      // ═══════════════════════════════════════════════════
      //  checkout.session.completed
      //  支付/订阅创建成功 → 激活用户权限
      // ═══════════════════════════════════════════════════
      case "checkout.session.completed": {
        const session = event.data.object as any;
        console.log("[Stripe Webhook] Checkout completed:", session.id);

        // 获取用户标识（优先 metadata.user_id，其次 customer_email）
        const userId = session.metadata?.user_id || session.customer_details?.email || `stripe_${session.customer}`;
        const email = session.metadata?.email || session.customer_details?.email || "";
        const planType = session.metadata?.plan_type || "subscription";
        const plan = session.metadata?.plan || "monthly";
        const isPermanent = planType === "license" || plan === "permanent";

        // 计算到期时间
        const now = new Date();
        let periodEnd: Date;
        if (isPermanent) {
          periodEnd = new Date("2099-12-31T23:59:59Z");
        } else if (plan === "yearly") {
          periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        } else {
          periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        }

        // 存储订阅记录
        upsertSubscription(userId, {
          email,
          plan_type: planType as "subscription" | "license",
          plan: plan as "monthly" | "yearly" | "permanent",
          is_active: true,
          is_permanent: isPermanent,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          stripe_session_id: session.id,
          provider: "stripe",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        });

        // 统一测试价 $1.00 入账（按 session.id 去重，幂等）
        recordPayment({
          orderId: session.id,
          provider: "stripe",
          plan: plan as "monthly" | "yearly" | "permanent",
          amount: 1.0,
          email,
        });

        console.log(`[Stripe Webhook] ✅ 订阅已激活: userId=${userId}, plan=${plan}, ends=${periodEnd.toISOString()}`);
        break;
      }

      // ═══════════════════════════════════════════════════
      //  customer.subscription.updated
      //  订阅变更 → 同步更新本地记录
      // ═══════════════════════════════════════════════════
      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] Subscription updated:", subscription.id);

        // 通过 stripe_subscription_id 查找本地记录
        const existing = getSubscriptionByStripeSubscriptionId(subscription.id);
        if (!existing) {
          // 尝试通过 customer ID 查找
          const byCustomer = getSubscriptionByStripeCustomerId(subscription.customer);
          if (byCustomer) {
            upsertSubscription(byCustomer.user_id, {
              stripe_subscription_id: subscription.id,
              plan: subscription.items?.data?.[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly",
              is_active: subscription.status === "active" || subscription.status === "trialing",
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            });
          }
        } else {
          upsertSubscription(existing.user_id, {
            plan: subscription.items?.data?.[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly",
            is_active: subscription.status === "active" || subscription.status === "trialing",
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          });
        }
        break;
      }

      // ═══════════════════════════════════════════════════
      //  customer.subscription.deleted
      //  订阅取消/过期 → 停用权限
      // ═══════════════════════════════════════════════════
      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        console.log("[Stripe Webhook] Subscription deleted:", subscription.id);

        const existing = getSubscriptionByStripeSubscriptionId(subscription.id);
        if (existing) {
          deactivateSubscription(existing.user_id);
          console.log(`[Stripe Webhook] 🔴 订阅已停用: userId=${existing.user_id}`);
        } else {
          console.log("[Stripe Webhook] 未找到对应本地记录的订阅:", subscription.id);
        }
        break;
      }

      // ═══════════════════════════════════════════════════
      //  invoice.payment_succeeded
      //  续费成功 → 延长有效期
      // ═══════════════════════════════════════════════════
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] Invoice paid:", invoice.id);

        if (invoice.subscription) {
          const existing = getSubscriptionByStripeSubscriptionId(invoice.subscription);
          if (existing) {
            // 获取 Stripe 订阅的最新信息
            try {
              const updatedSub = (await stripe.subscriptions.retrieve(invoice.subscription)) as any;
              upsertSubscription(existing.user_id, {
                is_active: true,
                current_period_start: new Date(updatedSub.current_period_start * 1000).toISOString(),
                current_period_end: new Date(updatedSub.current_period_end * 1000).toISOString(),
              });
              console.log(`[Stripe Webhook] 💳 续费成功: userId=${existing.user_id}, new_end=${new Date(updatedSub.current_period_end * 1000).toISOString()}`);
            } catch (err) {
              console.error("[Stripe Webhook] 获取订阅详情失败:", err);
            }
          }
        }
        break;
      }

      // ═══════════════════════════════════════════════════
      //  invoice.payment_failed
      //  续费失败 → 记录日志
      // ═══════════════════════════════════════════════════
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        console.log("[Stripe Webhook] ❌ Invoice payment failed:", invoice.id);

        if (invoice.subscription) {
          const existing = getSubscriptionByStripeSubscriptionId(invoice.subscription);
          if (existing) {
            console.warn(`[Stripe Webhook] ⚠️ 用户 ${existing.user_id} 续费失败，订阅 ${invoice.subscription}`);
          }
        }
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
