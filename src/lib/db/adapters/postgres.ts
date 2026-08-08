import { Pool } from "pg";
import type { SubscriptionRecord, PaymentRecord } from "@/lib/billing-store";
import type { VisionLogEntry } from "@/lib/vision-log-store";
import type { VisitRecord } from "@/lib/analytics-store";
import type { DbAdapter, RecordPaymentInput } from "../types";

/**
 * Postgres 适配器：Vercel Postgres / Neon / Supabase 等标准 PG 连接。
 *
 * 环境变量:
 *   - POSTGRES_URL（Vercel 标准）或 DATABASE_URL
 *
 * 首次使用自动建表（CREATE TABLE IF NOT EXISTS），
 * 结构化列 + jsonb 兜底字段，保证跨实例/跨设备读写一致。
 */
const CONNECTION_STRING = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";

let pool: Pool | null = null;
let ensurePromise: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: CONNECTION_STRING,
      max: 5,
      ssl: process.env.POSTGRES_SSL !== "false" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function ensureTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS calorieai_credits (
        user_id TEXT PRIMARY KEY,
        credits INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS calorieai_subscriptions (
        user_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS calorieai_payments (
        id TEXT PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        provider TEXT NOT NULL,
        plan TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS calorieai_vision_logs (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT,
        label TEXT,
        status INT NOT NULL DEFAULT 200,
        latency_ms INT NOT NULL DEFAULT 0,
        count INT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS calorieai_visits (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip TEXT NOT NULL DEFAULT '',
        ua TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '/'
      );
    `).then(() => undefined);
  }
  return ensurePromise;
}

async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  await ensureTables();
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}

export const postgresAdapter: DbAdapter = {
  kind: "postgres",

  getCredits: async (userId) => {
    const rows = await query<{ credits: number }>(
      "SELECT credits FROM calorieai_credits WHERE user_id = $1",
      [userId]
    );
    return rows[0]?.credits ?? null;
  },
  setCredits: async (userId, credits) => {
    await query(
      `INSERT INTO calorieai_credits (user_id, credits, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET credits = EXCLUDED.credits, updated_at = NOW()`,
      [userId, Math.max(0, Math.floor(credits))]
    );
  },

  getSubscription: async (userId) => {
    const rows = await query<{ data: SubscriptionRecord }>(
      "SELECT data FROM calorieai_subscriptions WHERE user_id = $1",
      [userId]
    );
    return rows[0]?.data ?? null;
  },
  getSubscriptionByEmail: async (email) => {
    const all = await postgresAdapter.getAllSubscriptions();
    return all.find((s) => s.email === email) || null;
  },
  getSubscriptionByStripeCustomerId: async (customerId) => {
    const all = await postgresAdapter.getAllSubscriptions();
    return all.find((s) => s.stripe_customer_id === customerId) || null;
  },
  getSubscriptionByStripeSubscriptionId: async (subscriptionId) => {
    const all = await postgresAdapter.getAllSubscriptions();
    return all.find((s) => s.stripe_subscription_id === subscriptionId) || null;
  },
  upsertSubscription: async (userId, data) => {
    const existing = await postgresAdapter.getSubscription(userId);
    const now = new Date().toISOString();
    const record: SubscriptionRecord = {
      user_id: userId,
      email: data.email || existing?.email || "",
      plan_type: data.plan_type || existing?.plan_type || "subscription",
      plan: data.plan || existing?.plan || "monthly",
      is_active: data.is_active ?? existing?.is_active ?? true,
      is_permanent: data.is_permanent ?? existing?.is_permanent ?? false,
      stripe_customer_id: data.stripe_customer_id || existing?.stripe_customer_id,
      stripe_subscription_id: data.stripe_subscription_id || existing?.stripe_subscription_id,
      stripe_session_id: data.stripe_session_id || existing?.stripe_session_id,
      paypal_order_id: data.paypal_order_id || existing?.paypal_order_id,
      provider: data.provider || existing?.provider || "stripe",
      current_period_start: data.current_period_start || existing?.current_period_start || now,
      current_period_end: data.current_period_end || existing?.current_period_end || now,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    await query(
      `INSERT INTO calorieai_subscriptions (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userId, JSON.stringify(record)]
    );
    return record;
  },
  deactivateSubscription: async (userId) => {
    const existing = await postgresAdapter.getSubscription(userId);
    if (!existing) return null;
    existing.is_active = false;
    existing.updated_at = new Date().toISOString();
    await query(
      "UPDATE calorieai_subscriptions SET data = $2, updated_at = NOW() WHERE user_id = $1",
      [userId, JSON.stringify(existing)]
    );
    return existing;
  },
  getAllSubscriptions: async () => {
    const rows = await query<{ data: SubscriptionRecord }>("SELECT data FROM calorieai_subscriptions");
    return rows.map((r) => r.data);
  },

  recordPayment: async (input: RecordPaymentInput) => {
    await ensureTables();
    const record: PaymentRecord = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      order_id: input.orderId,
      provider: input.provider,
      plan: input.plan,
      amount: input.amount,
      currency: input.currency || "USD",
      email: input.email || undefined,
      created_at: new Date().toISOString(),
    };
    try {
      await getPool().query(
        `INSERT INTO calorieai_payments (id, order_id, provider, plan, amount, currency, email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (order_id) DO NOTHING`,
        [record.id, record.order_id, record.provider, record.plan, record.amount, record.currency, record.email, record.created_at]
      );
      return record;
    } catch {
      return null; // order_id 冲突等 → 幂等跳过
    }
  },
  getPayments: async () => {
    const rows = await query<{
      id: string; order_id: string; provider: string; plan: string;
      amount: string; currency: string; email: string | null; created_at: string;
    }>(
      "SELECT id, order_id, provider, plan, amount, currency, email, created_at FROM calorieai_payments ORDER BY created_at"
    );
    return rows.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      provider: r.provider as "stripe" | "paypal",
      plan: r.plan as "monthly" | "yearly" | "permanent",
      amount: Number(r.amount),
      currency: r.currency,
      email: r.email || undefined,
      created_at: r.created_at,
    }));
  },

  recordVisionLog: async (entry) => {
    await query(
      `INSERT INTO calorieai_vision_logs (ts, ip, provider, model, label, status, latency_ms, count, error)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.ip, entry.provider, entry.model || null, entry.label || null, entry.status, entry.latency_ms, entry.count ?? null, entry.error || null]
    );
  },
  getVisionLogs: async (limit = 100) => {
    const rows = await query<{
      ts: string; ip: string; provider: string; model: string | null; label: string | null;
      status: number; latency_ms: number; count: number | null; error: string | null;
    }>("SELECT ts, ip, provider, model, label, status, latency_ms, count, error FROM calorieai_vision_logs ORDER BY ts DESC LIMIT $1", [limit]);
    return rows.map((r) => ({
      ts: r.ts, ip: r.ip, provider: r.provider, model: r.model || undefined, label: r.label || undefined,
      status: r.status, latency_ms: r.latency_ms, count: r.count ?? undefined, error: r.error || undefined,
    }));
  },
  getAllVisionLogs: async () => {
    const rows = await query<{
      ts: string; ip: string; provider: string; model: string | null; label: string | null;
      status: number; latency_ms: number; count: number | null; error: string | null;
    }>("SELECT ts, ip, provider, model, label, status, latency_ms, count, error FROM calorieai_vision_logs ORDER BY ts");
    return rows.map((r) => ({
      ts: r.ts, ip: r.ip, provider: r.provider, model: r.model || undefined, label: r.label || undefined,
      status: r.status, latency_ms: r.latency_ms, count: r.count ?? undefined, error: r.error || undefined,
    }));
  },

  recordVisit: async (entry) => {
    await query(
      "INSERT INTO calorieai_visits (ts, ip, ua, path) VALUES (NOW(), $1, $2, $3)",
      [entry.ip, entry.ua, entry.path]
    );
  },
  getVisits: async () => {
    const rows = await query<{ ts: string; ip: string; ua: string; path: string }>(
      "SELECT ts, ip, ua, path FROM calorieai_visits ORDER BY ts"
    );
    return rows.map((r) => ({ ts: r.ts, ip: r.ip, ua: r.ua, path: r.path }));
  },
};
