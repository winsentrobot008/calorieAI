import { NextRequest, NextResponse } from "next/server";
import { upsertSubscription } from "@/lib/billing-store";

/**
 * POST /api/v1/billing/subscribe?plan=monthly&user_id=xxx&email=xxx&provider=paypal&order_id=xxx
 *
 * PayPal 支付完成后，手动激活订阅（因为 PayPal 无 webhook）。
 * Stripe 支付由 webhook 自动处理。
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const plan = searchParams.get("plan") || "monthly";
    const userId = searchParams.get("user_id");
    const email = searchParams.get("email");
    const provider = searchParams.get("provider") || "paypal";
    const orderId = searchParams.get("order_id");

    if (!userId && !email) {
      return NextResponse.json(
        { error: "缺少用户标识 (user_id 或 email)" },
        { status: 400 },
      );
    }

    const effectiveUserId = userId || email || `paypal_${orderId || Date.now()}`;
    const isPermanent = plan === "permanent";

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

    const record = upsertSubscription(effectiveUserId, {
      email: email || "",
      plan_type: isPermanent ? "license" : "subscription",
      plan: plan as "monthly" | "yearly" | "permanent",
      is_active: true,
      is_permanent: isPermanent,
      paypal_order_id: orderId || undefined,
      provider: provider as "stripe" | "paypal",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    });

    return NextResponse.json({
      status: "ok",
      message: `订阅成功 (${plan})`,
      subscription_id: `sub_${Date.now()}`,
      user_id: effectiveUserId,
      plan: record.plan,
      is_permanent: record.is_permanent,
      current_period_end: record.current_period_end,
    });
  } catch (error: any) {
    console.error("[Billing Subscribe Error]", error);
    return NextResponse.json(
      { error: error.message || "订阅处理失败" },
      { status: 500 },
    );
  }
}
