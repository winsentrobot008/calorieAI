/**
 * cost-control — CalorieAI 积分守卫适配层（商业引擎统一实现）
 *
 * 权威逻辑已迁移至 commercial-engine/middleware/credit-guard.ts：
 *   - Upstash 分布式限频（429，@upstash/ratelimit 滑窗由本适配层注入）
 *   - 原子扣积分（402 INSUFFICIENT_CREDITS）
 *   - 失败退分（refund）与身份裁定（resolveMealUserId）
 *
 * 本文件保留原导出签名，路由无需改动；存储经本地 db 适配器注入。
 */

import {
  createMealCreditRefund,
  createMealCreditGuard,
  type MealGuardResult,
} from "@commercial-engine/middleware/credit-guard";
import type { DistributedRateLimiter } from "@commercial-engine/middleware/rate-limit";
import { createDistributedLimiter } from "@/lib/anti-crawler";
import { db, initCreditsIfMissing } from "@/lib/db";
import { anonymousUserId, isServerIssuedUserId } from "@/lib/user-identity";

/** 积分守卫限频参数（与 credit-guard 默认值保持一致） */
const MEAL_WINDOW_SECONDS = 60;
const MEAL_WINDOW_LIMIT = 6;

/**
 * 把 @upstash/ratelimit 滑窗检查器适配为引擎的 DistributedRateLimiter 端口。
 * 引擎目录不引入第三方依赖（无 node_modules），故由本适配层注入，
 * 与 anti-crawler 的 IP 限频共用同一套高性能滑窗实例。
 */
const mealRateCheck = createDistributedLimiter(
  "calorieai:meal-rate",
  MEAL_WINDOW_LIMIT,
  MEAL_WINDOW_SECONDS
);

const mealRateLimiter: DistributedRateLimiter | null = mealRateCheck
  ? {
      async check(key: string): Promise<{ success: boolean; reset: number; remaining: number }> {
        const result = await mealRateCheck(key);
        return {
          success: result.allowed,
          remaining: result.remaining,
          reset: Date.now() + (result.retryAfterSeconds ?? 0) * 1000,
        };
      },
    }
  : null;

const guard = createMealCreditGuard({
  ledger: {
    initCreditsIfMissing,
    setCredits: (userId, credits) => db.setCredits(userId, credits),
  },
  windowSeconds: MEAL_WINDOW_SECONDS,
  windowLimit: MEAL_WINDOW_LIMIT,
  distributedLimiter: mealRateLimiter,
});

export type { MealGuardResult };

export function reserveMealCredit(userId: string, ip: string): Promise<MealGuardResult> {
  return guard(userId, ip);
}

const refundMealCreditAtomic = createMealCreditRefund({
  initCreditsIfMissing,
  setCredits: (userId, credits) => db.setCredits(userId, credits),
});

/**
 * 服务端身份裁定（防止 user_id 伪造）：
 *   1. 形状合法（user_<16 位十六进制>）且服务端已存在积分记录 → 采用该账号；
 *   2. 其余一律回落到按 IP 派生的匿名账号（anon_<哈希>）。
 *
 * 这样轮换任意 user_id 字符串既无法命中他人账号，也不会各自触发
 * initCreditsIfMissing 的免费额度赠送。
 */
export async function resolveMealUserId(claimedUserId: string, ip: string): Promise<string> {
  const claimed = (claimedUserId || "").trim();
  if (isServerIssuedUserId(claimed)) {
    const existing = await db.getCredits(claimed);
    if (existing !== null) return claimed;
  }
  return anonymousUserId(ip);
}

/** 退还 1 积分（AI 调用失败补偿）：异常仅记服务端日志，绝不影响接口返回 */
export async function refundMealCredit(userId: string, amount = 1): Promise<void> {
  try {
    await refundMealCreditAtomic(userId, amount);
  } catch (err: unknown) {
    console.error("[Credits] 退分失败:", err instanceof Error ? err.message : err);
  }
}
