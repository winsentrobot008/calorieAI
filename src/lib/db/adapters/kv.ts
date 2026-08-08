import type { SubscriptionRecord, PaymentRecord } from "@/lib/billing-store";
import type { VisionLogEntry } from "@/lib/vision-log-store";
import type { VisitRecord } from "@/lib/analytics-store";
import type { DbAdapter, RecordPaymentInput } from "../types";

/**
 * KV 适配器：Vercel KV / Upstash Redis（REST 协议，无额外 SDK 依赖）。
 *
 * 环境变量:
 *   - KV_REST_API_URL / VERCEL_KV_REST_API_URL / UPSTASH_REDIS_REST_URL
 *   - KV_REST_API_TOKEN / VERCEL_KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN
 */
const KV_URL =
  process.env.KV_REST_API_URL ||
  process.env.VERCEL_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  "";
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.VERCEL_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${KV_TOKEN}` };
}

async function kvGet<T>(key: string): Promise<T | null> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`[KV] get failed: ${res.status}`);
  const data = await res.json();
  const raw = data?.result;
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value)),
  });
  if (!res.ok) throw new Error(`[KV] set failed: ${res.status}`);
}

const K = {
  credits: (userId: string) => `calorieai:credits:${userId}`,
  subscriptions: "calorieai:subscriptions",
  payments: "calorieai:payments",
  visionLogs: "calorieai:vision_logs",
  visits: "calorieai:visits",
};

async function readMap<T>(key: string): Promise<Record<string, T>> {
  return (await kvGet<Record<string, T>>(key)) || {};
}

export const kvAdapter: DbAdapter = {
  kind: "kv",

  getCredits: async (userId) => {
    const value = await kvGet<number>(K.credits(userId));
    return typeof value === "number" ? value : null;
  },
  setCredits: async (userId, credits) => {
    await kvSet(K.credits(userId), Math.max(0, Math.floor(credits)));
  },

  getSubscription: async (userId) => (await readMap<SubscriptionRecord>(K.subscriptions))[userId] || null,
  getSubscriptionByEmail: async (email) => {
    const map = await readMap<SubscriptionRecord>(K.subscriptions);
    return Object.values(map).find((s) => s.email === email) || null;
  },
  getSubscriptionByStripeCustomerId: async (customerId) => {
    const map = await readMap<SubscriptionRecord>(K.subscriptions);
    return Object.values(map).find((s) => s.stripe_customer_id === customerId) || null;
  },
  getSubscriptionByStripeSubscriptionId: async (subscriptionId) => {
    const map = await readMap<SubscriptionRecord>(K.subscriptions);
    return Object.values(map).find((s) => s.stripe_subscription_id === subscriptionId) || null;
  },
  upsertSubscription: async (userId, data) => {
    const map = await readMap<SubscriptionRecord>(K.subscriptions);
    const existing = map[userId];
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
    map[userId] = record;
    await kvSet(K.subscriptions, map);
    return record;
  },
  deactivateSubscription: async (userId) => {
    const map = await readMap<SubscriptionRecord>(K.subscriptions);
    const existing = map[userId];
    if (!existing) return null;
    existing.is_active = false;
    existing.updated_at = new Date().toISOString();
    await kvSet(K.subscriptions, map);
    return existing;
  },
  getAllSubscriptions: async () => Object.values(await readMap<SubscriptionRecord>(K.subscriptions)),

  recordPayment: async (input: RecordPaymentInput) => {
    const payments = (await kvGet<PaymentRecord[]>(K.payments)) || [];
    if (payments.some((p) => p.order_id === input.orderId)) return null;
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
    payments.push(record);
    await kvSet(K.payments, payments.slice(-2000));
    return record;
  },
  getPayments: async () => (await kvGet<PaymentRecord[]>(K.payments)) || [],

  recordVisionLog: async (entry) => {
    const logs = (await kvGet<VisionLogEntry[]>(K.visionLogs)) || [];
    logs.push({ ...entry, ts: new Date().toISOString() });
    await kvSet(K.visionLogs, logs.slice(-500));
  },
  getVisionLogs: async (limit = 100) => ((await kvGet<VisionLogEntry[]>(K.visionLogs)) || []).slice(-limit).reverse(),
  getAllVisionLogs: async () => (await kvGet<VisionLogEntry[]>(K.visionLogs)) || [],

  recordVisit: async (entry) => {
    const visits = (await kvGet<VisitRecord[]>(K.visits)) || [];
    visits.push({ ...entry, ts: new Date().toISOString() });
    await kvSet(K.visits, visits.slice(-2000));
  },
  getVisits: async () => (await kvGet<VisitRecord[]>(K.visits)) || [],
};
