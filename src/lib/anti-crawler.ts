/**
 * anti-crawler — WAF & 反爬虫防护
 *
 * 1) checkAntiCrawler: 校验 User-Agent 与请求特征，拦截明显爬虫/自动化客户端；
 * 2) rateLimitRequest: 针对单 IP 的滑动窗口频次限制（防并发恶意消耗 API 额度）。
 *
 * 注意：真实浏览器（Chrome/Firefox/Safari/Playwright Chromium）UA 不含特征词，不会被误伤。
 */

import { NextRequest } from "next/server";

const BOT_UA_PATTERN =
  /(bot|crawler|spider|scraper|curl|wget|python-requests|python-urllib|httpie|postman|headless|phantom|selenium|puppeteer|go-http-client|okhttp|axios|node-fetch|libwww|java\/|http-client|apachebench|ab\s|wrk)/i;

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

/** 取客户端真实 IP（优先 x-forwarded-for，其次 x-real-ip） */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
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

// ─── 单 IP 滑动窗口限频 ──────────────────────────────────────────────
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const buckets = new Map<string, number[]>();

// ─── 单 IP 每日滑动窗口限频（Vision API 降本：默认 30 次/日） ─────────
const DAILY_WINDOW_MS = 24 * 60 * 60_000;
const DAILY_MAX_REQUESTS = 30;
const dailyBuckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

/** 针对 analyze-image 的限频：单 IP 每分钟最多 6 次 */
export function rateLimitRequest(ip: string): RateLimitResult {
  const now = Date.now();
  const timestamps = (buckets.get(ip) || []).filter((ts) => now - ts < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    buckets.set(ip, timestamps);
    const retryAfter = Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  timestamps.push(now);
  buckets.set(ip, timestamps);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - timestamps.length };
}

/**
 * Vision API 降本频控：单 IP 每 24 小时最多 30 次（滑动窗口）。
 * 与每分钟 6 次的短期防刷叠加，双闸门同时生效。
 */
export function dailyRateLimitRequest(
  ip: string,
  limit: number = DAILY_MAX_REQUESTS
): RateLimitResult {
  const now = Date.now();
  const timestamps = (dailyBuckets.get(ip) || []).filter(
    (ts) => now - ts < DAILY_WINDOW_MS
  );

  if (timestamps.length >= limit) {
    dailyBuckets.set(ip, timestamps);
    const retryAfter = Math.ceil((timestamps[0] + DAILY_WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  timestamps.push(now);
  dailyBuckets.set(ip, timestamps);

  // 清理 24h 内无活动的 Key，防止 Map 无限增长
  if (dailyBuckets.size > 5000) {
    const nowMs = Date.now();
    for (const [k, v] of dailyBuckets) {
      if (!v.some((t) => nowMs - t < DAILY_WINDOW_MS)) dailyBuckets.delete(k);
    }
  }

  return { allowed: true, remaining: limit - timestamps.length };
}

/** 测试辅助：清空限频桶（仅测试/诊断用） */
export function _resetRateLimitBuckets(): void {
  buckets.clear();
  dailyBuckets.clear();
}
