/**
 * rate-limit — 轻量内存滑动窗口限频（best-effort）
 *
 * 用于注册 / 验证码发送等防刷接口：
 *   - 单 IP 60 秒内仅限 1 次；
 *   - 单 IP 每小时最多 5 次。
 * 注意：Vercel Serverless 多实例下为尽力而为（每实例独立计数），
 * 生产高防建议接入 Vercel KV / Upstash 分布式限频。
 */

type Bucket = number[];

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  retryAfterMs?: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    };
  }
  recent.push(now);
  buckets.set(key, recent);
  // 防止 Map 无限增长
  if (buckets.size > 5000) {
    const nowMs = Date.now();
    for (const [k, v] of buckets) {
      if (!v.some((t) => nowMs - t < 3600_000)) buckets.delete(k);
    }
  }
  return { allowed: true, remaining: limit - recent.length };
}

/** 从请求头提取客户端 IP（Vercel 代理链第一位） */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
