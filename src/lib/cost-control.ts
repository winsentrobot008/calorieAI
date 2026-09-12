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
} from "@git008/commercial-engine/middleware/credit-guard";
import type { DistributedRateLimiter } from "@git008/commercial-engine/middleware/rate-limit";
import { isAdminToken, isAdminUserId } from "@/lib/admin-access";
import { createDistributedLimiter } from "@/lib/anti-crawler";
import { db, initCreditsIfMissing } from "@/lib/db";
import { consumeTrialQuota, releaseTrialQuota } from "@/lib/trial-quota";
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

// ─── 上线测试期每日频控：普通用户 3 次 / 24h，管理员不限 ─────────────────────

/** 测试期普通用户每日（24 小时滑动窗口）请求上限 */
export const TRIAL_DAILY_LIMIT = 3;
/** 超限错误码（HTTP 429） */
export const TRIAL_LIMIT_CODE = "TRIAL_DAILY_LIMIT";
/** 超限提示文案（按要求逐字返回） */
export const TRIAL_LIMIT_MESSAGE = "测试阶段普通用户每天限额 3 次，如需更多额度请联系管理员";

export interface TrialLimitInput {
  /** 服务端裁定的调用方身份（登录账号 user_<hash>；匿名回落为 IP 派生的 anon_<hash>） */
  userId: string;
  /** 客户端真实 IP（userId 缺失时的兜底判重维度） */
  ip: string;
  /** 路由已判定为管理员（x-admin-token / 管理员 user_id） */
  isAdmin?: boolean;
  /** 管理员令牌（可选，服务端二次校验，防止绕过） */
  adminToken?: string | null;
}

export interface TrialLimitResult {
  allowed: boolean;
  /** true = 管理员豁免，未计数、无上限 */
  unlimited: boolean;
  limit: number;
  used: number;
  /** 剩余次数；管理员豁免时为 null（无上限） */
  remaining: number | null;
  retryAfter?: number;
  status?: 429;
  code?: string;
  detail?: string;
}

/**
 * 判重 key：优先 User ID（登录账号 / 匿名 IP 派生 ID），
 * 缺失时回落到真实 IP，保证「User ID / IP / Session」三维判重不失效。
 */
function trialQuotaKey(userId: string, ip: string): string {
  const id = (userId || "").trim();
  if (id) return `user:${id}`;
  return `ip:${(ip || "").trim() || "unknown"}`;
}

/**
 * 测试期每日限额校验（消费 1 次额度）：
 *   - 管理员（管理员 user_id / 有效 x-admin-token / 静态 ADMIN_API_TOKEN）
 *     → 直接放行，不计数、不限次；
 *   - 普通用户 → 24 小时内最多 TRIAL_DAILY_LIMIT 次，超限返回 429 + 指定文案。
 */
export async function reserveTrialDailyLimit(input: TrialLimitInput): Promise<TrialLimitResult> {
  const admin = input.isAdmin === true || isAdminUserId(input.userId) || isAdminToken(input.adminToken);
  if (admin) {
    return { allowed: true, unlimited: true, limit: TRIAL_DAILY_LIMIT, used: 0, remaining: null };
  }

  const check = await consumeTrialQuota(trialQuotaKey(input.userId, input.ip), TRIAL_DAILY_LIMIT);
  if (!check.allowed) {
    return {
      allowed: false,
      unlimited: false,
      limit: TRIAL_DAILY_LIMIT,
      used: check.used,
      remaining: 0,
      retryAfter: check.retryAfterSeconds,
      status: 429,
      code: TRIAL_LIMIT_CODE,
      detail: TRIAL_LIMIT_MESSAGE,
    };
  }
  return {
    allowed: true,
    unlimited: false,
    limit: TRIAL_DAILY_LIMIT,
    used: check.used,
    remaining: check.remaining,
  };
}

/** 退还 1 次测试期额度（AI 调用失败补偿，best-effort，绝不影响接口返回） */
export async function releaseTrialDailyLimit(userId: string, ip: string): Promise<void> {
  try {
    await releaseTrialQuota(trialQuotaKey(userId, ip));
  } catch (err: unknown) {
    console.error("[TrialLimit] 退次数失败:", err instanceof Error ? err.message : err);
  }
}
