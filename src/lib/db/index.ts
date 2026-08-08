/**
 * 统一数据库访问层 (Database Access Layer)
 *
 * 根据环境变量自动选择适配器:
 *   1. POSTGRES_URL / DATABASE_URL  → Postgres（Vercel Postgres / Neon / Supabase）
 *   2. KV_REST_API_URL + KV_REST_API_TOKEN → Vercel KV / Upstash Redis
 *   3. 均未配置 → 本地文件（os.tmpdir()）回退
 *
 * 上层业务只依赖 db 与聚合函数，不感知具体存储实现。
 */

import type { DbAdapter, PaymentStats, VisionStats, VisitStats } from "./types";
import { fileAdapter } from "./adapters/file";
import { kvAdapter } from "./adapters/kv";
import { postgresAdapter } from "./adapters/postgres";

function pickAdapter(): DbAdapter {
  const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (pgUrl) {
    console.log("[DB] Using Postgres adapter (POSTGRES_URL / DATABASE_URL)");
    return postgresAdapter;
  }
  const kvUrl =
    process.env.KV_REST_API_URL ||
    process.env.VERCEL_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const kvToken =
    process.env.KV_REST_API_TOKEN ||
    process.env.VERCEL_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    console.log("[DB] Using KV adapter (Vercel KV / Upstash)");
    return kvAdapter;
  }
  console.log("[DB] Using file adapter (os.tmpdir fallback)");
  return fileAdapter;
}

/** 全局数据库访问实例 */
export const db: DbAdapter = pickAdapter();

// ─── 统一聚合服务（适配器无关，全部基于原始数据计算） ──────────────────

/** 收入统计：总金额 / 订阅与买断拆分 / 方案拆分 / 最近流水 */
export async function getPaymentStats(): Promise<PaymentStats> {
  const payments = await db.getPayments();
  let total = 0;
  let subscription = 0;
  let license = 0;
  const planBreakdown: Record<string, number> = { monthly: 0, yearly: 0, permanent: 0 };
  for (const p of payments) {
    total += p.amount;
    if (p.plan === "permanent") license += p.amount;
    else subscription += p.amount;
    planBreakdown[p.plan] = (planBreakdown[p.plan] || 0) + p.amount;
  }
  return {
    total_revenue: total,
    count: payments.length,
    subscription_revenue: subscription,
    license_revenue: license,
    plan_breakdown: planBreakdown,
    recent_payments: payments.slice(-20).reverse(),
  };
}

/** 识图统计：总调用 / 今日 / 错误率 / 按提供商与模型聚合 */
export async function getVisionStats(): Promise<VisionStats> {
  const logs = await db.getAllVisionLogs();
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCalls = logs.filter((l) => l.ts.slice(0, 10) === todayKey).length;
  const errors = logs.filter((l) => l.status >= 400).length;

  const byKey = new Map<string, { name: string; model?: string; calls: number; errors: number; latencyTotal: number }>();
  for (const l of logs) {
    const key = `${l.provider}|${l.model || ""}`;
    const cur = byKey.get(key) || { name: l.provider, model: l.model, calls: 0, errors: 0, latencyTotal: 0 };
    cur.calls += 1;
    if (l.status >= 400) cur.errors += 1;
    cur.latencyTotal += l.latency_ms;
    byKey.set(key, cur);
  }

  return {
    total_calls: logs.length,
    today_calls: todayCalls,
    errors,
    error_rate_pct: logs.length ? Math.round((errors / logs.length) * 1000) / 10 : 0,
    by_provider: Array.from(byKey.values()).map((v) => ({
      name: v.name,
      model: v.model,
      calls: v.calls,
      errors: v.errors,
      avg_latency_ms: v.calls ? Math.round(v.latencyTotal / v.calls) : 0,
    })),
  };
}

/** 访问统计：总量 / 今日 / 独立 IP / 最近 IP / 最近访问 */
export async function getVisitStats(): Promise<VisitStats> {
  const visits = await db.getVisits();
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = visits.filter((v) => v.ts.slice(0, 10) === todayKey).length;

  const byIp = new Map<string, { count: number; last_seen: string }>();
  for (const v of visits) {
    const cur = byIp.get(v.ip) || { count: 0, last_seen: v.ts };
    cur.count += 1;
    if (v.ts > cur.last_seen) cur.last_seen = v.ts;
    byIp.set(v.ip, cur);
  }

  return {
    total_visits: visits.length,
    today_visits: today,
    unique_ips: byIp.size,
    recent_ips: Array.from(byIp.entries())
      .map(([ip, info]) => ({ ip, ...info }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    recent_visits: visits.slice(-20).reverse(),
  };
}

export async function getActiveSubscriptionCount(): Promise<number> {
  const subs = await db.getAllSubscriptions();
  return subs.filter((s) => s.is_active).length;
}

export async function getPermanentLicenseCount(): Promise<number> {
  const subs = await db.getAllSubscriptions();
  return subs.filter((s) => s.is_active && s.is_permanent).length;
}

/** 读取积分；无记录时初始化赠送（默认 3）并返回 */
export async function initCreditsIfMissing(userId: string, fallback = 3): Promise<number> {
  const current = await db.getCredits(userId);
  if (current === null) {
    await db.setCredits(userId, fallback);
    return fallback;
  }
  return current;
}

/** 增减积分（不低于 0），返回新余额 */
export async function addServerCredits(userId: string, delta: number): Promise<number> {
  const current = await initCreditsIfMissing(userId);
  const next = Math.max(0, current + delta);
  await db.setCredits(userId, next);
  return next;
}
