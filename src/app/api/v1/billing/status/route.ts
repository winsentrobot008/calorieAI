import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/v1/billing/status?user_id=xxx&email=xxx
 *
 * 获取用户当前订阅状态。
 * 支持 user_id 或 email 查询。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const email = searchParams.get("email");

  // ── 没有用户标识时返回默认免费用户状态 ──
  if (!userId && !email) {
    return NextResponse.json({
      is_premium: false,
      is_permanent: false,
      remaining_daily_recognitions: 3,
      daily_free_uses: 3,
      ad_reward_credits: 0,
      free_tier: true,
      subscription: null,
    });
  }

  // ── 查询订阅记录 ──
  let record = userId ? await db.getSubscription(userId) : null;
  if (!record && email) {
    record = await db.getSubscriptionByEmail(email);
  }

  // ── 未找到订阅记录 → 免费用户 ──
  if (!record) {
    return NextResponse.json({
      is_premium: false,
      is_permanent: false,
      remaining_daily_recognitions: 3,
      daily_free_uses: 3,
      ad_reward_credits: 0,
      free_tier: true,
      subscription: null,
    });
  }

  // ── 检查是否过期 ──
  const now = new Date();
  const periodEnd = new Date(record.current_period_end);
  const isExpired = periodEnd < now;

  // ── 判断付费状态 ──
  const isPremium = record.is_active && !isExpired;
  const isPermanent = record.is_permanent && isPremium;

  // ── 计算剩余免费次数 ──
  // Pro 用户无限次；免费用户每日 3 次
  const remainingDaily = isPremium ? 999 : 3;

  return NextResponse.json({
    is_premium: isPremium,
    is_permanent: isPermanent,
    remaining_daily_recognitions: remainingDaily,
    daily_free_uses: 3,
    ad_reward_credits: 0,
    free_tier: !isPremium,
    subscription: {
      plan: record.plan,
      plan_type: record.plan_type,
      provider: record.provider,
      is_active: isPremium,
      current_period_start: record.current_period_start,
      current_period_end: record.current_period_end,
      is_expired: isExpired,
    },
  });
}
