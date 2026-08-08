import type { SubscriptionRecord } from "@/lib/billing-store";
import { db } from "@/lib/db";

export interface ActivateSubscriptionOptions {
  /** 用户唯一标识 */
  userId: string;
  /** 用户邮箱（可选） */
  email?: string;
  /** 方案标识: "monthly" | "yearly" | "permanent" */
  plan: "monthly" | "yearly" | "permanent";
  /** 支付渠道: "stripe" | "paypal" */
  provider: "stripe" | "paypal";
  /** PayPal Order ID（PayPal 渠道记录用） */
  orderId?: string;
}

/**
 * 统一激活订阅 / Pro 权限：
 * 计算周期到期时间（永久买断 → 2099-12-31）并写入 billing-store。
 * Stripe Webhook、PayPal Capture、手动订阅接口共用此逻辑，避免到期时间计算不一致。
 */
export async function activateSubscription(options: ActivateSubscriptionOptions): Promise<SubscriptionRecord> {
  const { userId, email = "", plan, provider, orderId } = options;
  const isPermanent = plan === "permanent";

  const now = new Date();
  let periodEnd: Date;
  if (isPermanent) {
    periodEnd = new Date("2099-12-31T23:59:59Z");
  } else if (plan === "yearly") {
    periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  } else {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  return db.upsertSubscription(userId, {
    email,
    plan_type: isPermanent ? "license" : "subscription",
    plan,
    is_active: true,
    is_permanent: isPermanent,
    paypal_order_id: orderId || undefined,
    provider,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
  });
}
