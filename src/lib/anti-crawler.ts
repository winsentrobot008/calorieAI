/**
 * anti-crawler — WAF & 反爬虫防护（CalorieAI）
 *
 * 1) checkAntiCrawler: 校验 User-Agent 与请求特征，拦截明显爬虫/自动化客户端；
 * 2) rateLimitRequest / dailyRateLimitRequest: 单 IP 滑动窗口限频
 *    （权威限频实现位于 commercial-engine/middleware/rate-limit.ts）。
 * 3) rateLimitRequestDistributed / dailyRateLimitRequestDistributed:
 *    配置 Upstash / Vercel KV 时使用 @upstash/ratelimit 单实例滑窗（单次管道往返，
 *    相比手写 REST 的 5 次命令往返显著降低边缘延迟），未配置时回退进程内限频。
 *
 * 注意：真实浏览器（Chrome/Firefox/Safari/Playwright Chromium）UA 不含特征词，不会被误伤。
 */

import { NextRequest } from "next/server";
import {
  clientIpFromHeaders,
  createInMemoryRateLimiter,
  getUpstashRestConfig,
} from "@commercial-engine/middleware/rate-limit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const BOT_UA_PATTERN =
  /(bot|crawler|spider|scraper|curl|wget|python-requests|python-urllib|httpie|postman|headless|phantom|selenium|puppeteer|go-http-client|okhttp|axios|node-fetch|libwww|java\/|http-client|apachebench|ab\s|wrk)/i;

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

/** 取客户端真实 IP（优先 x-forwarded-for，其次 x-real-ip） */
export function getClientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

/**
 * 简易反爬虫校验：拦截无 UA、明显 Bot/CLI/自动化爬虫 UA。
 */
export function checkAntiCrawler(userAgent: string): GuardResult {
  const ua = userAgent || "";
  if (!ua) {
    return { blocked: true, reason: "MISSING_USER_AGENT" };
  }
  if (BOT_UA_PATTERN.test(ua)) {
    return { blocked: true, reason: "BOT_USER_AGENT" };
  }
  return { blocked: false };
}

// ─── 单 IP 滑动窗口限频（商业引擎统一实现） ──────────────────────────────
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const minuteLimiter = createInMemoryRateLimiter({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_WINDOW,
});

// ─── 单 IP 每日滑动窗口限频（Vision API 降本：默认 30 次/日） ─────────
const DAILY_WINDOW_MS = 24 * 60 * 60_000;
const DAILY_MAX_REQUESTS = 30;
const dailyLimiter = createInMemoryRateLimiter({
  windowMs: DAILY_WINDOW_MS,
  limit: DAILY_MAX_REQUESTS,
});

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

/** 针对 analyze-image 的限频：单 IP 每分钟最多 6 次 */
export function rateLimitRequest(ip: string): RateLimitResult {
  const result = minuteLimiter.check(ip);
  return result.allowed
    ? { allowed: true, remaining: result.remaining }
    : { allowed: false, remaining: 0, retryAfterSeconds: result.retryAfterSeconds };
}

/**
 * Vision API 降本频控：单 IP 每 24 小时最多 30 次（滑动窗口）。
 * 与每分钟 6 次的短期防刷叠加，双闸门同时生效。
 */
export function dailyRateLimitRequest(
  ip: string,
  limit: number = DAILY_MAX_REQUESTS
): RateLimitResult {
  const result =
    limit === DAILY_MAX_REQUESTS
      ? dailyLimiter.check(ip)
      : createInMemoryRateLimiter({ windowMs: DAILY_WINDOW_MS, limit }).check(ip);
  return result.allowed
    ? { allowed: true, remaining: result.remaining }
    : { allowed: false, remaining: 0, retryAfterSeconds: result.retryAfterSeconds };
}

// ─── 分布式限频（@upstash/ratelimit 单实例滑窗，未配置时回退进程内） ──────

/** 分布式限流检查器（一次调用完成计数，失败时由调用方降级） */
export type DistributedLimitCheck = (key: string) => Promise<RateLimitResult>;

function createRedis(): Redis | null {
  const cfg = getUpstashRestConfig();
  if (!cfg) return null;
  try {
    return new Redis({ url: cfg.url, token: cfg.token });
  } catch (err) {
    console.warn(
      "[RateLimit] Upstash 配置无效，回退进程内限频:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

const redis = createRedis();

/**
 * 创建分布式限流器：复用单个 Ratelimit slidingWindow 实例，
 * SDK 内部以管道方式完成「写入 + 清理 + 计数」，一次网络往返取代手写 REST 的 5 次；
 * 附加进程内 ephemeralCache，同一实例内重复命中的键直接短路，不再访问 Redis。
 * 未配置 Upstash / Vercel KV 时返回 null，由调用方回退进程内限频。
 */
export function createDistributedLimiter(
  prefix: string,
  limit: number,
  windowSeconds: number
): DistributedLimitCheck | null {
  if (!redis) return null;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix,
    analytics: false,
    ephemeralCache: new Map<string, number>(),
  });
  return async (key: string): Promise<RateLimitResult> => {
    const { success, remaining, reset } = await limiter.limit(key);
    if (success) return { allowed: true, remaining };
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
    };
  };
}

/** 单次分布式检查的最长等待，超时即降级（@upstash/redis 默认带指数退避重试，不可直接等待） */
const DISTRIBUTED_TIMEOUT_MS = 1_000;
/** Redis 故障后的熔断冷却时间：冷却期内直接走进程内限频，不再拖慢请求 */
const DEGRADE_COOLDOWN_MS = 30_000;
let distributedDownUntil = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RATE_LIMIT_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 分布式优先、未配置 / 超时 / Redis 异常时回退进程内限频（降级而非放行）。
 * 失败后进入冷却期，避免每个请求都为不可用的 Redis 付出退避重试延迟。
 */
async function checkWithFallback(
  distributed: DistributedLimitCheck | null,
  key: string,
  fallback: () => RateLimitResult
): Promise<RateLimitResult> {
  if (!distributed || Date.now() < distributedDownUntil) return fallback();
  try {
    return await withTimeout(distributed(key), DISTRIBUTED_TIMEOUT_MS);
  } catch {
    distributedDownUntil = Date.now() + DEGRADE_COOLDOWN_MS;
    return fallback();
  }
}

const minuteDistributed = createDistributedLimiter(
  "calorieai:rl:ip-minute",
  MAX_REQUESTS_PER_WINDOW,
  60
);
const dailyDistributed = createDistributedLimiter(
  "calorieai:rl:ip-daily",
  DAILY_MAX_REQUESTS,
  24 * 60 * 60
);

/**
 * 单 IP 每分钟限频（分布式优先）：
 * 多副本 Serverless 下限频不再按实例放大；未配置或 Redis 异常时回退进程内。
 */
export function rateLimitRequestDistributed(ip: string): Promise<RateLimitResult> {
  return checkWithFallback(minuteDistributed, ip, () => rateLimitRequest(ip));
}

/**
 * 单 IP 每日限频（分布式优先，语义同 dailyRateLimitRequest）：
 * Vision API 降本频控，默认 30 次 / 24 小时。
 */
export function dailyRateLimitRequestDistributed(
  ip: string,
  limit: number = DAILY_MAX_REQUESTS
): Promise<RateLimitResult> {
  if (limit !== DAILY_MAX_REQUESTS) return Promise.resolve(dailyRateLimitRequest(ip, limit));
  return checkWithFallback(dailyDistributed, ip, () => dailyRateLimitRequest(ip, limit));
}

/** 测试辅助：清空限频桶（仅测试/诊断用） */
export function _resetRateLimitBuckets(): void {
  minuteLimiter.reset?.();
  dailyLimiter.reset?.();
}
