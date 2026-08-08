import { NextRequest, NextResponse } from "next/server";
import { activateSubscription } from "@/lib/billing-activate";
import { recordPayment } from "@/lib/billing-store";

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
    const record = activateSubscription({
      userId: effectiveUserId,
      email: email || "",
      plan: plan as "monthly" | "yearly" | "permanent",
      provider: provider as "stripe" | "paypal",
      orderId: orderId || undefined,
    });

    // 统一测试价 $1.00 入账（按 order_id 去重；PayPal 主路径已在 capture 入账，此路径为兜底）
    recordPayment({
      orderId: orderId || `sub_${Date.now()}`,
      provider: provider as "stripe" | "paypal",
      plan: plan as "monthly" | "yearly" | "permanent",
      amount: 1.0,
      email: email || "",
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
