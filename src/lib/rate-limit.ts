/**
 * rate-limit — CalorieAI 限频适配层（商业引擎统一实现）
 *
 * 权威逻辑已迁移至 commercial-engine/middleware/rate-limit.ts：
 *   - checkRateLimit：内存滑动窗口（best-effort）
 *   - createUpstashSlidingWindowLimiter：Upstash / Vercel KV 分布式限频
 *
 * 本文件保留原导出签名（auth 等路由无需改动）。
 */

import {
  checkRateLimit as sharedCheckRateLimit,
  clientIpFromHeaders,
  type LegacyCheckResult,
} from "@commercial-engine/middleware/rate-limit";

export interface RateLimitResult extends LegacyCheckResult {}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  return sharedCheckRateLimit(key, limit, windowMs);
}

/** 从请求头提取客户端 IP（Vercel 代理链第一位） */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers);
}
