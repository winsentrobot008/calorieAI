import { NextRequest, NextResponse } from "next/server";
import {
  createDistributedLimiter,
  getClientIp,
  type RateLimitResult,
} from "@/lib/anti-crawler";
import { checkRateLimit } from "@/lib/rate-limit";
import { addServerCredits, db } from "@/lib/db";
import { resolveMealUserId } from "@/lib/cost-control";
import { AD_REWARD_CREDITS } from "@/lib/local-store";

const DAY_SECONDS = 24 * 60 * 60;
/** 单账号每日最多看 5 次激励广告，单 IP 每日最多 10 次（防脚本刷奖励） */
const AD_DAILY_PER_USER = 5;
const AD_DAILY_PER_IP = 10;

const userDaily = createDistributedLimiter("calorieai:rl:ad-user-daily", AD_DAILY_PER_USER, DAY_SECONDS);
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
 * 激励广告奖励的唯一权威入口：服务端按 user_id 入账（不信任客户端 delta），
 * 并以「账号 + IP 每日上限」双重限频，避免刷广告换积分。
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const body = await request.json().catch(() => ({}));
  const userId = await resolveMealUserId(String(body?.user_id || ""), ip);

  const userLimit = await checkDaily(userDaily, userId, AD_DAILY_PER_USER);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: "AD_LIMIT_REACHED", detail: "今日广告奖励次数已达上限" },
      { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSeconds || DAY_SECONDS) } }
    );
  }
  const ipLimit = await checkDaily(ipDaily, ip, AD_DAILY_PER_IP);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "AD_LIMIT_REACHED", detail: "今日广告奖励次数已达上限" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds || DAY_SECONDS) } }
    );
  }

  const credits = await addServerCredits(userId, AD_REWARD_CREDITS);
  const sub = await db.getSubscription(userId);
  const isPro = !!sub?.is_active;
  return NextResponse.json({
    status: "ok",
    message: `广告观看成功！获得 +${AD_REWARD_CREDITS} 积分`,
    credits,
    is_pro: isPro,
    rewarded: true,
  });
}
