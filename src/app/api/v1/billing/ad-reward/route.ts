import { NextRequest, NextResponse } from "next/server";
import {
  createDistributedLimiter,
  getClientIp,
  type RateLimitResult,
} from "@/lib/anti-crawler";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  db,
  claimAdReward,
  ensureDailyQuota,
  AD_DAILY_LIMIT,
  AD_REWARD_CREDITS,
} from "@/lib/db";
import { resolveMealUserId } from "@/lib/cost-control";

const DAY_SECONDS = 24 * 60 * 60;
/** 单 IP 每日最多 10 次（防脚本批量刷奖励）；单账号上限见 AD_DAILY_LIMIT = 3 */
const AD_DAILY_PER_IP = 10;

const ipDaily = createDistributedLimiter("calorieai:rl:ad-ip-daily", AD_DAILY_PER_IP, DAY_SECONDS);

/** 分布式限频缺失/异常时的进程内降级实现 */
function memoryFallback(key: string, limit: number): RateLimitResult {
  const result = checkRateLimit(`ad:${key}`, limit, DAY_SECONDS * 1000);
  return result.allowed
    ? { allowed: true, remaining: result.remaining ?? 0 }
    : {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((result.retryAfterMs || DAY_SECONDS * 1000) / 1000),
      };
}

async function checkDaily(
  limiter: ReturnType<typeof createDistributedLimiter>,
  key: string,
  limit: number
): Promise<RateLimitResult> {
  if (!limiter) return memoryFallback(key, limit);
  try {
    return await limiter(key);
  } catch {
    return memoryFallback(key, limit);
  }
}

/**
 * POST /api/v1/billing/ad-reward
 *
 * 激励广告奖励的唯一权威入口（2026-09 规则）：
 *   - 服务端按 user_id 入账，不信任客户端 delta；
 *   - 每次奖励 AD_REWARD_CREDITS（1 积分），即「1 广告 = 1 积分」；
 *   - 单账号每日上限 AD_DAILY_LIMIT（3 次），计数持久化在用户积分档案
 *     daily_ad_views_today，达到上限返回 400 AD_DAILY_LIMIT_REACHED；
 *   - IP 维度每日 10 次兜底限频（429），防止脚本轮换账号刷奖励。
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const body = await request.json().catch(() => ({}));
  const userId = await resolveMealUserId(String(body?.user_id || ""), ip);

  // 日切结算：跨 UTC 自然日先清零每日广告计数，避免昨日次数占用今日额度
  await ensureDailyQuota(userId);

  const ipLimit = await checkDaily(ipDaily, ip, AD_DAILY_PER_IP);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "AD_LIMIT_REACHED", detail: "今日广告奖励次数已达上限" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds || DAY_SECONDS) } }
    );
  }

  const result = await claimAdReward(userId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code || "AD_REWARD_FAILED",
        code: result.code || "AD_REWARD_FAILED",
        detail: `今日广告奖励次数已达上限（每日最多 ${AD_DAILY_LIMIT} 次）`,
        credits: result.profile?.credits ?? (await db.getCredits(userId)) ?? 0,
        daily_ad_views_today: result.profile?.daily_ad_views_today ?? AD_DAILY_LIMIT,
        daily_ad_limit: AD_DAILY_LIMIT,
        rewarded: false,
      },
      { status: 400 }
    );
  }

  const sub = await db.getSubscription(userId);
  const isPro = !!sub?.is_active;
  return NextResponse.json({
    status: "ok",
    message: `广告观看成功！获得 +${AD_REWARD_CREDITS} 积分`,
    credits: result.profile?.credits ?? 0,
    daily_ad_views_today: result.profile?.daily_ad_views_today ?? 0,
    daily_ad_limit: AD_DAILY_LIMIT,
    is_pro: isPro,
    rewarded: true,
  });
}