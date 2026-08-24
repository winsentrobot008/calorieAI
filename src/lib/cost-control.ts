import { db, initCreditsIfMissing } from "@/lib/db";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const WINDOW_SECONDS = 60;
const WINDOW_LIMIT = 6;

export interface MealGuardResult {
  allowed: boolean;
  status?: 402 | 429;
  code?: string;
  retryAfter?: number;
}

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

async function checkDistributedRateLimit(key: string): Promise<MealGuardResult> {
  const redis = getRedis();
  if (!redis) return { allowed: true };
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(WINDOW_LIMIT, `${WINDOW_SECONDS} s`),
    prefix: "calorieai:meal-rate",
  });
  const result = await limiter.limit(key);
  return result.success
    ? { allowed: true }
    : { allowed: false, status: 429, code: "RATE_LIMITED", retryAfter: Math.ceil((result.reset - Date.now()) / 1000) };
}

export async function reserveMealCredit(userId: string, ip: string): Promise<MealGuardResult> {
  const rate = await checkDistributedRateLimit(userId || ip);
  if (!rate.allowed) return rate;
  const accountId = userId || "anonymous";
  const current = await initCreditsIfMissing(accountId);
  if (current < 1) return { allowed: false, status: 402, code: "INSUFFICIENT_CREDITS" };
  await db.setCredits(accountId, current - 1);
  return { allowed: true };
}